import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Memory } from '../server/memory.mjs';
const directory = fs.mkdtempSync(path.join(process.cwd(), '.local-memory-check-'));
process.env.ORQUESTRA_MEMORY_BIN ||= path.resolve('.local/runtime/ai-memory/ai-memory.exe');
let memory = new Memory(directory);
const project = randomUUID(), other = randomUUID();
try {
  await memory.call(project, 'write', { path: 'notes/decisao.md', body: '# Autenticação\nUsar sessão local. Validação com acentos: ação, memória.' });
  assert.equal((await memory.call(project, 'read', { path: 'notes/decisao.md' })).title, 'Autenticação');
  assert.ok((await memory.call(project, 'query', { query: 'Autenticação' })).hits.length);
  assert.equal((await memory.call(other, 'query', { query: 'Autenticação' })).hits.length, 0);
  const handoff = await memory.call(project, 'handoff_begin', { summary: 'Retomar a integração', next_steps: ['Revisar o resultado'] });
  const claimed = await memory.call(project, 'handoff_accept', { handoff_id: handoff.handoff_id });
  assert.equal(claimed.status, 'claimed');
  assert.notEqual((await memory.call(project, 'handoff_accept', { handoff_id: handoff.handoff_id })).status, 'claimed');
  await memory.dispose(); memory = new Memory(directory);
  assert.match((await memory.call(project, 'read', { path: 'notes/decisao.md' })).body, /ação, memória/);
  console.log(JSON.stringify({ passed: true, unicode: true, projectIsolation: true, persistedAfterRestart: true, handoffClaimedOnce: true, record: directory }));
} finally { await memory.dispose(); }
