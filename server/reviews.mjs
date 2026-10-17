import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import crossSpawn from 'cross-spawn';
import { saveJson } from './persistence.mjs';
import { stopWorker } from './cli-adapters.mjs';
import { textField } from './workspace.mjs';

export function runValidation(cwd, script, timeoutMs = 120000, signal) {
  return new Promise(resolve => {
    const env = { ...process.env, CI: 'true', GIT_TERMINAL_PROMPT: '0' };
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|ORQUESTRA_MCP/i.test(key)) delete env[key];
    const child = crossSpawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '', timedOut = false;
    const append = data => { output = (output + data).slice(-16000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; stopWorker(child); }, timeoutMs);
    child.on('error', e => { error = e.message; });
    const abort = () => { error = 'Validação interrompida.'; stopWorker(child); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ command: `npm run ${script}`, exitCode: code, passed: code === 0 && !error && !timedOut, output, error: timedOut ? 'Tempo de validação excedido.' : error }); });
  });
}

export class Reviews {
  constructor(workspace, tasks, git, workers, emit = () => {}, runner = runValidation) {
    Object.assign(this, { workspace, tasks, git, workers, emit, runner });
    this.controllers = new Map(); this.memoryKeys = new Map(); this.closed = false;
    this.file = path.join(path.dirname(workspace.file), 'reviews.json');
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    for (const item of this.items) if (['implementing', 'reviewing', 'testing', 'validating'].includes(item.status)) { item.status = 'interrupted'; item.pending = ['Serviço reiniciado. Consulte as tarefas antes de iniciar outro ciclo.']; }
    this.save();
  }
  save() { saveJson(this.file, this.items); }
  changed() {
    this.save(); this.emit();
    if (this.memory) for (const item of this.items.filter(i => ['approved', 'needs_changes', 'blocked', 'validation_failed'].includes(i.status))) {
      const key = `${item.cycle}:${item.status}`;
      if (this.memoryKeys.get(item.id) === key) continue;
      this.memoryKeys.set(item.id, key);
      // One summary page links to existing task history, without duplicating transcripts.
      const body = `# Revisão cruzada\nEstado: ${item.status}\nBranch: ${item.branch}\nRevisão: ${item.revision || 'pendente'}\nAgentes: ${Object.entries(item.roles).map(([role, a]) => `${role}: ${a.name}`).join('; ')}\nTarefas: ${item.stages.map(s => s.taskId).join(', ')}\nAchados: ${item.findings.join('; ')}\nTestes: ${item.tests.map(t => `${t.command}: ${t.exitCode}`).join('; ')}\nPendências: ${item.pending.join('; ')}`.slice(0, 31000);
      this.memory.call(item.projectId, 'write', { path: `reviews/${item.id}.md`, tier: 'episodic', body }).catch(error => { item.memoryError = error.message.slice(0, 1000); this.save(); this.emit(); });
    }
  }
  list(projectId) { return this.items.filter(i => i.projectId === projectId); }
  get(projectId, id) { const item = this.items.find(i => i.projectId === projectId && i.id === id); if (!item) throw new Error('Revisão não encontrada neste projeto.'); return item; }
  select(projectId, input) {
    const available = this.workers(projectId).filter(a => a.available && !a.busy);
    const pick = (id, predicate) => {
      const agent = available.find(a => (!id || a.id === id) && predicate(a));
      if (!agent) throw new Error('Abra executores disponíveis para os papéis selecionados. Implementador e revisor devem ser diferentes.');
      return agent;
    };
    const implementer = pick(input.implementer, a => !!a.worktree);
    const reviewer = pick(input.reviewer, a => a.id !== implementer.id);
    const tester = input.tester ? pick(input.tester, a => a.id !== implementer.id) : available.find(a => a.id !== implementer.id && a.id !== reviewer.id) || reviewer;
    return { implementer, reviewer, tester };
  }
  create(projectId, input) {
    if (this.closed) throw new Error('O serviço está encerrando.');
    const prompt = textField(input.prompt, 'Objetivo', 10000);
    const roles = this.select(projectId, input);
    const state = this.git.inspect(projectId, roles.implementer.id);
    if (this.items.some(i => i.projectId === projectId && i.roles.implementer.id === roles.implementer.id && ['implementing', 'reviewing', 'testing', 'awaiting_validation', 'validating'].includes(i.status))) throw new Error('Este implementador já possui uma revisão ativa.');
    const item = { id: randomUUID(), projectId, prompt, roles, cycle: 1, maxCycles: Math.max(1, Math.min(3, Number(input.maxCycles) || 1)), status: 'implementing', worktree: state.cwd, branch: state.branch, createdAt: Date.now(), stages: [], findings: [], tests: [], pending: [] };
    this.delegate(item, 'implementer', prompt + '\nTrabalhe somente na sua worktree. Não faça push ou merge. Commits exigem autorização do usuário ou a configuração explícita por agente.');
    this.items.push(item); this.changed(); return item;
  }
  delegate(item, role, prompt) {
    const agent = item.roles[role];
    if (!this.workers(item.projectId).some(a => a.id === agent.id && a.available && !a.busy)) throw new Error(`Executor ${role} indisponível ou ocupado.`);
    const job = this.tasks.create(item.projectId, { agentId: agent.id, requestId: `review-${item.id}-${item.cycle}-${role}`, prompt, title: `${role} · ${item.prompt.slice(0, 80)}`, source: 'cross-review' });
    item.taskId = job.id; item.stages.push({ role, taskId: job.id, cycle: item.cycle });
  }
  tick() {
    if (this.closed) return;
    for (const item of this.items.filter(i => ['implementing', 'reviewing', 'testing'].includes(i.status))) {
      const task = this.tasks.get(item.taskId, item.projectId);
      if (['queued', 'running', 'cancelling'].includes(task.status)) continue;
      try {
        if (task.status !== 'succeeded') throw new Error(`Etapa ${task.status}: ${task.error || 'consulte o terminal e a tarefa'}`);
        const state = this.git.inspect(item.projectId, item.roles.implementer.id);
        if (item.status === 'implementing') {
          item.revision = state.revision; item.files = state.changedFiles; item.commits = state.commits;
          if (!state.changedFiles.length) throw new Error('Não há alterações reais para revisar.');
          if (state.conflicts.length) throw new Error('A worktree contém conflitos Git.');
          const instructions = this.reviewPrompt(item, state);
          this.delegate(item, 'reviewer', instructions); item.status = 'reviewing';
        } else {
          if (state.revision !== item.revision) throw new Error('O código mudou após o início da revisão. Inicie outro ciclo.');
          let report;
          try { report = JSON.parse(task.result.trim()); } catch { throw new Error('O agente deve retornar o relatório JSON solicitado; texto livre não aprova a revisão.'); }
          if (report.revision !== item.revision || !['approved', 'changes_requested'].includes(report.verdict) || !Array.isArray(report.findings) || report.findings.some(f => typeof f !== 'string')) throw new Error('Relatório sem revisão, veredicto ou achados válidos.');
          item.stages.at(-1).report = report;
          item.findings.push(...report.findings.slice(0, 50));
          if (report.verdict === 'changes_requested') { item.status = 'needs_changes'; item.pending = ['Encaminhe os achados ao implementador em outro ciclo.']; }
          else if (item.status === 'reviewing') { this.delegate(item, 'tester', this.reviewPrompt(item, state, true)); item.status = 'testing'; }
          else { item.status = 'awaiting_validation'; item.pending = ['Execute a validação local pela interface. A declaração dos agentes não basta para aprovar.']; }
        }
      } catch (error) { item.status = 'blocked'; item.pending = [error.message]; }
      this.changed();
    }
  }
  reviewPrompt(item, state, tester = false) {
    return `${tester ? 'TESTADOR: execute os testes disponíveis e relate problemas.' : 'REVISOR: analise as alterações reais e identifique bugs e regressões.'}\nSomente leitura: não edite arquivos nem faça commits. Não execute agentes autenticados ou testes que exijam credenciais.\nWorktree do implementador: ${state.cwd}\nBranch: ${state.branch}\nBase: ${state.base}\nRevise com git -C <worktree> diff ${state.base} e leia os arquivos não rastreados.\nArquivos: ${JSON.stringify(state.changedFiles).slice(0, 2500)}\nDiff inicial (pode estar abreviado; consulte o diff completo no disco):\n${state.diff.slice(0, 6500)}\n\nRetorne em concluir_tarefa um result contendo APENAS JSON: {"revision":"${item.revision}","verdict":"approved ou changes_requested","findings":["arquivo:linha — problema"],"tests":[{"command":"comando executado","exitCode":0,"output":"resumo real"}]}. Informe pendências em findings. Não aprove por mera declaração do implementador.`;
  }
  retry(projectId, id) {
    const item = this.get(projectId, id);
    if (!['blocked', 'needs_changes', 'interrupted', 'validation_failed'].includes(item.status)) throw new Error('Esta revisão não pode iniciar outro ciclo agora.');
    if (item.cycle >= item.maxCycles) throw new Error('Limite de ciclos atingido. Crie outra revisão após avaliar as pendências.');
    if (item.stages.some(s => ['queued', 'running', 'cancelling'].includes(this.tasks.get(s.taskId, projectId).status))) throw new Error('Aguarde ou cancele as etapas ainda ativas antes de retomar.');
    const nextCycle = item.cycle + 1;
    item.cycle = nextCycle;
    try { this.delegate(item, 'implementer', `${item.prompt}\nCorrija os achados da revisão:\n${item.findings.join('\n')}\nPendências:\n${item.pending.join('\n')}`); }
    catch (error) { item.cycle--; throw error; }
    item.status = 'implementing'; item.tests = []; item.pending = []; this.changed(); return item;
  }
  async validate(projectId, id) {
    if (this.closed) throw new Error('O serviço está encerrando.');
    const item = this.get(projectId, id);
    if (!['awaiting_validation', 'validation_failed'].includes(item.status)) throw new Error('Aguarde revisão e teste dos agentes antes da validação.');
    if (this.git.inspect(projectId, item.roles.implementer.id).revision !== item.revision) throw new Error('O código mudou. Inicie outro ciclo de revisão.');
    const manifest = JSON.parse(fs.readFileSync(path.join(item.worktree, 'package.json'), 'utf8'));
    if (!manifest.scripts?.test) throw new Error('Projeto sem script test: a revisão permanece pendente.');
    const scripts = ['check', 'test', 'build'].filter(s => manifest.scripts[s]);
    const release = this.tasks.reserve?.(item.worktree, item.id) || (() => {});
    const controller = new AbortController(); this.controllers.set(item.id, controller);
    item.status = 'validating'; item.tests = []; this.changed();
    try {
      for (const script of scripts) {
        const result = await this.runner(item.worktree, script, 120000, controller.signal); item.tests.push(result); this.changed();
        if (this.closed) break;
        if (!result.passed) break;
      }
      const unchanged = this.git.inspect(projectId, item.roles.implementer.id).revision === item.revision;
      item.status = this.closed ? 'interrupted' : unchanged && item.tests.length === scripts.length && item.tests.every(t => t.passed && t.exitCode === 0) ? 'approved' : 'validation_failed';
      item.pending = item.status === 'approved' ? [] : [unchanged ? 'Corrija as verificações reprovadas.' : 'O código mudou durante a validação. Revise novamente.'];
    } catch (error) { item.status = this.closed ? 'interrupted' : 'validation_failed'; item.pending = [error.message]; }
    finally { this.controllers.delete(item.id); release(); }
    item.finishedAt = Date.now(); this.changed(); return item;
  }
  dispose() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
    for (const item of this.items) if (['implementing', 'reviewing', 'testing', 'validating'].includes(item.status)) { item.status = 'interrupted'; item.pending = ['O serviço foi encerrado.']; }
    this.changed();
  }
}
