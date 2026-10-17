import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { transformWithEsbuild } from 'vite';

const roots = ['server', 'scripts', 'tests', 'electron', 'src'];
let checked = 0;
async function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(mjs|cjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
      if (result.error || result.status !== 0) throw result.error || new Error(`Sintaxe inválida: ${file}`);
      checked++;
    } else if (file.endsWith('.jsx')) {
      await transformWithEsbuild(fs.readFileSync(file, 'utf8'), file, { loader: 'jsx', jsx: 'automatic' });
      checked++;
    }
  }
}
for (const root of roots) await walk(root);
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages[''];
for (const field of ['dependencies', 'devDependencies', 'engines']) {
  if (JSON.stringify(manifest[field]) !== JSON.stringify(lock[field])) throw new Error(`Lockfile divergente: ${field}`);
}
console.log(`Sintaxe verificada em ${checked} arquivos; manifesto e lockfile consistentes.`);
