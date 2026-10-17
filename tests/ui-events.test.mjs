import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotEvents, sessionDraft, filterActivity } from '../src/ui-events.mjs';

const task = { id: 'task-1', kind: 'delegated', agentId: 'agent-1', agentName: 'OpenCode', projectId: 'project-1', sessionId: 'session-1', status: 'running', delivery: 'sent' };
const snapshot = tasks => ({ tasks, agents: [] });

test('initial snapshots and unchanged reconnects do not replay historical notifications', () => {
  const current = snapshot([{ ...task, status: 'succeeded' }]);
  assert.deepEqual(snapshotEvents(null, current), []);
  assert.deepEqual(snapshotEvents(current, structuredClone(current)), []);
});
test('receipt, completion, failure and intervention follow authoritative task changes', () => {
  const received = { ...task, delivery: 'acknowledged' };
  const receipt = snapshotEvents(snapshot([task]), snapshot([received]));
  assert.equal(receipt.length, 1); assert.equal(receipt[0].key, 'receipt:task-1');
  const complete = snapshotEvents(snapshot([received]), snapshot([{ ...received, status: 'succeeded' }]));
  assert.equal(complete.length, 1); assert.equal(complete[0].native, true); assert.match(complete[0].message, /concluída/);
  for (const status of ['failed', 'interrupted', 'awaiting_approval']) {
    const event = snapshotEvents(snapshot([task]), snapshot([{ ...task, status }]))[0];
    assert.equal(event.native, true); assert.equal(event.error, status !== 'awaiting_approval');
  }
});
test('agent fallback and replacement session are distinct from task completion', () => {
  const agent = { id: 'a', projectId: 'p', sessionId: 's1', name: 'CLI', status: 'running', mode: 'agent' };
  const changes = snapshotEvents({ agents: [agent] }, { agents: [{ ...agent, mode: 'fallback', sessionId: 's2' }] });
  assert.equal(changes[0].error, true); assert.equal(changes[0].sessionId, 's2');
  assert.equal(changes[0].taskId, undefined);
});
test('new session preserves CLI configuration while excluding runtime, tokens and worktree ownership', () => {
  const agent = { id: 'original', projectId: 'p', name: 'Codex', provider: 'codex', cwd: 'C:/project', role: 'review', command: 'codex', coordinator: true, worktree: 'private', autoCommit: true, sessionId: 'old', token: 'secret' };
  const copy = sessionDraft(agent, [{ ...agent, name: 'Codex · sessão 2' }]);
  assert.deepEqual(copy, { projectId: 'p', provider: 'codex', name: 'Codex · sessão 3', cwd: 'C:/project', role: 'review', command: 'codex' });
  assert.equal(sessionDraft({ ...agent, name: 'Codex · sessão 2' }, [agent]).name, 'Codex · sessão 2');
});
test('activity filters retain project/session boundaries and global service events', () => {
  const events = [{ agentId: 'a', projectId: 'p', kind: 'error' }, { agentId: 'b', projectId: 'q', kind: 'error' }, { kind: 'state' }];
  assert.equal(filterActivity(events, { projectId: 'p' }).length, 2);
  assert.deepEqual(filterActivity(events, { projectId: 'p', agentId: 'a', kind: 'error' }), [events[0]]);
  assert.deepEqual(filterActivity(events, { projectId: 'p', kind: 'message' }), []);
});
