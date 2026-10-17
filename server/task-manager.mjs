import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { automatedProviders, spawnWorker, stopWorker, parseWorkerEvent } from './cli-adapters.mjs';
import { directory, textField } from './workspace.mjs';
import { saveJson } from './persistence.mjs';

export const activeTaskStates = ['queued', 'running', 'cancelling'];
function canonical(cwd) { const real = fs.realpathSync(cwd); return process.platform === 'win32' ? real.toLowerCase() : real; }
export function overlap(a, b) { return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep); }
export class TaskManager {
  constructor(workspace, emit, options = {}) {
    this.workspace = workspace; this.emit = emit;
    this.spawn = options.spawn || spawnWorker; this.kill = options.kill || stopWorker;
    this.live = options.live; this.memory = options.memory;
    this.maxParallel = options.maxParallel || 3;
    this.timeoutMs = options.timeoutMs || 30 * 60 * 1000;
    this.file = path.join(path.dirname(workspace.file), 'tasks.json');
    this.jobs = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.running = new Map(); this.closed = false;
    for (const job of this.jobs) if (activeTaskStates.includes(job.status)) {
      job.status = 'interrupted'; job.error = 'O serviço foi reiniciado. Reenvie a tarefa se desejar continuar.'; job.finishedAt = Date.now();
    }
    this.save();
  }
  save() {
    saveJson(this.file, this.jobs);
  }
  changed() { this.save(); this.emit({ type: 'changed' }); }
  summaries(projectId) {
    return this.jobs.filter(j => !projectId || j.projectId === projectId).map(({ output, result, prompt, ...job }) => ({ ...job, hasResult: !!result }));
  }
  get(id, projectId) {
    const job = this.jobs.find(j => j.id === id && (!projectId || j.projectId === projectId));
    if (!job) throw new Error('Tarefa não encontrada neste projeto.');
    return { ...job };
  }
  create(projectId, input) {
    if (this.closed) throw new Error('O serviço está encerrando.');
    const agent = this.workspace.state.agents.find(a => a.id === input.agentId && a.projectId === projectId);
    if (!agent || agent.coordinator || !(this.live ? this.live.available(agent.id) : automatedProviders.includes(agent.provider))) throw new Error('Escolha um executor com terminal aberto e integração MCP neste projeto.');
    const prompt = textField(input.prompt, 'Tarefa', 16000);
    const requestId = textField(input.requestId, 'Identificador do pedido', 120);
    const previous = this.jobs.find(j => j.projectId === projectId && j.requestId === requestId);
    if (previous) {
      if (previous.agentId !== agent.id || previous.prompt !== prompt) throw new Error('Identificador já usado para outra tarefa.');
      return this.get(previous.id);
    }
    if (this.jobs.filter(j => activeTaskStates.includes(j.status)).length >= 30) throw new Error('A fila já possui 30 tarefas ativas.');
    if (this.jobs.length >= 500) throw new Error('Limite de 500 tarefas no histórico atingido.');
    const cwd = directory(agent.cwd);
    const job = {
      id: randomUUID(), requestId, projectId, agentId: agent.id, agentName: agent.name, provider: agent.provider,
      role: agent.role, cwd, cwdKey: canonical(cwd), title: (typeof input.title === 'string' ? input.title.trim() : prompt.split('\n')[0]).slice(0, 140) || 'Tarefa delegada',
      prompt, status: 'queued', createdAt: Date.now(), output: '', result: '', error: '',
    };
    this.jobs.push(job); this.changed(); queueMicrotask(() => this.pump());
    return this.get(job.id);
  }
  pump() {
    if (this.closed) return;
    for (const job of this.jobs.filter(j => j.status === 'queued')) {
      if (this.running.size >= this.maxParallel) break;
      if ([...this.running.values()].some(r => overlap(r.job.cwdKey, job.cwdKey) || r.job.agentId === job.agentId)) continue;
      this.run(job);
    }
  }
  append(job, text) {
    job.output = (job.output + text).slice(-262144);
    // Output is bounded and persisted at completion; the live view polls this buffer.
  }
  run(job) {
    job.status = 'running'; job.startedAt = Date.now(); this.append(job, `[Orquestra] ${job.agentName} iniciou a tarefa.\n`);
    const execution = { job, child: null, completed: false, timer: null, finished: false };
    this.running.set(job.id, execution);
    const finish = code => {
      if (execution.finished) return; execution.finished = true;
      clearTimeout(execution.timer);
      this.running.delete(job.id); job.exitCode = code; job.finishedAt = Date.now();
      if (job.status === 'cancelling') job.status = 'cancelled';
      else if (!['interrupted', 'awaiting_approval'].includes(job.status)) {
        job.status = code === 0 && execution.completed && !job.error && !!job.result.trim() ? 'succeeded' : 'failed';
        if (job.status === 'failed' && !job.error) job.error = `O CLI terminou sem confirmar um resultado completo (saída ${code ?? 'indisponível'}). Consulte a saída da tarefa.`;
      }
      this.append(job, `\n[Orquestra] ${job.status}${job.error ? ': ' + job.error : ''}\n`);
      if (this.memory) this.memory.recordTask(job).catch(error => { job.memoryError = error.message.slice(0, 1000); this.changed(); });
      this.changed(); this.pump();
    };
    try {
      const child = this.live ? this.live.start(job) : this.spawn(job); execution.child = child;
      const decode = new StringDecoder('utf8'); let pending = '';
      const line = raw => {
        if (!raw.trim()) return;
        let event;
        try { event = JSON.parse(raw); } catch { this.append(job, raw + '\n'); return; }
        const normalized = event.type === 'orquestra.live' ? { log: event.text } : event.type === 'orquestra.result' ? { text: event.text, completed: event.success, error: event.success ? '' : event.text } : parseWorkerEvent(job.provider, event);
        if (normalized.log) this.append(job, normalized.log + '\n');
        if (normalized.text) {
          job.result = (job.result + normalized.text + (job.provider === 'gemini' ? '' : '\n')).slice(-65536);
          this.append(job, normalized.text + '\n');
        }
        if (normalized.completed) execution.completed = true;
        if (normalized.error) { job.error = String(normalized.error).slice(0, 4000); this.append(job, `Erro: ${job.error}\n`); }
        if (normalized.needsAction && job.status === 'running') {
          job.status = 'awaiting_approval'; job.error = 'O CLI requer uma ação ou permissão. Resolva no terminal interativo e reenvie a tarefa.';
          this.changed(); this.stop(child);
        }
      };
      child.stdout.on('data', data => {
        pending += decode.write(data);
        const lines = pending.split('\n'); pending = lines.pop();
        for (const entry of lines) line(entry);
        if (pending.length > 1024 * 1024) { job.error = 'Saída estruturada excedeu o limite por evento.'; pending = ''; this.stop(child); }
      });
      child.stderr.setEncoding('utf8'); child.stderr.on('data', data => this.append(job, data));
      child.on('error', error => { job.error = error.message; finish(null); });
      child.on('close', code => { pending += decode.end(); if (pending) line(pending); finish(code); });
      execution.timer = setTimeout(() => { job.error = 'Tempo máximo de 30 minutos atingido.'; this.stop(child); }, this.timeoutMs);
      this.changed();
    } catch (error) { job.error = error.message; finish(null); }
  }
  stop(child) { if (child?.live) this.live.stop(child); else this.kill(child); }
  cancel(id, projectId) {
    const job = this.jobs.find(j => j.id === id && (!projectId || j.projectId === projectId));
    if (!job) throw new Error('Tarefa não encontrada neste projeto.');
    if (job.status === 'queued') { job.status = 'cancelled'; job.finishedAt = Date.now(); this.changed(); }
    else if (this.running.has(job.id)) { job.status = 'cancelling'; this.changed(); this.stop(this.running.get(job.id).child); }
    return this.get(id, projectId);
  }
  async wait(id, projectId, ms = 0) {
    const end = Date.now() + Math.max(0, Math.min(25000, Number(ms) || 0));
    let job = this.get(id, projectId);
    while (activeTaskStates.includes(job.status) && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
      job = this.get(id, projectId);
    }
    return job;
  }
  dispose() {
    this.closed = true;
    for (const job of this.jobs) if (activeTaskStates.includes(job.status)) {
      job.status = 'interrupted'; job.error = 'O serviço foi encerrado.'; job.finishedAt = Date.now();
    }
    for (const execution of this.running.values()) { clearTimeout(execution.timer); if (execution.child) this.stop(execution.child); }
    this.save();
  }
}
