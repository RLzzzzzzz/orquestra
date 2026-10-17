import fs from 'node:fs';
import { spawn } from 'node:child_process';

const suite = process.argv[2] || 'all';
const groups = {
  unit: ['workspace', 'folder-picker', 'coordinator', 'live-tasks', 'memory', 'native-capture', 'desktop-notifications', 'cli-adapters', 'cli-process', 'ui-events'],
  integration: ['server', 'worktrees'],
  regression: ['orchestration', 'reviews', 'core'],
};
if (suite !== 'all' && !groups[suite]) throw new Error(`Suíte desconhecida: ${suite}`);
const discovered = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs')).sort();
const unassigned = discovered.filter(f => !Object.values(groups).flat().includes(f.slice(0, -9)));
if (unassigned.length) throw new Error(`Classifique os novos testes em scripts/test.mjs: ${unassigned.join(', ')}`);
const files = discovered.filter(f => suite === 'all' || groups[suite].includes(f.slice(0, -9))).map(f => `tests/${f}`);
if (!files.length) throw new Error(`Suíte sem testes: ${suite}`);
const coverage = process.argv.includes('--coverage');
if (coverage) fs.mkdirSync('coverage', { recursive: true });
const args = ['--test', ...(coverage ? ['--experimental-test-coverage', '--test-coverage-include=server/**', '--test-reporter=spec', '--test-reporter=lcov', '--test-reporter-destination=stdout', `--test-reporter-destination=coverage/${suite}.lcov`] : []), ...files];
const env = { ...process.env, ORQUESTRA_MEMORY_BIN: `${process.cwd()}/tests/fixtures/memory-not-installed` };
// Tests use fixtures, never the user's installed AI Memory or account sessions.
delete env.ORQUESTRA_MCP_TOKEN;
delete env.ORQUESTRA_MCP_URL;
const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
