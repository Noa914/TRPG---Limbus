'use strict';

/* ═══════════════════════════════════════
   LIMBUS TRPG · app.js
═══════════════════════════════════════ */

/* ─── 상수 ─── */
const STATS = [
  { key:'strength',    label:'힘',   icon:'⚔' },
  { key:'agility',     label:'민첩', icon:'◎' },
  { key:'endurance',   label:'내구', icon:'◉' },
  { key:'luck',        label:'행운', icon:'✦' },
  { key:'technique',   label:'기술', icon:'⬡' },
  { key:'intelligence',label:'지능', icon:'◈' },
];

const AFFILIATIONS = [
  { group:'협회', opts:[
    '하나협회','츠바이협회','섕크협회','시협회','트레스협회',
    '리우협회','세븐협회','에잇협회','재바찌협회','디에치협회','외우피협회','기타협회'
  ]},
  { group:'무소속', opts:['무소속'] },
  { group:'죄인 (손가락)', opts:['엄지','검지','중지','약지'] },
];
const AFFIL_ALL = AFFILIATIONS.flatMap(g => g.opts); // 17개

const INIT_STARLIGHT = 3;
const STAT_MIN = 1, STAT_MAX = 100;

/* ─── 전역 상태 ─── */
let gameStarted = false;
let characters  = [];   // CharState[]
let globalLog   = [];
let masterStat  = 'strength';
let masterDice  = 10;
let modalTarget = null; // { charId }

/* ─── 유틸 ─── */
const rand = n => Math.floor(Math.random() * n) + 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randStat = () => rand(100);
const randAffil = () => AFFIL_ALL[Math.floor(Math.random() * AFFIL_ALL.length)];

function calcModifier(statVal) {
  return Math.round((statVal - 50) / 10);
}

/* ─── 캐릭터 ID 생성 ─── */
let _idCnt = 0;
const newId = () => ++_idCnt;

/* ─── 캐릭터 상태 ─── */
function createChar() {
  const stats = {};
  STATS.forEach(s => { stats[s.key] = randStat(); });
  return {
    id: newId(),
    name: '',
    affil: randAffil(),
    stats,
    starlight: INIT_STARLIGHT,
    lastRoll: null,   // { raw, mod, final, dice, stat, verdict, resultClass }
  };
}

/* ══════════════════════════════════════
   배경 파티클
══════════════════════════════════════ */
(function() {
  const cv = document.getElementById('bg-canvas');
  const cx = cv.getContext('2d');
  let W, H, pts = [];
  function resize(){ W = cv.width = innerWidth; H = cv.height = innerHeight; }
  function mkPt(){ return { x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*.16, vy:(Math.random()-.5)*.16,
    r:Math.random()*1.1+.3, a:Math.random()*.45+.08, h:Math.random()>.5?270:45 }; }
  resize();
  for(let i=0;i<55;i++) pts.push(mkPt());
  window.addEventListener('resize', resize);
  (function draw(){
    cx.clearRect(0,0,W,H);
    pts.forEach(p=>{
      cx.beginPath(); cx.arc(p.x,p.y,p.r,0,Math.PI*2);
      cx.fillStyle=`hsla(${p.h},60%,70%,${p.a})`; cx.fill();
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
    });
    requestAnimationFrame(draw);
  })();
})();

/* ══════════════════════════════════════
   소속 <select> 옵션 HTML 생성
══════════════════════════════════════ */
function buildAffilOptions(selectedVal) {
  return AFFILIATIONS.map(g =>
    `<optgroup label="── ${g.group} ──">` +
    g.opts.map(o => `<option value="${o}"${o===selectedVal?' selected':''}>${o}</option>`).join('') +
    `</optgroup>`
  ).join('');
}

/* ══════════════════════════════════════
   캐릭터 카드 HTML 생성
══════════════════════════════════════ */
function charCardHTML(ch, idx) {
  const statsHTML = STATS.map(s => {
    const v = ch.stats[s.key];
    const pct = v + '%';
    return `
      <div class="stat-item" data-stat="${s.key}">
        <span class="stat-icon">${s.icon}</span>
        <span class="stat-name">${s.label}</span>
        <span class="stat-val">${v}</span>
        <div class="stat-bar-wrap"><div class="stat-bar" style="width:${pct}"></div></div>
      </div>`;
  }).join('');

  const lastResHTML = ch.lastRoll
    ? `<div class="char-last-result ${ch.lastRoll.resultClass}" style="display:block">
         <span class="char-result-val">${ch.lastRoll.final}</span>
         <span class="char-result-verdict">${ch.lastRoll.verdict}</span>
         <div style="font-size:.65rem;color:var(--text-dim);margin-top:.2rem">
           1D${ch.lastRoll.dice} · ${ch.lastRoll.statLabel}${ch.lastRoll.mod!==0?(ch.lastRoll.mod>0?' +'+ch.lastRoll.mod:' '+ch.lastRoll.mod):''}
         </div>
       </div>` : '';

  const removeBtn = gameStarted ? '' :
    `<button class="card-remove" data-action="remove" data-id="${ch.id}" title="캐릭터 삭제">✕</button>`;

  return `
  <div class="char-card${gameStarted?' locked':''}" id="char-card-${ch.id}">
    <div class="card-header">
      <span class="card-num">NO.${String(idx+1).padStart(2,'0')}</span>
      <span class="card-title" id="ctitle-${ch.id}">${ch.name || '이름 없음'}</span>
      ${removeBtn}
    </div>

    <div class="starlight-bar">
      <span class="starlight-label">✦ 별빛</span>
      <span class="starlight-count" id="sl-count-${ch.id}">${ch.starlight}</span>
      <button class="starlight-use-btn" data-action="use-starlight" data-id="${ch.id}"
        ${ch.starlight<=0?'disabled':''}>별빛 사용</button>
    </div>

    <div class="form-group">
      <label class="form-label">캐릭터 이름</label>
      <input type="text" class="form-input" data-field="name" data-id="${ch.id}"
        placeholder="이름을 입력하세요" value="${ch.name}" ${gameStarted?'disabled':''}/>
    </div>

    <div class="form-group">
      <label class="form-label">종족</label>
      <select class="form-select" disabled>
        <option>인간</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">소속</label>
      <div class="affil-row">
        <select class="form-select" data-field="affil" data-id="${ch.id}"
          id="affil-${ch.id}" ${gameStarted?'disabled':''}>
          ${buildAffilOptions(ch.affil)}
        </select>
        ${gameStarted?'':
          `<button class="reroll-btn" data-action="reroll-affil" data-id="${ch.id}" title="소속 재굴림 (1D${AFFIL_ALL.length})">🎲</button>`}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">능력치 <span class="hint">— 1D100 랜덤 설정됨</span></label>
      <div class="stats-grid">${statsHTML}</div>
    </div>

    ${lastResHTML}
  </div>`;
}

/* ══════════════════════════════════════
   렌더링
══════════════════════════════════════ */
function renderChars() {
  const container = document.getElementById('chars-container');
  container.innerHTML = characters.map((ch, i) => charCardHTML(ch, i)).join('');
}

function renderSingleChar(ch) {
  const idx = characters.findIndex(c => c.id === ch.id);
  const card = document.getElementById(`char-card-${ch.id}`);
  if (!card) { renderChars(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = charCardHTML(ch, idx);
  card.replaceWith(tmp.firstElementChild);
}

function renderGlobalLog() {
  const el = document.getElementById('global-log-list');
  if (!globalLog.length) {
    el.innerHTML = '<div class="log-empty">아직 판정 기록이 없습니다.</div>';
    return;
  }
  el.innerHTML = [...globalLog].reverse().map(r => {
    const ts = r.ts.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return `
      <div class="log-item ${r.resultClass}">
        <span class="log-dot"></span>
        <span class="log-rv">${r.final}</span>
        <span class="log-meta">${r.charName} · ${r.statLabel} · 1D${r.dice}${r.dc?' DC'+r.dc:''}</span>
        <span class="log-verdict">${r.verdict}</span>
        <span style="color:var(--text-muted);font-size:.62rem;margin-left:auto">${ts}</span>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════
   게임 단계 전환
══════════════════════════════════════ */
function startGame() {
  if (characters.length === 0) { alert('캐릭터를 최소 1명 이상 추가하세요.'); return; }
  gameStarted = true;
  document.getElementById('phase-label').textContent = '◈ 게임 진행 중';
  document.getElementById('btn-start-game').disabled = true;
  document.getElementById('btn-add-char').disabled = true;
  document.getElementById('master-panel').style.display = '';
  renderChars();
}

/* ══════════════════════════════════════
   마스터 판정 실행
══════════════════════════════════════ */
function doMasterRoll() {
  const reason = document.getElementById('master-reason').value.trim();
  const dcRaw  = parseInt(document.getElementById('master-dc').value);
  const dc     = isNaN(dcRaw) ? null : dcRaw;

  const results = characters.map(ch => {
    const statVal = ch.stats[masterStat];
    const statLabel = STATS.find(s => s.key === masterStat).label;
    const raw  = rand(masterDice);
    const mod  = calcModifier(statVal);
    const final = clamp(raw + mod, 1, masterDice + Math.abs(mod));

    let verdict, resultClass;
    if (dc === null) { verdict = '판정 완료'; resultClass = 'neutral'; }
    else if (final >= dc) { verdict = '성공'; resultClass = 'success'; }
    else { verdict = '실패'; resultClass = 'failure'; }

    const rollData = { raw, mod, final, dice: masterDice, stat: masterStat,
                       statLabel, statVal, dc, verdict, resultClass,
                       charName: ch.name || '이름 없음',
                       reason, ts: new Date() };

    ch.lastRoll = rollData;
    globalLog.push(rollData);
    if (globalLog.length > 100) globalLog.shift();

    return { ch, rollData };
  });

  // 캐릭터 카드 업데이트
  results.forEach(({ ch }) => renderSingleChar(ch));

  // 판정 결과 목록
  const judgeList = document.getElementById('judge-list');
  judgeList.innerHTML = results.map(({ ch, rollData: r }) => `
    <div class="judge-item ${r.resultClass}">
      <div class="judge-name">${ch.name || '이름 없음'}</div>
      <div class="judge-roll">${r.final}</div>
      <div class="judge-verdict">${r.verdict}</div>
      <div class="judge-detail">${r.statLabel}(${r.statVal}) · 1D${r.dice}${r.mod!==0?(r.mod>0?' +'+r.mod:' '+r.mod):''}</div>
    </div>`).join('');

  document.getElementById('judge-results').style.display = '';

  // reason 입력창 자동 초기화
  // document.getElementById('master-reason').value = '';

  renderGlobalLog();
}

/* ══════════════════════════════════════
   별빛 모달
══════════════════════════════════════ */
function openStarlightModal(charId) {
  const ch = characters.find(c => c.id === charId);
  if (!ch) return;
  modalTarget = charId;

  document.getElementById('modal-char-name').textContent = ch.name || '이름 없음';
  document.getElementById('modal-starlight-val').textContent = ch.starlight;
  document.getElementById('modal-affil-current').textContent = ch.affil;

  // 마지막 판정
  const lastEl   = document.getElementById('modal-roll-current');
  const rerollBtn = document.getElementById('modal-roll-reroll');
  if (ch.lastRoll) {
    lastEl.textContent = `${ch.lastRoll.final} (1D${ch.lastRoll.dice})`;
    rerollBtn.disabled = ch.starlight <= 0;
  } else {
    lastEl.textContent = '없음';
    rerollBtn.disabled = true;
  }

  // 스탯 버튼
  const grid = document.getElementById('modal-stat-grid');
  grid.innerHTML = STATS.map(s => `
    <button class="modal-item-btn stat-reroll-btn"
      data-action="reroll-stat" data-stat="${s.key}" data-id="${charId}"
      ${(gameStarted || ch.starlight <= 0) ? 'disabled' : ''}>
      <span>${s.icon} ${s.label}</span>
      <span class="modal-current" style="color:var(--starlight)">${ch.stats[s.key]}</span>
      <span class="modal-cost">✦ ×1</span>
      ${gameStarted ? '<span class="stat-locked-note">🔒 게임 시작 후 변경 불가</span>' : ''}
    </button>`).join('');

  document.getElementById('starlight-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('starlight-modal').style.display = 'none';
  modalTarget = null;
}

function spendStarlight(charId, callback) {
  const ch = characters.find(c => c.id === charId);
  if (!ch || ch.starlight <= 0) { alert('별빛이 부족합니다.'); return; }
  ch.starlight--;
  callback(ch);
  // 모달 수치 갱신
  document.getElementById('modal-starlight-val').textContent = ch.starlight;
  document.getElementById(`sl-count-${charId}`).textContent  = ch.starlight;
  const useBtn = document.querySelector(`.starlight-use-btn[data-id="${charId}"]`);
  if (useBtn) useBtn.disabled = ch.starlight <= 0;
}

/* ══════════════════════════════════════
   이벤트 위임 (전체)
══════════════════════════════════════ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  const id     = parseInt(t.dataset.id);

  /* 캐릭터 삭제 */
  if (action === 'remove' && !gameStarted) {
    characters = characters.filter(c => c.id !== id);
    renderChars();
    return;
  }

  /* 소속 재굴림 (카드 내 🎲 버튼 - 게임 전) */
  if (action === 'reroll-affil' && !gameStarted) {
    const ch = characters.find(c => c.id === id);
    if (!ch) return;
    ch.affil = randAffil();
    const sel = document.getElementById(`affil-${ch.id}`);
    if (sel) { sel.innerHTML = buildAffilOptions(ch.affil); }
    return;
  }

  /* 별빛 사용 버튼 */
  if (action === 'use-starlight') {
    openStarlightModal(id);
    return;
  }

  /* 모달 - 스탯 재굴림 */
  if (action === 'reroll-stat') {
    if (gameStarted) { alert('게임이 시작된 후에는 스탯을 변경할 수 없습니다.'); return; }
    const statKey = t.dataset.stat;
    spendStarlight(id, ch => {
      ch.stats[statKey] = randStat();
      renderSingleChar(ch);
      // 모달 버튼 수치 갱신
      const span = t.querySelector('.modal-current');
      if (span) span.textContent = ch.stats[statKey];
      // 스탯 남은 별빛에 따라 모든 stat 버튼 disabled 갱신
      document.querySelectorAll('#modal-stat-grid .stat-reroll-btn').forEach(btn => {
        btn.disabled = gameStarted || ch.starlight <= 0;
      });
    });
    return;
  }

  /* 모달 - 소속 재굴림 */
  if (action === 'modal-affil-reroll') { /* handled below */ }

  /* 마스터 판정 실행 */
  if (action === 'roll-all') {
    doMasterRoll();
    return;
  }
});

/* 소속 재굴림 (모달) */
document.getElementById('modal-affil-reroll').addEventListener('click', () => {
  if (modalTarget === null) return;
  spendStarlight(modalTarget, ch => {
    ch.affil = randAffil();
    document.getElementById('modal-affil-current').textContent = ch.affil;
    const sel = document.getElementById(`affil-${ch.id}`);
    if (sel) sel.innerHTML = buildAffilOptions(ch.affil);
    renderSingleChar(ch);
    document.getElementById('modal-affil-reroll').disabled = ch.starlight <= 0;
  });
});

/* 판정 재굴림 (모달) */
document.getElementById('modal-roll-reroll').addEventListener('click', () => {
  if (modalTarget === null) return;
  const ch = characters.find(c => c.id === modalTarget);
  if (!ch || !ch.lastRoll) return;
  spendStarlight(modalTarget, chx => {
    const prev = chx.lastRoll;
    const raw   = rand(prev.dice);
    const mod   = calcModifier(chx.stats[prev.stat]);
    const final = clamp(raw + mod, 1, prev.dice + Math.abs(mod));
    let verdict, resultClass;
    if (prev.dc === null) { verdict = '판정 완료'; resultClass = 'neutral'; }
    else if (final >= prev.dc) { verdict = '성공'; resultClass = 'success'; }
    else { verdict = '실패'; resultClass = 'failure'; }
    chx.lastRoll = { ...prev, raw, mod, final, verdict, resultClass, ts: new Date() };
    globalLog.push(chx.lastRoll);
    if (globalLog.length > 100) globalLog.shift();
    renderSingleChar(chx);
    renderGlobalLog();
    // 모달 수치 갱신
    document.getElementById('modal-roll-current').textContent = `${final} (1D${prev.dice})`;
    document.getElementById('modal-roll-reroll').disabled = chx.starlight <= 0;
  });
});

/* 모달 닫기 */
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('starlight-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

/* ── 판정 결과창 닫기 ── */
document.getElementById('judge-close').addEventListener('click', () => {
  document.getElementById('judge-results').style.display = 'none';
});

/* ── 입력 변경 감지 (이름, 소속) ── */
document.getElementById('chars-container').addEventListener('change', e => {
  const t = e.target;
  const id = parseInt(t.dataset.id);
  const ch = characters.find(c => c.id === id);
  if (!ch) return;
  if (t.dataset.field === 'name') {
    ch.name = t.value;
    const titleEl = document.getElementById(`ctitle-${ch.id}`);
    if (titleEl) titleEl.textContent = ch.name || '이름 없음';
  }
  if (t.dataset.field === 'affil') {
    ch.affil = t.value;
  }
});
document.getElementById('chars-container').addEventListener('input', e => {
  const t = e.target;
  const id = parseInt(t.dataset.id);
  const ch = characters.find(c => c.id === id);
  if (!ch) return;
  if (t.dataset.field === 'name') {
    ch.name = t.value;
    const titleEl = document.getElementById(`ctitle-${ch.id}`);
    if (titleEl) titleEl.textContent = ch.name || '이름 없음';
  }
});

/* ── 마스터 패널: 스탯 선택 ── */
document.querySelectorAll('.stat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    masterStat = btn.dataset.stat;
  });
});

/* ── 마스터 패널: 주사위 선택 ── */
document.querySelectorAll('.dice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dice-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    masterDice = parseInt(btn.dataset.dice);
  });
});

/* ── DC ── */
document.getElementById('master-dc-clear').addEventListener('click', () => {
  document.getElementById('master-dc').value = '';
});
document.querySelectorAll('.dc-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('master-dc').value = btn.dataset.dc;
  });
});

/* ── 전체 판정 실행 ── */
document.getElementById('roll-all-btn').addEventListener('click', doMasterRoll);

/* ── 글로벌 로그 초기화 ── */
document.getElementById('global-log-clear').addEventListener('click', () => {
  globalLog = [];
  renderGlobalLog();
});

/* ── 캐릭터 추가 ── */
document.getElementById('btn-add-char').addEventListener('click', () => {
  if (gameStarted) return;
  if (characters.length >= 10) { alert('캐릭터는 최대 10명까지 추가할 수 있습니다.'); return; }
  characters.push(createChar());
  renderChars();
});

/* ── 게임 시작 ── */
document.getElementById('btn-start-game').addEventListener('click', startGame);

/* ─────────────────────────────────────────
   Firebase 실시간 동기화
───────────────────────────────────────── */
let _fbReady = false;
let _localChange = false;  // 로컬→DB 쓰기 중 루프 방지

function serializeChars() {
  return characters.map(ch => ({
    id:       ch.id,
    name:     ch.name,
    affil:    ch.affil,
    stats:    ch.stats,
    starlight: ch.starlight,
    lastRoll: ch.lastRoll ? {
      raw: ch.lastRoll.raw, mod: ch.lastRoll.mod, final: ch.lastRoll.final,
      dice: ch.lastRoll.dice, stat: ch.lastRoll.stat, statLabel: ch.lastRoll.statLabel,
      statVal: ch.lastRoll.statVal, dc: ch.lastRoll.dc, verdict: ch.lastRoll.verdict,
      resultClass: ch.lastRoll.resultClass, charName: ch.lastRoll.charName,
      reason: ch.lastRoll.reason, ts: ch.lastRoll.ts ? ch.lastRoll.ts.getTime() : null
    } : null
  }));
}

function deserializeChars(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.map(ch => ({
    ...ch,
    lastRoll: ch.lastRoll ? {
      ...ch.lastRoll,
      ts: ch.lastRoll.ts ? new Date(ch.lastRoll.ts) : new Date()
    } : null
  }));
}

/* DB에 현재 상태 푸시 */
function pushStateToDb() {
  if (!_fbReady) return;
  const fb = window._fb;
  _localChange = true;
  fb.set(fb.dbChars(), serializeChars())
    .finally(() => { setTimeout(() => { _localChange = false; }, 200); });
  fb.set(fb.dbGameState(), { started: gameStarted });
  fb.set(fb.dbLog(), globalLog.map(r => ({
    ...r, ts: r.ts ? r.ts.getTime() : null
  })));
}

/* DB → 로컬 상태 반영 */
function applyRemoteState(remoteChars, remoteGameState, remoteLog) {
  if (_localChange) return;

  // 캐릭터
  if (remoteChars) {
    const incoming = deserializeChars(remoteChars);
    // id 카운터 동기화
    const maxId = incoming.reduce((m, c) => Math.max(m, c.id), 0);
    if (maxId >= _idCnt) _idCnt = maxId;
    characters = incoming;
    renderChars();
  }
  // 게임 상태
  if (remoteGameState && remoteGameState.started && !gameStarted) {
    gameStarted = true;
    document.getElementById('phase-label').textContent = '◈ 게임 진행 중';
    document.getElementById('btn-start-game').disabled = true;
    document.getElementById('btn-add-char').disabled = true;
    document.getElementById('master-panel').style.display = '';
    renderChars();
  }
  // 로그
  if (remoteLog && Array.isArray(remoteLog)) {
    globalLog = remoteLog.map(r => ({ ...r, ts: r.ts ? new Date(r.ts) : new Date() }));
    renderGlobalLog();
  }
}

/* Firebase 초기화 후 리스너 등록 */
window.addEventListener('firebase-ready', () => {
  _fbReady = true;
  const fb = window._fb;

  // 실시간 리스너 — characters
  fb.onValue(fb.dbChars(), snap => {
    if (_localChange) return;
    const data = snap.val();
    if (data) {
      const incoming = deserializeChars(data);
      const maxId = incoming.reduce((m, c) => Math.max(m, c.id), 0);
      if (maxId >= _idCnt) _idCnt = maxId;
      characters = incoming;
      renderChars();
    }
  });

  // 실시간 리스너 — gameState
  fb.onValue(fb.dbGameState(), snap => {
    const data = snap.val();
    if (data && data.started && !gameStarted) {
      gameStarted = true;
      document.getElementById('phase-label').textContent = '◈ 게임 진행 중';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-add-char').disabled = true;
      document.getElementById('master-panel').style.display = '';
      renderChars();
    }
  });

  // 실시간 리스너 — log
  fb.onValue(fb.dbLog(), snap => {
    if (_localChange) return;
    const data = snap.val();
    if (data && Array.isArray(data)) {
      globalLog = data.map(r => ({ ...r, ts: r.ts ? new Date(r.ts) : new Date() }));
      renderGlobalLog();
    }
  });

  // 실시간 리스너 — images
  fb.onValue(fb.dbImages(), snap => {
    const data = snap.val();
    renderGalleryFromDb(data);
  });

  // 초기 상태 업로드 (처음 접속자만 — DB가 비어있을 때)
  fb.onValue(fb.dbChars(), snap => {
    if (!snap.val() && characters.length > 0) {
      pushStateToDb();
    }
  }, { onlyOnce: true });
});

/* 원본 함수들을 래핑해서 변경 시 DB 동기화 */
const _origStartGame = startGame;
startGame = function() {
  _origStartGame();
  pushStateToDb();
};

/* 캐릭터 추가/삭제/변경 후 동기화 (이벤트 리스너 오버라이드) */
function syncAfterChange() { pushStateToDb(); }

document.getElementById('btn-add-char').addEventListener('click', () => {
  setTimeout(syncAfterChange, 50);
});

/* 이름·소속 변경 감지 동기화 */
document.getElementById('chars-container').addEventListener('change', () => {
  setTimeout(syncAfterChange, 50);
});
document.getElementById('chars-container').addEventListener('input', () => {
  clearTimeout(window._syncTimer);
  window._syncTimer = setTimeout(syncAfterChange, 600);
});

/* ─────────────────────────────────────────
   이미지 갤러리
───────────────────────────────────────── */
let galleryImages = [];   // [{ id, name, dataUrl }]
let lightboxIdx   = 0;
let pendingImgObj = null; // 이름 입력 대기 중 이미지

/* ── 갤러리 렌더 ── */
function renderGallery() {
  const grid  = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  if (!galleryImages.length) {
    empty.style.display = '';
    grid.innerHTML = '';
    grid.appendChild(empty);
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = galleryImages.map((img, i) => `
    <div class="gallery-item" data-idx="${i}">
      <div class="gallery-thumb-wrap">
        <img class="gallery-thumb" src="${img.dataUrl}" alt="${img.name}" loading="lazy"/>
        <button class="gallery-fullscreen-btn" data-action="gallery-open" data-idx="${i}" title="전체화면">⛶</button>
        <button class="gallery-delete-btn" data-action="gallery-delete" data-id="${img.id}" title="삭제">✕</button>
      </div>
      <div class="gallery-name" data-action="gallery-rename" data-idx="${i}">${img.name || '이름 없음'}</div>
    </div>`).join('');
}

/* DB에서 갤러리 수신 */
function renderGalleryFromDb(data) {
  if (!data) { galleryImages = []; renderGallery(); return; }
  // Firebase object → array
  galleryImages = Object.entries(data).map(([id, v]) => ({ id, ...v }));
  renderGallery();
}

/* ── 파일 업로드 처리 ── */
document.getElementById('gallery-upload-btn').addEventListener('click', () => {
  document.getElementById('gallery-file-input').click();
});

document.getElementById('gallery-file-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const defaultName = file.name.replace(/\.[^/.]+$/, '');
    // 이름 입력 모달 띄우기
    await promptImageName(defaultName, dataUrl);
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── 이미지 이름 모달 ── */
function promptImageName(defaultName, dataUrl) {
  return new Promise(resolve => {
    pendingImgObj = { dataUrl, resolve };
    document.getElementById('img-name-input').value = defaultName;
    document.getElementById('img-name-modal').style.display = 'flex';
    document.getElementById('img-name-input').focus();
    document.getElementById('img-name-input').select();
  });
}

function confirmImageName() {
  if (!pendingImgObj) return;
  const name = document.getElementById('img-name-input').value.trim() || '이름 없음';
  const { dataUrl, resolve } = pendingImgObj;
  pendingImgObj = null;
  document.getElementById('img-name-modal').style.display = 'none';

  const newImg = { name, dataUrl, createdAt: Date.now() };

  if (_fbReady) {
    const fb = window._fb;
    fb.push(fb.dbImages(), newImg);
    // onValue 리스너가 자동으로 갱신함
  } else {
    const id = 'local_' + Date.now();
    galleryImages.push({ id, ...newImg });
    renderGallery();
  }
  resolve();
}

document.getElementById('img-name-confirm').addEventListener('click', confirmImageName);
document.getElementById('img-name-cancel').addEventListener('click', () => {
  if (pendingImgObj) { pendingImgObj.resolve(); pendingImgObj = null; }
  document.getElementById('img-name-modal').style.display = 'none';
});
document.getElementById('img-name-close').addEventListener('click', () => {
  if (pendingImgObj) { pendingImgObj.resolve(); pendingImgObj = null; }
  document.getElementById('img-name-modal').style.display = 'none';
});
document.getElementById('img-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmImageName();
});

/* ── 갤러리 이벤트 위임 ── */
document.getElementById('gallery-grid').addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;

  if (action === 'gallery-open') {
    openLightbox(parseInt(t.dataset.idx));
  }
  if (action === 'gallery-delete') {
    const imgId = t.dataset.id;
    if (!confirm('이미지를 삭제하시겠습니까?')) return;
    if (_fbReady && !imgId.startsWith('local_')) {
      const fb = window._fb;
      fb.remove(fb.ref(fb.db, `${fb.ROOM}/images/${imgId}`));
    } else {
      galleryImages = galleryImages.filter(i => i.id !== imgId);
      renderGallery();
    }
  }
  if (action === 'gallery-rename') {
    const idx = parseInt(t.dataset.idx);
    const img = galleryImages[idx];
    if (!img) return;
    const newName = prompt('새 이름을 입력하세요:', img.name);
    if (newName === null) return;
    const trimmed = newName.trim() || '이름 없음';
    if (_fbReady && !img.id.startsWith('local_')) {
      const fb = window._fb;
      fb.update(fb.ref(fb.db, `${fb.ROOM}/images/${img.id}`), { name: trimmed });
    } else {
      galleryImages[idx].name = trimmed;
      renderGallery();
    }
  }
});

/* ── 라이트박스 ── */
function openLightbox(idx) {
  lightboxIdx = idx;
  updateLightbox();
  document.getElementById('lightbox-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  document.getElementById('lightbox-overlay').style.display = 'none';
  document.body.style.overflow = '';
}
function updateLightbox() {
  const img = galleryImages[lightboxIdx];
  if (!img) return;
  document.getElementById('lightbox-img').src     = img.dataUrl;
  document.getElementById('lightbox-caption').textContent = img.name || '';
  document.getElementById('lightbox-prev').style.opacity = lightboxIdx > 0 ? '1' : '0.3';
  document.getElementById('lightbox-next').style.opacity = lightboxIdx < galleryImages.length - 1 ? '1' : '0.3';
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLightbox();
});
document.getElementById('lightbox-prev').addEventListener('click', () => {
  if (lightboxIdx > 0) { lightboxIdx--; updateLightbox(); }
});
document.getElementById('lightbox-next').addEventListener('click', () => {
  if (lightboxIdx < galleryImages.length - 1) { lightboxIdx++; updateLightbox(); }
});
document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox-overlay');
  if (lb.style.display === 'none') return;
  if (e.key === 'Escape')     closeLightbox();
  if (e.key === 'ArrowLeft')  { if (lightboxIdx > 0) { lightboxIdx--; updateLightbox(); } }
  if (e.key === 'ArrowRight') { if (lightboxIdx < galleryImages.length - 1) { lightboxIdx++; updateLightbox(); } }
});

/* ── 판정 실행 후 DB 동기화 (doMasterRoll 오버라이드) ── */
const _origDoMasterRoll = doMasterRoll;
doMasterRoll = function() {
  _origDoMasterRoll();
  setTimeout(syncAfterChange, 80);
};

/* ── 글로벌 로그 초기화 후 DB 동기화 ── */
document.getElementById('global-log-clear').addEventListener('click', () => {
  setTimeout(syncAfterChange, 50);
});

/* ── 초기 캐릭터 1명 생성 ── */
characters.push(createChar());
renderChars();
