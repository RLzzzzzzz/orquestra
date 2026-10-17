// Opt-in: sends one benign model task through a real coordinator and open worker terminal.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import headless from '@xterm/headless';

const dir = fs.mkdtempSync(path.join(process.cwd(), '.local-live-terminals-'));
const port = 14319, origin = `http://127.0.0.1:${port}`;
const binary = path.resolve('.local/runtime/ai-memory/ai-memory.exe');
const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), ORQUESTRA_DATA_DIR: dir, ORQUESTRA_MEMORY_BIN: binary }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await pause(300); } throw new Error(`Timeout: ${label}`); }
let ws, headers, coordinator, worker; const screens = new Map(); let state;
const screen = id => { const b = screens.get(id)?.buffer.active; return b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\n') : ''; };
async function call(route, method = 'GET', data) { const res = await fetch(origin + '/api' + route, { method, headers, ...(data && { body: JSON.stringify(data) }) }); const body = await res.json(); if (!res.ok) throw new Error(body.error); return body; }
try {
  await until(() => output.includes('Orquestra disponível'), 'servidor');
  const home = await fetch(origin); headers = { Cookie: home.headers.get('set-cookie').split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
  state = await call('/state'); const projectId = state.projects[0].id;
  ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
  ws.on('message', raw => {
    const event = JSON.parse(raw);
    if (['output', 'replay'].includes(event.type)) {
      if (!screens.has(event.id)) {
        const term = new headless.Terminal({ cols: 100, rows: 28, allowProposedApi: true }); screens.set(event.id, term);
        term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', id: event.id, data })); });
      }
      screens.get(event.id).write(event.data);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  worker = await call('/agents', 'POST', { projectId, provider: 'opencode', name: 'Executor ao vivo' });
  await call(`/agents/${worker.id}/start`, 'POST');
  const leader = await call('/agents', 'POST', { projectId, provider: 'codex', name: 'Coordenador de verificação' });
  coordinator = await call(`/projects/${projectId}/coordinator`, 'POST', { agentId: leader.id });
  await until(() => screen(worker.id).includes('Ask anything') && screen(coordinator.id).includes('Ask Codex to do anything'), 'prompts dos dois CLIs');
  const before = (await call('/state')).agents.find(a => a.id === worker.id).pid;
  console.log('Dois terminais abertos. Enviando objetivo ao coordenador.');
  await call(`/agents/${coordinator.id}/prompt`, 'POST', { bracketed: true, text: 'Verificação de integração. Use listar_agentes do MCP orquestra e delegue exatamente uma tarefa ao Executor ao vivo: "Responda apenas ORQUESTRA_LIVE_OK no chat e conclua usando concluir_tarefa com status succeeded e result ORQUESTRA_LIVE_OK. Não leia ou altere arquivos nem execute comandos.". Consulte a tarefa até terminar e depois responda ORQUESTRA_COORDINATOR_OK. Não faça outras tarefas, não leia arquivos e não use subagentes internos.' });
  await until(async () => { state = await call('/state'); const job = state.tasks[0]; if (job && !['queued', 'running'].includes(job.status)) return true; return false; }, 'tarefa concluir', 150000);
  const job = await call(`/tasks/${state.tasks[0].id}`);
  await until(() => screen(coordinator.id).includes('ORQUESTRA_COORDINATOR_OK'), 'resposta do coordenador', 45000);
  await until(async () => (await call(`/projects/${projectId}/memory/recent`)).hits?.some(h => h.path === `tasks/${job.id}.md`), 'memória da tarefa', 15000);
  const after = (await call('/state')).agents.find(a => a.id === worker.id).pid;
  const passed = job.status === 'succeeded' && job.result.includes('ORQUESTRA_LIVE_OK') && before === after && screen(worker.id).includes('ORQUESTRA_LIVE_OK');
  console.log(JSON.stringify({ passed, status: job.status, sameWorkerPid: before === after, workerChatVisible: screen(worker.id).includes('ORQUESTRA_LIVE_OK'), memorySaved: true, result: job.result, record: dir }, null, 2));
  if (!passed) throw new Error(job.error || 'Delegação não validada.');
} catch (e) {
  console.error(e.message); console.log('COORDENADOR\n' + screen(coordinator?.id)); console.log('EXECUTOR\n' + screen(worker?.id)); console.log(output.slice(-1500)); process.exitCode = 1;
} finally {
  if (headers) { try { const current = await call('/state'); for (const a of current.agents) await call(`/agents/${a.id}/stop`, 'POST'); } catch {} }
  ws?.terminate(); for (const term of screens.values()) term.dispose(); child.kill();
}
