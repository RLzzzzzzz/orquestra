import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import crossSpawn from 'cross-spawn';
import { findCommand } from './workspace.mjs';
import os from 'node:os';
import { saveJson } from './persistence.mjs';

// Repository markers may contain aliases and inferred identities. None of
// those may change the project selected in Orquestra.
const routingKeys = ['identity', 'identity_src', 'identity_style', 'aliases', 'project_src', 'project_strategy'];
export function scopeOpenCodePlugin(source) {
  const anchor = 'function applyMarkerParams(';
  if (!source.includes(anchor)) throw new Error('Plugin oficial sem função de escopo conhecida.');
  return source.replace(anchor, 'function applyRepositoryMarkerParams(') + `\nfunction applyMarkerParams(url: URL, cwd: string | undefined): boolean {\n  if (!applyRepositoryMarkerParams(url, cwd)) return false;\n  const project = process.env.ORQUESTRA_MEMORY_PROJECT;\n  if (!project || !/^[\\w-]{1,128}$/.test(project)) return false;\n  for (const key of ${JSON.stringify(routingKeys)}) url.searchParams.delete(key);\n  url.searchParams.set('workspace', 'orquestra'); url.searchParams.set('project', project);\n  url.searchParams.set('default_global', 'false');\n  return true;\n}\n`;
}

export function linkedProfile(source, target, privateFile) {
  fs.mkdirSync(target, { recursive: true });
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === privateFile) continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (fs.existsSync(to)) continue;
    if (entry.isDirectory()) fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    else fs.linkSync(from, to);
  }
}

export function codexHooksArgs(settings) {
  const toml = value => Array.isArray(value) ? `[${value.map(toml).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}` : JSON.stringify(value);
  return Object.entries(settings.hooks).flatMap(([event, handlers]) => ['-c', `hooks.${event}=${toml(handlers)}`]);
}

export function hermesProfile(dataDir, projectId, env = process.env) {
  const home = env.HERMES_HOME || (process.platform === 'win32' ? path.join(env.LOCALAPPDATA || '', 'hermes') : path.join(env.HOME || '', '.hermes'));
  const hermes = findCommand('hermes', env);
  if (!hermes) throw new Error('Hermes não encontrado.');
  // Hermes' package runtime has deep paths; keep its private profile short on
  // Windows instead of exceeding MAX_PATH under the app's data directory.
  const key = createHash('sha256').update(`${dataDir}/${projectId}`).digest('hex').slice(0, 16);
  const target = path.join(os.tmpdir(), `oq-hermes-${key}`);
  const resolved = crossSpawn.sync(hermes, ['--print-runtime-command', '--module', 'os'], { env, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  if (resolved.error || resolved.status !== 0) throw new Error('O launcher Hermes não disponibiliza seu runtime de integração.');
  const runtime = JSON.parse(resolved.stdout.trim());
  if (!Array.isArray(runtime) || runtime[1] !== '-I' || runtime[2] !== '-c') throw new Error('Contrato de runtime Hermes desconhecido.');
  const helper = fileURLToPath(new URL('./hermes-capture.py', import.meta.url));
  const done = crossSpawn.sync(runtime[0], [...runtime.slice(1, 3), runtime[3] + '; helper_path=sys.argv.pop(1); runpy.run_path(helper_path, run_name="__main__")', helper, home, target], { env, windowsHide: true, timeout: 30000, encoding: 'utf8' });
  if (done.error || done.status !== 0) throw new Error((done.stderr || done.error?.message || 'Hermes não conseguiu preparar o perfil isolado.').slice(-1200));
  return target;
}

// Native hooks retain the official sanitizer, spool, IDs and capture policy.
// This loopback gateway binds their inferred scope to the authorized app project.
export async function captureGateway({ dataDir, endpoint, token }) {
  const portFile = path.join(dataDir, 'orquestra-capture-port.json');
  const saved = fs.existsSync(portFile) ? JSON.parse(fs.readFileSync(portFile, 'utf8')) : {};
  // Official spool files retain the old project URLs. Restore their authorized
  // routes before any agent is reopened so draining after restart still works.
  const projects = new Set((Array.isArray(saved.projects) ? saved.projects : []).filter(id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id)));
  const server = http.createServer(async (req, res) => {
    try {
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end(); return; }
      const incoming = new URL(req.url, 'http://127.0.0.1');
      const rootBatch = incoming.pathname === '/hook/batch' && req.method === 'POST';
      const match = rootBatch ? [null, null, '/hook/batch'] : incoming.pathname.match(/^\/project\/([\w-]+)(\/(?:hook(?:\/batch)?|handoff|healthz))$/);
      if (!match || (!rootBatch && !projects.has(match[1])) || !['GET', 'POST'].includes(req.method)) { res.writeHead(404).end(); return; }
      const scope = (url, projectId = match[1]) => {
        for (const key of routingKeys) url.searchParams.delete(key);
        url.searchParams.set('workspace', 'orquestra'); url.searchParams.set('project', projectId);
        url.searchParams.set('default_global', 'false');
        return url;
      };
      const target = new URL(match[2] + incoming.search, endpoint);
      if (!rootBatch) scope(target);
      let body;
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        body = Buffer.concat(chunks);
        if (match[2] === '/hook/batch') {
          const items = JSON.parse(body);
          if (!Array.isArray(items) || items.length > 256) throw new Error('Invalid batch');
          body = JSON.stringify(items.map(item => {
            const url = new URL(item.url, endpoint);
            const originScope = url.pathname.match(/^\/project\/([\w-]+)\/hook$/);
            const projectId = rootBatch ? originScope?.[1] : match[1];
            if (!projectId || !projects.has(projectId) || (!originScope && url.pathname !== '/hook')) throw new Error('Invalid hook');
            url.pathname = '/hook'; scope(url, projectId); return { ...item, url: url.pathname + url.search };
          }));
        }
      }
      const response = await fetch(target, { method: req.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AI-Memory-Client': 'hook' }, body, signal: AbortSignal.timeout(10000) });
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(502); res.end('{"error":"Falha no gateway de captura."}'); }
  });
  const port = Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536 ? saved.port : 0;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const persist = () => saveJson(portFile, { port: server.address().port, projects: [...projects] });
  try { persist(); } catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return { register(projectId) {
    if (typeof projectId !== 'string' || !/^[\w-]{1,128}$/.test(projectId)) throw new Error('Projeto inválido.');
    if (!projects.has(projectId)) { projects.add(projectId); try { persist(); } catch (error) { projects.delete(projectId); throw error; } }
    return `http://127.0.0.1:${server.address().port}/project/${projectId}`;
  }, close() { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

const common = { SessionStart: 'session-start', UserPromptSubmit: 'user-prompt-submit', PreToolUse: 'pre-tool-use', PostToolUse: 'post-tool-use', PreCompact: 'pre-compact', Stop: 'stop', SessionEnd: 'session-end' };
export function nativeHooks({ binary, dataDir, endpoint, provider, platform = process.platform }) {
  const agent = { claude: 'claude-code', gemini: 'gemini-cli', antigravity: 'antigravity-cli' }[provider] || provider;
  const events = provider === 'gemini' ? { SessionStart: 'session-start', SessionEnd: 'session-end', BeforeAgent: 'user-prompt-submit', AfterAgent: 'stop', BeforeTool: 'pre-tool-use', AfterTool: 'post-tool-use', PreCompress: 'pre-compact' } : common;
  const quote = value => platform === 'win32' ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`;
  const handler = event => {
    const args = [binary, '--data-dir', dataDir, 'hook', '--event', event, '--agent', agent, '--server-url', endpoint];
    let command = args.map(quote).join(' ');
    if (platform === 'win32') {
      // CLI runners use different shells. UTF-16 encoded PowerShell avoids cmd
      // nested-quote rules and preserves accented executable paths and JSON.
      const literal = value => `'${value.replaceAll("'", "''")}'`;
      const code = `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $payload = [Console]::In.ReadToEnd(); $payload | & ${args.map(literal).join(' ')}; exit $LASTEXITCODE`;
      command = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(code, 'utf16le').toString('base64')}`;
    }
    return { type: 'command', command, timeout: provider === 'gemini' ? 20000 : 20 };
  };
  if (provider === 'antigravity') return { 'ai-memory': { PreInvocation: [handler('session-start')], Stop: [handler('stop')], PreToolUse: [{ matcher: '', hooks: [handler('pre-tool-use')] }], PostToolUse: [{ matcher: '', hooks: [handler('post-tool-use')] }] } };
  return { hooks: Object.fromEntries(Object.entries(events).map(([name, event]) => [name, [{ matcher: '', hooks: [{ ...handler(event), name: `orquestra-memory-${event}` }] }]])) };
}

export function writeCaptureSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}
