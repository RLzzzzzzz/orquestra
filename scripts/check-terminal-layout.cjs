const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(40); }
  throw new Error(`Timeout: ${label}`);
}

async function renderer() {
  const { app, BrowserWindow } = require('electron');
  const directory = process.env.ORQUESTRA_LAYOUT_FIXTURE;
  app.setPath('userData', path.join(directory, 'electron'));
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  app.setAppLogsPath(path.join(directory, 'logs'));
  await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const tick = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const click = label => evaluate(`(() => { const label = ${JSON.stringify(label)}; const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.title === label); if (!button) throw new Error('Controle ausente: ' + label); button.click(); })()`);
  await win.loadURL(process.env.ORQUESTRA_LAYOUT_URL);
  await until(() => evaluate("document.querySelectorAll('.terminal-pane').length === 6 && document.querySelector('.connection.online') !== null"), 'interface conectar aos seis terminais de teste');
  await evaluate("document.fonts.ready");
  let scenarios = 0;
  const inspect = async label => {
    await tick();
    // xterm pauses drawing outside the scroll viewport. Bring each pane into
    // view before checking its canvas, as a person scrolling the grid would.
    const indexes = await evaluate("[...document.querySelectorAll('.terminal-pane')].map((p,i)=>getComputedStyle(p).display!=='none'?i:-1).filter(i=>i>=0)");
    for (const index of indexes) {
      await evaluate(`document.querySelectorAll('.terminal-pane')[${index}].scrollIntoView({block:'nearest'})`);
      await tick();
    }
    const result = await evaluate(`(() => {
      const grid = document.querySelector('.terminal-grid'), rect = grid.getBoundingClientRect();
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, gridWidth: rect.width, panes: [...grid.children].filter(p => getComputedStyle(p).display !== 'none').map(p => {
        const r = p.getBoundingClientRect(), body = p.querySelector('.terminal-body').getBoundingClientRect(), host = p.querySelector('.xterm-container').getBoundingClientRect(), screen = p.querySelector('.xterm-screen')?.getBoundingClientRect();
        return { name: p.getAttribute('aria-label'), width: r.width, height: r.height, bodyWidth: body.width, bodyHeight: body.height, hostWidth: host.width, hostHeight: host.height, screenWidth: screen?.width || 0, screenHeight: screen?.height || 0, footerBottom: p.querySelector('.pane-footer').getBoundingClientRect().bottom, bottom: r.bottom };
      }) };
    })()`);
    assert.ok(result.pageWidth <= result.viewport + 1, `${label}: overflow horizontal da aplicação ${JSON.stringify(result)}`);
    assert.ok(result.panes.length > 0, `${label}: nenhum terminal visível`);
    for (const pane of result.panes) {
      const context = `${label}: ${JSON.stringify(pane)}`;
      assert.ok(pane.width <= result.gridWidth + 1, `painel fora da área disponível: ${context}`);
      assert.ok(pane.bodyWidth > 20 && pane.bodyHeight > 30, `terminal sem área útil: ${context}`);
      assert.ok(pane.hostHeight <= pane.bodyHeight + 1, `host ultrapassa o corpo: ${context}`);
      assert.ok(pane.screenWidth > 0 && pane.screenHeight > 0, `xterm sem dimensões: ${context}`);
      assert.ok(pane.screenWidth <= pane.hostWidth + 1 && pane.screenHeight <= pane.hostHeight + 1, `xterm ultrapassa o host após resize: ${context}`);
      assert.ok(pane.footerBottom <= pane.bottom + 1, `rodapé cortado: ${context}`);
    }
    scenarios++;
  };
  // The actual UI controls drive React state; no test-only layout mutations.
  for (const width of [1440, 900, 640, 320]) {
    win.setContentSize(width, 900);
    for (const bars of [false, true]) {
      const state = await evaluate("({left:!!document.querySelector('.sidebar'),right:!!document.querySelector('.task-panel')})");
      if (state.left !== bars) await click(state.left ? 'Recolher projetos' : 'Mostrar projetos');
      if (state.right !== bars) await click(state.right ? 'Recolher tarefas' : 'Mostrar tarefas');
      for (const [layout, label] of [['grid', 'Grade automática'], ['columns', 'Duas colunas'], ['single', 'Uma coluna']]) {
        await click(label);
        await inspect(`${width}px barras=${bars} layout=${layout}`);
      }
      await click('Focar Executor 1');
      await inspect(`${width}px barras=${bars} foco`);
      await click('Sair do foco');
      await inspect(`${width}px barras=${bars} sair do foco`);
    }
  }
  // Restore a deliberately wide persisted pane and verify it survives shrinking.
  // The saved-size key uses the fixture's known agent ID; reload exercises hydration.
  await evaluate(`localStorage.setItem(${JSON.stringify('pane-size:' + process.env.ORQUESTRA_LAYOUT_AGENT)}, JSON.stringify({width:1200,height:520})); localStorage.setItem('fontSize','20');`);
  win.reload();
  await until(() => evaluate("document.querySelectorAll('.terminal-pane').length === 6 && document.querySelector('.connection.online') !== null"), 'reabrir layout persistido');
  await evaluate('document.fonts.ready');
  for (const width of [1440, 640, 320, 1440]) {
    win.setContentSize(width, 900);
    await inspect(`${width}px tamanho salvo largo e fonte 20`);
  }
  // Hidden panes must be fitted again when the terminal view is restored.
  await evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.startsWith('Atividade')).click()");
  await tick();
  win.setContentSize(900, 760);
  await evaluate("[...document.querySelectorAll('.view-tabs button')].find(b=>b.textContent.startsWith('Terminais')).click()");
  await inspect('reexibir terminais após mudar tamanho em outra aba');
  win.setContentSize(1440, 900);
  await click('Focar Executor 1');
  await tick();
  const screenshot = path.join(root, 'coverage', 'terminal-layout.png');
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ passed: true, scenarios, providers: 'custom echo fixtures; no model calls', renderer: 'Electron/Chromium, real built application', screenshot }));
  app.quit();
}

async function launch() {
  if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Execute npm.cmd run build antes de check:layout.');
  const directory = fs.mkdtempSync(path.join(root, '.local-terminal-layout-'));
  const projectId = randomUUID();
  const agents = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), projectId, provider: 'custom', name: `Executor ${i + 1}`, command: `node "${path.join(root, 'tests/fixtures/echo-cli.mjs')}" LAYOUT_${i}`, cwd: root, role: 'Fixture de layout' }));
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify({ projects: [{ id: projectId, name: 'Projeto de teste dos terminais', cwd: root }], agents }));
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), ORQUESTRA_DATA_DIR: directory, ORQUESTRA_MEMORY_BIN: path.join(directory, 'memory-not-installed') };
  delete env.ELECTRON_RUN_AS_NODE;
  let server, browser, output = '';
  try {
    server = fork(path.join(root, 'server/index.mjs'), [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
    const url = `http://127.0.0.1:${port}`;
    await until(() => output.includes('Orquestra disponível') || server.exitCode !== null, 'iniciar backend isolado');
    assert.equal(server.exitCode, null, output);
    const home = await fetch(url), cookie = home.headers.get('set-cookie').split(';')[0];
    // Two independent real PTYs stream fixture output while the UI resizes.
    for (const agent of agents.slice(0, 2)) {
      const response = await fetch(`${url}/api/agents/${agent.id}/start`, { method: 'POST', headers: { Cookie: cookie, Origin: url } });
      assert.equal(response.status, 200, await response.text());
    }
    browser = spawn(require('electron'), [__filename, '--layout-renderer'], { cwd: root, env: { ...env, ORQUESTRA_LAYOUT_FIXTURE: directory, ORQUESTRA_LAYOUT_URL: url, ORQUESTRA_LAYOUT_AGENT: agents[0].id }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    browser.stdout.pipe(process.stdout); browser.stderr.pipe(process.stderr);
    const code = await new Promise((resolve, reject) => { browser.once('error', reject); browser.once('exit', resolve); });
    assert.equal(code, 0, 'Verificação do renderer falhou.');
  } finally {
    if (browser && browser.exitCode === null) browser.kill();
    if (server && server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      if (server.connected) server.send({ type: 'shutdown' }); else server.kill();
      await Promise.race([exited, pause(7000)]);
      if (server.exitCode === null) server.kill();
    }
    // Only the newly created fixture inside this repository is removed.
    assert.ok(directory.startsWith(root + path.sep + '.local-terminal-layout-'));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

(process.argv.includes('--layout-renderer') ? renderer() : launch()).catch(error => {
  console.error(error);
  if (process.argv.includes('--layout-renderer')) require('electron').app.exit(1);
  else process.exitCode = 1;
});
