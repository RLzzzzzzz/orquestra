import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveTasks } from '../server/live-tasks.mjs';
import { Terminals } from '../server/terminals.mjs';
import { Orchestration } from '../server/orchestration.mjs';
import { Memory } from '../server/memory.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function liveFixture(t, options) {
  const events = new EventEmitter(), writes = [];
  const session = { id: 'session-a', status: 'running', mode: 'agent', managed: true, mcpReady: true, cwd: 'project',
    proc: { onData(fn) { events.on('data', fn); return { dispose: () => events.off('data', fn) }; }, onExit(fn) { events.on('exit', fn); return { dispose: () => events.off('exit', fn) }; }, kill() { events.emit('exit'); } } };
  const terminals = { sessions: new Map([['worker', session]]), async prompt(id, text, options) { writes.push({ id, text, options }); }, stop() { session.proc.kill(); } };
  const live = new LiveTasks(terminals, { context: async () => ({ text: 'shared context', warnings: [] }) }, options);
  const job = { id: 'task-a', agentId: 'worker', projectId: 'project-a', prompt: 'test', cwd: 'project' };
  const child = live.start(job); child.stdout.resume(); child.stderr.resume();
  t.after(() => live.stop(child));
  const scope = { agentId: 'worker', projectId: 'project-a', sessionId: 'session-a' };
  return { events, session, terminals, live, job, child, scope, writes };
}

test('running PTY is unavailable until MCP initialization; receipt and completion are separate', async t => {
  const f = liveFixture(t); await tick();
  assert.equal(f.job.delivery, 'sent'); assert.equal(f.job.receivedAt, undefined);
  assert.equal(f.writes[0].options.expectedSession, f.session);
  f.live.acknowledge(f.scope, { task_id: f.job.id });
  assert.equal(f.job.delivery, 'acknowledged'); assert.ok(f.job.receivedAt); assert.equal(f.live.active.size, 1);
  f.live.complete(f.scope, { task_id: f.job.id, status: 'succeeded', result: 'real response' });
  assert.equal(f.live.active.size, 0);
  assert.equal(f.live.complete(f.scope, { task_id: f.job.id, status: 'succeeded', result: 'real response' }).duplicate, true);
  assert.throws(() => f.live.complete(f.scope, { task_id: f.job.id, status: 'succeeded', result: 'different' }), /outro resultado/);
  f.session.mcpReady = false; assert.equal(f.live.available('worker'), false);
});

test('missing receipt stops the task promptly instead of waiting the full task timeout', async t => {
  const f = liveFixture(t, { receiptTimeoutMs: 15 });
  await new Promise(resolve => { f.child.on('close', resolve); setTimeout(resolve, 100); });
  assert.equal(f.job.delivery, 'unconfirmed'); assert.match(f.job.error, /recebimento/); assert.equal(f.live.active.size, 0);
});

test('receipt timeout starts after recall and delivery, and partial context remains visible', async t => {
  const f = liveFixture(t, { receiptTimeoutMs: 15 });
  let release;
  f.live.memory.context = () => new Promise(resolve => { release = resolve; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.live.active.size, 1); assert.equal(f.job.delivery, 'sending');
  assert.equal(f.writes.length, 0);
  release({ text: '{"pages":[]}', warnings: ['one page missing'] }); await tick();
  assert.equal(f.job.delivery, 'sent'); assert.equal(f.job.contextStatus, 'partial');
  assert.match(f.job.contextError, /one page missing/);
  f.live.acknowledge(f.scope, { task_id: f.job.id });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.live.active.size, 1);
});

test('stale-session completion is refused and cancellation never kills the replacement', async t => {
  const f = liveFixture(t); await tick();
  const replacement = { ...f.session, id: 'session-b' }; f.terminals.sessions.set('worker', replacement);
  assert.throws(() => f.live.complete(f.scope, { task_id: f.job.id, status: 'succeeded', result: 'late' }), /sessão atual/);
  let stoppedReplacement = false; f.terminals.stop = () => { stoppedReplacement = true; };
  f.live.stop(f.child); assert.equal(stoppedReplacement, false); assert.equal(f.live.active.size, 0);
});

test('session capability expires on restart and MCP registration is bound to the current terminal', async () => {
  const session = { id: 'session-a', status: 'running' };
  const terminals = { sessions: new Map([['worker', session]]), info: () => ({ sessionId: session.id, status: session.status }), emit() {} };
  const orchestration = new Orchestration({}, terminals, {}, 0);
  const token = orchestration.issue('project', 'worker', 'worker'); const scope = orchestration.scope(token); scope.sessionId = 'session-a';
  await orchestration.call(scope, 'registrar_sessao'); assert.equal(session.mcpReady, true);
  session.id = 'session-b'; assert.equal(orchestration.scope(token), undefined);
  await assert.rejects(orchestration.call(scope, 'registrar_sessao'), /não corresponde/);
});

test('terminal pastes preserve LF, reject stale input and keep envelope budget separate from user text', async () => {
  const terminal = new Terminals(() => {}), writes = [];
  const session = { id: 'current', status: 'running', mode: 'agent', proc: { write: data => writes.push(data) } };
  terminal.sessions.set('agent', session);
  assert.throws(() => terminal.write('agent', 'bad', 'old'), /sessão/);
  await terminal.prompt('agent', 'line1\r\nline2', { submit: false, bracketed: true, sessionId: 'current' });
  assert.equal(writes[0], '\x1b[200~line1\nline2\x1b[201~');
  await assert.rejects(terminal.prompt('agent', 'x'.repeat(17000)), /longa/);
  await terminal.prompt('agent', 'x'.repeat(17000), { limit: 24000, submit: false });
  await assert.rejects(terminal.prompt('agent', 'late', { sessionId: 'old' }), /sessão/);
});

test('terminal resize deduplicates geometry and rejects stale or invalid dimensions', () => {
  const terminal = new Terminals(() => {}), calls = [];
  const session = { id: 'current', status: 'running', cols: 100, rows: 28, proc: { resize: (...size) => calls.push(size) } };
  terminal.sessions.set('agent', session);
  terminal.resize('agent', 100, 28, 'current');
  terminal.resize('agent', 90, 32, 'stale');
  terminal.resize('agent', 0, 32, 'current');
  terminal.resize('agent', 90.5, 32, 'current');
  assert.deepEqual(calls, []);
  terminal.resize('agent', 90, 32, 'current');
  terminal.resize('agent', 90, 32, 'current');
  assert.deepEqual(calls, [[90, 32]]);
  session.proc.resize = () => { throw new Error('PTY resize failed'); };
  assert.throws(() => terminal.resize('agent', 80, 24, 'current'), /failed/);
  assert.equal(session.cols, 90); assert.equal(session.rows, 32);
  session.status = 'exited';
  assert.doesNotThrow(() => terminal.resize('agent', 80, 24, 'current'));
});

test('AI Memory calls serialize shared wiki writes and recover after a rejected operation', async () => {
  const memory = Object.create(Memory.prototype); memory.ready = Promise.resolve(); memory.status = 'ready'; memory.ensureProject = async () => {};
  let active = 0, maximum = 0;
  memory.client = { async callTool({ arguments: args }) {
    active++; maximum = Math.max(maximum, active); await tick(); active--;
    return { isError: args.body.includes('fail'), content: [{ type: 'text', text: args.body.includes('fail') ? 'write failed' : '{"ok":true}' }] };
  } };
  const results = await Promise.allSettled(['first', 'fail', 'last'].map(body => memory.call('project', 'write', { path: 'notes/probe.md', body })));
  assert.equal(maximum, 1); assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('AI Memory initialization handles isError responses without caching false success', async () => {
  const memory = Object.create(Memory.prototype); memory.projects = new Map(); const calls = [];
  memory.client = { async callTool(input) { calls.push(input.name); return input.name === 'memory_status' ? { isError: true, content: [{ type: 'text', text: 'project fixture not found' }] } : { content: [{ type: 'text', text: '{"ok":true}' }] }; } };
  await memory.ensureProject('new-project'); assert.deepEqual(calls, ['memory_status', 'memory_write_page']);
});
