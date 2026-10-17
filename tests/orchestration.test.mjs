import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workspace } from '../server/workspace.mjs';
import { TaskManager } from '../server/task-manager.mjs';
import { Orchestration, bridgePath } from '../server/orchestration.mjs';
import { parseWorkerEvent } from '../server/cli-adapters.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.local-tasks-'));
  const workspace = new Workspace(dir, dir);
  const projectId = workspace.state.projects[0].id;
  const agent = workspace.addAgent({ projectId, provider: 'codex', name: 'Executor' });
  const children = [];
  const manager = new TaskManager(workspace, () => {}, { spawn() {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.end = (code = 0, completed = true) => {
      child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Resultado ágil' } }) + '\n');
      if (completed) child.stdout.write('{"type":"turn.completed"}\n');
      child.emit('close', code);
    };
    children.push(child); return child;
  }, kill(child) { child.killed = true; } });
  t.after(() => { manager.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const create = (requestId, overrides = {}) => manager.create(projectId, { agentId: agent.id, prompt: 'Uma tarefa', requestId, ...overrides });
  return { dir, workspace, projectId, agent, children, manager, create };
}

test('queue serializes overlapping folders, preserves cancellation lock and deduplicates requests', async t => {
  const f = fixture(t);
  const first = f.create('one');
  assert.equal(f.create('one').id, first.id);
  assert.throws(() => f.create('one', { prompt: 'Outra tarefa' }), /Identificador/);
  const second = f.create('two'); await tick();
  assert.equal(f.children.length, 1);
  assert.equal(f.manager.get(second.id).status, 'queued');
  f.manager.cancel(first.id, f.projectId);
  assert.equal(f.children[0].killed, true);
  assert.equal(f.children.length, 1);
  f.children[0].emit('close', 1);
  assert.equal(f.manager.get(first.id).status, 'cancelled');
  assert.equal(f.children.length, 2);
  f.children[1].end();
  assert.equal(f.manager.get(second.id).status, 'succeeded');
  assert.match(f.manager.get(second.id).result, /ágil/);
  assert.throws(() => f.manager.get(second.id, 'another-project'), /não encontrada/);
});

test('separate folders run concurrently; exit zero without structured completion is failure', async t => {
  const f = fixture(t);
  const a = path.join(f.dir, 'a'), b = path.join(f.dir, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  f.agent.cwd = a;
  const other = f.workspace.addAgent({ projectId: f.projectId, provider: 'codex', name: 'Outro', cwd: b });
  const one = f.create('one'), two = f.create('two', { agentId: other.id }); await tick();
  assert.equal(f.children.length, 2);
  f.children[0].end(0, false); f.children[1].end();
  assert.equal(f.manager.get(one.id).status, 'failed');
  assert.equal(f.manager.get(two.id).status, 'succeeded');
});

test('restart interrupts persisted jobs without resubmitting them', async t => {
  const f = fixture(t); const job = f.create('one'); await tick();
  let spawned = false;
  const reopened = new TaskManager(f.workspace, () => {}, { spawn() { spawned = true; } });
  assert.equal(reopened.get(job.id).status, 'interrupted');
  reopened.pump(); assert.equal(spawned, false); reopened.dispose();
  f.children[0].end();
});

test('provider events distinguish completion, errors and permission requests', () => {
  assert.equal(parseWorkerEvent('opencode', { type: 'step_finish', part: { reason: 'tool-calls' } }).completed, false);
  assert.equal(parseWorkerEvent('opencode', { type: 'step_finish', part: { reason: 'stop' } }).completed, true);
  assert.equal(parseWorkerEvent('claude', { type: 'result', subtype: 'success', permission_denials: [{}] }).needsAction, true);
  assert.equal(parseWorkerEvent('gemini', { type: 'result', status: 'error', error: { message: 'quota' } }).error, 'quota');
  assert.equal(parseWorkerEvent('codex', { type: 'turn.failed', error: { message: 'failed' } }).error, 'failed');
});

test('real MCP stdio handshake, delegation, result and project boundaries', { timeout: 20000 }, async t => {
  const f = fixture(t);
  const orchestration = new Orchestration(f.workspace, {}, f.manager, 0);
  const token = orchestration.issue(f.projectId, 'test-coordinator');
  const server = http.createServer(async (req, res) => {
    const scope = orchestration.scope(req.headers.authorization?.replace('Bearer ', ''));
    if (!scope) { res.writeHead(401); res.end('{}'); return; }
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const { name, args } = JSON.parse(raw);
      res.end(JSON.stringify(await orchestration.call(scope, name, args)));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/internal/orchestration`;
  const client = new Client({ name: 'orquestra-test', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [bridgePath], env: { ...process.env, ORQUESTRA_MCP_TOKEN: token, ORQUESTRA_MCP_URL: url }, stderr: 'pipe' });
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['listar_agentes', 'concluir_tarefa', 'buscar_memoria', 'salvar_memoria', 'criar_handoff']) assert.ok(names.includes(name));
  const invoke = async (name, args = {}) => client.callTool({ name, arguments: args });
  const workers = JSON.parse((await invoke('listar_agentes')).content[0].text);
  assert.equal(workers.agents[0].id, f.agent.id);
  const delegated = await invoke('enviar_tarefa', { agent_id: f.agent.id, instruction: 'Uma tarefa', request_id: 'mcp-one' });
  assert.ok(!delegated.isError, JSON.stringify(delegated));
  const id = JSON.parse(delegated.content[0].text).task_id;
  await tick(); f.children[0].end();
  const done = JSON.parse((await invoke('consultar_tarefa', { task_id: id })).content[0].text);
  assert.equal(done.status, 'succeeded');
  const foreign = f.workspace.addProject({ name: 'Outro', cwd: f.dir });
  const other = f.workspace.addAgent({ projectId: foreign.id, provider: 'codex', name: 'Privado' });
  const job = f.manager.create(foreign.id, { agentId: other.id, requestId: 'foreign', prompt: 'Privado' });
  assert.equal((await invoke('consultar_tarefa', { task_id: job.id })).isError, true);
  assert.equal((await invoke('enviar_tarefa', { agent_id: other.id, instruction: 'Inválido', request_id: 'bad' })).isError, true);
});
