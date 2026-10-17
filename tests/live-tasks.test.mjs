import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveTasks } from '../server/live-tasks.mjs';
import { redact } from '../server/memory.mjs';

test('delegation uses the open PTY, streams output and accepts completion only from its worker', async () => {
  const events = new EventEmitter(); const session = { id: 'session-1', mcpReady: true, status: 'running', mode: 'agent', managed: true, pid: 123,
    proc: { onData(fn) { events.on('data', fn); return { dispose: () => events.off('data', fn) }; }, onExit(fn) { events.on('exit', fn); return { dispose: () => events.off('exit', fn) }; } } };
  let prompt, stopped = false;
  const terminals = { sessions: new Map([['agent', session]]), async prompt(id, text) { assert.equal(id, 'agent'); prompt = text; }, stop() { stopped = true; events.emit('exit'); } };
  const live = new LiveTasks(terminals, { context: async () => ({ text: 'contexto anterior', warnings: [] }) });
  const job = { id: 'task-1', projectId: 'project', agentId: 'agent', prompt: 'Trabalhe aqui', agentName: 'Worker' };
  const child = live.start(job); let out = '', exit;
  child.stdout.on('data', d => out += d); child.on('close', code => { exit = code; });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(prompt, /task-1/); assert.match(prompt, /contexto anterior/);
  assert.equal(terminals.sessions.get('agent'), session); assert.equal(session.pid, 123);
  events.emit('data', '\u001b[32mresposta ao vivo\u001b[0m'); assert.match(out, /resposta ao vivo/);
  assert.throws(() => live.complete({ agentId: 'foreign', projectId: 'project' }, { task_id: job.id, status: 'succeeded', result: 'x' }), /não pertence/);
  live.complete({ agentId: 'agent', projectId: 'project' }, { task_id: job.id, status: 'succeeded', result: 'Terminei' });
  assert.equal(exit, 0); assert.match(out, /orquestra.result/); assert.equal(events.listenerCount('data'), 0);
  const second = live.start({ ...job, id: 'task-2' }); second.on('close', () => {}); live.stop(second);
  assert.equal(stopped, true); assert.equal(live.active.size, 0);
});

test('closed, fallback and unmanaged terminals cannot receive delegation', () => {
  const terminal = { sessions: new Map([['fallback', { status: 'running', mode: 'fallback', managed: true }], ['manual', { status: 'running', mode: 'agent' }]]) };
  const live = new LiveTasks(terminal);
  for (const id of ['fallback', 'manual', 'missing']) { assert.equal(live.available(id), false); assert.throws(() => live.start({ agentId: id }), /Abra o terminal/); }
});

test('common credentials are redacted before memory persistence', () => {
  const result = redact('token=supersecret password:example sk-abcdefghijklmnopqrstuv');
  assert.ok(!result.includes('supersecret')); assert.ok(!result.includes('example')); assert.ok(!result.includes('sk-'));
  const headers = redact('Authorization: Bearer private.credential.value\nAuthorization=Basic dXNlcjpwYXNz');
  assert.ok(!headers.includes('private.credential.value')); assert.ok(!headers.includes('dXNlcjpwYXNz'));
});

test('delegation refuses an existing terminal opened in a different directory', () => {
  const terminals = { sessions: new Map([['worker', { status: 'running', mode: 'agent', managed: true, mcpReady: true, cwd: 'old-directory' }]]) };
  const live = new LiveTasks(terminals);
  assert.throws(() => live.start({ agentId: 'worker', cwd: 'new-worktree' }), /pasta do terminal/);
  assert.equal(live.active.size, 0);
});
