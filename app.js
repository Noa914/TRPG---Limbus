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
let isSpectator = false;   // true 면 플레이어(관전자): 마스터 화면을 읽기 전용 미러링
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
  emitChange();
}

function renderSingleChar(ch) {
  const idx = characters.findIndex(c => c.id === ch.id);
  const card = document.getElementById(`char-card-${ch.id}`);
  if (!card) { renderChars(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = charCardHTML(ch, idx);
  card.replaceWith(tmp.firstElementChild);
  emitChange();
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
  emitChange();
}

/* ══════════════════════════════════════
   게임 단계 전환
══════════════════════════════════════ */
function startGame() {
  if (isSpectator) return;
  if (characters.length === 0) { alert('캐릭터를 최소 1명 이상 추가하세요.'); return; }
  gameStarted = true;
  reflectPhase();
  renderChars();
}

/* ══════════════════════════════════════
   마스터 판정 실행
══════════════════════════════════════ */
function doMasterRoll() {
  if (isSpectator) return;
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
  if (isSpectator) return;            // 관전자(플레이어)는 조작 불가
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
  emitChange();
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
  emitChange();
});

/* ── 마스터 패널: 스탯 선택 ── */
document.querySelectorAll('.stat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    masterStat = btn.dataset.stat;
    emitChange();
  });
});

/* ── 마스터 패널: 주사위 선택 ── */
document.querySelectorAll('.dice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dice-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    masterDice = parseInt(btn.dataset.dice);
    emitChange();
  });
});

/* ── DC ── */
document.getElementById('master-dc-clear').addEventListener('click', () => {
  document.getElementById('master-dc').value = '';
  emitChange();
});
document.querySelectorAll('.dc-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('master-dc').value = btn.dataset.dc;
    emitChange();
  });
});
/* 판정 내용/DC 입력도 동기화 */
document.getElementById('master-reason').addEventListener('input', emitChange);
document.getElementById('master-dc').addEventListener('input', emitChange);

/* ── 전체 판정 실행 ── */
document.getElementById('roll-all-btn').addEventListener('click', doMasterRoll);

/* ── 글로벌 로그 초기화 ── */
document.getElementById('global-log-clear').addEventListener('click', () => {
  globalLog = [];
  renderGlobalLog();
});

/* ── 캐릭터 추가 ── */
document.getElementById('btn-add-char').addEventListener('click', () => {
  if (gameStarted || isSpectator) return;
  if (characters.length >= 10) { alert('캐릭터는 최대 10명까지 추가할 수 있습니다.'); return; }
  characters.push(createChar());
  renderChars();
});

/* ── 게임 시작 ── */
document.getElementById('btn-start-game').addEventListener('click', startGame);

/* ── 초기 캐릭터 1명 생성 ── */
characters.push(createChar());
renderChars();


/* ══════════════════════════════════════════════════════════
   실시간 공유 연동 (realtime.js 와 통신) · 이미지 공유 · 관전자
   ══════════════════════════════════════════════════════════ */

/* 상태 변경 알림 — realtime.js 가 'limbus:change' 를 듣고 마스터 상태를 동기화 */
function emitChange() {
  document.dispatchEvent(new CustomEvent('limbus:change'));
}

/* 단계(phase) UI 반영 — 시작 전/후 + 관전자 여부 */
function reflectPhase() {
  const label = document.getElementById('phase-label');
  const panel = document.getElementById('master-panel');
  const sg = document.getElementById('btn-start-game');
  const ac = document.getElementById('btn-add-char');
  if (label) label.textContent = gameStarted ? '◈ 게임 진행 중' : '◈ 캐릭터 생성 단계';
  // 마스터 패널은 게임 시작 후 노출 (관전자도 결과/로그를 보도록 노출)
  if (panel) panel.style.display = gameStarted ? '' : 'none';
  if (sg) sg.disabled = gameStarted || isSpectator;
  if (ac) ac.disabled = gameStarted || isSpectator;
}

/* 마스터 패널의 선택 상태(능력치/주사위/내용/DC)를 현재 전역값에 맞춰 표시 */
function syncMasterPanelUI() {
  document.querySelectorAll('.stat-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.stat === masterStat));
  document.querySelectorAll('.dice-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.dice) === masterDice));
}

/* ── 직렬화 (마스터 → 모든 플레이어) ── */
function getState() {
  return {
    gameStarted,
    masterStat,
    masterDice,
    masterReason: (document.getElementById('master-reason') || {}).value || '',
    masterDc:     (document.getElementById('master-dc')     || {}).value || '',
    characters,           // Date(ts) 는 JSON.stringify 가 ISO 문자열로 변환
    globalLog,
  };
}

/* ── 역직렬화 적용 (플레이어 측) ── */
function applyState(snap) {
  if (!snap) return;
  gameStarted = !!snap.gameStarted;
  if (snap.masterStat) masterStat = snap.masterStat;
  if (snap.masterDice) masterDice = snap.masterDice;

  const reasonEl = document.getElementById('master-reason');
  const dcEl     = document.getElementById('master-dc');
  if (reasonEl) reasonEl.value = snap.masterReason || '';
  if (dcEl)     dcEl.value     = snap.masterDc || '';

  characters = (snap.characters || []).map(c => ({
    ...c,
    lastRoll: c.lastRoll ? { ...c.lastRoll, ts: new Date(c.lastRoll.ts) } : null,
  }));
  globalLog = (snap.globalLog || []).map(r => ({ ...r, ts: new Date(r.ts) }));

  syncMasterPanelUI();
  reflectPhase();
  renderChars();        // 내부에서 emitChange 호출되지만 플레이어는 push 안 함
  renderGlobalLog();
}

/* ── 관전자(플레이어) 모드 진입 ── */
function enterSpectator() {
  isSpectator = true;
  document.body.classList.add('spectator');
  reflectPhase();
}

/* ══════════════════════════════════════
   공유 이미지(장면) 표시
══════════════════════════════════════ */
function setSharedImage(dataUrl, name, visible) {
  const view  = document.getElementById('share-stage-view');
  const empty = document.getElementById('share-stage-empty');
  const cap   = document.getElementById('share-stage-caption');
  const clearBtn = document.getElementById('share-clear');
  if (!view) return;
  if (dataUrl && visible !== false) {
    view.src = dataUrl;
    view.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (cap) cap.textContent = name || '';
    if (clearBtn) clearBtn.disabled = false;
  } else {
    view.removeAttribute('src');
    view.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    if (cap) cap.textContent = '';
    if (clearBtn) clearBtn.disabled = true;
  }
}

/* 이미지 압축: 긴 변을 maxDim 으로 줄이고 JPEG 로 인코딩 (실시간 전송 부담 완화) */
function compressImage(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#0b0b16';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let q = quality;
      let out = cv.toDataURL('image/jpeg', q);
      // 실시간 DB 부담을 줄이기 위해 너무 크면 더 압축
      while (out.length > 900000 && q > 0.4) {
        q -= 0.12;
        out = cv.toDataURL('image/jpeg', q);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 불러오지 못했습니다.')); };
    img.src = url;
  });
}

/* 이미지 선택 → (연결 시) 브로드캐스트 + 로컬 표시 */
async function handleImageFile(file) {
  if (!file || isSpectator) return;
  if (!file.type.startsWith('image/')) { alert('이미지 파일만 업로드할 수 있습니다.'); return; }
  try {
    const dataUrl = await compressImage(file);
    if (LIMBUS.broadcastImage) LIMBUS.broadcastImage(dataUrl, file.name, true);
    setSharedImage(dataUrl, file.name, true);   // 즉시 로컬 반영
  } catch (err) {
    alert(err.message || '이미지 처리 중 오류가 발생했습니다.');
  }
}

/* 이미지 입력 / 지우기 버튼 연결 */
(function bindShareControls() {
  const input = document.getElementById('share-file');
  const drop  = document.getElementById('share-stage');
  const clearBtn = document.getElementById('share-clear');

  if (input) {
    input.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) handleImageFile(f);
      input.value = '';   // 같은 파일 재선택 허용
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (isSpectator) return;
      if (LIMBUS.broadcastImage) LIMBUS.broadcastImage(null);
      setSharedImage(null);
    });
  }
  // 드래그&드롭
  if (drop) {
    ['dragover', 'dragenter'].forEach(ev =>
      drop.addEventListener(ev, e => { if (!isSpectator) { e.preventDefault(); drop.classList.add('drag-over'); } }));
    ['dragleave', 'drop'].forEach(ev =>
      drop.addEventListener(ev, () => drop.classList.remove('drag-over')));
    drop.addEventListener('drop', e => {
      if (isSpectator) return;
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleImageFile(f);
    });
  }
})();

/* ── 공개 API (realtime.js 에서 사용) ── */
const LIMBUS = window.LIMBUS = {
  broadcastImage: null,   // realtime.js 가 마스터 연결 시 주입
  getState,
  applyState,
  setSharedImage,
  enterSpectator,
  emitChange,
};
