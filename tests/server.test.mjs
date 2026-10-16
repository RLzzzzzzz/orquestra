import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import http from 'node:http';

const port = 14317;
const origin = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (check()) return; await pause(50); }
  throw new Error(`Timeout: ${label}`);
}
test('local server and real independent PTYs', { timeout: 60000 }, async t => {
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-integration-'));
  const bin = path.join(temp, 'bin with spaces');
  fs.mkdirSync(bin);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'codex.cmd'), '@"%ORQUESTRA_FIXTURE_NODE%" "%ORQUESTRA_FIXTURE_SCRIPT%" SHIM\r\n');
  }
  let child, cookie, ws;
  const messages = [];
  async function boot() {
    let output = '';
    child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, PORT: String(port), ORQUESTRA_DATA_DIR: temp, ORQUESTRA_FIXTURE_NODE: process.execPath, ORQUESTRA_FIXTURE_SCRIPT: path.join(process.cwd(), 'tests/fixtures/echo-cli.mjs') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    await until(() => output.includes('Orquestra disponível') || child.exitCode !== null, 'servidor iniciar');
    assert.equal(child.exitCode, null, output);
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    cookie = home.headers.get('set-cookie').split(';')[0];
    assert.match(home.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  }
  async function call(route, method = 'GET', data) {
    const res = await fetch(origin + '/api' + route, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(data !== undefined && { body: JSON.stringify(data) }) });
    return { status: res.status, data: await res.json() };
  }
  async function connect() {
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie, Origin: origin } });
    ws.on('message', raw => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  }
  t.after(async () => {
    ws?.terminate();
    if (child && child.exitCode === null) {
      try { const { data } = await call('/state'); for (const a of data.agents || []) await call(`/agents/${a.id}/stop`, 'POST'); } catch {}
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    // Only this test's freshly-created directory is removed.
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await boot();
  await t.test('rejects unauthenticated, cross-origin, and rebound-host requests', async () => {
    assert.equal((await fetch(origin + '/api/state')).status, 401);
    assert.equal((await fetch(origin + '/internal/orchestration', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":"listar_agentes"}' })).status, 401);
    assert.equal((await fetch(origin + '/internal/orchestration', { method: 'POST', headers: { Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await fetch(origin + '/api/state', { headers: { Cookie: cookie, Origin: 'https://other.example' } })).status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      http.get(origin, { headers: { Host: `evil.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(origin + '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const forbidden = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie, Origin: 'https://other.example' } });
    await new Promise((resolve, reject) => { forbidden.once('error', resolve); forbidden.once('open', () => { forbidden.close(); reject(new Error('Cross-origin socket accepted')); }); });
  });
  await connect();
  const state = (await call('/state')).data;
  const projectId = state.projects[0].id;
  const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'echo-cli.mjs');
  await t.test('launches a preset through a Windows cmd shim in a path with spaces', async t => {
    if (process.platform !== 'win32') return t.skip();
    assert.equal((await call('/providers')).data.find(p => p.id === 'codex').available, true);
    const shim = (await call('/agents', 'POST', { projectId, provider: 'codex', name: 'Shim test' })).data;
    assert.equal((await call(`/agents/${shim.id}/start`, 'POST')).status, 200);
    try {
      await until(() => messages.some(m => m.id === shim.id && m.data?.includes('READY_SHIM')), 'preset executar shim');
    } catch (error) {
      throw new Error(error.message + '\n' + JSON.stringify(messages.filter(m => m.id === shim.id)));
    } finally { await call(`/agents/${shim.id}`, 'DELETE'); }
  });
  await t.test('runs an interactive shell and reports a natural process exit', async () => {
    const shell = (await call('/agents', 'POST', { projectId, provider: 'shell', name: 'Shell test' })).data;
    assert.equal((await call(`/agents/${shell.id}/start`, 'POST')).status, 200);
    await until(() => messages.some(m => m.id === shell.id && m.type === 'output'), 'shell iniciar');
    await call(`/agents/${shell.id}/input`, 'POST', { data: process.platform === 'win32' ? "Write-Output ('SHELL_' + 'CHECK'); exit 0\r" : "printf 'SHELL_CHECK\\n'; exit 0\r" });
    await until(() => messages.some(m => m.id === shell.id && m.data?.includes('SHELL_CHECK')), 'shell responder');
    await until(() => messages.some(m => m.type === 'state' && m.agents.some(a => a.id === shell.id && a.status === 'exited' && a.exitCode === 0)), 'saída natural');
    await call(`/agents/${shell.id}`, 'DELETE');
  });
  let a, b;
  await t.test('keeps failed CLI panes writable and rejects task broadcast into their fallback shell', async () => {
    const failed = (await call('/agents', 'POST', { projectId, provider: 'custom', name: 'Invalid command', command: '__orquestra_missing_command__' })).data;
    try {
      assert.equal((await call(`/agents/${failed.id}/start`, 'POST')).status, 200);
      await until(() => messages.some(m => m.type === 'state' && m.agents.some(a => a.id === failed.id && a.status === 'running' && a.mode === 'fallback')), 'shell de recuperação ficar disponível');
      const recovered = (await call('/state')).data.agents.find(a => a.id === failed.id);
      assert.equal(recovered.mode, 'fallback');
      assert.notEqual(recovered.agentExitCode, 0);
      const blocked = await call(`/agents/${failed.id}/prompt`, 'POST', { text: 'Do not run this in a shell' });
      assert.equal(blocked.status, 400);
      ws.send(JSON.stringify({ type: 'input', id: failed.id, data: `node "${fixture}" HAND_TYPED\r` }));
      await until(() => messages.some(m => m.id === failed.id && m.data?.includes('READY_HAND_TYPED')), 'comando digitado funcionar no shell');
      await call(`/agents/${failed.id}/stop`, 'POST');
      await pause(200);
      assert.equal((await call('/state')).data.agents.find(a => a.id === failed.id).status, 'exited');
    } finally { await call(`/agents/${failed.id}`, 'DELETE'); }
  });
  await t.test('validates configuration and creates two real CLI terminals', async () => {
    assert.equal((await call('/projects', 'POST', { name: 'bad', cwd: path.join(temp, 'not-real') })).status, 400);
    a = (await call('/agents', 'POST', { projectId, provider: 'custom', name: 'Test A', command: `node "${fixture}" A` })).data;
    b = (await call('/agents', 'POST', { projectId, provider: 'custom', name: 'Test B', command: `node "${fixture}" B` })).data;
    assert.ok(a.id); assert.ok(b.id);
    assert.equal((await call(`/agents/${a.id}/start`, 'POST')).status, 200);
    assert.equal((await call(`/agents/${b.id}/start`, 'POST')).status, 200);
    await until(() => messages.some(m => m.id === a.id && m.data?.includes('READY_A')) && messages.some(m => m.id === b.id && m.data?.includes('READY_B')), 'ambos CLIs emitirem saída');
    const agents = (await call('/state')).data.agents;
    assert.notEqual(agents[0].pid, agents[1].pid);
    assert.ok(agents.every(a => a.status === 'running'));
  });
  await t.test('routes input and resize without mixing terminal output', async () => {
    ws.send(JSON.stringify({ type: 'resize', id: a.id, cols: 90, rows: 32 }));
    ws.send(JSON.stringify({ type: 'input', id: a.id, data: 'ONLY_A\r' }));
    await call(`/agents/${b.id}/input`, 'POST', { data: 'ONLY_B\r' });
    await until(() => messages.some(m => m.id === a.id && m.data?.includes('RESULT_A:ONLY_A')) && messages.some(m => m.id === b.id && m.data?.includes('RESULT_B:ONLY_B')), 'entrada chegar ao terminal correto');
    assert.ok(!messages.some(m => m.id === b.id && m.data?.includes('ONLY_A')));
    assert.equal((await call(`/agents/${a.id}/prompt`, 'POST', { text: 'TASK_CHECK', submit: true })).status, 200);
    await until(() => messages.some(m => m.id === a.id && m.data?.includes('RESULT_A:TASK_CHECK')), 'envio de tarefa confirmado');
    assert.equal((await call(`/agents/${a.id}/input`, 'POST', { data: 'x'.repeat(32769) })).status, 400);
    ws.send(JSON.stringify({ type: 'resize', id: a.id, cols: -10, rows: 0 }));
    assert.equal((await call('/state')).status, 200);
  });
  await t.test('reattaches with history and keeps existing process IDs', async () => {
    const before = (await call('/state')).data.agents;
    ws.terminate(); messages.length = 0;
    await connect();
    await until(() => messages.some(m => m.type === 'replay' && m.id === a.id && m.data.includes('RESULT_A:ONLY_A')), 'replay na reconexão');
    assert.deepEqual((await call('/state')).data.agents.map(a => a.pid), before.map(a => a.pid));
  });
  await t.test('stops, restarts and removes sessions', async () => {
    const previous = (await call('/state')).data.agents.find(item => item.id === a.id).pid;
    assert.equal((await call(`/agents/${a.id}/stop`, 'POST')).status, 200);
    assert.equal((await call(`/agents/${a.id}/input`, 'POST', { data: 'test' })).status, 400);
    await pause(350);
    assert.equal((await call(`/agents/${a.id}/start`, 'POST')).status, 200);
    assert.notEqual((await call('/state')).data.agents.find(item => item.id === a.id).pid, previous);
    assert.equal((await call(`/agents/${b.id}`, 'DELETE')).status, 200);
    assert.ok(!(await call('/state')).data.agents.some(item => item.id === b.id));
    await call(`/agents/${a.id}/stop`, 'POST');
  });
  await t.test('persists configuration across server restarts without auto-starting agents', async () => {
    ws.terminate(); child.kill(); await new Promise(resolve => child.once('exit', resolve));
    await boot();
    const saved = (await call('/state')).data;
    assert.equal(saved.agents.length, 1);
    assert.equal(saved.agents[0].id, a.id);
    assert.equal(saved.agents[0].status, 'idle');
  });
});
