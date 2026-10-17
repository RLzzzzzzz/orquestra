import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Workspace } from '../server/workspace.mjs';
import { Worktrees } from '../server/worktrees.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.local-worktrees-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'projeto com acentuação'); fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.orquestra-worktrees/\n');
  fs.writeFileSync(path.join(repo, 'sample.txt'), 'base\n');
  git('add', '.'); git('commit', '-m', 'test: fixture only');
  const workspace = new Workspace(path.join(dir, 'data'), repo), projectId = workspace.state.projects[0].id;
  const a = workspace.addAgent({ projectId, provider: 'codex', name: 'A' }), b = workspace.addAgent({ projectId, provider: 'codex', name: 'B' });
  const runtime = { status: 'idle', active: [] };
  const trees = new Worktrees(workspace, { info: () => ({ status: runtime.status }) }, { summaries: () => runtime.active });
  return { dir, repo, git, workspace, projectId, a, b, runtime, trees };
}

test('real Git worktrees isolate agents of the same provider and preserve main and dirty worktrees', t => {
  const f = fixture(t), mainHead = f.git('rev-parse', 'HEAD').trim();
  const a = f.trees.prepare(f.projectId, f.a.id), b = f.trees.prepare(f.projectId, f.b.id);
  assert.notEqual(a.branch, b.branch); assert.notEqual(a.cwd, b.cwd);
  fs.writeFileSync(path.join(a.cwd, 'sample.txt'), 'A\n');
  fs.writeFileSync(path.join(a.cwd, 'novo ação.txt'), 'novo\n');
  assert.equal(fs.readFileSync(path.join(b.cwd, 'sample.txt'), 'utf8'), 'base\n');
  assert.equal(fs.readFileSync(path.join(f.repo, 'sample.txt'), 'utf8'), 'base\n');
  let state = f.trees.inspect(f.projectId, f.a.id);
  assert.ok(state.diff.includes('+A')); assert.ok(state.untracked.some(x => x.path === 'novo ação.txt'));
  assert.throws(() => f.trees.commit(f.projectId, f.a.id, { revision: state.revision, message: 'feat: teste' }), /autorização/);
  assert.throws(() => f.trees.commit(f.projectId, f.a.id, { authorized: true, revision: 'stale', message: 'feat: teste' }, true), /mudaram/);
  state = f.trees.commit(f.projectId, f.a.id, { authorized: true, revision: state.revision, message: 'feat: teste' }, true);
  assert.equal(state.files.length, 0); assert.equal(state.commits.length, 1);
  assert.equal(f.git('branch', '--show-current').trim(), 'main'); assert.equal(f.git('rev-parse', 'HEAD').trim(), mainHead);
  fs.writeFileSync(path.join(b.cwd, 'sample.txt'), 'B\n');
  assert.equal(f.trees.list(f.projectId)[0].possibleConflicts[0].path, 'sample.txt');
  const restored = new Workspace(path.join(f.dir, 'data'), f.repo);
  assert.equal(restored.state.agents[0].cwd, a.cwd);
  assert.equal(f.trees.prepare(f.projectId, f.b.id).cwd, b.cwd);
  assert.equal(fs.readFileSync(path.join(b.cwd, 'sample.txt'), 'utf8'), 'B\n');
});

test('worktree operations reject active terminals, foreign projects, wrong branches and stale untracked content', t => {
  const f = fixture(t);
  f.runtime.status = 'running'; assert.throws(() => f.trees.prepare(f.projectId, f.a.id), /Encerre/);
  f.runtime.status = 'idle'; const w = f.trees.prepare(f.projectId, f.a.id);
  assert.throws(() => f.trees.inspect('foreign', f.a.id), /não encontrado/);
  fs.writeFileSync(path.join(w.cwd, 'new.txt'), 'first'); const before = f.trees.inspect(f.projectId, f.a.id);
  fs.writeFileSync(path.join(w.cwd, 'new.txt'), 'second');
  f.trees.configure(f.projectId, f.a.id, { autoCommit: true });
  assert.throws(() => f.trees.commit(f.projectId, f.a.id, { revision: before.revision, message: 'feat: stale' }), /mudaram/);
  const state = f.trees.inspect(f.projectId, f.a.id);
  const committed = f.trees.commit(f.projectId, f.a.id, { revision: state.revision, message: 'feat: authorized agent' });
  assert.equal(committed.commits.length, 1);
  execFileSync('git', ['-C', w.cwd, 'switch', '-c', 'unexpected'], { windowsHide: true });
  assert.throws(() => f.trees.inspect(f.projectId, f.a.id), /branch atual/);
});

test('Git creation fails clearly for an unignored worktree directory or a repository without commits', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, '.gitignore'), '');
  assert.throws(() => f.trees.prepare(f.projectId, f.a.id), /gitignore/);
  const empty = path.join(f.dir, 'empty'); fs.mkdirSync(empty);
  // An explicit empty repository prevents Git walking up to the application's repo.
  execFileSync('git', ['-C', empty, 'init', '-b', 'main'], { windowsHide: true });
  fs.writeFileSync(path.join(empty, '.gitignore'), '.orquestra-worktrees/\n');
  f.workspace.state.projects[0].cwd = empty;
  assert.throws(() => f.trees.prepare(f.projectId, f.a.id), /revision|HEAD|Git|git|repository/);
});
