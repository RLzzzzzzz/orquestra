const CHANNEL = 'orquestra:notification';

function createNotifier({ Notification, getWindow, now = Date.now }) {
  const seen = new Map(), active = new Set();
  return function notify(payload) {
    if (!payload || typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > 4000 || typeof payload.key !== 'string' || payload.key.length > 256) return { status: 'invalid' };
    const window = getWindow();
    if (!window || window.isDestroyed()) return { status: 'unavailable' };
    if (!Notification.isSupported()) return { status: 'unsupported' };
    if (payload.test !== true && window.isFocused() && !window.isMinimized()) return { status: 'foreground' };
    const time = now();
    if (seen.has(payload.key) && time - seen.get(payload.key) < 30000) return { status: 'duplicate' };
    seen.set(payload.key, time);
    if (seen.size > 500) seen.delete(seen.keys().next().value);
    try {
      const notice = new Notification({ title: 'Orquestra', body: payload.body, silent: true });
      active.add(notice);
      notice.on('click', () => {
        const target = getWindow();
        if (target && !target.isDestroyed()) { if (target.isMinimized()) target.restore(); target.show(); target.focus(); }
      });
      notice.on('close', () => active.delete(notice));
      notice.on('failed', () => { active.delete(notice); seen.delete(payload.key); });
      notice.show();
      return { status: 'submitted' };
    } catch { seen.delete(payload.key); return { status: 'failed' }; }
  };
}

function registerNotifications({ ipcMain, Notification, getWindow }) {
  const notify = createNotifier({ Notification, getWindow });
  ipcMain.handle(CHANNEL, (event, payload) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { status: 'forbidden' };
    return notify(payload);
  });
}

module.exports = { CHANNEL, createNotifier, registerNotifications };
