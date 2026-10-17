import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../server/memory.mjs';

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
});
