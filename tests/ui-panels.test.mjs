import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';

// Render the actual panels with React; no browser or AI sessions are started.
const folder = fs.mkdtempSync(path.join(process.cwd(), '.local-ui-panels-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const panels = {};
for (const name of ['WorkReviewPanel', 'Orchestration', 'MemoryPanel', 'TaskBoard']) {
  const source = fs.readFileSync(`src/${name}.jsx`, 'utf8').replaceAll('./WorkReviewPanel.jsx', './WorkReviewPanel.mjs');
  const { code } = await transformWithEsbuild(source, `${name}.jsx`, { loader: 'jsx', jsx: 'automatic' });
  const file = path.join(folder, `${name}.mjs`);
  fs.writeFileSync(file, code);
  panels[name] = (await import(pathToFileURL(file))).default;
}
const project = { id: 'project-a', name: 'Projeto A' };
const props = { project, tasks: [], agents: [], providers: [], connected: true, request: async () => { throw new Error('SSR must not make requests'); }, notify() {} };
const render = (name, extra = {}) => renderToStaticMarkup(React.createElement(panels[name], { ...props, ...extra }));

test('panels require an explicit project before offering mutations', () => {
  for (const name of ['MemoryPanel', 'Orchestration', 'TaskBoard']) {
    const html = render(name, { project: null });
    assert.match(html, /Selecione um projeto/);
    assert.doesNotMatch(html, /<form|<button|<select/);
  }
  assert.equal(render('WorkReviewPanel', { project: null }), '');
});

test('orchestration and worktree choices exclude agents from other projects', () => {
  const agents = [
    { id: 'a', projectId: project.id, name: 'Executor local', provider: 'codex', status: 'running', mode: 'agent', managed: true, mcpReady: true },
    { id: 'b', projectId: 'project-b', name: 'Executor de outro projeto', provider: 'codex', status: 'running', mode: 'agent', managed: true, mcpReady: true },
  ];
  const providers = [{ id: 'codex', coordinator: true, available: true }];
  for (const name of ['Orchestration', 'WorkReviewPanel']) {
    const html = render(name, { agents, providers });
    assert.match(html, /Executor local/);
    assert.doesNotMatch(html, /Executor de outro projeto/);
  }
});

test('task board keeps project boundaries and offers each state exactly once while offline', () => {
  const tasks = [
    { id: 'a', projectId: project.id, kind: 'board', title: 'Tarefa local', status: 'todo' },
    { id: 'b', projectId: 'project-b', kind: 'board', title: 'Tarefa de outro projeto', status: 'todo' },
  ];
  const html = render('TaskBoard', { tasks, connected: false });
  assert.match(html, /Tarefa local/);
  assert.doesNotMatch(html, /Tarefa de outro projeto/);
  assert.equal((html.match(/<option value="cancelled"/g) || []).length, 1);
  assert.match(html, /<select[^>]*disabled=""/);
});

test('memory clearly shows project scope and disables mutations when engine is unavailable', () => {
  const html = render('MemoryPanel', { status: { status: 'failed' } });
  assert.match(html, /Projeto: Projeto A/);
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length > 0);
  assert.ok(buttons.every(button => button.includes('disabled=""')));
});
