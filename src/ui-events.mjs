const taskLabels = { queued: 'Delegação na fila', running: 'Delegação iniciada', succeeded: 'Tarefa concluída', failed: 'Falha na tarefa', cancelled: 'Tarefa cancelada', interrupted: 'Tarefa interrompida', awaiting_approval: 'Intervenção necessária' };
const failures = new Set(['failed', 'interrupted']);

// Snapshots are authoritative; never turn terminal ANSI or replay into success.
export function snapshotEvents(previous, next) {
  if (!previous) return [];
  const tasks = new Map((previous.tasks || []).map(task => [task.id, task]));
  const agents = new Map((previous.agents || []).map(agent => [agent.id, agent]));
  const result = [];
  for (const task of next.tasks || []) {
    if (task.kind !== 'delegated') continue;
    const old = tasks.get(task.id);
    const base = { agentId: task.agentId, projectId: task.projectId, sessionId: task.sessionId, taskId: task.id };
    if (old?.status !== task.status && taskLabels[task.status]) result.push({ ...base, key: `task:${task.id}:${task.status}`, message: `${taskLabels[task.status]} · ${task.agentName || 'Executor'}`, detail: task.title, kind: failures.has(task.status) ? 'error' : 'delegation', error: failures.has(task.status), native: ['succeeded', 'failed', 'interrupted', 'awaiting_approval'].includes(task.status) });
    else if (old?.delivery !== 'acknowledged' && task.delivery === 'acknowledged') result.push({ ...base, key: `receipt:${task.id}`, message: `Delegação recebida · ${task.agentName || 'Executor'}`, kind: 'delegation' });
  }
  for (const agent of next.agents || []) {
    const old = agents.get(agent.id);
    if (!old) { result.push({ key: `agent:${agent.id}:added`, agentId: agent.id, projectId: agent.projectId, sessionId: agent.sessionId, kind: 'state', message: `${agent.name} · Sessão adicionada` }); continue; }
    if (old.status === agent.status && old.mode === agent.mode && old.sessionId === agent.sessionId && old.mcpReady === agent.mcpReady) continue;
    const failed = agent.mode === 'fallback' || (agent.status === 'exited' && agent.exitCode != null && agent.exitCode !== 0);
    result.push({ key: `agent:${agent.id}:${agent.sessionId}:${agent.status}:${agent.mode}:${agent.mcpReady}`, agentId: agent.id, projectId: agent.projectId, sessionId: agent.sessionId, kind: failed ? 'error' : 'state', error: failed, native: failed, message: `${agent.name} · ${failed ? 'O CLI encerrou com erro' : agent.mcpReady && !old.mcpReady ? 'MCP conectado' : agent.status === 'running' ? 'Sessão aberta' : 'Sessão encerrada'}` });
  }
  return result;
}

export function sessionDraft(agent, agents) {
  const base = agent.name.replace(/ · sessão \d+$/, '');
  let number = 2;
  while (agents.some(item => item.projectId === agent.projectId && item.name === `${base} · sessão ${number}`)) number++;
  return { projectId: agent.projectId, provider: agent.provider, name: `${base} · sessão ${number}`, cwd: agent.cwd, role: agent.role || '', command: agent.command };
}

export function filterActivity(events, { projectId, agentId = '', kind = '' }) {
  return events.filter(event => (!event.projectId || event.projectId === projectId) && (!agentId || event.agentId === agentId) && (!kind || (event.kind || 'state') === kind));
}
