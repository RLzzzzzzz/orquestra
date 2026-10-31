// Opt-in: opens the installed OpenCode UI, but never submits a model prompt.
// All application, OpenCode and Electron state lives in a fresh fixture folder.
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(60); }
  throw new Error(`Timeout: ${label}`);
}

async function renderer() {
  const { app, BrowserWindow } = require('electron');
  const watchdog = setTimeout(() => { console.error('OpenCode QA: tempo total de verificação excedido.'); app.exit(1); }, 90000);
  watchdog.unref();
  const headless = require('@xterm/headless');
  const directory = process.env.ORQUESTRA_OPENCODE_FIXTURE;
  const artifact = path.join(root, 'coverage', 'opencode-resize');
  fs.mkdirSync(artifact, { recursive: true });
  app.setPath('userData', path.join(directory, 'electron'));
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  app.setAppLogsPath(path.join(directory, 'logs'));
  await app.whenReady();
  console.log('OpenCode QA: renderer ready');
  const win = new BrowserWindow({ width: 1400, height: 1000, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  console.log('OpenCode QA: debugger attached');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__opencodeEvents = [];
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); this.addEventListener('message', e => { try { const m=JSON.parse(e.data); if (m.type==='output'||m.type==='replay') window.__opencodeEvents.push(m); } catch {} }); }
      send(data) { try { const m=JSON.parse(data); if(m.type==='resize') window.__opencodeEvents.push(m); } catch {} return super.send(data); }
    };
  ` });
  console.log('OpenCode QA: event capture installed');
  await win.loadURL(process.env.ORQUESTRA_OPENCODE_URL);
  console.log('OpenCode QA: application loaded');
  await until(() => evaluate("document.querySelector('.terminal-pane') && document.querySelector('.connection.online')"), 'interface conectar');
  await evaluate("document.fonts.ready");
  // Keep drawers from covering the terminal at compact widths. Exercise native
  // OpenCode layout, rather than measuring the part hidden under a drawer.
  await evaluate(`(() => { for (const label of ['Recolher projetos', 'Recolher tarefas']) document.querySelector('button[aria-label="' + label + '"]')?.click(); })()`);
  await pause(200);
  const initialAgent = await evaluate("fetch('/api/state').then(r=>r.json()).then(s=>s.agents[0])");
  assert.equal(initialAgent.windowsPty.backend, 'conpty');
  const mirror = new headless.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  let outputCount = 0, geometry;
  const drain = async () => {
    const events = await evaluate('window.__opencodeEvents.splice(0)');
    for (const event of events) {
      if (event.type === 'resize') { mirror.resize(event.cols, event.rows); geometry = { cols: event.cols, rows: event.rows }; }
      else { if (event.type === 'replay') mirror.reset(); await new Promise(resolve => mirror.write(event.data, resolve)); outputCount++; }
    }
  };
  const snapshot = () => {
    const buffer = mirror.buffer.active;
    const lines = Array.from({ length: mirror.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
    const logoLine = lines.find(line => line.includes('█')) || '';
    return { ...geometry, outputCount, lines, promptRow: lines.findIndex(line => line.includes('Ask anything')), logoColumn: logoLine.indexOf('█'), occupiedRows: lines.map((line, row) => line.trim() ? row : -1).filter(row => row >= 0) };
  };
  try { await until(async () => { await drain(); return snapshot().promptRow >= 0; }, 'OpenCode apresentar prompt sem enviar instrução', 45000); }
  catch (error) { fs.writeFileSync(path.join(artifact, 'startup.txt'), snapshot().lines.join('\n')); fs.writeFileSync(path.join(artifact, 'startup.png'), (await win.webContents.capturePage()).toPNG()); throw error; }
  const results = [];
  for (const [width, height] of [[1400, 1000], [850, 740], [1600, 1100], [1000, 850], [1400, 1000]]) {
    const before = outputCount;
    win.setContentSize(width, height);
    // OpenCode owns its redraw; waiting for actual ANSI after resize is required.
    await pause(1500); await drain();
    const screen = snapshot();
    const label = `${width}x${height}`;
    fs.writeFileSync(path.join(artifact, label + '.txt'), screen.lines.join('\n'));
    fs.writeFileSync(path.join(artifact, label + '.png'), (await win.webContents.capturePage()).toPNG());
    assert.ok(screen.promptRow >= 0, `${label}: OpenCode perdeu o prompt após resize`);
    assert.ok(screen.logoColumn >= 0, `${label}: logo da TUI foi cortado`);
    assert.ok(screen.lines.some(line => line.includes('MCP')), `${label}: rodapé da TUI foi cortado`);
    if (results.length) assert.ok(outputCount > before, `${label}: CLI não redesenhou após resize`);
    const agent = await evaluate("fetch('/api/state').then(r=>r.json()).then(s=>s.agents[0])");
    assert.equal(agent.pid, initialAgent.pid, 'Resize não pode reiniciar o OpenCode');
    assert.equal(agent.sessionId, initialAgent.sessionId, 'Resize não pode substituir a sessão');
    results.push({ viewport: label, cols: screen.cols, rows: screen.rows, promptRow: screen.promptRow, logoColumn: screen.logoColumn, occupiedRows: screen.occupiedRows, outputAfterResize: outputCount - before });
  }
  assert.ok(new Set(results.map(r => r.cols)).size >= 3, 'O terminal não mudou de largura');
  assert.ok(new Set(results.map(r => r.logoColumn)).size >= 3, 'O logo não acompanhou as larguras da TUI');
  fs.writeFileSync(path.join(artifact, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, backend: process.env.ORQUESTRA_OPENCODE_PACKAGED === '1' ? 'packaged' : 'source', version: 'installed OpenCode', results, artifact }));
  mirror.dispose();
  app.quit();
}

async function launch() {
  const packaged = process.argv.includes('--packaged');
  const backendRoot = packaged ? path.join(root, 'release/win-unpacked/resources/backend') : root;
  const runtime = packaged ? path.join(backendRoot, 'node.exe') : process.execPath;
  if (!fs.existsSync(path.join(backendRoot, 'dist/index.html'))) throw new Error(packaged ? 'Gere desktop:pack ou desktop:portable primeiro.' : 'Execute npm.cmd run build primeiro.');
  const directory = fs.mkdtempSync(path.join(root, '.local-opencode-resize-'));
  const projectId = randomUUID(), agentId = randomUUID();
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify({ projects: [{ id: projectId, name: 'OpenCode resize regression', cwd: directory }], agents: [{ id: agentId, projectId, provider: 'opencode', command: 'opencode', name: 'OpenCode real', cwd: directory }] }));
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), ORQUESTRA_DATA_DIR: directory, ORQUESTRA_MEMORY_BIN: path.join(directory, 'memory-not-installed'), XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_DATA_HOME: path.join(directory, 'data'), XDG_STATE_HOME: path.join(directory, 'state'), XDG_CACHE_HOME: path.join(directory, 'cache'), OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }) };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = path.dirname(runtime) + path.delimiter + (env[pathKey] || '');
  delete env.ELECTRON_RUN_AS_NODE;
  let server, browser, output = '';
  try {
    server = fork(path.join(backendRoot, 'server/index.mjs'), [], { execPath: runtime, cwd: backendRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
    await until(() => output.includes('Orquestra disponível') || server.exitCode !== null, 'backend iniciar');
    assert.equal(server.exitCode, null, output);
    const url = `http://127.0.0.1:${port}`;
    const home = await fetch(url), cookie = home.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${url}/api/agents/${agentId}/start`, { method: 'POST', headers: { Cookie: cookie, Origin: url } });
    assert.equal(response.status, 200, await response.text());
    browser = spawn(require('electron'), [__filename, '--opencode-renderer'], { cwd: root, env: { ...env, ORQUESTRA_OPENCODE_FIXTURE: directory, ORQUESTRA_OPENCODE_URL: url, ORQUESTRA_OPENCODE_PACKAGED: packaged ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    browser.stdout.pipe(process.stdout); browser.stderr.pipe(process.stderr);
    const code = await new Promise((resolve, reject) => { browser.once('error', reject); browser.once('exit', resolve); });
    assert.equal(code, 0, 'Verificação OpenCode falhou.');
  } finally {
    if (browser && browser.exitCode === null) browser.kill();
    if (server && server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      if (server.connected) server.send({ type: 'shutdown' }); else server.kill();
      await Promise.race([exited, pause(7000)]);
      if (server.exitCode === null) server.kill();
    }
    assert.ok(directory.startsWith(root + path.sep + '.local-opencode-resize-'));
    // Native console shutdown can release its SQLite handles asynchronously.
    for (let attempt = 0; ; attempt++) {
      try { fs.rmSync(directory, { recursive: true, force: true }); break; }
      catch (error) { if (attempt >= 15) throw error; await pause(400); }
    }
  }
}
(process.argv.includes('--opencode-renderer') ? renderer() : launch()).catch(error => {
  console.error(error);
  if (process.argv.includes('--opencode-renderer')) require('electron').app.exit(1);
  else process.exitCode = 1;
});
