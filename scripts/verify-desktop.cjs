const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

module.exports = async function verifyDesktop(context) {
  const backend = path.join(context.appOutDir, 'resources', 'backend');
  const root = path.resolve(__dirname, '..');
  const asar = await import('@electron/asar');
  const archive = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!asar.extractFile(archive, 'assets/orquestra.ico').equals(fs.readFileSync(path.join(root, 'electron', 'assets', 'orquestra.ico')))) {
    throw new Error('Ícone da aplicação ausente ou desatualizado no pacote Electron.');
  }
  for (const name of ['main.cjs', 'preload.cjs', 'notifications.cjs']) {
    if (!asar.extractFile(archive, name).equals(fs.readFileSync(path.join(root, 'electron', name)))) {
      throw new Error(`Arquivo Electron ausente ou desatualizado: ${name}`);
    }
  }
  for (const name of ['server/terminals.mjs', 'server/cli-launcher.mjs', 'server/cli-process.mjs', 'server/native-capture.mjs', 'server/hermes-capture.py', 'server/memory.mjs', 'dist/index.html']) {
    if (!fs.readFileSync(path.join(backend, name)).equals(fs.readFileSync(path.join(root, name)))) {
      throw new Error(`Arquivo do backend ausente ou desatualizado: ${name}`);
    }
  }
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
  // OpenCode uses node-pty's bundled ConPTY. Validate its runtime companions,
  // not just the JavaScript/native-module import, before distributing a build.
  const ptyRoot = path.dirname(requireBackend.resolve('node-pty/package.json'));
  const nativeDirs = ['build/Release', 'prebuilds/win32-x64'].map(dir => path.join(ptyRoot, dir));
  if (!nativeDirs.some(dir => ['conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'].every(file => fs.existsSync(path.join(dir, file))))) {
    throw new Error('Runtime ConPTY do OpenCode incompleto no pacote (conpty.node, conpty.dll ou OpenConsole.exe ausente).');
  }
  execFileSync(path.join(backend, 'node.exe'), ['--input-type=module', '--eval',
    "await import('./server/terminals.mjs'); await import('./server/memory.mjs'); await import('./server/task-manager.mjs'); await import('./server/orchestration.mjs');",
  ], { cwd: backend, windowsHide: true, timeout: 10000, stdio: 'pipe' });
  console.log('Pacote verificado: Electron, preload, notificações, captura nativa, interface e dependências locais.');
};
