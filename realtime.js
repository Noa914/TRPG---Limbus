'use strict';
/* ═══════════════════════════════════════════════════════════
   LIMBUS TRPG · realtime.js
   Firebase Realtime Database 기반 실시간 공유
   - 접속자 마우스 커서 공유
   - 마스터가 띄운 이미지 실시간 공유
   - 마스터의 화면(캐릭터/판정/로그) 실시간 미러링
   firebase-config.js 가 비어있으면 자동으로 오프라인 단독 모드.
   ═══════════════════════════════════════════════════════════ */
(function () {

  const RT = {
    enabled:  false,
    role:     null,     // 'master' | 'player'
    roomId:   null,
    clientId: null,
    name:     '',
    color:    270,
    db:       null,
    base:     null,
  };
  window.LIMBUS_RT = RT;

  /* ── 유틸 ── */
  const genId = () => Math.random().toString(36).slice(2, 9);
  const genRoom = () =>
    Array.from({ length: 4 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  function hueFor(id) {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  function configReady() {
    const c = window.FIREBASE_CONFIG;
    return c && c.databaseURL && c.apiKey &&
           !String(c.apiKey).includes('YOUR_') &&
           !String(c.databaseURL).includes('YOUR_');
  }

  /* ── URL 해시 파라미터 ── */
  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { room: p.get('room'), role: p.get('role'), name: p.get('name') };
  }
  function writeHash(o) {
    const p = new URLSearchParams();
    Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
    history.replaceState(null, '', '#' + p.toString());
  }

  /* ════════════════════════════════════
     연결 UI (헤더 아래 바)
  ════════════════════════════════════ */
  const elName    = () => document.getElementById('rt-name');
  const elRoom    = () => document.getElementById('rt-room');
  const elStatus  = () => document.getElementById('rt-status');
  const elPanelIn = () => document.getElementById('rt-form');
  const elPanelOn = () => document.getElementById('rt-connected');
  const elPresence= () => document.getElementById('rt-presence');
  const elRoomShow= () => document.getElementById('rt-room-show');
  const elRoleShow= () => document.getElementById('rt-role-show');

  function setStatus(txt, on) {
    const s = elStatus();
    if (s) { s.textContent = txt; s.classList.toggle('on', !!on); }
  }
  function showConnectedUI() {
    if (elPanelIn()) elPanelIn().style.display = 'none';
    if (elPanelOn()) elPanelOn().style.display = 'flex';
    if (elRoomShow()) elRoomShow().textContent = RT.roomId;
    if (elRoleShow()) elRoleShow().textContent = RT.role === 'master' ? '마스터' : '플레이어';
  }

  /* ════════════════════════════════════
     원격 커서 렌더
  ════════════════════════════════════ */
  const cursors = {};   // clientId -> element
  function cursorLayer() { return document.getElementById('cursor-layer'); }

  function upsertCursor(id, data) {
    if (!data || id === RT.clientId) return;
    const layer = cursorLayer();
    if (!layer) return;
    let el = cursors[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L4 20 L9 15 L12.5 22 L15 21 L11.5 14 L18 14 Z"/></svg>' +
        '<span class="remote-cursor-label"></span>';
      layer.appendChild(el);
      cursors[id] = el;
    }
    const hue = data.color != null ? data.color : hueFor(id);
    const col = `hsl(${hue} 80% 65%)`;
    el.querySelector('svg path').setAttribute('fill', col);
    el.querySelector('svg path').setAttribute('stroke', 'rgba(0,0,0,.5)');
    const label = el.querySelector('.remote-cursor-label');
    label.textContent = (data.role === 'master' ? '⬟ ' : '') + (data.name || '익명');
    label.style.background = col;
    el.style.left = (data.x * window.innerWidth) + 'px';
    el.style.top  = (data.y * window.innerHeight) + 'px';
  }
  function removeCursor(id) {
    if (cursors[id]) { cursors[id].remove(); delete cursors[id]; }
  }

  /* ════════════════════════════════════
     접속자 목록 렌더
  ════════════════════════════════════ */
  function renderPresence(map) {
    const box = elPresence();
    if (!box) return;
    const entries = Object.entries(map || {});
    if (!entries.length) { box.innerHTML = ''; return; }
    box.innerHTML = entries.map(([id, p]) => {
      const hue = p.color != null ? p.color : hueFor(id);
      const me = id === RT.clientId ? ' (나)' : '';
      const crown = p.role === 'master' ? '⬟ ' : '';
      return `<span class="rt-chip" title="${p.role === 'master' ? '마스터' : '플레이어'}">
        <span class="rt-dot" style="background:hsl(${hue} 80% 65%)"></span>
        ${crown}${(p.name || '익명')}${me}</span>`;
    }).join('');
  }

  /* ════════════════════════════════════
     커서 브로드캐스트 (50ms 간격)
  ════════════════════════════════════ */
  function startCursorBroadcast() {
    let pending = null;
    const ref = RT.base.child('cursors/' + RT.clientId);
    window.addEventListener('mousemove', e => {
      pending = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
        name: RT.name, color: RT.color, role: RT.role, t: Date.now(),
      };
    }, { passive: true });
    setInterval(() => { if (pending) { ref.set(pending); pending = null; } }, 50);
  }

  /* ════════════════════════════════════
     마스터 상태 푸시 (디바운스)
  ════════════════════════════════════ */
  let pushTimer = null;
  function scheduleStatePush() {
    if (!RT.enabled || RT.role !== 'master') return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      try {
        RT.base.child('state').set({
          json: JSON.stringify(window.LIMBUS.getState()),
          ts: Date.now(),
        });
      } catch (e) { console.warn('state push 실패', e); }
    }, 200);
  }

  /* ════════════════════════════════════
     연결
  ════════════════════════════════════ */
  function connect(role) {
    const name = (elName() && elName().value.trim()) ||
                 (role === 'master' ? '마스터' : '플레이어');
    let room = (elRoom() && elRoom().value.trim().toUpperCase()) || '';

    if (role === 'master' && !room) room = genRoom();
    if (role === 'player' && !room) { alert('참가할 방 코드를 입력하세요.'); return; }

    if (!configReady()) {
      alert('Firebase 설정이 없어 실시간 공유를 켤 수 없습니다.\n' +
            'firebase-config.js 를 채우면 활성화됩니다.\n' +
            '지금은 오프라인 단독 모드로 사용할 수 있습니다.');
      return;
    }
    if (typeof firebase === 'undefined') {
      alert('Firebase 스크립트를 불러오지 못했습니다. 네트워크를 확인하세요.');
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      RT.db = firebase.database();
    } catch (e) {
      alert('Firebase 초기화 실패: ' + e.message);
      return;
    }

    RT.role = role;
    RT.roomId = room;
    RT.name = name;
    RT.clientId = genId();
    RT.color = hueFor(RT.clientId);
    RT.base = RT.db.ref('rooms/' + room);
    RT.enabled = true;

    /* presence + 연결 해제 시 정리 */
    const meRef = RT.base.child('presence/' + RT.clientId);
    meRef.set({ name: RT.name, role: RT.role, color: RT.color, t: Date.now() });
    meRef.onDisconnect().remove();
    RT.base.child('cursors/' + RT.clientId).onDisconnect().remove();

    RT.base.child('presence').on('value', s => renderPresence(s.val() || {}));

    /* 커서 */
    RT.base.child('cursors').on('child_added',   s => upsertCursor(s.key, s.val()));
    RT.base.child('cursors').on('child_changed', s => upsertCursor(s.key, s.val()));
    RT.base.child('cursors').on('child_removed', s => removeCursor(s.key));

    /* 공유 이미지 — 모두 수신 */
    RT.base.child('image').on('value', s => {
      const v = s.val();
      if (v && v.dataUrl) window.LIMBUS.setSharedImage(v.dataUrl, v.name, v.visible !== false);
      else window.LIMBUS.setSharedImage(null);
    });

    if (role === 'master') {
      RT.base.child('meta').update({ masterId: RT.clientId, t: Date.now() });
      /* 마스터: 이미지 브로드캐스트 주입 */
      window.LIMBUS.broadcastImage = (dataUrl, imgName, visible) => {
        RT.base.child('image').set(
          dataUrl ? { dataUrl, name: imgName || '', visible: visible !== false, ts: Date.now() }
                  : null);
      };
      /* 마스터: 상태 변경 시 푸시 */
      document.addEventListener('limbus:change', scheduleStatePush);
      scheduleStatePush();   // 최초 1회
    } else {
      /* 플레이어: 마스터 상태 수신 → 미러링 (읽기 전용) */
      window.LIMBUS.enterSpectator();
      RT.base.child('state').on('value', s => {
        const v = s.val();
        if (v && v.json) {
          try { window.LIMBUS.applyState(JSON.parse(v.json)); }
          catch (e) { console.warn('state apply 실패', e); }
        }
      });
    }

    writeHash({ room, role, name });
    startCursorBroadcast();
    showConnectedUI();
    setStatus('● 연결됨 · ' + room, true);
  }

  function disconnect() {
    if (RT.enabled && RT.base) {
      try {
        RT.base.child('presence/' + RT.clientId).remove();
        RT.base.child('cursors/' + RT.clientId).remove();
        RT.base.off();
      } catch (e) {}
    }
    location.hash = '';
    location.reload();   // 깨끗하게 재시작
  }

  /* ════════════════════════════════════
     UI 바인딩 + 자동 재접속
  ════════════════════════════════════ */
  function init() {
    if (!configReady()) {
      setStatus('오프라인 단독 모드 (Firebase 미설정)', false);
    } else {
      setStatus('실시간 공유 준비됨 — 방을 만들거나 참가하세요', false);
    }

    const mBtn = document.getElementById('rt-create');
    const pBtn = document.getElementById('rt-join');
    const dBtn = document.getElementById('rt-leave');
    const cBtn = document.getElementById('rt-copy');
    if (mBtn) mBtn.addEventListener('click', () => connect('master'));
    if (pBtn) pBtn.addEventListener('click', () => connect('player'));
    if (dBtn) dBtn.addEventListener('click', disconnect);
    if (cBtn) cBtn.addEventListener('click', () => {
      const link = location.origin + location.pathname +
        '#room=' + RT.roomId + '&role=player';
      navigator.clipboard.writeText(link)
        .then(() => { cBtn.textContent = '복사됨!'; setTimeout(() => cBtn.textContent = '🔗 초대 링크 복사', 1500); })
        .catch(() => prompt('아래 링크를 복사하세요:', link));
    });

    /* 해시로 들어온 경우 자동 입력 + 자동 참가 */
    const h = readHash();
    if (h.name && elName()) elName().value = h.name;
    if (h.room && elRoom()) elRoom().value = h.room;
    if (h.room && h.role && configReady()) {
      connect(h.role === 'master' ? 'master' : 'player');
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();

})();
