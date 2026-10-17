// Opt-in real CLI startup, no model prompt. Private backend, port and data.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fork } from 'node:child_process';
import { WebSocket } from 'ws';
import { redact } from '../server/memory.mjs';

const directory = fs.mkdtempSync(path.resolve('.local-codex-startup-'));
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = fork('server/index.mjs', [], { env: { ...process.env, PORT: String(port), ORQUESTRA_DATA_DIR: directory, ORQUESTRA_MEMORY_BIN: path.resolve('.local/runtime/ai-memory/ai-memory.exe') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let ws, output = '', agent, result;
child.stdout.resume(); child.stderr.resume();
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timeout')), 30000);
    child.once('message', message => { clearTimeout(timer); message.type === 'ready' ? resolve() : reject(new Error('Unexpected startup message')); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const home = await fetch(origin);
  const headers = { Cookie: home.headers.get('set-cookie').split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
  const api = async (route, body) => {
    const response = await fetch(origin + '/api' + route, { headers, ...(body && { method: 'POST', body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  };
  const state = await api('/state');
  const deadline = Date.now() + 30000;
  while ((await api('/state')).memory.status === 'starting' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  agent = await api('/agents', { projectId: state.projects[0].id, provider: 'codex', name: 'Codex startup regression', cwd: process.cwd() });
  ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', raw => {
    const event = JSON.parse(raw);
    if (event.id === agent.id && ['output', 'replay'].includes(event.type)) output = (output + event.data).slice(-10000);
  });
  await api(`/agents/${agent.id}/start`, {});
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const current = (await api('/state')).agents.find(item => item.id === agent.id);
    if (current?.mode === 'fallback') throw new Error('Codex exited into fallback');
    if (current?.status === 'running' && current.mcpReady) { result = { passed: true, provider: 'codex', mode: current.mode, mcpReady: true, sessionId: current.sessionId }; break; }
    if (current?.status === 'running' && /OpenAI Codex/.test(output) && /Review hooks/.test(output)) {
      result = { passed: true, provider: 'codex', mode: current.mode, mcpReady: false, awaitingHookReview: true, sessionId: current.sessionId };
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!result) throw new Error('Codex did not initialize the Orquestra MCP within 45 seconds');
} catch (error) {
  result = { passed: false, error: error.message };
  process.exitCode = 1;
} finally {
  result.output = redact(output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''));
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output: undefined, directory }));
  ws?.close();
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (child.connected) child.send({ type: 'shutdown' });
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 7000))]);
  if (child.exitCode === null) child.kill();
}
