// Opt-in: real local agents + official AI Memory. Uses existing CLI logins.
// Separate app data/port; never stops sessions in the user's running app.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import headless from '@xterm/headless';

const dir = fs.mkdtempSync(path.join(process.cwd(), '.local-core-e2e-'));
const coordinatorProvider = process.env.ORQUESTRA_E2E_COORDINATOR || 'opencode';
if (!['opencode', 'codex'].includes(coordinatorProvider)) throw new Error('Coordenador E2E não suportado.');
const port = 14329, origin = `http://127.0.0.1:${port}`, marker = `CORE_REAL_${randomUUID()}`;
const screens = new Map(), events = [];
let child, headers, ws, worker, coordinator, projectId, job, stage = 'boot';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await sleep(300); }
  throw new Error(`Timeout: ${label}`);
}
async function api(route, method = 'GET', data) {
  const res = await fetch(origin + '/api' + route, { method, headers, ...(data !== undefined && { body: JSON.stringify(data) }), signal: AbortSignal.timeout(30000) });
  const result = await res.json(); if (!res.ok) throw new Error(result.error); return result;
}
async function boot() {
  child = fork('server/index.mjs', [], { env: { ...process.env, PORT: String(port), ORQUESTRA_DATA_DIR: dir, ORQUESTRA_MEMORY_BIN: path.resolve('.local/runtime/ai-memory/ai-memory.exe') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout.on('data', d => { output = (output + d).slice(-2000); }); child.stderr.on('data', d => { output = (output + d).slice(-2000); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inicialização: ' + output)), 20000);
    child.once('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(); } });
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Servidor encerrou: ${code} ${output}`)); });
  });
  const home = await fetch(origin); headers = { Cookie: home.headers.get('set-cookie').split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
}
async function stop() {
  ws?.terminate();
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.send({ type: 'shutdown' }); });
}
try {
  console.log('Iniciando Orquestra isolado com o core atual.'); await boot();
  projectId = (await api('/state')).projects[0].id;
  stage = 'memory-startup';
  await until(async () => { const memory = (await api('/state')).memory; if (memory.status === 'unavailable') throw new Error(memory.error); return memory.status === 'ready'; }, 'AI Memory iniciar', 20000);
  const baseline = await api(`/projects/${projectId}/memory/status`);
  await api(`/projects/${projectId}/memory/write`, 'POST', { path: 'notes/e2e-seed.md', body: `# Prova entre sessões\nValor que o executor deve recuperar: ${marker}` });
  ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
  ws.on('message', raw => {
    const event = JSON.parse(raw); events.push(event); if (events.length > 5000) events.shift();
    if (['output', 'replay'].includes(event.type)) {
      if (!screens.has(event.id)) {
        const term = new headless.Terminal({ cols: 100, rows: 28, allowProposedApi: true }); screens.set(event.id, term);
        term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', id: event.id, sessionId: event.sessionId, data })); });
      }
      screens.get(event.id).write(event.data);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  stage = 'agents-mcp-initialize';
  worker = await api('/agents', 'POST', { projectId, provider: 'opencode', name: 'Executor core real' });
  await api(`/agents/${worker.id}/start`, 'POST', {});
  const source = await api('/agents', 'POST', { projectId, provider: coordinatorProvider, name: 'Coordenador core real' });
  coordinator = await api(`/projects/${projectId}/coordinator`, 'POST', { agentId: source.id });
  await until(async () => { const agents = (await api('/state')).agents; return [worker.id, coordinator.id].every(id => agents.find(a => a.id === id)?.mcpReady); }, 'MCP das duas sessões', 30000);
  console.log('Duas sessões MCP inicializadas. Enviando solicitação ao coordenador.');
  stage = 'real-delegation';
  await api(`/agents/${coordinator.id}/prompt`, 'POST', { bracketed: true, text: `Teste real do Orquestra. Use listar_agentes e enviar_tarefa do MCP orquestra para delegar exatamente uma tarefa ao agente ID ${worker.id}, request_id core-e2e-one: "Confirme recebimento com confirmar_recebimento. Leia notes/e2e-seed.md usando ler_memoria, grave notes/e2e-worker.md com o valor recuperado e o ID desta tarefa usando salvar_memoria. Não edite código ou execute comandos. Conclua pelo MCP concluir_tarefa com status succeeded e result contendo o valor lido. Escreva o resultado no chat." Consulte consultar_tarefa até concluir e responda CORE_COORDINATOR_OK com o resultado. Não use subagentes ou outros agentes e não altere código.` });
  job = await until(async () => { const jobs = (await api('/state')).tasks.filter(t => t.kind === 'delegated'); const task = jobs[0]; if (!task) return; if (['failed', 'cancelled', 'interrupted'].includes(task.status)) throw new Error(JSON.stringify(await api(`/tasks/${task.id}`))); return task.status === 'succeeded' && task.memoryStatus === 'saved' ? api(`/tasks/${task.id}`) : undefined; }, 'delegação e persistência');
  assert.match(job.result, new RegExp(marker)); assert.equal(job.delivery, 'acknowledged'); assert.ok(job.receivedAt); assert.ok(job.sessionId);
  const note = await api(`/projects/${projectId}/memory/read`, 'POST', { path: 'notes/e2e-worker.md' }); assert.ok(note.body.includes(marker));
  await until(() => events.some(e => e.type === 'output' && e.id === coordinator.id && e.data?.includes('CORE_COORDINATOR_OK')), 'resposta ao coordenador');
  assert.ok(events.some(e => e.type === 'state' && e.tasks.some(t => t.id === job.id && t.status === 'succeeded')));
  stage = 'native-capture';
  const nativeMinimum = coordinatorProvider === 'opencode' ? 2 : 1;
  const captured = await until(async () => { const data = await api(`/projects/${projectId}/memory/status`); return data.counts.sessions >= baseline.counts.sessions + nativeMinimum && data.counts.observations > baseline.counts.observations ? data : undefined; }, 'sessões e observações nativas', 15000);
  console.log('Delegação, confirmação, leitura/escrita e estado WebSocket aprovados. Reiniciando somente o servidor de teste.');
  stage = 'restart'; await stop(); await boot();
  const restored = await api(`/tasks/${job.id}`); assert.equal(restored.status, 'succeeded'); assert.equal(restored.result, job.result);
  assert.ok((await api(`/projects/${projectId}/memory/read`, 'POST', { path: 'notes/e2e-worker.md' })).body.includes(marker));
  assert.ok((await api('/state')).agents.every(a => a.status === 'idle'));
  const persisted = await api(`/projects/${projectId}/memory/status`);
  assert.ok(persisted.counts.sessions >= captured.counts.sessions); assert.ok(persisted.counts.observations >= captured.counts.observations);
  const report = { passed: true, realAgents: true, provider: 'opencode', coordinatorProvider, taskId: job.id, sessionId: job.sessionId, receivedAt: job.receivedAt, memoryStatus: job.memoryStatus, nativeSessions: persisted.counts.sessions - baseline.counts.sessions, nativeObservations: persisted.counts.observations - baseline.counts.observations, websocketState: true, recoveredAfterRestart: true, record: dir };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { console.error(`${stage}: ${error.message}`); fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ stage, error: error.message }, null, 2)); console.error(`Registro: ${dir}`); process.exitCode = 1; }
finally { await stop(); for (const term of screens.values()) term.dispose(); }
