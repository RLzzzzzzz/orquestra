import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = path.join(root, '.desktop', 'backend');
if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error('Gere o desktop com Node.js 22+ x64 no Windows. O node.exe usado aqui será incluído no pacote.');
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Execute por npm.cmd run desktop:prepare.');
await fs.access(path.join(root, 'dist', 'index.html'));
// This is a disposable staging directory, never the user's .local data.
if (path.resolve(stage) !== path.resolve(root, '.desktop', 'backend')) throw new Error('Diretório de preparação inválido.');
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });
for (const name of ['server', 'dist', 'package.json', 'package-lock.json', 'THIRD_PARTY.md']) {
  await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true });
}
await fs.copyFile(process.execPath, path.join(stage, 'node.exe'));
// Preserve the license and third-party notices of the exact Node version shipped.
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(30000) });
if (!license.ok) throw new Error(`Não foi possível obter a licença do Node.js (${license.status}).`);
await fs.writeFile(path.join(stage, 'NODE-LICENSE.txt'), await license.text());

// Install separately so node-pty matches this Node, without changing the
// development node_modules or rebuilding anything against Electron.
await new Promise((resolve, reject) => {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`;
  const child = spawn(process.execPath, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, env, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Instalação do backend falhou (${code}).`)));
});
await fs.rm(path.join(stage, 'package-lock.json'));
const memoryDir = path.join(root, '.local', 'runtime', 'ai-memory');
const hasMemory = await fs.access(path.join(memoryDir, 'ai-memory.exe')).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (hasMemory) {
  const target = path.join(stage, 'runtime', 'ai-memory');
  await fs.mkdir(target, { recursive: true });
  for (const name of ['ai-memory.exe', 'LICENSE']) await fs.copyFile(path.join(memoryDir, name), path.join(target, name));
} else {
  console.warn('AI Memory não incluído. Execute npm.cmd run memory:install antes de empacotar para incluir a memória.');
}
// Keep Electron and backend version metadata in sync with the root manifest.
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const desktopFile = path.join(root, 'electron', 'package.json');
const desktop = JSON.parse(await fs.readFile(desktopFile, 'utf8'));
desktop.version = manifest.version;
await fs.writeFile(desktopFile, JSON.stringify(desktop, null, 2) + '\n');
console.log(`Backend preparado em ${stage}, com Node.js ${process.version} x64.`);
