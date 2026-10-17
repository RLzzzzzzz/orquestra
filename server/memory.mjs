import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pathToFileURL } from 'node:url';
import { findCommand, textField } from './workspace.mjs';
import { captureGateway, nativeHooks, writeCaptureSettings, hermesProfile, linkedProfile, codexHooksArgs } from './native-capture.mjs';
import os from 'node:os';

const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function localPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
function decodeResult(result) {
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (result.isError) throw new Error(text.slice(0, 1500));
  try { return JSON.parse(text); } catch { return { text }; }
}
export function redact(text = '') {
  return String(text).replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[SEGREDO REMOVIDO]')
    .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,})\b/g, '[SEGREDO REMOVIDO]')
    .replace(/((?:api[_-]?key|authorization|password|senha|token)\s*[:=]\s*)([^\s,;]+)/gi, '$1[SEGREDO REMOVIDO]');
}
export function captureFailure(error, secret = '') {
  // execFile.message starts with the command and startup logs; the actionable
  // provider error is at the end of stderr. Never persist the engine bearer.
  let detail = String(error.stderr || error.message || error).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (secret) detail = detail.replaceAll(secret, '[SEGREDO REMOVIDO]');
  return redact(detail).trim().slice(-1200);
}
export class Memory {
  constructor(dataDir, notify = () => {}) {
    this.dataDir = path.resolve(dataDir, 'memory'); this.notify = notify;
    this.status = 'starting'; this.error = ''; this.closed = false;
    this.projects = new Map();
    this.ready = this.start().catch(async error => { this.status = 'unavailable'; this.error = redact(`AI Memory (${this.stage || 'startup'}): ${error.message}${this.diagnostics ? '\n' + this.diagnostics : ''}`).slice(-2500); await this.client?.close().catch(() => {}); await this.gateway?.close(); this.process?.kill(); this.notify(); });
  }
  async start() {
    const local = path.join(path.dirname(this.dataDir), 'runtime', 'ai-memory', process.platform === 'win32' ? 'ai-memory.exe' : 'ai-memory');
    const binary = process.env.ORQUESTRA_MEMORY_BIN || (fs.existsSync(local) ? local : findCommand('ai-memory'));
    if (!binary) throw new Error('Instale o AI Memory: npm.cmd run memory:install. Depois reinicie o Orquestra.');
    this.binary = binary;
    const wiki = path.join(this.dataDir, 'wiki'); fs.mkdirSync(wiki, { recursive: true });
    // A separate git repository prevents the native Windows runtime finding the app's parent repo.
    if (!fs.existsSync(path.join(wiki, '.git', 'HEAD'))) await execute('git', ['init', wiki], { windowsHide: true, timeout: 15000 });
    this.stage = 'spawn';
    // Native hook/drain reads this official credential file, not the server's
    // environment. Keep it stable so already-spooled events survive restart.
    const tokenFile = path.join(this.dataDir, 'auth-token');
    this.authToken = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : randomBytes(32).toString('hex');
    if (!this.authToken) throw new Error('Credencial local do AI Memory vazia.');
    fs.writeFileSync(tokenFile, this.authToken, { mode: 0o600 });
    // Native spool entries include their destination; keep it stable on restart.
    const endpointFile = path.join(this.dataDir, 'orquestra-http-port.json');
    const previousPort = fs.existsSync(endpointFile) ? JSON.parse(fs.readFileSync(endpointFile, 'utf8')).port : undefined;
    const port = Number.isInteger(previousPort) && previousPort > 0 && previousPort < 65536 ? previousPort : await localPort();
    fs.writeFileSync(endpointFile, JSON.stringify({ port }));
    this.endpoint = `http://127.0.0.1:${port}`;
    const env = { ...process.env, AI_MEMORY_AUTH_TOKEN: this.authToken, AI_MEMORY_BACKFILL_ON_START: 'false' };
    delete env.AI_MEMORY_CAPTURE_OWNER;
    this.process = spawn(binary, ['--data-dir', this.dataDir, 'serve', '--transport', 'http', '--bind', this.endpoint.slice(7)], { cwd: this.dataDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const diagnostic = data => { this.diagnostics = redact(((this.diagnostics || '') + data).replaceAll(this.authToken, '[SEGREDO REMOVIDO]')).slice(-1800); };
    this.process.stdout.on('data', diagnostic); this.process.stderr.on('data', diagnostic);
    this.process.on('error', error => { this.spawnError = error; });
    this.process.on('exit', (code, signal) => { this.engineExit = `${code ?? signal}`; if (!this.closed && this.status === 'ready') { this.status = 'unavailable'; this.error = `AI Memory encerrou (${this.engineExit}).`; this.notify(); } });
    this.stage = 'http-ready';
    const deadline = Date.now() + 15000;
    while (true) {
      if (this.spawnError) throw this.spawnError;
      if (this.engineExit !== undefined) throw new Error(`Processo encerrou (${this.engineExit}).`);
      try { const response = await fetch(this.endpoint + '/healthz', { signal: AbortSignal.timeout(500) }); if (response.ok) break; } catch {}
      if (Date.now() >= deadline) throw new Error('Servidor HTTP não ficou disponível em 15 segundos.');
      await pause(50);
    }
    this.stage = 'mcp-initialize';
    this.client = new Client({ name: 'orquestra-memory', version: '0.3.0' });
    this.transport = new StreamableHTTPClientTransport(new URL(this.endpoint + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${this.authToken}` } } });
    await this.client.connect(this.transport, { timeout: 15000 });
    if (this.closed) return this.client.close();
    this.client.onclose = () => { if (!this.closed) { this.status = 'unavailable'; this.error = 'AI Memory encerrou. Reinicie o serviço para reconectar.'; this.notify(); } };
    this.stage = 'native-plugin';
    this.gateway = await captureGateway({ dataDir: this.dataDir, endpoint: this.endpoint, token: this.authToken });
    try {
      const { stdout } = await execute(binary, ['--data-dir', this.dataDir, 'install-hooks', '--agent', 'opencode', '--server-url', this.endpoint], { env: { ...env, AI_MEMORY_AUTH_TOKEN: '' }, windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      // Keep official capture policy, native IDs, spool, retries and event mapping.
      // Bind only routing to the app project without writing a repository marker.
      const anchor = 'function applyMarkerParams(';
      if (!stdout.includes(anchor)) throw new Error('Plugin oficial sem função de escopo conhecida.');
      const source = stdout.replace(anchor, 'function applyRepositoryMarkerParams(') + `\nfunction applyMarkerParams(url: URL, cwd: string | undefined): boolean {\n  if (!applyRepositoryMarkerParams(url, cwd)) return false;\n  const project = process.env.ORQUESTRA_MEMORY_PROJECT;\n  if (!project) return false;\n  url.searchParams.delete('identity'); url.searchParams.delete('identity_src');\n  url.searchParams.set('workspace', 'orquestra'); url.searchParams.set('project', project);\n  return true;\n}\n`;
      if (source.includes(this.authToken)) throw new Error('O gerador tentou persistir a credencial do servidor.');
      this.pluginPath = path.join(this.dataDir, 'integrations', 'opencode-ai-memory.ts');
      fs.mkdirSync(path.dirname(this.pluginPath), { recursive: true });
      fs.writeFileSync(this.pluginPath, source);
    } catch (error) { this.captureError = captureFailure(error, this.authToken); }
    if (this.engineExit !== undefined) throw new Error(`Processo encerrou (${this.engineExit}) durante a preparação.`);
    this.stage = 'ready'; this.status = 'ready'; this.notify();
  }
  info() { return { status: this.status, stage: this.stage, error: this.error, engine: 'akitaonrails/ai-memory', version: '3.1.0', local: true, transport: 'http', lifecycleCapture: !!(this.gateway || this.pluginPath) && this.status === 'ready', captureProviders: this.status === 'ready' ? [...(this.pluginPath ? ['opencode'] : []), ...(this.gateway ? ['codex', 'claude', 'gemini', 'antigravity', 'hermes'] : [])] : [], captureScope: this.gateway ? 'native-provider-hooks' : this.pluginPath ? 'native-opencode-new-sessions' : 'delegated-task-records', captureError: this.captureError || '' }; }
  agentCapture(projectId, provider, cwd) {
    if (this.status !== 'ready') return {};
    const env = { ORQUESTRA_MEMORY_PROJECT: projectId, AI_MEMORY_AUTH_TOKEN: this.authToken, AI_MEMORY_DATA_DIR: this.dataDir, AI_MEMORY_CAPTURE_OWNER: '', AI_MEMORY_BACKFILL_ON_START: 'false' };
    if (provider === 'opencode') return this.pluginPath ? { plugin: pathToFileURL(this.pluginPath).href, env } : {};
    if (!this.gateway || !['codex', 'claude', 'gemini', 'antigravity', 'hermes'].includes(provider)) return {};
    const endpoint = this.gateway.register(projectId);
    if (provider === 'hermes') return { env: { ...env, HERMES_HOME: hermesProfile(this.dataDir, projectId), ORQUESTRA_MEMORY_BINARY: this.binary, ORQUESTRA_MEMORY_ENDPOINT: endpoint } };
    const settings = nativeHooks({ binary: this.binary, dataDir: this.dataDir, endpoint, provider });
    const file = path.join(this.dataDir, 'integrations', projectId, `${provider}.json`);
    if (provider === 'gemini') {
      const profile = path.join(this.dataDir, 'integrations', projectId, 'gemini-profile');
      const originalDir = path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini');
      const original = path.join(originalDir, 'settings.json');
      const base = fs.existsSync(original) ? JSON.parse(fs.readFileSync(original, 'utf8')) : {};
      // Private user-settings overlay; leave administrator policy untouched.
      const hooks = { ...base.hooks };
      for (const [event, handlers] of Object.entries(settings.hooks)) hooks[event] = [...(hooks[event] || []), ...handlers];
      linkedProfile(originalDir, path.join(profile, '.gemini'), 'settings.json');
      writeCaptureSettings(path.join(profile, '.gemini', 'settings.json'), { ...base, hooks }); env.GEMINI_CLI_HOME = profile;
    } else if (provider === 'antigravity') {
      if (!cwd) throw new Error('Informe a pasta do Antigravity para configurar seus hooks locais.');
      const target = path.join(cwd, '.agents', 'hooks.json');
      const base = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
      writeCaptureSettings(target, { ...base, ...settings });
    } else writeCaptureSettings(file, settings);
    return { hooksFile: file, ...(provider === 'codex' ? { args: codexHooksArgs(settings) } : {}), env };
  }
  async postHookBatch(endpointUrl, events, token, projectId) {
    if (!projectId) throw new Error('Informe o projeto explícito para captura externa.');
    if (events.some(ev => !/^[\w-]{1,64}$/.test(ev.ingestKey || '') || !ev.sessionId)) throw new Error('Evento sem sessão ou chave estável de ingestão.');
    if (events.some(ev => ev.body?.session_id && ev.body.session_id !== ev.sessionId)) throw new Error('Identidade nativa da sessão diverge do corpo do evento.');
    const batchItems = events.map(ev => ({
      url: '/hook?' + new URLSearchParams({ event: ev.event, agent: ev.agent, workspace: 'orquestra', project: projectId, extension: 'orquestra', source_event: ev.event, ingest_key: ev.ingestKey }),
      body: { ...ev.body, session_id: ev.sessionId }
    }));
    const response = await fetch(`${endpointUrl}/hook/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(batchItems),
      signal: AbortSignal.timeout(10000)
    });
    const receipt = await response.json();
    // Partial/429 receipts still acknowledge items. The producer owns retries.
    return { ...receipt, httpStatus: response.status };
  }
  async ensureProject(projectId) {
    if (!this.projects.has(projectId)) {
      const pending = (async () => {
        try { decodeResult(await this.client.callTool({ name: 'memory_status', arguments: { workspace: 'orquestra', project: projectId } }, undefined, { timeout: 15000 })); }
        catch (error) {
          if (!/(?:project|workspace) .*not found/.test(error.message)) throw error;
          decodeResult(await this.client.callTool({ name: 'memory_write_page', arguments: { workspace: 'orquestra', project: projectId, path: 'notes/projeto.md', body: '# Memória do projeto\n\nEste espaço reúne notas e resultados dos agentes deste projeto no Orquestra.', create_only: true, tags: ['orquestra'] } }, undefined, { timeout: 15000 }));
        }
      })();
      this.projects.set(projectId, pending);
      pending.catch(() => this.projects.delete(projectId));
    }
    await this.projects.get(projectId);
  }
  call(projectId, operation, input = {}) {
    if (this.closed) return Promise.reject(new Error('AI Memory está encerrando.'));
    // The official engine writes a shared Git wiki. Serialize calls through the
    // same client so task completion and agent writes cannot race its index.
    const pending = (this.operations || Promise.resolve()).then(() => this.performCall(projectId, operation, input));
    this.operations = pending.catch(() => {});
    return pending;
  }
  async performCall(projectId, operation, input = {}) {
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
    if (operation === 'write') {
      if (input.expected_page_id !== undefined) args.expected_page_id = textField(input.expected_page_id, 'Versão da página', 300);
      if (input.create_only === true) args.create_only = true;
      if (args.expected_page_id && args.create_only) throw new Error('Use versão esperada ou criação exclusiva, não ambos.');
    }
    if (args.path && (args.path.includes('..') || !/^[\w/-]+\.md$/.test(args.path))) throw new Error('Use um caminho relativo como notes/decisao.md.');
    const name = { query: 'memory_query', write: 'memory_write_page', read: 'memory_read_page', delete: 'memory_delete_page', recent: 'memory_recent', briefing: 'memory_briefing', status: 'memory_status', handoff_begin: 'memory_handoff_begin', handoff_accept: 'memory_handoff_accept', handoff_list: 'memory_handoff_list' }[operation];
    const result = await this.client.callTool({ name, arguments: { ...args, workspace: 'orquestra', project: projectId } }, undefined, { timeout: 15000 });
    return decodeResult(result);
  }
  async context(projectId, query = '') {
    // A briefing contains page descriptors, not their bodies. Hydrate a bounded
    // selection through the official read tool instead of truncating raw JSON.
    const brief = await this.call(projectId, 'briefing');
    const warnings = [];
    let hits = [];
    if (query.trim()) {
      try { hits = (await this.call(projectId, 'query', { query: query.slice(0, 2000) })).hits || []; }
      catch (error) { warnings.push(`Busca indisponível: ${error.message.slice(0, 200)}`); }
    }
    const candidates = [...(brief.pinned || []).slice(0, 2), ...hits, ...(brief.settled || []), ...(brief.rules || []), ...(brief.recent_pages || [])];
    const paths = [...new Set(candidates.map(page => page.path).filter(Boolean))].slice(0, 5);
    const pages = [];
    for (const pagePath of paths) {
      try {
        const page = await this.call(projectId, 'read', { path: pagePath });
        const body = String(page.body || '');
        pages.push({ path: pagePath.slice(0, 200), title: String(page.title || '').slice(0, 160), body: body.slice(0, 1200), truncated: body.length > 1200 });
      } catch (error) { warnings.push(`Não foi possível ler ${pagePath}: ${error.message.slice(0, 200)}`); }
    }
    const packet = { scope: brief.scope, pages, warnings: warnings.slice(0, 5) };
    // Keep the packet valid JSON, including escaped text, under the PTY budget.
    while (JSON.stringify(packet).length > 4500 && pages.some(page => page.body.length)) {
      const largest = pages.reduce((a, b) => a.body.length >= b.body.length ? a : b);
      largest.body = largest.body.slice(0, Math.max(0, largest.body.length - 100)); largest.truncated = true;
    }
    return { text: JSON.stringify(packet), warnings: packet.warnings };
  }
  async recordTask(job) {
    const body = `# ${job.title}\n\nTarefa: ${job.id}\nPedido: ${job.requestId || ''}\nAgente: ${job.agentName} (${job.provider})\nSessão: ${job.sessionId || 'indisponível'}\nEntrega: ${job.delivery || 'indisponível'}\nEstado: ${job.status}\nData: ${new Date(job.createdAt).toISOString()}\n\n## Instrução\n${job.prompt}\n\n## Resultado\n${job.result || job.error || 'Sem resultado.'}`;
    await this.call(job.projectId, 'write', { path: `tasks/${job.id}.md`, tier: 'episodic', body: body.length > 32000 ? body.slice(0, 31900) + '\n\n[Registro abreviado; resultado completo no histórico de tarefas.]' : body });
  }
  async dispose() {
    this.closed = true;
    // A blocked call or startup must not orphan the supervised engine when the
    // app's outer shutdown deadline expires.
    const force = setTimeout(() => this.process?.kill(), 1800);
    try { await this.operations; await this.ready; await this.client?.close(); }
    finally {
      await this.gateway?.close();
      clearTimeout(force);
      if (this.process && this.process.exitCode === null) {
        const exited = new Promise(resolve => this.process.once('exit', resolve));
        this.process.kill(); await Promise.race([exited, pause(2000)]);
      }
    }
  }
}
