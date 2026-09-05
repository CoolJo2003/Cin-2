// Cine2 — récepteur de pilotage à distance.
// Injecté sur la page à piloter (Netflix, Prime, Disney+...) via un favori
// (bookmarklet), pas via une extension. Rejoue les clics/touches envoyés
// depuis l'app Ciné2 sur la vraie page.

(function () {
  if (window.__cine2ControlLoaded) return; // évite les doublons si on reclique le favori
  window.__cine2ControlLoaded = true;

  const params = new URL(document.currentScript.src).searchParams;
  const serverUrl = params.get('server') || '';
  let roomCode = localStorage.getItem('cine2_room') || '';
  let ws = null;

  const badge = document.createElement('div');
  badge.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
    background: #1f1830; color: #f4f0fa; font: 13px system-ui, sans-serif;
    border-radius: 12px; padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex; flex-direction: column; gap: 6px; width: 220px;
  `;
  badge.innerHTML = `
    <div style="font-weight:600;">🎬 Ciné2 — Pilotage</div>
    <input id="cine2-code" placeholder="Code du salon" style="padding:6px;border-radius:6px;border:1px solid #444;background:#14101c;color:#fff;text-transform:uppercase;">
    <button id="cine2-connect" style="padding:7px;border-radius:6px;border:none;background:#ffd66b;color:#241b0a;font-weight:600;cursor:pointer;">Connecter</button>
    <div id="cine2-status" style="font-size:11px;color:#a99cc0;">Non connecté.</div>
    <div id="cine2-close" style="font-size:11px;color:#a99cc0;cursor:pointer;text-align:right;">masquer ✕</div>
  `;
  document.body.appendChild(badge);
  const codeInput = badge.querySelector('#cine2-code');
  const statusEl = badge.querySelector('#cine2-status');
  codeInput.value = roomCode;

  badge.querySelector('#cine2-close').onclick = () => { badge.style.display = 'none'; };
  badge.querySelector('#cine2-connect').onclick = () => {
    roomCode = codeInput.value.trim().toUpperCase();
    localStorage.setItem('cine2_room', roomCode);
    connect();
  };

  function connect() {
    if (!serverUrl) { statusEl.textContent = 'Favori mal configuré (adresse serveur manquante).'; return; }
    if (!roomCode) { statusEl.textContent = 'Entre le code du salon affiché dans Ciné2.'; return; }
    try { ws && ws.close(); } catch (e) {}
    try {
      ws = new WebSocket(serverUrl);
    } catch (e) {
      statusEl.textContent = 'Adresse de serveur invalide.';
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'control-join', code: roomCode }));
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'control-joined') statusEl.textContent = '✅ Connecté au salon ' + msg.code + '.';
      if (msg.type === 'error') statusEl.textContent = '❌ ' + msg.message;
      if (msg.type === 'remote-input') applyRemoteInput(msg);
    };
    ws.onclose = () => { statusEl.textContent = 'Déconnecté.'; };
    ws.onerror = () => { statusEl.textContent = "Erreur de connexion (l'app doit être servie en https)."; };
  }

  function applyRemoteInput(msg) {
    if (msg.kind === 'click') {
      const x = msg.xf * window.innerWidth;
      const y = msg.yf * window.innerHeight;
      const el = document.elementFromPoint(x, y) || document.body;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
      });
      return;
    }
    if (msg.kind === 'key') {
      const target = document.activeElement || document.body;
      ['keydown', 'keyup'].forEach((type) => {
        target.dispatchEvent(new KeyboardEvent(type, { key: msg.key, code: msg.code, bubbles: true, cancelable: true }));
      });
    }
  }

  // se reconnecte tout seul si un salon avait déjà été utilisé sur ce site
  if (roomCode) connect();
})();
