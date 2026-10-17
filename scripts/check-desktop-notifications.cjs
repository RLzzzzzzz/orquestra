// Opt-in Windows smoke test: real Electron renderer, preload, IPC and OS toast.
// Run: electron scripts/check-desktop-notifications.cjs <result.json>
const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { registerNotifications } = require('../electron/notifications.cjs');
const resultFile = path.resolve(process.argv[2] || '.local/desktop-notification-result.json');
const result = { supported: Notification.isSupported(), events: [], bridge: false };
app.setName('Orquestra');
app.setAppUserModelId('br.orquestra.desktop');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'oq-notification-')));
let window, timer, finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  app.exit(code);
}
class ObservedNotification extends Notification {
  constructor(options) {
    super(options);
    this.on('show', () => {
      result.events.push('show');
      // Allow renderer invocation to resolve before saving the evidence.
      setTimeout(() => finish(result.bridge && result.submission?.status === 'submitted' ? 0 : 1), 500);
    });
    this.on('failed', (_event, error) => { result.events.push('failed'); result.error = String(error); finish(1); });
  }
}
app.whenReady().then(async () => {
  timer = setTimeout(() => { result.error = 'No OS show event within 15 seconds'; finish(1); }, 15000);
  registerNotifications({ ipcMain, Notification: ObservedNotification, getWindow: () => window });
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await window.loadURL('data:text/html,<title>Orquestra notification smoke test</title>');
  result.bridge = await window.webContents.executeJavaScript('typeof window.orquestraDesktop?.notify === "function"');
  result.submission = await window.webContents.executeJavaScript('window.orquestraDesktop.notify({body:"Teste de notificação do Orquestra.",key:"desktop-smoke-test",test:true})');
  if (result.submission.status !== 'submitted') finish(1);
}).catch(error => { result.error = error.message; finish(1); });
