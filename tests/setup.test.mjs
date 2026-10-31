import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSetupArgs, setup } from '../scripts/setup.mjs';
import { Workspace } from '../server/workspace.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.local-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, devDependencies: {} }));
  const bin = path.join(root, 'bin with spaces'); fs.mkdirSync(bin);
  const binary = command => path.join(bin, command + (process.platform === 'win32' ? '.cmd' : ''));
  fs.writeFileSync(binary('git'), 'fixture');
  const env = { PATH: bin, npm_execpath: process.execPath };
  const options = parseSetupArgs([], root, env);
  const memory = path.join(options.dataDir, 'runtime/ai-memory', process.platform === 'win32' ? 'ai-memory.exe' : 'ai-memory');
  const calls = [], logs = [];
  const hooks = {
    env, log: message => logs.push(message), serviceRunning: async () => false,
    run: async (file, args, callOptions) => {
      calls.push({ file, args, options: callOptions });
      if (args[0].endsWith('install-memory.mjs')) { fs.mkdirSync(path.dirname(memory), { recursive: true }); fs.writeFileSync(memory, 'fixture'); }
      if (args[1] === 'install' && args.includes('@openai/codex')) fs.writeFileSync(binary('codex'), 'fixture');
    },
  };
  return { root, binary, env, options, memory, calls, logs, hooks };
}

test('setup rejects invalid flags and never allows package names outside its allowlist', () => {
  assert.throws(() => parseSetupArgs(['--install-clis', 'package-from-user']), /CLIs instaláveis/);
  assert.throws(() => parseSetupArgs(['--data-dir']), /Informe um valor/);
  assert.throws(() => parseSetupArgs(['--unknown']), /desconhecida/);
  assert.throws(() => parseSetupArgs(['--check', '--install-clis', 'codex']), /somente leitura/);
  assert.deepEqual(parseSetupArgs(['--install-clis', 'codex,codex,gemini']).installClis, ['codex', 'gemini']);
});

test('setup bootstraps dependencies before loading app modules and installs only explicitly requested missing CLIs', async t => {
  const f = fixture(t);
  f.options.installClis = ['codex'];
  f.hooks.dependenciesPresent = () => false;
  f.hooks.loadWorkspace = async () => {
    assert.deepEqual(f.calls[0].args.slice(1), ['ci', '--no-audit', '--no-fund']);
    return import('../server/workspace.mjs');
  };
  const report = await setup(f.options, f.hooks);
  assert.deepEqual(report.providers, ['codex']);
  assert.equal(report.added.length, 1);
  assert.ok(f.calls.some(c => c.args.includes('--global') && c.args.includes('@openai/codex')));
  assert.ok(f.calls.some(c => c.args[0].endsWith('install-memory.mjs')));
  assert.deepEqual(f.calls.at(-1).args.slice(1), ['run', 'build']);
  assert.equal(f.calls.some(c => c.args.includes('login')), false);
});

test('repeated setup preserves existing agents, roles, cwd and workspace bytes without reinstalling', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.binary('codex'), 'fixture');
  const initial = await setup(f.options, f.hooks);
  const workspace = new Workspace(f.options.dataDir, f.root);
  const agent = workspace.state.agents[0];
  agent.name = 'Minha sessão'; agent.role = 'Revisor';
  const worktree = path.join(f.root, 'worktree'); fs.mkdirSync(worktree); agent.cwd = worktree;
  workspace.save();
  const saved = fs.readFileSync(workspace.file, 'utf8');
  f.calls.length = 0;
  f.options.installClis = ['codex'];
  const repeated = await setup(f.options, f.hooks);
  assert.equal(repeated.project.id, initial.project.id);
  assert.equal(repeated.added.length, 0);
  assert.equal(fs.readFileSync(workspace.file, 'utf8'), saved);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args.slice(1), ['run', 'build']);
});

test('new OpenCode installs stay on the adapter-supported major instead of the latest tag', async t => {
  const f = fixture(t);
  f.options.installClis = ['opencode'];
  f.options.skipMemory = true;
  f.hooks.run = async (file, args, options) => {
    f.calls.push({ file, args, options });
    if (args[1] === 'install') {
      assert.deepEqual(args.slice(1), ['install', '--global', 'opencode-ai@1', '--no-audit', '--no-fund']);
      fs.writeFileSync(f.binary('opencode'), 'fixture');
    }
  };
  const report = await setup(f.options, f.hooks);
  assert.deepEqual(report.providers, ['opencode']);
  assert.equal(report.added.length, 1);
});

test('check mode and running-server guard do not write files or invoke commands', async t => {
  const f = fixture(t);
  f.options.check = true;
  const report = await setup(f.options, f.hooks);
  assert.equal(report.ready, false);
  assert.equal(fs.existsSync(f.options.dataDir), false);
  assert.equal(f.calls.length, 0);
  f.options.check = false;
  f.hooks.serviceRunning = async () => true;
  await assert.rejects(setup(f.options, f.hooks), /Feche o Orquestra/);
  assert.equal(fs.existsSync(f.options.dataDir), false);
  assert.equal(f.calls.length, 0);
});

test('custom data directory receives memory runtime and workspace while project path supports accents', async t => {
  const f = fixture(t);
  const projectDir = path.join(f.root, 'meu projeto ação'); fs.mkdirSync(projectDir);
  const dataDir = path.join(f.root, 'outros dados');
  const options = parseSetupArgs(['--project-dir', projectDir, '--data-dir', dataDir], f.root, f.env);
  const expectedMemory = path.join(dataDir, 'runtime/ai-memory', process.platform === 'win32' ? 'ai-memory.exe' : 'ai-memory');
  f.hooks.run = async (file, args, callOptions) => {
    if (args[0].endsWith('install-memory.mjs')) {
      assert.equal(callOptions.env.ORQUESTRA_MEMORY_INSTALL_DIR, path.dirname(expectedMemory));
      fs.mkdirSync(path.dirname(expectedMemory), { recursive: true }); fs.writeFileSync(expectedMemory, 'fixture');
    }
  };
  const report = await setup(options, f.hooks);
  assert.equal(report.project.cwd, projectDir);
  assert.equal(fs.existsSync(path.join(dataDir, 'workspace.json')), true);
  assert.equal(fs.existsSync(path.join(f.root, '.local')), false);
});

test('failed build never creates a project or registers agents', async t => {
  const f = fixture(t);
  f.options.skipMemory = true;
  fs.writeFileSync(f.binary('codex'), 'fixture');
  f.hooks.run = async () => { throw new Error('build failed'); };
  await assert.rejects(setup(f.options, f.hooks), /build failed/);
  assert.equal(fs.existsSync(path.join(f.options.dataDir, 'workspace.json')), false);
});

test('setup rejects an invalid explicit memory executable instead of claiming success', async t => {
  const f = fixture(t);
  f.env.ORQUESTRA_MEMORY_BIN = path.join(f.root, 'missing.exe');
  await assert.rejects(setup(f.options, f.hooks), /ORQUESTRA_MEMORY_BIN/);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(f.options.dataDir), false);
});
