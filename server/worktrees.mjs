import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

// No shell, push, merge, reset or removal operations are exposed here.
export class Worktrees {
  constructor(workspace, terminals, tasks) { this.workspace = workspace; this.terminals = terminals; this.tasks = tasks; }
  git(cwd, args) {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || 'Git falhou.');
    return result.stdout;
  }
  agent(projectId, agentId) {
    const agent = this.workspace.state.agents.find(a => a.projectId === projectId && a.id === agentId && !a.coordinator);
    if (!agent) throw new Error('Agente não encontrado neste projeto.');
    return agent;
  }
  assertIdle(agent) {
    if (this.terminals.info(agent.id).status === 'running' || this.tasks.summaries(agent.projectId).some(t => t.agentId === agent.id && ['queued', 'running', 'cancelling'].includes(t.status))) throw new Error('Encerre o terminal e as tarefas antes de preparar a worktree.');
  }
  prepare(projectId, agentId) {
    const agent = this.agent(projectId, agentId);
    this.assertIdle(agent);
    if (agent.worktree) { this.verify(agent); return agent.worktree; }
    const project = this.workspace.state.projects.find(p => p.id === projectId);
    const root = fs.realpathSync(this.git(project.cwd, ['rev-parse', '--show-toplevel']).trim());
    // Do not silently add files to another repository's ignore configuration.
    try { this.git(root, ['check-ignore', '-q', '.orquestra-worktrees/probe']); }
    catch { throw new Error('Adicione .orquestra-worktrees/ ao .gitignore do projeto antes de criar worktrees.'); }
    const base = this.git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    const id = randomUUID();
    const branch = `orquestra/${agent.id}/${id}`;
    const parent = path.join(root, '.orquestra-worktrees');
    fs.mkdirSync(parent, { recursive: true });
    if (fs.realpathSync(parent) !== path.resolve(parent)) throw new Error('A pasta de worktrees não pode ser um link.');
    const cwd = path.join(parent, id);
    this.git(root, ['worktree', 'add', '-b', branch, cwd, base]);
    agent.worktree = { id, root, cwd, branch, base, originalCwd: agent.cwd, createdAt: Date.now() };
    agent.cwd = cwd;
    agent.autoCommit = false;
    this.workspace.save();
    return { ...agent.worktree };
  }
  verify(agent) {
    const w = agent.worktree;
    if (!w || agent.cwd !== w.cwd || !fs.existsSync(w.cwd)) throw new Error('Worktree do agente indisponível.');
    if (this.git(w.cwd, ['branch', '--show-current']).trim() !== w.branch) throw new Error('A branch atual não corresponde à branch do agente.');
    const common = cwd => fs.realpathSync(path.resolve(cwd, this.git(cwd, ['rev-parse', '--git-common-dir']).trim()));
    if (common(w.cwd) !== common(w.root)) throw new Error('A worktree pertence a outro repositório.');
    return w;
  }
  inspect(projectId, agentId) {
    const agent = this.agent(projectId, agentId), w = this.verify(agent);
    const head = this.git(w.cwd, ['rev-parse', 'HEAD']).trim();
    const status = this.git(w.cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const files = [];
    const entries = status.split('\0');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]; if (!entry) continue;
      files.push({ status: entry.slice(0, 2), path: entry.slice(3), ...(/[RC]/.test(entry.slice(0, 2)) ? { from: entries[++i] } : {}) });
    }
    const diff = this.git(w.cwd, ['diff', '--no-ext-diff', '--no-textconv', '--binary', w.base, '--', '.']);
    const untracked = files.filter(f => f.status === '??').map(f => {
      const file = path.resolve(w.cwd, f.path);
      if (!file.startsWith(w.cwd + path.sep) || fs.lstatSync(file).isSymbolicLink()) throw new Error('Arquivo não rastreado fora da worktree ou link simbólico.');
      if (fs.statSync(file).size > 1024 * 1024) throw new Error(`Arquivo grande demais para revisão: ${f.path}`);
      return { path: f.path, content: fs.readFileSync(file).toString('base64') };
    });
    const changed = this.git(w.cwd, ['diff', '--name-only', '-z', w.base, '--', '.']).split('\0').filter(Boolean);
    const conflicts = files.filter(f => /U|AA|DD/.test(f.status)).map(f => f.path);
    const commits = this.git(w.cwd, ['log', '--format=%H %s', `${w.base}..HEAD`]).trim().split('\n').filter(Boolean);
    const revision = createHash('sha256').update(JSON.stringify({ head, status, diff, untracked })).digest('hex');
    return { ...w, head, revision, autoCommit: agent.autoCommit === true, files, changedFiles: [...new Set([...changed, ...files.map(f => f.path)])], conflicts, commits, diff, untracked: untracked.map(f => ({ path: f.path, text: Buffer.from(f.content, 'base64').toString('utf8') })) };
  }
  configure(projectId, agentId, input) {
    const agent = this.agent(projectId, agentId); this.verify(agent);
    if (typeof input.autoCommit !== 'boolean') throw new Error('Informe a configuração de commits automáticos.');
    agent.autoCommit = input.autoCommit; this.workspace.save();
    return { autoCommit: agent.autoCommit };
  }
  commit(projectId, agentId, input, user = false, worker = false) {
    const agent = this.agent(projectId, agentId);
    if (!user && agent.autoCommit !== true) throw new Error('Commit exige autorização do usuário na interface.');
    if (user && input.authorized !== true) throw new Error('Autorize o commit após revisar os arquivos.');
    if (!worker && this.tasks.summaries(projectId).some(t => t.agentId === agentId && ['queued', 'running', 'cancelling'].includes(t.status))) throw new Error('Aguarde a tarefa terminar antes do commit.');
    if (this.tasks.holds?.size) throw new Error('Aguarde a validação terminar antes do commit.');
    const state = this.inspect(projectId, agentId);
    if (!input.revision || input.revision !== state.revision) throw new Error('As alterações mudaram. Revise o diff novamente.');
    if (state.conflicts.length) throw new Error('Resolva os conflitos antes do commit.');
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 500 || input.message.includes('\0')) throw new Error('Mensagem de commit inválida. Prefira Conventional Commits.');
    if (!state.files.length) throw new Error('Nenhuma alteração para commit.');
    this.git(state.cwd, ['add', '-A', '--', '.']);
    this.git(state.cwd, ['commit', '-m', input.message.trim()]);
    return this.inspect(projectId, agentId);
  }
  list(projectId) {
    const states = this.workspace.state.agents.filter(a => a.projectId === projectId && a.worktree).map(a => {
      try { const { diff, untracked, ...state } = this.inspect(projectId, a.id); return { agentId: a.id, agentName: a.name, ...state }; }
      catch (error) { return { agentId: a.id, agentName: a.name, ...a.worktree, error: error.message }; }
    });
    return states.map(state => ({ ...state, possibleConflicts: states.filter(other => other.agentId !== state.agentId && other.root === state.root).flatMap(other => (state.changedFiles || []).filter(file => other.changedFiles?.includes(file)).map(file => ({ agentId: other.agentId, path: file }))) }));
  }
}
