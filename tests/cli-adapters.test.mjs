import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerEvent } from '../server/cli-adapters.mjs';

test('provider protocols distinguish tool execution, response, completion and permission errors', () => {
  assert.equal(parseWorkerEvent('codex', { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }).text, 'ok');
  assert.match(parseWorkerEvent('codex', { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.js' }] } }).log, /a.js/);
  assert.equal(parseWorkerEvent('opencode', { type: 'text', part: { text: 'ok' } }).completed, false);
  assert.equal(parseWorkerEvent('claude', { type: 'result', subtype: 'success', is_error: true, result: 'quota' }).completed, false);
  assert.equal(parseWorkerEvent('gemini', { type: 'message', role: 'user', content: 'ignore' }).text, '');
  assert.equal(parseWorkerEvent('gemini', { type: 'result', status: 'success' }).completed, true);
  for (const type of ['permission.asked', 'permission_denied', 'approval.required']) assert.equal(parseWorkerEvent('codex', { type }).needsAction, true);
});
