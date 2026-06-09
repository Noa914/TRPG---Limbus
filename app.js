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
let currentTurn = null;   // 현재 턴인 캐릭터 id (null = 턴 미시작)
let _prevTurn   = null;   // 턴 변경 감지용 (안내 화면)
let scenarios   = [];     // 불러온 시나리오 목록
let activeScenario = null; // 현재 선택된 시나리오

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
  STATS.forEach(s => { stats[s.key] = null; });   // 처음엔 비어있음 — 유저가 직접 굴림
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
    if (v == null) {
      // 아직 안 굴린 능력치
      const inner = isSpectator
        ? `<span class="stat-pending">대기 중</span>`
        : `<button class="stat-roll-btn" data-action="roll-stat" data-stat="${s.key}" data-id="${ch.id}" title="${s.label} 굴리기 (1D100)">🎲 굴리기</button>`;
      return `
      <div class="stat-item unrolled" data-stat="${s.key}">
        <span class="stat-icon">${s.icon}</span>
        <span class="stat-name">${s.label}</span>
        ${inner}
      </div>`;
    }
    const pct = v + '%';
    return `
      <div class="stat-item" data-stat="${s.key}">
        <span class="stat-icon">${s.icon}</span>
        <span class="stat-name">${s.label}</span>
        <span class="stat-val">${v}</span>
        <div class="stat-bar-wrap"><div class="stat-bar" style="width:${pct}"></div></div>
      </div>`;
  }).join('');

  const anyUnrolled = STATS.some(s => ch.stats[s.key] == null);
  const rollAllBtn = (!gameStarted && !isSpectator && anyUnrolled)
    ? `<button class="roll-all-stats-btn" data-action="roll-all-stats" data-id="${ch.id}">🎲 전체 굴리기</button>` : '';

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
      <label class="form-label">능력치 <span class="hint">— 직접 주사위를 굴리세요 (1D100)</span>${rollAllBtn}</label>
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
  const notReady = characters.some(c => STATS.some(s => c.stats[s.key] == null));
  if (notReady) { alert('게임을 시작하려면 모든 캐릭터의 능력치를 먼저 굴려주세요.'); return; }
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

  // 굴림 애니메이션 — 카드 결과 + 판정 목록 숫자를 동시에 또르르
  const tumbleItems = [];
  results.forEach(({ ch, rollData }) => {
    const card = document.getElementById(`char-card-${ch.id}`);
    const rv = card && card.querySelector('.char-result-val');
    if (rv) tumbleItems.push({ el: rv, final: rollData.final });
  });
  document.querySelectorAll('#judge-list .judge-roll').forEach((el, idx) => {
    if (results[idx]) tumbleItems.push({ el, final: results[idx].rollData.final });
  });
  tumbleMany(tumbleItems, masterDice);

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
      <span class="modal-current" style="color:var(--starlight)">${ch.stats[s.key] ?? '—'}</span>
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
    rollAffilAnimated(id);
    return;
  }

  /* 능력치 직접 굴리기 (카드) */
  if (action === 'roll-stat') {
    if (gameStarted) return;
    rollStatAnimated(id, t.dataset.stat);
    return;
  }
  if (action === 'roll-all-stats') {
    if (gameStarted) return;
    rollAllStats(id);
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
      const fin = randStat();
      rollStatAnimated(id, statKey, fin);     // 카드에서 굴림 애니메이션 + 값 반영
      const span = t.querySelector('.modal-current');
      if (span) span.textContent = fin;
      // 남은 별빛에 따라 모든 stat 버튼 disabled 갱신
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
    currentTurn,
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
  currentTurn = (snap.currentTurn != null) ? snap.currentTurn : null;

  syncMasterPanelUI();
  reflectPhase();
  renderChars();        // 내부에서 emitChange 호출되지만 플레이어는 push 안 함
  renderGlobalLog();
  renderTurn();         // 턴 강조 + 배너 + 변경 시 안내
}

/* ── 관전자(플레이어) 모드 진입 ── */
function enterSpectator() {
  isSpectator = true;
  document.body.classList.add('spectator');
  reflectPhase();
}

/* ══════════════════════════════════════
   공유 화면(장면) 표시 — 이미지 + 제목 + 본문
══════════════════════════════════════ */
function setSharedStage(stage) {
  const view  = document.getElementById('share-stage-view');
  const empty = document.getElementById('share-stage-empty');
  const cap   = document.getElementById('share-stage-caption');
  const clearBtn = document.getElementById('share-clear');
  const overlay = document.getElementById('scene-overlay');
  const sTitle  = document.getElementById('scene-title');
  const sBody   = document.getElementById('scene-body');
  if (!view) return;

  const image = stage && stage.image;
  const title = stage && stage.title;
  const body  = stage && stage.text;
  const name  = stage && stage.name;
  const hasAny = !!(image || title || body);

  // 이미지
  if (image) {
    view.src = image; view.style.display = 'block';
  } else {
    view.removeAttribute('src'); view.style.display = 'none';
  }
  // 장면 제목/본문 오버레이
  if (overlay) {
    if (title || body) {
      overlay.style.display = 'flex';
      overlay.classList.toggle('over-image', !!image);
      if (sTitle) { sTitle.textContent = title || ''; sTitle.style.display = title ? '' : 'none'; }
      if (sBody)  { sBody.textContent  = body  || ''; sBody.style.display  = body  ? '' : 'none'; }
    } else {
      overlay.style.display = 'none';
    }
  }
  if (empty) empty.style.display = hasAny ? 'none' : 'flex';
  if (cap)   cap.textContent = (!title && name) ? name : '';
  if (clearBtn) clearBtn.disabled = !hasAny;
}
/* 하위호환: 이미지 한 장만 표시 */
function setSharedImage(dataUrl, name) {
  setSharedStage(dataUrl ? { image: dataUrl, name } : null);
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
    broadcastStageLocal({ image: dataUrl, name: file.name });
  } catch (err) {
    alert(err.message || '이미지 처리 중 오류가 발생했습니다.');
  }
}

/* 장면 브로드캐스트(연결 시) + 로컬 즉시 반영 */
function broadcastStageLocal(stage) {
  if (LIMBUS.broadcastStage) LIMBUS.broadcastStage(stage);
  setSharedStage(stage);
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
      broadcastStageLocal(null);
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
  broadcastStage: null,   // realtime.js 가 마스터 연결 시 주입 (장면 브로드캐스트)
  getState,
  applyState,
  setSharedStage,
  setSharedImage,
  enterSpectator,
  emitChange,
};


/* ══════════════════════════════════════════════════════════
   주사위 소리 (Web Audio · 외부 파일 없이 합성) + 굴림 애니메이션
   ══════════════════════════════════════════════════════════ */

let _soundOn = true;
let _audioCtx = null;
function audioCtx() {
  if (!_soundOn) return null;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  } catch (e) { return null; }
}

/* 짧은 오실레이터 '딸깍' */
function _blip(freq, dur, type, gain) {
  const c = audioCtx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain || 0.05, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}
/* 주사위 굴러가는 잡음(rattle) */
function _rattle(dur, gain) {
  const c = audioCtx(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.5);
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8;
  const g = c.createGain(); g.gain.value = gain || 0.12;
  src.connect(bp).connect(g).connect(c.destination);
  src.start();
}
const playRollStart = () => { _rattle(0.18, 0.13); };
const playTick      = () => { _blip(380 + Math.random() * 260, 0.045, 'square', 0.04); };
function playLand() {
  _blip(190, 0.16, 'triangle', 0.13);
  setTimeout(() => _blip(120, 0.22, 'sine', 0.10), 25);
}

/* 굴림 애니메이션 — 숫자가 또르르 돌다가 최종값에 정착 */
function rollStatAnimated(charId, statKey, finalOverride) {
  const ch = characters.find(c => c.id === charId);
  if (!ch || gameStarted || isSpectator) return;
  const card = document.getElementById(`char-card-${charId}`);
  if (!card) return;
  const item = card.querySelector(`.stat-item[data-stat="${statKey}"]`);
  if (!item || item.classList.contains('is-rolling')) return;

  const meta  = STATS.find(s => s.key === statKey);
  const final = (finalOverride != null) ? finalOverride : randStat();

  // 굴림용 레이아웃으로 전환
  item.classList.remove('unrolled');
  item.classList.add('is-rolling');
  item.innerHTML =
    `<span class="stat-icon">${meta.icon}</span>` +
    `<span class="stat-name">${meta.label}</span>` +
    `<span class="stat-val rolling">?</span>` +
    `<div class="stat-bar-wrap"><div class="stat-bar" style="width:0%"></div></div>`;
  const valEl = item.querySelector('.stat-val');
  const barEl = item.querySelector('.stat-bar');

  playRollStart();

  // 점점 느려지는 틱 간격 (총 ~720ms)
  const gaps = [40, 45, 50, 58, 68, 80, 95, 115, 140, 170];
  let i = 0;
  function step() {
    if (i < gaps.length - 1) {
      valEl.textContent = rand(100);
      playTick();
      setTimeout(step, gaps[i++]);
    } else {
      // 정착
      valEl.textContent = final;
      valEl.classList.remove('rolling');
      item.classList.remove('is-rolling');
      item.classList.add('just-rolled');
      setTimeout(() => item.classList.remove('just-rolled'), 450);
      ch.stats[statKey] = final;
      barEl.style.width = final + '%';
      playLand();
      // 모두 굴렸으면 '전체 굴리기' 버튼 제거
      if (!STATS.some(s => ch.stats[s.key] == null)) {
        const allBtn = card.querySelector('.roll-all-stats-btn');
        if (allBtn) allBtn.remove();
      }
      emitChange();
    }
  }
  setTimeout(step, 60);
}

/* 전체 굴리기 — 안 굴린 능력치를 순차적으로 */
function rollAllStats(charId) {
  const ch = characters.find(c => c.id === charId);
  if (!ch || gameStarted || isSpectator) return;
  let delay = 0;
  STATS.forEach(s => {
    if (ch.stats[s.key] == null) {
      setTimeout(() => rollStatAnimated(charId, s.key), delay);
      delay += 170;
    }
  });
}

/* 소리 켜기/끄기 토글 */
(function bindSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _soundOn = !_soundOn;
    btn.textContent = _soundOn ? '🔊' : '🔇';
    btn.classList.toggle('off', !_soundOn);
    if (_soundOn) playTick();   // 켰을 때 살짝 확인음
  });
})();


/* ══════════════════════════════════════════════════════════
   추가 애니메이션 · 턴 시스템 · 시나리오
   ══════════════════════════════════════════════════════════ */

const escapeHtml = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* 여러 숫자 요소를 동시에 또르르 → 최종값 정착 (소리 1세트) */
function tumbleMany(items, tumbleMax) {
  if (!items || !items.length) return;
  playRollStart();
  const gaps = [40, 45, 50, 58, 68, 80, 95, 115, 140, 170];
  const max = Math.max(10, tumbleMax || 20);
  let i = 0;
  items.forEach(it => it.el.classList.add('num-rolling'));
  function step() {
    if (i < gaps.length - 1) {
      items.forEach(it => { it.el.textContent = rand(max); });
      playTick();
      setTimeout(step, gaps[i++]);
    } else {
      items.forEach(it => {
        it.el.textContent = it.final;
        it.el.classList.remove('num-rolling');
        it.el.classList.add('num-landed');
        setTimeout(() => it.el.classList.remove('num-landed'), 450);
      });
      playLand();
    }
  }
  setTimeout(step, 40);
}

/* 소속 굴리기 — 드롭다운이 빠르게 바뀌다 정착 */
function rollAffilAnimated(charId) {
  const ch = characters.find(c => c.id === charId);
  if (!ch || gameStarted || isSpectator) return;
  const sel = document.getElementById(`affil-${charId}`);
  if (!sel || sel.classList.contains('affil-rolling')) return;
  const final = randAffil();
  playRollStart();
  sel.classList.add('affil-rolling');
  sel.disabled = true;
  const gaps = [50, 55, 62, 72, 85, 100, 120, 145, 175];
  let i = 0;
  function step() {
    if (i < gaps.length - 1) {
      sel.value = randAffil();
      playTick();
      setTimeout(step, gaps[i++]);
    } else {
      ch.affil = final;
      sel.innerHTML = buildAffilOptions(final);
      sel.value = final;
      sel.classList.remove('affil-rolling');
      sel.disabled = gameStarted;
      playLand();
      emitChange();
    }
  }
  setTimeout(step, 40);
}

/* ══════════════════════════════════════
   턴 시스템
══════════════════════════════════════ */
function renderTurn() {
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('active-turn'));
  let activeCh = null, activeIdx = -1;
  if (currentTurn != null) {
    activeIdx = characters.findIndex(c => c.id === currentTurn);
    activeCh  = characters[activeIdx] || null;
    if (activeCh) {
      const card = document.getElementById('char-card-' + currentTurn);
      if (card) card.classList.add('active-turn');
    }
  }
  const banner = document.getElementById('turn-banner');
  if (banner) {
    if (activeCh) {
      banner.style.display = 'flex';
      const txt = document.getElementById('turn-banner-text');
      if (txt) txt.textContent = `NO.${String(activeIdx + 1).padStart(2, '0')} · ${activeCh.name || '이름 없음'} 의 턴`;
    } else {
      banner.style.display = 'none';
    }
  }
  // 턴 변경 → 안내 화면
  if (currentTurn != null && currentTurn !== _prevTurn && activeCh) {
    showTurnAnnounce(activeIdx + 1, activeCh.name || '이름 없음');
  }
  _prevTurn = currentTurn;
  // 턴 컨트롤은 마스터 + 게임중에만
  const tc = document.getElementById('turn-controls');
  if (tc) tc.style.display = (gameStarted && !isSpectator) ? 'flex' : 'none';
}

function showTurnAnnounce(num, name) {
  const el = document.getElementById('turn-announce');
  if (!el) return;
  const n = document.getElementById('turn-announce-num');
  const nm = document.getElementById('turn-announce-name');
  if (n)  n.textContent = 'NO.' + String(num).padStart(2, '0');
  if (nm) nm.textContent = name;
  el.classList.remove('show');
  void el.offsetWidth;       // 리플로우로 애니메이션 재시작
  el.classList.add('show');
  playTick();
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1900);
}

function setTurn(charId) {
  if (isSpectator) return;
  currentTurn = charId;
  renderTurn();
  emitChange();
}
function stepTurn(dir) {
  if (isSpectator || !characters.length) return;
  let idx = characters.findIndex(c => c.id === currentTurn);
  if (idx < 0) idx = (dir > 0) ? -1 : 0;
  idx = (idx + dir + characters.length) % characters.length;
  setTurn(characters[idx].id);
}
function endTurns() {
  if (isSpectator) return;
  currentTurn = null;
  renderTurn();
  emitChange();
}

/* ══════════════════════════════════════
   시나리오 (별도 scenarios/ 폴더에서 로드)
══════════════════════════════════════ */
async function loadScenarios() {
  scenarios = [];
  try {
    const res = await fetch('scenarios/manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const files = await res.json();
      for (const f of (Array.isArray(files) ? files : [])) {
        try {
          const r = await fetch('scenarios/' + f, { cache: 'no-store' });
          if (r.ok) { const data = await r.json(); data._file = f; scenarios.push(data); }
        } catch (e) {}
      }
    }
  } catch (e) { /* file:// 또는 manifest 없음 → 무시 (불러오기로 직접 추가 가능) */ }
  renderScenarioPicker();
}

function renderScenarioPicker() {
  const sel = document.getElementById('scenario-select');
  if (!sel) return;
  const opts = scenarios.map((s, i) =>
    `<option value="${i}">${escapeHtml(s.title || '제목 없음')}</option>`).join('');
  const keep = sel.value;
  sel.innerHTML = `<option value="">— 시나리오 선택 —</option>${opts}`;
  if (keep && sel.querySelector(`option[value="${keep}"]`)) sel.value = keep;
  renderSceneList();
}

function selectScenario(idx) {
  activeScenario = (idx === '' || idx == null) ? null : (scenarios[idx] || null);
  renderSceneList();
}

function renderSceneList() {
  const box = document.getElementById('scene-list');
  if (!box) return;
  if (!activeScenario || !Array.isArray(activeScenario.scenes) || !activeScenario.scenes.length) {
    box.innerHTML = `<div class="scene-list-empty">시나리오를 선택하면 장면이 표시됩니다. 없으면 <a href="scenarios/index.html">시나리오 라이브러리</a>에서 만들어 등록하세요.</div>`;
    return;
  }
  box.innerHTML = activeScenario.scenes.map((sc, i) => `
    <div class="scene-mini">
      <div class="scene-mini-head">
        <span class="scene-mini-num">${i + 1}</span>
        <span class="scene-mini-title">${escapeHtml(sc.title || '(제목 없음)')}</span>
        <button class="scene-show-btn" data-action="show-scene" data-scene="${i}">띄우기 ▶</button>
      </div>
      ${sc.body ? `<div class="scene-mini-body">${escapeHtml(String(sc.body).slice(0, 140))}${String(sc.body).length > 140 ? '…' : ''}</div>` : ''}
      ${sc.image ? `<div class="scene-mini-thumb"><img src="${sc.image}" alt=""/></div>` : ''}
    </div>`).join('');
}

function showScene(i) {
  if (isSpectator || !activeScenario) return;
  const sc = activeScenario.scenes[i];
  if (!sc) return;
  broadcastStageLocal({ image: sc.image || null, title: sc.title || '', text: sc.body || '' });
}

function importScenarioObject(obj) {
  if (!obj || !Array.isArray(obj.scenes)) { alert('시나리오 형식이 올바르지 않습니다.'); return; }
  obj._file = obj._file || '(불러옴)';
  scenarios.push(obj);
  renderScenarioPicker();
  const sel = document.getElementById('scenario-select');
  if (sel) { sel.value = String(scenarios.length - 1); selectScenario(sel.value); }
}

/* 시나리오 컨트롤 바인딩 */
(function bindScenario() {
  const sel = document.getElementById('scenario-select');
  if (sel) sel.addEventListener('change', e => selectScenario(e.target.value));
  const imp = document.getElementById('scenario-import');
  if (imp) imp.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { importScenarioObject(JSON.parse(rd.result)); } catch (err) { alert('JSON 파싱 실패: ' + err.message); } };
    rd.readAsText(f);
    imp.value = '';
  });
})();

/* ══════════════════════════════════════
   턴/장면 클릭 핸들러 (전역 위임에 추가)
══════════════════════════════════════ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t || isSpectator) return;
  const a = t.dataset.action;
  if (a === 'turn-start') { if (characters.length) setTurn(characters[0].id); }
  else if (a === 'turn-prev')  stepTurn(-1);
  else if (a === 'turn-next')  stepTurn(1);
  else if (a === 'turn-end')   endTurns();
  else if (a === 'show-scene') showScene(parseInt(t.dataset.scene, 10));
});

/* 카드 렌더 후 턴 강조 재적용 */
const _origRenderChars = renderChars;
renderChars = function () { _origRenderChars(); renderTurn(); };

/* 시나리오 로드 시작 */
loadScenarios();
