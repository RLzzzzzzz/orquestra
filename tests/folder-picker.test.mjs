import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDirectory } from '../server/folder-picker.mjs';

test('returns the folder selected by the native Windows dialog', async () => {
  let invocation;
  const result = await pickDirectory('win32', async (...args) => {
    invocation = args;
    return { stdout: ' C:\\Projetos\\orquestra \r\n' };
  });
  assert.deepEqual(result, { path: 'C:\\Projetos\\orquestra' });
  assert.equal(invocation[0], 'powershell.exe');
  assert.deepEqual(invocation[1].slice(0, 3), ['-NoProfile', '-STA', '-Command']);
  assert.equal(invocation[2].windowsHide, false);
  assert.equal(invocation[2].timeout, 60000);
});

test('reports a cancelled directory dialog without changing a path', async () => {
  assert.deepEqual(await pickDirectory('win32', async () => ({ stdout: '' })), { path: null });
});
