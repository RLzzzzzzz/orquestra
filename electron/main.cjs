const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron');
const { registerNotifications } = require('./notifications.cjs');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

app.setName('Orquestra');
if (process.platform === 'win32') app.setAppUserModelId('br.orquestra.desktop');
const profile = path.join(app.getPath('appData'), 'Orquestra');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
let window;
let backend;
let quitting = false;
let stopped = false;
let log;
let failed = false;

function fail(error) {
  if (quitting || failed) return;
  failed = true;
  dialog.showErrorBox('Orquestra', `${error.message}\n\nLog: ${path.join(app.getPath('userData'), 'server.log')}`);
  app.quit();
}

function startServer() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(__dirname, '..');
  const runtime = app.isPackaged ? path.join(root, 'node.exe') : process.env.ORQUESTRA_NODE_EXECUTABLE;
  if (!runtime || !fs.existsSync(runtime)) throw new Error('Runtime Node.js ausente. Use npm.cmd run desktop ou gere novamente o pacote.');
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Interface ausente. Execute npm.cmd run build antes de abrir o desktop.');
  const dataDir = process.env.ORQUESTRA_DATA_DIR || path.join(app.getPath('userData'), 'data');
  const memoryBinary = path.join(root, app.isPackaged ? 'runtime' : '.local/runtime', 'ai-memory', 'ai-memory.exe');
  const env = {
    ...process.env,
    ORQUESTRA_DATA_DIR: dataDir,
    ORQUESTRA_DEFAULT_PROJECT_DIR: app.getPath('documents'),
  };
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta entre 1 e 65535.');
  // npm CLI shims and MCP subprocesses must also find the bundled Node runtime.
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.dirname(runtime)}${path.delimiter}${env[pathKey] || ''}`;
  delete env.ELECTRON_RUN_AS_NODE;
  if (!env.ORQUESTRA_MEMORY_BIN && fs.existsSync(memoryBinary)) env.ORQUESTRA_MEMORY_BIN = memoryBinary;
  log = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'w' });
  log.on('error', fail);
  backend = fork(path.join(root, 'server', 'index.mjs'), [], {
    execPath: runtime, execArgv: [], cwd: root, env,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  backend.stdout.pipe(log, { end: false });
  backend.stderr.pipe(log, { end: false });
  backend.once('close', () => log.end());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('O servidor não iniciou em 30 segundos.')), 30000);
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (!quitting) {
        const error = new Error(`O servidor encerrou (${signal || code}). Consulte o log para identificar a causa.`);
        reject(error);
        fail(error);
      }
    });
    backend.once('message', message => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      resolve(message.url);
    });
  });
}

async function stopServer() {
  if (!backend?.pid || backend.exitCode !== null || backend.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      // Windows signals do not run Node's shutdown handlers. Use IPC first;
      // terminate the entire child tree only if graceful shutdown stalls.
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(backend.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { backend.kill(); resolve(); });
        killer.once('exit', resolve);
      } else { backend.kill('SIGKILL'); resolve(); }
    }, 5000);
    backend.once('exit', () => { clearTimeout(timer); resolve(); });
    if (backend.connected) backend.send({ type: 'shutdown' }, () => {});
    else backend.kill();
  });
}

app.on('before-quit', event => {
  if (stopped) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  stopServer().finally(() => { stopped = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  stopped = true;
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    if (quitting) return;
    registerNotifications({ ipcMain, Notification, getWindow: () => window });
    const url = await startServer();
    if (quitting) return;
    window = new BrowserWindow({
      title: 'Orquestra', width: 1440, height: 960, minWidth: 900, minHeight: 600,
      backgroundColor: '#111318', show: false, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== new URL(url).origin) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, target) => {
      if (new URL(target).origin !== new URL(url).origin) event.preventDefault();
    });
    await window.loadURL(url);
    if (!quitting) window.show();
  }).catch(fail);
}
