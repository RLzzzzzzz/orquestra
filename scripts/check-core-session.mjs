// Opt-in diagnostics against the running app. Does not submit a model prompt.
import path from 'node:path';
import { WebSocket } from 'ws';

const origin = `http://127.0.0.1:${process.env.PORT || 4317}`;
const home = await fetch(origin, { signal: AbortSignal.timeout(5000) });
const cookie = home.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Abra o servidor local do Orquestra.');
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
async function api(route, method = 'GET', data) {
  const res = await fetch(origin + '/api' + route, { method, headers, signal: AbortSignal.timeout(5000), ...(data !== undefined && { body: JSON.stringify(data) }) });
  const body = await res.json(); if (!res.ok) throw new Error(body.error); return body;
}
const [mode = 'inspect', value] = process.argv.slice(2);
if (mode === 'inspect') {
  const state = await api('/state');
  const memoryScopes = [];
  for (const project of state.projects) {
    try { memoryScopes.push({ projectId: project.id, ...(await api(`/projects/${project.id}/memory/status`)) }); }
    catch (error) { memoryScopes.push({ projectId: project.id, error: error.message }); }
  }
  console.log(JSON.stringify({ memory: state.memory, memoryScopes,
    sessionProtocol: state.agents.some(agent => typeof agent.sessionId === 'string') ? 'session-aware' : 'no-session-id-observed',
    providers: (await api('/providers')).map(({ id, available }) => ({ id, available })),
    agents: state.agents.map(({ id, name, status, mode, managed, sessionId, mcpReady, pid }) => ({ id, name, status, mode, managed, sessionId, mcpReady, pid })),
  }, null, 2));
} else if (mode === 'prepare') {
  if (!['codex', 'opencode', 'claude'].includes(value)) throw new Error('Selecione um executor gerenciado suportado.');
  const state = await api('/state');
  const project = state.projects.find(p => path.resolve(p.cwd) === process.cwd());
  if (!project) throw new Error('Projeto da pasta atual não encontrado.');
  const agent = await api('/agents', 'POST', { projectId: project.id, provider: value, name: `${value} · diagnóstico core` });
  await api(`/agents/${agent.id}/start`, 'POST', {});
  console.log(JSON.stringify({ projectId: project.id, agentId: agent.id, provider: value }));
} else if (mode === 'watch') {
  if (!value) throw new Error('Informe agentId.');
  let transcript = '';
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
  ws.on('message', raw => {
    const event = JSON.parse(raw);
    if (['output', 'replay'].includes(event.type) && event.id === value) transcript = (transcript + event.data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).slice(-8000);
  });
  ws.on('error', e => { console.error(e.message); process.exitCode = 1; });
  ws.on('close', () => console.log(transcript));
  setTimeout(() => ws.close(), 20000);
} else throw new Error('Use inspect, prepare <provider> ou watch <agentId>.');
