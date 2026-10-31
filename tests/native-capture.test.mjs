import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { captureGateway, nativeHooks, scopeOpenCodePlugin } from '../server/native-capture.mjs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';

test('OpenCode repository routing cannot remap the app project or request global recall', async () => {
  const original = `function applyMarkerParams(url: URL, cwd: string | undefined): boolean {
    for (const key of ['identity', 'identity_src', 'identity_style', 'aliases', 'project_src', 'project_strategy']) url.searchParams.set(key, 'foreign');
    url.searchParams.set('default_global', 'true'); return true;
  }`;
  const source = scopeOpenCodePlugin(original);
  const { code } = await transformWithEsbuild(source, 'plugin.ts', { loader: 'ts' });
  const context = vm.createContext({ URL, process: { env: { ORQUESTRA_MEMORY_PROJECT: 'project-a' } } });
  vm.runInContext(code, context);
  const url = new URL('http://local/hook?workspace=foreign&project=foreign');
  assert.equal(context.applyMarkerParams(url, '/repository'), true);
  assert.equal(url.searchParams.get('workspace'), 'orquestra');
  assert.equal(url.searchParams.get('project'), 'project-a');
  assert.equal(url.searchParams.get('default_global'), 'false');
  for (const key of ['identity', 'identity_src', 'identity_style', 'aliases', 'project_src', 'project_strategy']) assert.equal(url.searchParams.has(key), false);
  delete context.process.env.ORQUESTRA_MEMORY_PROJECT;
  assert.equal(context.applyMarkerParams(url, '/repository'), false);
  assert.throws(() => scopeOpenCodePlugin('unsupported generator'), /escopo conhecida/);
});

test('native hooks use real provider events and never persist bearer credentials', () => {
  const options = { binary: 'C:/App Folder/ai-memory.exe', dataDir: 'C:/Data', endpoint: 'http://127.0.0.1:123/project/authorized', platform: 'win32' };
  for (const provider of ['codex', 'claude', 'gemini', 'antigravity']) {
    const settings = nativeHooks({ ...options, provider });
    assert.match(JSON.stringify(settings), /powershell.exe -NoProfile -NonInteractive -EncodedCommand/);
    assert.ok(!JSON.stringify(settings).includes('--auth-token'));
    assert.ok(!JSON.stringify(settings).includes('bypass'));
  }
  assert.ok(nativeHooks({ ...options, provider: 'codex' }).hooks.SessionEnd);
  assert.ok(nativeHooks({ ...options, provider: 'gemini' }).hooks.BeforeAgent);
  assert.equal(nativeHooks({ ...options, provider: 'gemini' }).hooks.SessionStart[0].hooks[0].timeout, 20000);
  const agy = nativeHooks({ ...options, provider: 'antigravity' })['ai-memory'];
  assert.ok(agy.PreInvocation); assert.equal(agy.SessionEnd, undefined);
});

test('gateway authenticates and fixes scope on single and batched native hooks', async t => {
  const directory = fs.mkdtempSync(path.resolve('.local-native-gateway-')), requests = [];
  const engine = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"accepted":1,"accepted_indices":[0]}');
  });
  await new Promise(resolve => engine.listen(0, '127.0.0.1', resolve));
  const gateway = await captureGateway({ dataDir: directory, endpoint: `http://127.0.0.1:${engine.address().port}`, token: 'private-token' });
  t.after(async () => { await gateway.close(); await new Promise(resolve => engine.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const endpoint = gateway.register('project-a'), headers = { Authorization: 'Bearer private-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(endpoint + '/hook', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(endpoint + '/hook', { method: 'POST', headers: { ...headers, Origin: 'http://foreign' }, body: '{}' })).status, 403);
  assert.equal((await fetch(endpoint + '/mcp', { headers })).status, 404);
  await fetch(endpoint + '/hook?project=foreign&workspace=foreign&identity=bad&aliases=foreign&project_strategy=repo-root&default_global=true', { method: 'POST', headers, body: '{"session_id":"native-a"}' });
  const query = new URL(requests[0].url, 'http://local').searchParams;
  assert.equal(query.get('project'), 'project-a'); assert.equal(query.get('workspace'), 'orquestra'); assert.equal(query.has('identity'), false);
  assert.equal(query.has('aliases'), false); assert.equal(query.has('project_strategy'), false); assert.equal(query.get('default_global'), 'false');
  const response = await fetch(endpoint + '/hook/batch', { method: 'POST', headers, body: JSON.stringify([{ url: '/hook?event=session-start&project=foreign', body: { session_id: 'native-a' } }]) });
  assert.deepEqual((await response.json()).accepted_indices, [0]);
  assert.match(JSON.parse(requests[1].body)[0].url, /project=project-a/);
  assert.ok(!fs.readFileSync(path.join(directory, 'orquestra-capture-port.json'), 'utf8').includes('private-token'));
});
