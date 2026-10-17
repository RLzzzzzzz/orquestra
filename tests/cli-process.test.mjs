import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCliLaunch } from '../server/cli-process.mjs';

test('npm CLI launcher preserves long hook arguments without cmd.exe truncation', async t => {
  if (process.platform !== 'win32') return t.skip('Windows npm shim regression');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq CLI ação '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'node_modules', 'fixture', 'cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const file = path.join(dir, 'codex.cmd');
  fs.writeFileSync(file, '@ECHO off\r\nSET "_prog=node"\r\n"%_prog%" "%dp0%\\node_modules\\fixture\\cli.js" %*\r\n');
  const args = ['--no-daemon', '-c', 'hooks.SessionStart=' + 'x'.repeat(15000), '-c', 'developer_instructions="ação com espaços"'];
  const command = resolveCliLaunch(file, args);
  assert.equal(command.file, process.execPath);
  assert.deepEqual(command.args, [entry, ...args]);
  const { stdout } = await promisify(execFile)(process.execPath, ['server/cli-launcher.mjs'], { env: { ...process.env, ORQUESTRA_LAUNCH: JSON.stringify({ file, args }) }, windowsHide: true, timeout: 10000 });
  assert.deepEqual(JSON.parse(stdout), args);
});

test('custom Windows wrappers and native executables keep their launch contract', t => {
  const dir = fs.mkdtempSync(path.resolve('.local-cli-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'custom.cmd'), args = ['hello'];
  fs.writeFileSync(file, '@echo custom wrapper %*');
  assert.deepEqual(resolveCliLaunch(file, args, 'win32'), { file, args });
  assert.deepEqual(resolveCliLaunch('codex.exe', args, 'win32'), { file: 'codex.exe', args });
  assert.deepEqual(resolveCliLaunch(file, args, 'linux'), { file, args });
});
