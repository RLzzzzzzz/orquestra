// Opt-in real provider calls. Private memory/profile, no repository edits.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import crossSpawn from 'cross-spawn';
import { Memory, redact } from '../server/memory.mjs';
import { findCommand } from '../server/workspace.mjs';

const directory = fs.mkdtempSync(path.resolve('.local-provider-capture-'));
process.env.ORQUESTRA_MEMORY_BIN ||= path.resolve('.local/runtime/ai-memory/ai-memory.exe');
const memory = new Memory(directory), results = [];
const names = process.argv.slice(2);
try {
  await memory.ready;
  if (memory.status !== 'ready') throw new Error(memory.error);
  for (const provider of names.length ? names : ['codex', 'gemini', 'antigravity', 'hermes']) {
    const project = `probe-${provider}-${randomUUID()}`, cwd = path.join(directory, provider);
    fs.mkdirSync(cwd, { recursive: true });
    const file = findCommand(provider === 'antigravity' ? 'agy' : provider);
    if (!file) { results.push({ provider, status: 'not-installed' }); continue; }
    await memory.call(project, 'status');
    let capture;
    try { capture = memory.agentCapture(project, provider, cwd); }
    catch (error) { results.push({ provider, status: 'configuration-failed', error: redact(error.message) }); continue; }
    const prompt = 'Reply exactly ORQUESTRA_CAPTURE_OK. Do not use tools or change files.';
    const args = {
      codex: ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--json', ...(capture.args || []), '-'],
      gemini: ['-p', prompt, '--output-format', 'stream-json'],
      antigravity: ['--print', prompt, '--output-format', 'stream-json', '--print-timeout', '40s'],
      hermes: ['--native', '-z', prompt],
    }[provider];
    if (!args) { results.push({ provider, status: 'no-probe-command' }); continue; }
    console.log(`Validando ${provider} com hooks nativos...`);
    const output = await new Promise(resolve => {
      const child = crossSpawn(file, args, { cwd, env: { ...process.env, ...capture.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let text = '', timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32') crossSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill();
      }, 60000);
      child.stdout.on('data', chunk => { text = (text + chunk).slice(-12000); });
      child.stderr.on('data', chunk => { text = (text + chunk).slice(-12000); });
      child.stdin.on('error', () => {}); child.stdin.end(provider === 'codex' ? prompt : undefined);
      child.once('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, timedOut, outputTail: redact(text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).slice(-2500), answered: text.includes('ORQUESTRA_CAPTURE_OK') }); });
    });
    let counts;
    for (let i = 0; i < 30; i++) {
      counts = (await memory.call(project, 'status')).counts;
      if (counts.observations > 0) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const result = { provider, project, ...output, counts, captured: counts.sessions > 0 && counts.observations > 0 };
    results.push(result); console.log(JSON.stringify(result));
  }
} finally {
  await memory.dispose();
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ directory, results }, null, 2));
  console.log(`Evidência: ${directory}`);
}
