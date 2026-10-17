import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Reviews, runValidation } from '../server/reviews.mjs';

function fixture(t, runner) {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.local-reviews-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'fixture', test: 'fixture', build: 'fixture' } }));
  const agents = ['a', 'b', 'c'].map(id => ({ id, name: id, available: true, busy: false, worktree: id === 'a' ? { cwd: dir } : undefined }));
  const jobs = [];
  const tasks = { create(projectId, input) { const j = { ...input, projectId, id: String(jobs.length), status: 'queued' }; jobs.push(j); return j; }, get(id) { return jobs.find(j => j.id === id); } };
  const state = { revision: 'revision-1', changedFiles: ['file.txt'], commits: [], conflicts: [], cwd: dir, branch: 'orquestra/a', base: 'base-sha', diff: '+real change' };
  const workspace = { file: path.join(dir, 'workspace.json') };
  const reviews = new Reviews(workspace, tasks, { inspect: () => ({ ...state }) }, () => agents, () => {}, runner || (async (cwd, script) => ({ command: `npm run ${script}`, exitCode: 0, passed: true, output: 'real runner fixture' })));
  const create = (extra = {}) => reviews.create('project', { prompt: 'Corrigir', implementer: 'a', reviewer: 'b', tester: 'c', maxCycles: 2, ...extra });
  const complete = (item, report) => { Object.assign(jobs.at(-1), { status: 'succeeded', result: report === undefined ? 'implementado' : JSON.stringify(report) }); reviews.tick(); return item; };
  const report = (verdict = 'approved') => ({ revision: state.revision, verdict, findings: verdict === 'approved' ? [] : ['file.txt:1 bug'], tests: [] });
  const ready = () => { const item = create(); complete(item); complete(item, report()); complete(item, report()); return item; };
  return { dir, workspace, reviews, agents, jobs, state, create, complete, report, ready };
}

test('cross review delegates distinct roles against actual diff, then requires executed validations', async t => {
  const f = fixture(t), item = f.ready();
  assert.equal(item.status, 'awaiting_validation'); assert.equal(f.jobs.length, 3);
  assert.match(f.jobs[1].prompt, /real change/); assert.match(f.jobs[1].prompt, /base-sha/);
  assert.deepEqual(f.jobs.map(j => j.agentId), ['a', 'b', 'c']);
  await f.reviews.validate('project', item.id);
  assert.equal(item.status, 'approved'); assert.equal(item.tests.length, 3); assert.equal(item.tests.every(t => t.exitCode === 0), true);
  assert.throws(() => f.reviews.get('foreign', item.id), /não encontrada/);
});

test('rejects self review, unavailable workers and automatic selection with only one agent', t => {
  const f = fixture(t);
  assert.throws(() => f.create({ reviewer: 'a' }), /diferentes/);
  f.agents[1].available = false;
  assert.throws(() => f.create(), /disponíveis/);
  f.agents[2].available = false;
  assert.throws(() => f.reviews.create('project', { prompt: 'Tarefa' }), /disponíveis/);
});

test('findings go back to implementer and cycle limits prevent infinite retries', t => {
  const f = fixture(t), item = f.create(); f.complete(item); f.complete(item, f.report('changes_requested'));
  assert.equal(item.status, 'needs_changes'); f.reviews.retry('project', item.id);
  assert.equal(item.cycle, 2); assert.match(f.jobs.at(-1).prompt, /file.txt:1 bug/);
  f.complete(item); f.complete(item, f.report('changes_requested'));
  assert.throws(() => f.reviews.retry('project', item.id), /Limite/);
});

test('free text, stale revision, conflicts and failed tasks never approve a review', t => {
  const f = fixture(t), item = f.create(); f.complete(item);
  f.complete(item); assert.equal(item.status, 'blocked'); assert.match(item.pending[0], /JSON/);
  f.reviews.retry('project', item.id); f.state.conflicts = ['file.txt']; f.complete(item); assert.equal(item.status, 'blocked');
  const other = fixture(t), next = other.create(); other.complete(next); other.state.revision = 'changed'; other.complete(next, other.report());
  assert.equal(next.status, 'blocked'); assert.match(next.pending[0], /mudou/);
  const failed = fixture(t), job = failed.create(); failed.jobs[0].status = 'awaiting_approval'; failed.reviews.tick();
  assert.equal(job.status, 'blocked'); assert.match(job.pending[0], /awaiting_approval/);
});

test('test failure and code changes during execution reject final validation', async t => {
  const f = fixture(t, async () => ({ command: 'npm test', exitCode: 1, passed: false, output: 'regression failed' }));
  const item = f.ready(); await f.reviews.validate('project', item.id);
  assert.equal(item.status, 'validation_failed'); assert.equal(item.tests.length, 1);
  const changed = fixture(t, async () => { changed.state.revision = 'modified'; return { command: 'npm test', exitCode: 0, passed: true }; });
  const next = changed.ready(); await changed.reviews.validate('project', next.id); assert.equal(next.status, 'validation_failed');
});

test('restart interrupts reviews and never resubmits active jobs', t => {
  const f = fixture(t); f.create();
  const restored = new Reviews(f.workspace, { get() { throw new Error('should not run'); } }, {}, () => []);
  restored.tick(); assert.equal(restored.items[0].status, 'interrupted'); assert.equal(f.jobs.length, 1);
});

test('validation runner records real command success, failure and output without authenticated CLIs', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(123)"', fail: 'node -e "process.exit(7)"' } }));
  const success = await runValidation(f.dir, 'test'); assert.equal(success.passed, true); assert.match(success.output, /123/);
  const failure = await runValidation(f.dir, 'fail'); assert.equal(failure.passed, false); assert.equal(failure.exitCode, 7);
});

test('validation timeout rejects a hung command instead of declaring success', { timeout: 15000 }, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(()=>{},30000)"' } }));
  const started = Date.now();
  // Allow npm/cmd to finish spawning on Windows before exercising termination
  // of the running command tree, instead of racing the CLI bootstrap itself.
  const result = await runValidation(f.dir, 'test', 2500);
  assert.equal(result.passed, false); assert.match(result.error, /Tempo/);
  assert.ok(Date.now() - started < 10000, 'A árvore de processos deve encerrar antes do comando de 30 segundos.');
});

test('final summary reuses AI Memory, with a single page and task references', async t => {
  const f = fixture(t), calls = []; f.reviews.memory = { call: async (...args) => { calls.push(args); } };
  const item = f.ready(); await f.reviews.validate('project', item.id); f.reviews.changed();
  assert.equal(calls.length, 1); assert.equal(calls[0][2].path, `reviews/${item.id}.md`);
  assert.match(calls[0][2].body, /Tarefas: 0, 1, 2/);
});
