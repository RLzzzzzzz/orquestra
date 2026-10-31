import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory, captureFailure } from '../server/memory.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

test('capture diagnostics retain the provider failure instead of startup noise and scrub bearer', () => {
  const secret = 'engine-private-example';
  const detail = captureFailure({ message: 'Command failed: ai-memory', stderr: 'startup '.repeat(400) + `\x1b[31mEEXIST: mkdir opencode; ${secret}\x1b[0m` }, secret);
  assert.match(detail, /EEXIST: mkdir opencode/); assert.ok(detail.length <= 1200);
  assert.ok(!detail.includes(secret)); assert.ok(!detail.includes('\x1b'));
});

test('missing engine fails startup clearly without claiming lifecycle capture', async t => {
  const dir = fs.mkdtempSync(path.resolve('.local-memory-startup-'));
  const previous = process.env.ORQUESTRA_MEMORY_BIN;
  process.env.ORQUESTRA_MEMORY_BIN = path.join(dir, 'missing-engine.exe');
  const memory = new Memory(dir);
  try {
    await memory.ready;
    assert.equal(memory.info().status, 'unavailable');
    assert.equal(memory.info().lifecycleCapture, false);
    assert.match(memory.info().error, /http-ready|spawn/);
    await assert.rejects(memory.call('project', 'status'), /AI Memory/);
  } finally { await memory.dispose(); if (previous === undefined) delete process.env.ORQUESTRA_MEMORY_BIN; else process.env.ORQUESTRA_MEMORY_BIN = previous; }
});

test('native capture configuration is scoped to supported fresh sessions and hides bearer from status', () => {
  const memory = Object.create(Memory.prototype);
  Object.assign(memory, { status: 'ready', pluginPath: path.resolve('.local/plugin.ts'), authToken: 'private-native-bearer', dataDir: path.resolve('.local/memory') });
  const capture = memory.agentCapture('project-a', 'opencode');
  assert.equal(capture.env.ORQUESTRA_MEMORY_PROJECT, 'project-a');
  assert.equal(capture.env.AI_MEMORY_CAPTURE_OWNER, '');
  assert.match(capture.plugin, /^file:/);
  assert.ok(!JSON.stringify(memory.info()).includes('private-native-bearer'));
  assert.deepEqual(memory.agentCapture('project-a', 'codex'), {});
  memory.status = 'unavailable'; assert.deepEqual(memory.agentCapture('project-a', 'opencode'), {});
});

test('Antigravity projects sharing a repository keep independent process capture routes', t => {
  const directory = fs.mkdtempSync(path.resolve('.local-memory-capture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.agents', 'hooks.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ 'user-hook': { Stop: [{ command: 'keep-user-command' }] } }));
  const memory = Object.create(Memory.prototype);
  Object.assign(memory, { status: 'ready', binary: 'fixture-ai-memory.exe', authToken: 'fixture-secret', dataDir: directory,
    gateway: { register: project => `http://127.0.0.1:1234/project/${project}` } });
  const first = memory.agentCapture('project-a', 'antigravity', directory);
  const originalSettings = fs.readFileSync(file, 'utf8');
  const second = memory.agentCapture('project-b', 'antigravity', directory);
  assert.equal(fs.readFileSync(file, 'utf8'), originalSettings);
  assert.equal(first.env.ORQUESTRA_MEMORY_ENDPOINT, 'http://127.0.0.1:1234/project/project-a');
  assert.equal(second.env.ORQUESTRA_MEMORY_ENDPOINT, 'http://127.0.0.1:1234/project/project-b');
  assert.equal(first.env.ORQUESTRA_MEMORY_BINARY, memory.binary);
  assert.equal(JSON.parse(originalSettings)['user-hook'].Stop[0].command, 'keep-user-command');
});

test('external batch requires stable identities and preserves partial acknowledgements on saturation', async t => {
  const memory = Object.create(Memory.prototype); let request;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    request = JSON.parse(text);
    res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ accepted_indices: [0], accepted: 1 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const events = [{ event: 'user-prompt-submit', agent: 'codex', sessionId: 'native-17', ingestKey: 'stable-event-1', body: { session_id: 'native-17', prompt: 'fixture' } }];
  await assert.rejects(memory.postHookBatch(endpoint, events, 'test'), /projeto/);
  await assert.rejects(memory.postHookBatch(endpoint, [{ ...events[0], ingestKey: '' }], 'test', 'project-a'), /chave/);
  await assert.rejects(memory.postHookBatch(endpoint, [{ ...events[0], body: { session_id: 'wrong-session' } }], 'test', 'project-a'), /diverge/);
  const receipt = await memory.postHookBatch(endpoint, events, 'test', 'project-a');
  assert.deepEqual(receipt.accepted_indices, [0]); assert.equal(receipt.httpStatus, 429);
  const query = new URL(request[0].url, endpoint).searchParams;
  assert.equal(query.get('workspace'), 'orquestra'); assert.equal(query.get('project'), 'project-a');
  assert.equal(query.get('extension'), 'orquestra'); assert.equal(query.get('source_event'), events[0].event);
  assert.equal(query.get('ingest_key'), 'stable-event-1');
  await memory.postHookBatch(endpoint, [{ ...events[0], body: { prompt: 'without duplicated session field' } }], 'test', 'project-a');
  assert.equal(request[0].body.session_id, 'native-17');
});

test('deletes one project memory page through the official AI Memory tool', async () => {
  let request;
  const memory = Object.create(Memory.prototype);
  memory.ready = Promise.resolve();
  memory.status = 'ready';
  memory.ensureProject = async projectId => assert.equal(projectId, 'project-a');
  memory.client = { callTool: async input => {
    request = input;
    return { content: [{ type: 'text', text: JSON.stringify({ path: 'notes/example.md', deleted: true }) }] };
  } };
  const result = await memory.call('project-a', 'delete', { path: 'notes/example.md', expected_page_id: 'page-7' });
  assert.deepEqual(result, { path: 'notes/example.md', deleted: true });
  assert.deepEqual(request, {
    name: 'memory_delete_page',
    arguments: { path: 'notes/example.md', expected_page_id: 'page-7', workspace: 'orquestra', project: 'project-a' },
  });
});

test('rejects memory deletion paths outside the project wiki', async () => {
  const memory = Object.create(Memory.prototype);
  memory.ready = Promise.resolve(); memory.status = 'ready'; memory.ensureProject = async () => {};
  await assert.rejects(memory.call('project-a', 'delete', { path: '../outside.md' }), /caminho relativo/i);
  for (const pagePath of ['/outside.md', 'notes//outside.md', 'notes/../outside.md', 'C:/outside.md']) {
    await assert.rejects(memory.call('project-a', 'read', { path: pagePath }), /caminho relativo/i);
  }
});

test('missing or malformed project never falls back to the engine default scope', async () => {
  const memory = Object.create(Memory.prototype);
  memory.ready = Promise.resolve(); memory.status = 'ready';
  memory.ensureProject = async () => assert.fail('invalid scope reached engine');
  for (const projectId of [undefined, null, '', ' project ', '../foreign', '/foreign', 'a'.repeat(129)]) {
    await assert.rejects(memory.call(projectId, 'status'), /projeto explícito/i);
    assert.throws(() => memory.agentCapture(projectId, 'codex'), /projeto explícito/i);
  }
});

test('search stays project-scoped without model answers and writes redact credentials', async () => {
  const requests = [], memory = Object.create(Memory.prototype);
  memory.ready = Promise.resolve(); memory.status = 'ready'; memory.ensureProject = async () => {};
  memory.client = { callTool: async request => { requests.push(request); return { content: [{ type: 'text', text: '{"ok":true}' }] }; } };
  await memory.call('project-a', 'query', { query: 'decisão', project: 'foreign', global: true });
  assert.deepEqual(requests[0].arguments, { query: 'decisão', limit: 15, global: false, answer: false, workspace: 'orquestra', project: 'project-a' });
  await memory.call('project-a', 'write', { path: 'notes/test.md', body: 'token=private-example decisão' });
  assert.ok(!requests[1].arguments.body.includes('private-example'));
  await assert.rejects(memory.call('project-a', 'write', { path: '../../bad.md', body: 'bad' }), /relativo/);
  memory.client.callTool = async () => ({ isError: true, content: [{ type: 'text', text: 'memory failure' }] });
  await assert.rejects(memory.call('project-a', 'briefing'), /memory failure/);
  memory.status = 'unavailable'; memory.error = 'not installed';
  await assert.rejects(memory.call('project-a', 'briefing'), /not installed/);
});

test('task recording preserves its ID and bounds long results in the existing AI Memory history', async () => {
  const memory = Object.create(Memory.prototype); let request;
  memory.call = async (...args) => { request = args; };
  await memory.recordTask({ id: 'task-id', projectId: 'project', title: 'Título', agentName: 'Codex', provider: 'codex', status: 'failed', prompt: 'Tarefa', createdAt: Date.now(), result: 'x'.repeat(40000) });
  assert.equal(request[0], 'project'); assert.equal(request[2].path, 'tasks/task-id.md'); assert.ok(request[2].body.length <= 32000);
});

test('memory edits forward native compare-and-set and exclusive-create preconditions', async () => {
  const requests = [], memory = Object.create(Memory.prototype);
  memory.ready = Promise.resolve(); memory.status = 'ready'; memory.ensureProject = async () => {};
  memory.client = { callTool: async request => { requests.push(request); return { content: [{ type: 'text', text: '{"ok":true}' }] }; } };
  await memory.call('project', 'write', { path: 'notes/shared.md', body: 'change', expected_page_id: 'version-read' });
  assert.equal(requests[0].arguments.expected_page_id, 'version-read');
  await memory.call('project', 'write', { path: 'notes/new.md', body: 'new', create_only: true });
  assert.equal(requests[1].arguments.create_only, true);
  await assert.rejects(memory.call('project', 'write', { path: 'notes/shared.md', body: 'invalid', create_only: true, expected_page_id: 'old' }), /não ambos/);
  assert.equal(requests.length, 2);
});

test('delegated context hydrates unique pinned and relevant pages within a valid JSON budget', async () => {
  const memory = Object.create(Memory.prototype), reads = [];
  memory.call = async (project, operation, input) => {
    assert.equal(project, 'project');
    if (operation === 'briefing') return { scope: { project }, pinned: [{ path: 'notes/rules.md' }], recent_pages: [{ path: 'notes/recent.md' }] };
    if (operation === 'query') { assert.equal(input.query, 'fix retry'); return { hits: [{ path: 'notes/relevant.md' }, { path: 'notes/rules.md' }] }; }
    assert.equal(operation, 'read'); reads.push(input.path);
    return { title: 'Decision', body: 'ACTUAL_DECISION: keep retries idempotent.\n"\\'.repeat(1000) };
  };
  const result = await memory.context('project', 'fix retry');
  const packet = JSON.parse(result.text);
  assert.equal(packet.pages.length, 3); assert.equal(new Set(reads).size, reads.length);
  assert.match(result.text, /ACTUAL_DECISION/); assert.ok(result.text.length <= 4500);
  assert.ok(packet.pages.every(page => page.truncated)); assert.deepEqual(result.warnings, []);
});

test('partial recall keeps readable memory and reports failed search or deleted pages', async () => {
  const memory = Object.create(Memory.prototype);
  memory.call = async (project, operation, input) => {
    if (operation === 'briefing') return { recent_pages: [{ path: 'notes/deleted.md' }, { path: 'notes/kept.md' }] };
    if (operation === 'query') throw new Error('search unavailable');
    if (input.path.includes('deleted')) throw new Error('page missing');
    return { body: 'surviving context' };
  };
  const result = await memory.context('project', 'topic');
  assert.match(result.text, /surviving context/); assert.equal(result.warnings.length, 2);
});
