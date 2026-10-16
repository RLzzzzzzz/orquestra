// Opt-in integration check: sends a small real request using existing CLI logins.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crossSpawn from 'cross-spawn';
import { Workspace } from '../server/workspace.mjs';
import { TaskManager } from '../server/task-manager.mjs';
import { Orchestration, coordinatorCommand } from '../server/orchestration.mjs';
import { stopWorker } from '../server/cli-adapters.mjs';

const provider = process.argv[2] || 'opencode';
const leader = process.argv[3] || 'codex';
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.local-live-check-'));
const workspace = new Workspace(dataDir, process.cwd());
const projectId = workspace.state.projects[0].id;
workspace.addAgent({ projectId, provider, name: 'Executor de verificação' });
const tasks = new TaskManager(workspace, () => {
  for (const job of tasks.summaries()) console.log(`Executor: ${job.status}`);
}, { timeoutMs: 120000 });
const orchestration = new Orchestration(workspace, {}, tasks, 0);
const token = orchestration.issue(projectId, 'check');
const calls = [];
const server = http.createServer(async (req, res) => {
  const scope = orchestration.scope(req.headers.authorization?.replace('Bearer ', ''));
  if (!scope) { res.writeHead(401); res.end('{}'); return; }
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    const { name, args } = JSON.parse(body); calls.push(name); console.log(`MCP: ${name}`);
    res.end(JSON.stringify(await orchestration.call(scope, name, args)));
  } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let child, timer;
try {
  const coordinatorEnv = { ORQUESTRA_MCP_TOKEN: token, ORQUESTRA_MCP_URL: `http://127.0.0.1:${server.address().port}/internal/orchestration` };
  const launch = coordinatorCommand(leader, { env: coordinatorEnv });
  const args = leader === 'opencode' ? ['run', '--format', 'json', ...launch.args] : [...launch.args, 'exec', '--json', '--color', 'never', '--sandbox', 'read-only', '-'];
  child = crossSpawn(launch.file, args, {
    cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...coordinatorEnv, ...launch.env },
  });
  timer = setTimeout(() => stopWorker(child), 180000);
  let output = '', stderr = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end('Teste de integração. Use especificamente mcp__orquestra__listar_agentes (descubra pela busca de ferramentas se necessário), não list_agents de colaboração interna. Delegue exatamente uma tarefa pelo mcp__orquestra__enviar_tarefa ao executor disponível com a instrução "Responda apenas ORQUESTRA_WORKER_OK. Não leia nem altere arquivos, não execute comandos e não use ferramentas.". Consulte pelo mcp__orquestra__consultar_tarefa até concluir. Não faça nenhuma outra tarefa, não leia arquivos locais. Depois responda ORQUESTRA_COORDINATOR_OK se o executor retornou o marcador; caso contrário relate o erro.');
  const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  const jobs = tasks.jobs;
  const passed = code === 0 && calls.includes('enviar_tarefa') && calls.includes('consultar_tarefa') && jobs.length === 1 && jobs[0].status === 'succeeded' && jobs[0].result.includes('ORQUESTRA_WORKER_OK') && output.includes('ORQUESTRA_COORDINATOR_OK');
  console.log(JSON.stringify({ passed, provider, code, calls, jobs: jobs.map(j => ({ status: j.status, result: j.result, error: j.error })) }, null, 2));
  if (!passed) { console.log(stderr.slice(-6000)); console.log(output.slice(-12000)); for (const j of jobs) console.log(j.output.slice(-8000)); process.exitCode = 1; }
} finally {
  clearTimeout(timer); tasks.dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  console.log(`Registro de verificação: ${dataDir}`);
}
