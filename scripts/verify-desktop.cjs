const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

module.exports = async function verifyDesktop(context) {
  const backend = path.join(context.appOutDir, 'resources', 'backend');
  const modules = path.join(backend, 'node_modules') + path.sep;
  const requireBackend = createRequire(path.join(backend, 'package.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(backend, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies)) {
    if (!fs.existsSync(path.join(modules, name, 'package.json'))) {
      throw new Error(`Dependência ausente do backend empacotado: ${name}`);
    }
  }
  for (const name of ['ws', 'node-pty', 'cross-spawn', 'zod', '@modelcontextprotocol/sdk/client/index.js', '@modelcontextprotocol/sdk/server/index.js']) {
    const resolved = requireBackend.resolve(name);
    if (!resolved.toLowerCase().startsWith(modules.toLowerCase())) {
      throw new Error(`Dependência resolvida fora do pacote: ${name}: ${resolved}`);
    }
  }
  execFileSync(path.join(backend, 'node.exe'), ['--input-type=module', '--eval',
    "await import('./server/terminals.mjs'); await import('./server/memory.mjs'); await import('./server/task-manager.mjs'); await import('./server/orchestration.mjs');",
  ], { cwd: backend, windowsHide: true, timeout: 10000, stdio: 'pipe' });
  console.log('Backend empacotado: dependências locais e imports verificados.');
};
