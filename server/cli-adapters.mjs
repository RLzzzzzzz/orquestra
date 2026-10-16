import crossSpawn from 'cross-spawn';
import { findCommand } from './workspace.mjs';

export const automatedProviders = ['codex', 'opencode', 'claude', 'gemini'];
export function workerCommand(provider) {
  const file = findCommand(provider);
  if (!file) throw new Error(`${provider} não está instalado no PATH do servidor.`);
  const args = {
    codex: ['exec', '--json', '--color', 'never', '--sandbox', 'workspace-write', '-'],
    opencode: ['run', '--format', 'json'],
    claude: ['-p', '--output-format', 'stream-json', '--verbose'],
    gemini: ['-p', 'Execute a tarefa recebida pela entrada padrão.', '--output-format', 'stream-json'],
  }[provider];
  if (!args) throw new Error('Esse CLI não possui adaptador de tarefas automáticas.');
  return { file, args };
}
export function spawnWorker(job) {
  const { file, args } = workerCommand(job.provider);
  const env = { ...process.env, NO_COLOR: '1' };
  // A worker never inherits the coordinator's capability to delegate more work.
  delete env.ORQUESTRA_MCP_TOKEN;
  delete env.ORQUESTRA_MCP_URL;
  delete env.ORQUESTRA_LAUNCH;
  const child = crossSpawn(file, args, { cwd: job.cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  // Prompts never become shell arguments, even on Windows.
  child.stdin.end(`Você é um executor de uma tarefa delegada pelo Orquestra.\nResponsabilidade: ${job.role || job.agentName}.\nExecute apenas a tarefa abaixo, respeitando as permissões do seu CLI. Não delegue a outros agentes. Ao terminar, relate o resultado, arquivos alterados e testes executados. Se não puder concluir, explique o impedimento.\n\n${job.prompt}`);
  return child;
}
export function stopWorker(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = crossSpawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    killer.on('exit', code => { if (code) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
    timer.unref();
  }
}

// Normalize documented structured events. Exit code alone is not proof of success.
export function parseWorkerEvent(provider, event) {
  const result = { log: '', text: '', completed: false, error: '', needsAction: false };
  if (provider === 'codex') {
    const item = event.item;
    if (event.type === 'item.completed' && item?.type === 'agent_message') result.text = item.text || '';
    if (event.type === 'item.started' && item?.type === 'command_execution') result.log = `Comando: ${item.command}`;
    if (event.type === 'item.completed' && item?.type === 'file_change') result.log = `Arquivos: ${(item.changes || []).map(c => c.path).join(', ')}`;
    if (event.type === 'turn.completed') result.completed = true;
    if (event.type === 'turn.failed' || event.type === 'error') result.error = event.error?.message || event.message || 'O Codex informou um erro.';
  }
  if (provider === 'opencode') {
    if (event.type === 'text') result.text = event.part?.text || '';
    if (event.type === 'step_finish' && ['stop', 'end_turn'].includes(event.part?.reason)) result.completed = true;
    if (event.type === 'tool_use') result.log = `Ferramenta: ${event.part?.tool || event.tool || 'execução'}`;
    if (event.type === 'error') result.error = event.error?.data?.message || event.error?.message || event.error?.name || 'O OpenCode informou um erro.';
  }
  if (provider === 'claude') {
    if (event.type === 'assistant') result.log = (event.message?.content || []).filter(c => c.type === 'tool_use').map(c => `Ferramenta: ${c.name}`).join('\n');
    if (event.type === 'result') {
      result.text = event.result || '';
      result.completed = event.subtype === 'success' && !event.is_error;
      if (event.is_error) result.error = (event.errors || []).join('\n') || event.result || 'O Claude informou um erro.';
      result.needsAction = !!event.permission_denials?.length;
    }
  }
  if (provider === 'gemini') {
    if (event.type === 'message' && event.role === 'assistant') result.text = event.content || '';
    if (event.type === 'tool_use') result.log = `Ferramenta: ${event.tool_name || 'execução'}`;
    if (event.type === 'result') {
      result.completed = event.status === 'success';
      if (event.status === 'error') result.error = event.error?.message || 'O Gemini informou um erro.';
    }
  }
  if (['permission.asked', 'permission_denied', 'approval.required'].includes(event.type)) {
    result.needsAction = true;
    result.log = 'O CLI solicitou uma permissão. Resolva no terminal interativo e tente a tarefa novamente.';
  }
  return result;
}
