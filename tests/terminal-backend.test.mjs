import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Terminals, terminalPtyOptions, terminalPtyMetadata } from '../server/terminals.mjs';

test('OpenCode selects bundled ConPTY while other Windows terminals keep WinPTY', () => {
  assert.deepEqual(terminalPtyOptions('opencode', 'win32'), { useConpty: true, useConptyDll: true });
  for (const provider of ['codex', 'claude', 'custom', 'shell', 'gemini']) assert.deepEqual(terminalPtyOptions(provider, 'win32'), { useConpty: false });
  assert.deepEqual(terminalPtyOptions('opencode', 'linux'), {});
  assert.deepEqual(terminalPtyMetadata({ useConpty: true }, 'win32', '10.0.26100'), { backend: 'conpty', buildNumber: 26100 });
  assert.deepEqual(terminalPtyMetadata({ useConpty: false }, 'win32', '10.0.19045'), { backend: 'winpty', buildNumber: 19045 });
  assert.deepEqual(terminalPtyMetadata({ useConpty: true }, 'win32', 'unknown'), { backend: 'conpty' });
  assert.equal(terminalPtyMetadata({}, 'linux'), undefined);
});

test('managed Windows OpenCode transport delivers resize events and exits its isolated host', { timeout: 20000 }, async t => {
  if (process.platform !== 'win32') return t.skip('Windows console transport regression');
  // Production runs native consoles in a separate Node backend and bounds its
  // shutdown. Keep that process boundary here: native PTY workers must not
  // retain the test runner after a natural CLI exit and recovery-shell stop.
  const { stdout } = await promisify(execFile)(process.execPath, [path.resolve('tests/fixtures/terminal-backend-host.mjs')], { windowsHide: true, timeout: 15000 });
  assert.match(stdout, /RESIZE_AND_FALLBACK_OK/);
});
