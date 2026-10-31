import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Workspace, providers, findCommand, commandCanStartAsync } from './workspace.mjs';
import { Terminals } from './terminals.mjs';
import { TaskManager } from './task-manager.mjs';
import { Orchestration, coordinatorProviders } from './orchestration.mjs';
import { automatedProviders } from './cli-adapters.mjs';
import { Memory } from './memory.mjs';
import { LiveTasks } from './live-tasks.mjs';
import { pickDirectory } from './folder-picker.mjs';
import { Worktrees } from './worktrees.mjs';
import { Reviews } from './reviews.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4317);
const dev = process.argv.includes('--dev');
const token = randomBytes(32).toString('hex');
const cookieName = `orquestra_${port}`;
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([...hosts].map(h => `http://${h}`));
const workspace = new Workspace(process.env.ORQUESTRA_DATA_DIR || path.join(root, '.local'), process.env.ORQUESTRA_DEFAULT_PROJECT_DIR || root);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const broadcast = data => {
  for (const ws of sockets.clients) {
    if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, 'Reconecte para recuperar o terminal');
    else send(ws, data);
  }
};
const terminals = new Terminals(event => broadcast(event.type === 'changed' ? snapshot() : event));
const memory = new Memory(path.dirname(workspace.file), () => broadcast(snapshot()));
const live = new LiveTasks(terminals, memory);
let reviews;
const tasks = new TaskManager(workspace, () => { broadcast(snapshot()); queueMicrotask(() => reviews?.tick()); }, { live, memory });
const orchestration = new Orchestration(workspace, terminals, tasks, port, memory, live);
const worktrees = new Worktrees(workspace, terminals, tasks);
tasks.git = worktrees;
orchestration.worktrees = worktrees;
reviews = new Reviews(workspace, tasks, worktrees, id => orchestration.workers(id), () => broadcast(snapshot()));
reviews.memory = memory;
orchestration.reviews = reviews;
function snapshot() {
  return { type: 'state', projects: workspace.state.projects, agents: workspace.state.agents.map(a => {
    const task = tasks.jobs.find(t => t.agentId === a.id && ['running', 'cancelling'].includes(t.status));
    return { ...a, ...terminals.info(a.id), taskId: task?.id, taskTitle: task?.title };
  }), tasks: tasks.summaries(), memory: memory.info() };
}
function authenticated(req) {
  return (req.headers.cookie || '').split(';').some(c => c.trim() === `${cookieName}=${token}`);
}
function trusted(req) {
  return hosts.has(req.headers.host) && (!req.headers.origin || origins.has(req.headers.origin)) && req.headers['sec-fetch-site'] !== 'cross-site';
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Pedido muito grande.');
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  const data = JSON.parse(content || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Pedido inválido.');
  return data;
}
let vite;
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!trusted(req)) return json(res, 403, { error: 'Origem não permitida.' });
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === '/internal/orchestration') {
    const scope = orchestration.scope((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!scope) return json(res, 401, { error: 'Coordenador não autenticado.' });
    if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
    try { const input = await body(req); return json(res, 200, await orchestration.call(scope, input.name, input.args)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (pathname.startsWith('/api/')) {
    if (!authenticated(req)) return json(res, 401, { error: 'Reabra o aplicativo para conectar.' });
    try {
      if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, snapshot());
      if (req.method === 'GET' && pathname === '/api/providers') {
        const available = await Promise.all(providers.map(async p => ({ ...p, coordinator: coordinatorProviders.includes(p.id), automated: automatedProviders.includes(p.id), available: ['shell', 'custom'].includes(p.id) || (['antigravity', 'hermes'].includes(p.id) ? await commandCanStartAsync(p.command) : !!findCommand(p.command)) })));
        return json(res, 200, available);
      }
      if (req.method === 'POST' && pathname === '/api/select-directory') return json(res, 200, await pickDirectory());
      if (req.method === 'POST' && pathname === '/api/projects') {
        const project = workspace.addProject(await body(req));
        broadcast(snapshot()); return json(res, 201, project);
      }
      if (req.method === 'POST' && pathname === '/api/agents') {
        const agent = workspace.addAgent(await body(req));
        broadcast(snapshot()); return json(res, 201, agent);
      }
      const gitMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/worktrees(?:\/([a-f0-9-]+)(?:\/(prepare|commit|settings))?)?$/);
      if (gitMatch) {
        const [, projectId, agentId, action] = gitMatch;
        if (req.method === 'GET') return json(res, 200, agentId ? worktrees.inspect(projectId, agentId) : worktrees.list(projectId));
        if (req.method === 'POST' && agentId) {
          const input = await body(req);
          const result = action === 'prepare' ? worktrees.prepare(projectId, agentId) : action === 'commit' ? worktrees.commit(projectId, agentId, input, true) : action === 'settings' ? worktrees.configure(projectId, agentId, input) : null;
          if (result) { broadcast(snapshot()); return json(res, 200, result); }
        }
      }
      const reviewMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/reviews(?:\/([a-f0-9-]+)(?:\/(retry|validate))?)?$/);
      if (reviewMatch) {
        const [, projectId, id, action] = reviewMatch;
        if (req.method === 'GET') return json(res, 200, id ? reviews.get(projectId, id) : reviews.list(projectId));
        if (req.method === 'POST') {
          if (!id) return json(res, 201, reviews.create(projectId, await body(req)));
          if (action === 'retry') return json(res, 200, reviews.retry(projectId, id));
          if (action === 'validate') return json(res, 200, await reviews.validate(projectId, id));
        }
      }
      const coordinatorMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/coordinator$/);
      if (req.method === 'POST' && coordinatorMatch) return json(res, 200, orchestration.start(coordinatorMatch[1], (await body(req)).agentId));
      const memoryMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/memory\/(status|query|write|delete|read|recent|briefing|handoff_list|handoff_begin|handoff_accept)$/);
      if (memoryMatch && ['GET', 'POST'].includes(req.method)) {
        if (!workspace.state.projects.some(p => p.id === memoryMatch[1])) throw new Error('Projeto não encontrado.');
        const operation = memoryMatch[2];
        if (req.method === 'GET' && !['status', 'recent', 'briefing', 'handoff_list'].includes(operation)) return json(res, 405, { error: 'Use POST.' });
        const data = req.method === 'POST' ? await body(req) : {};
        return json(res, 200, await memory.call(memoryMatch[1], operation, data));
      }
      if (pathname === '/api/tasks' && req.method === 'POST') {
        const input = await body(req); return json(res, 201, tasks.create(input.projectId, input));
      }
      const boardMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/board-tasks(?:\/([a-f0-9-]+))?$/);
      if (boardMatch && req.method === 'GET' && !boardMatch[2]) return json(res, 200, { tasks: tasks.summaries(boardMatch[1]) });
      if (boardMatch && req.method === 'POST' && !boardMatch[2]) return json(res, 201, tasks.createBoard(boardMatch[1], await body(req)));
      if (boardMatch && req.method === 'PATCH' && boardMatch[2]) return json(res, 200, tasks.updateBoard(boardMatch[2], boardMatch[1], await body(req)));
      const taskMatch = pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(cancel))?$/);
      if (taskMatch && req.method === 'GET' && !taskMatch[2]) return json(res, 200, tasks.get(taskMatch[1]));
      if (taskMatch && req.method === 'POST' && taskMatch[2] === 'cancel') return json(res, 200, tasks.cancel(taskMatch[1]));
      const match = pathname.match(/^\/api\/agents\/([a-f0-9-]+)(?:\/(start|stop|input|prompt))?$/);
      if (match) {
        const agent = workspace.state.agents.find(a => a.id === match[1]);
        if (!agent) return json(res, 404, { error: 'Agente não encontrado.' });
        if (req.method === 'DELETE' && !match[2]) {
          if (tasks.summaries().some(t => t.agentId === agent.id && ['queued', 'running', 'cancelling'].includes(t.status))) return json(res, 409, { error: 'Cancele as tarefas ativas antes de remover o executor.' });
          for (const [token, scope] of orchestration.tokens) if (scope.agentId === agent.id) orchestration.tokens.delete(token);
          terminals.stop(agent.id); workspace.removeAgent(agent.id); terminals.sessions.delete(agent.id);
          broadcast(snapshot()); return json(res, 200, { ok: true });
        }
        if (req.method === 'POST') {
          if (match[2] === 'start') { if (agent.coordinator) orchestration.start(agent.projectId); else orchestration.startWorker(agent); }
          else if (match[2] === 'stop') terminals.stop(agent.id);
          else if (match[2] === 'input') { const input = await body(req); terminals.write(agent.id, input.data, input.sessionId); }
          else if (match[2] === 'prompt') {
            const input = await body(req);
            await terminals.prompt(agent.id, input.text, { submit: input.submit !== false, bracketed: input.bracketed === true, sessionId: input.sessionId });
          }
          else return json(res, 404, { error: 'Ação não encontrada.' });
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: 'Rota não encontrada.' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método não permitido.' });
  // Only a top-level page navigation can bootstrap the local session cookie.
  if (pathname === '/') res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
  if (vite) return vite.middlewares(req, res);
  const dist = path.join(root, 'dist');
  let file;
  try { file = path.resolve(dist, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname)); }
  catch { return json(res, 400, { error: 'Caminho inválido.' }); }
  if (!file.startsWith(dist + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return json(res, 404, { error: 'Arquivo não encontrado. Execute npm.cmd run build antes de iniciar.' });
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'application/octet-stream'), 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server }, allowedHosts: ['localhost', '127.0.0.1'] } });
}
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { if (!dev) socket.destroy(); return; }
  if (!trusted(req) || !authenticated(req) || !origins.has(req.headers.origin)) { socket.destroy(); return; }
  sockets.handleUpgrade(req, socket, head, ws => {
    sockets.emit('connection', ws, req);
  });
});
sockets.on('connection', ws => {
  ws.on('error', () => {});
  // Snapshot and replay share the same event loop; live output follows without a gap.
  send(ws, snapshot());
  for (const [id, session] of terminals.sessions) send(ws, { type: 'replay', id, sessionId: session.id, data: session.history });
  ws.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'input') terminals.write(message.id, message.data, message.sessionId);
      else if (message.type === 'resize') terminals.resize(message.id, message.cols, message.rows, message.sessionId);
    } catch (error) { send(ws, { type: 'error', message: error.message }); }
  });
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `A porta ${port} está ocupada. Feche a outra instância ou configure PORT.` : error.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Orquestra disponível em ${url}`);
  if (process.connected) process.send({ type: 'ready', url });
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  // Bound the entire shutdown, including a stalled memory transport/drain.
  setTimeout(() => process.exit(0), 5000).unref();
  tasks.dispose();
  reviews.dispose();
  terminals.dispose();
  await memory.dispose();
  for (const ws of sockets.clients) ws.terminate();
  sockets.close();
  if (vite) await vite.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Electron owns this process through IPC; Windows signals cannot request cleanup.
if (process.send) {
  process.on('message', message => { if (message?.type === 'shutdown') shutdown(); });
  process.on('disconnect', shutdown);
}
