import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { findCommand, textField } from './workspace.mjs';

const execute = promisify(execFile);
export function redact(text = '') {
  return String(text).replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,})\b/g, '[SEGREDO REMOVIDO]')
    .replace(/((?:api[_-]?key|authorization|password|senha|token)\s*[:=]\s*)([^\s,;]+)/gi, '$1[SEGREDO REMOVIDO]');
}
export class Memory {
  constructor(dataDir, notify = () => {}) {
    this.dataDir = path.join(dataDir, 'memory'); this.notify = notify;
    this.status = 'starting'; this.error = ''; this.closed = false;
    this.projects = new Map();
    this.ready = this.start().catch(error => { this.status = 'unavailable'; this.error = error.message; this.notify(); });
  }
  async start() {
    const local = path.join(path.dirname(this.dataDir), 'runtime', 'ai-memory', process.platform === 'win32' ? 'ai-memory.exe' : 'ai-memory');
    const binary = process.env.ORQUESTRA_MEMORY_BIN || (fs.existsSync(local) ? local : findCommand('ai-memory'));
    if (!binary) throw new Error('Instale o AI Memory: npm.cmd run memory:install. Depois reinicie o Orquestra.');
    const wiki = path.join(this.dataDir, 'wiki'); fs.mkdirSync(wiki, { recursive: true });
    // A separate git repository prevents the native Windows runtime finding the app's parent repo.
    if (!fs.existsSync(path.join(wiki, '.git', 'HEAD'))) await execute('git', ['init', wiki], { windowsHide: true });
    this.client = new Client({ name: 'orquestra-memory', version: '0.3.0' });
    this.transport = new StdioClientTransport({ command: binary, args: ['--data-dir', this.dataDir, 'serve', '--transport', 'stdio'], cwd: this.dataDir, stderr: 'pipe' });
    this.transport.stderr?.on('data', () => {});
    await this.client.connect(this.transport);
    if (this.closed) return this.client.close();
    this.client.onclose = () => { if (!this.closed) { this.status = 'unavailable'; this.error = 'AI Memory encerrou. Reinicie o serviço para reconectar.'; this.notify(); } };
    this.status = 'ready'; this.notify();
  }
  info() { return { status: this.status, error: this.error, engine: 'akitaonrails/ai-memory', version: '3.1.0', local: true }; }
  async ensureProject(projectId) {
    if (!this.projects.has(projectId)) {
      const pending = (async () => {
        try { await this.client.callTool({ name: 'memory_status', arguments: { workspace: 'orquestra', project: projectId } }); }
        catch (error) {
          if (!/(?:project|workspace) .*not found/.test(error.message)) throw error;
          const result = await this.client.callTool({ name: 'memory_write_page', arguments: { workspace: 'orquestra', project: projectId, path: 'notes/projeto.md', body: '# Memória do projeto\n\nEste espaço reúne notas e resultados dos agentes deste projeto no Orquestra.', create_only: true, tags: ['orquestra'] } });
          if (result.isError) throw new Error('Não foi possível inicializar a memória deste projeto.');
        }
      })();
      this.projects.set(projectId, pending);
      pending.catch(() => this.projects.delete(projectId));
    }
    await this.projects.get(projectId);
  }
  async call(projectId, operation, input = {}) {
    await this.ready;
    if (this.status !== 'ready') throw new Error(this.error || 'Memória indisponível.');
    await this.ensureProject(projectId);
    let args = {};
    if (operation === 'query') args = { query: textField(input.query, 'Busca', 2000), limit: 15, global: false, answer: false };
    else if (operation === 'write') args = { path: textField(input.path, 'Caminho', 200), body: redact(textField(input.body, 'Memória', 32000)), tier: ['working', 'episodic', 'semantic', 'procedural'].includes(input.tier) ? input.tier : 'semantic', pinned: input.pinned === true, tags: ['orquestra'] };
    else if (operation === 'read') args = { path: textField(input.path, 'Caminho', 200), include_related: false };
    else if (operation === 'delete') args = { path: textField(input.path, 'Caminho', 200), ...(typeof input.expected_page_id === 'string' && input.expected_page_id.length <= 300 ? { expected_page_id: input.expected_page_id } : {}) };
    else if (operation === 'recent') args = { limit: 30 };
    else if (operation === 'briefing') args = { settled_first: true, recent_pages_limit: 10 };
    else if (operation === 'handoff_begin') args = { summary: redact(textField(input.summary, 'Resumo', 4000)), next_steps: (input.next_steps || []).slice(0, 15).map(s => redact(textField(s, 'Próximo passo', 1000))), open_questions: [], files_touched: [] };
    else if (operation === 'handoff_accept') args = { handoff_id: textField(input.handoff_id, 'Handoff', 120) };
    else if (operation === 'handoff_list') args = { limit: 20 };
    else if (operation !== 'status') throw new Error('Operação de memória não permitida.');
    if (args.path && (args.path.includes('..') || !/^[\w/-]+\.md$/.test(args.path))) throw new Error('Use um caminho relativo como notes/decisao.md.');
    const name = { query: 'memory_query', write: 'memory_write_page', read: 'memory_read_page', delete: 'memory_delete_page', recent: 'memory_recent', briefing: 'memory_briefing', status: 'memory_status', handoff_begin: 'memory_handoff_begin', handoff_accept: 'memory_handoff_accept', handoff_list: 'memory_handoff_list' }[operation];
    const result = await this.client.callTool({ name, arguments: { ...args, workspace: 'orquestra', project: projectId } }, undefined, { timeout: 15000 });
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (result.isError) throw new Error(text.slice(0, 1500));
    try { return JSON.parse(text); } catch { return { text }; }
  }
  async recordTask(job) {
    const body = `# ${job.title}\n\nAgente: ${job.agentName} (${job.provider})\nEstado: ${job.status}\nData: ${new Date(job.createdAt).toISOString()}\n\n## Instrução\n${job.prompt}\n\n## Resultado\n${job.result || job.error || 'Sem resultado.'}`;
    await this.call(job.projectId, 'write', { path: `tasks/${job.id}.md`, tier: 'episodic', body: body.length > 32000 ? body.slice(0, 31900) + '\n\n[Registro abreviado; resultado completo no histórico de tarefas.]' : body });
  }
  async dispose() { this.closed = true; await this.ready; await this.client?.close(); }
}
