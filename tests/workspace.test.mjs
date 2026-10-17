import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Workspace, directory, textField, findCommand, commandCanStart } from '../server/workspace.mjs';

test('persists projects and agents, including paths with spaces and accents', t => {
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const folder = path.join(temp, 'projeto com acentuação'); fs.mkdirSync(folder);
  const ws = new Workspace(temp, folder);
  const project = ws.addProject({ name: 'Segundo projeto', cwd: folder });
  const agent = ws.addAgent({ projectId: project.id, provider: 'custom', name: 'Revisor', command: 'node --version', role: 'Revisão' });
  const restored = new Workspace(temp, folder);
  assert.deepEqual(restored.state, ws.state);
  assert.equal(agent.cwd, folder);
  assert.equal(agent.command, 'node --version');
  restored.removeAgent(agent.id);
  assert.equal(new Workspace(temp, folder).state.agents.length, 0);
});
test('rejects invalid working directories and invalid agent configuration', t => {
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const ws = new Workspace(temp, temp);
  assert.throws(() => directory(path.join(temp, 'missing')), /não existe/);
  assert.throws(() => textField(' ', 'Nome'), /inválido/);
  assert.throws(() => ws.addAgent({ projectId: 'missing' }), /Projeto/);
  assert.throws(() => ws.addAgent({ projectId: ws.state.projects[0].id, provider: 'unknown' }), /Tipo/);
  assert.throws(() => ws.addAgent({ projectId: ws.state.projects[0].id, provider: 'custom', name: 'test', command: '' }), /Comando/);
  assert.equal(ws.state.agents.length, 0);
});
test('prefers executable and cmd shims over PowerShell scripts on Windows', t => {
  if (process.platform !== 'win32') return t.skip();
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'testcli.ps1'), '');
  assert.equal(findCommand('testcli', { PATH: temp }, 'win32'), null);
  fs.writeFileSync(path.join(temp, 'testcli.cmd'), '');
  assert.equal(findCommand('testcli', { PATH: temp }, 'win32'), path.join(temp, 'testcli.cmd'));
});
test('finds and validates Antigravity in LOCALAPPDATA when agy is absent from PATH', t => {
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const localAppData = path.join(temp, 'AppData', 'Local');
  const binary = path.join(localAppData, 'agy', 'bin', 'agy.exe');
  const pathBinary = path.join(temp, 'path-bin', 'agy.exe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.mkdirSync(path.dirname(pathBinary), { recursive: true });
  fs.writeFileSync(binary, 'fixture');
  fs.writeFileSync(pathBinary, 'fixture');
  const env = { PATH: path.dirname(pathBinary), LOCALAPPDATA: localAppData };
  assert.equal(findCommand('agy', env, 'win32'), pathBinary);
  fs.rmSync(pathBinary);
  assert.equal(findCommand('agy', env, 'win32'), binary);
  let started;
  assert.equal(commandCanStart('agy', env, 'win32', (file, args) => {
    started = { file, args };
    return { status: 0, signal: null };
  }), true);
  assert.deepEqual(started, { file: binary, args: ['--version'] });
});
test('finds and validates Hermes in LOCALAPPDATA when hermes is absent from PATH', t => {
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.local-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const localAppData = path.join(temp, 'AppData', 'Local');
  const binary = path.join(localAppData, 'hermes', 'bin', 'hermes.cmd');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'fixture');
  const env = { PATH: path.join(temp, 'empty-path'), LOCALAPPDATA: localAppData };
  assert.equal(findCommand('hermes', env, 'win32'), binary);
  let started;
  assert.equal(commandCanStart('hermes', env, 'win32', (file, args) => {
    started = { file, args };
    return { status: 0, signal: null };
  }), true);
  assert.deepEqual(started, { file: 'cmd.exe', args: ['/d', '/c', `${binary} --version`] });
});
