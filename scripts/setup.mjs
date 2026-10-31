import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
// The MCP/config adapter uses the OpenCode 1 contract. Keep new installs on
// that major even if the package's latest tag changes to a newer generation.
export const cliPackages = Object.freeze({ codex: '@openai/codex', opencode: 'opencode-ai@1', gemini: '@google/gemini-cli' });
export function parseSetupArgs(args, root = repository, env = process.env) {
  const options = { root, projectDir: root, dataDir: path.resolve(env.ORQUESTRA_DATA_DIR || path.join(root, '.local')), installClis: [], skipMemory: false, check: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--help', '-h'].includes(arg)) options.help = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--skip-memory') options.skipMemory = true;
    else if (['--project-dir', '--data-dir', '--install-clis'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Informe um valor para ${arg}.`);
      if (arg === '--project-dir') options.projectDir = path.resolve(value);
      else if (arg === '--data-dir') options.dataDir = path.resolve(value);
      else {
        options.installClis = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];
        if (!options.installClis.length || options.installClis.some(id => !Object.hasOwn(cliPackages, id))) throw new Error('CLIs instaláveis: codex, opencode, gemini. Separe por vírgulas.');
      }
    } else throw new Error(`Opção desconhecida: ${arg}. Use --help.`);
  }
  if (options.check && options.installClis.length) throw new Error('--check é somente leitura; remova --install-clis.');
  return options;
}

export function dependenciesPresent(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).every(name => fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
}

export function serviceRunning(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = running => { socket.destroy(); resolve(running); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(true));
  });
}

export function configureWorkspace(Workspace, dataDir, projectDir, available) {
  const workspace = new Workspace(dataDir, projectDir);
  const canonical = value => {
    const real = fs.realpathSync(value);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  const target = canonical(projectDir);
  const project = workspace.state.projects.find(p => {
    try { return canonical(p.cwd) === target; } catch { return false; }
  });
  const missing = available.filter(provider => !project || !workspace.state.agents.some(a => a.projectId === project.id && a.provider === provider.id && !a.coordinator));
  if (workspace.state.agents.length + missing.length > 48) throw new Error('O cadastro excederia o limite de 48 agentes. Remova agentes antigos pela interface e tente novamente.');
  const selected = project || workspace.addProject({ name: path.basename(projectDir) || 'Projeto', cwd: projectDir });
  const added = missing.map(provider => workspace.addAgent({ projectId: selected.id, provider: provider.id, name: provider.name, cwd: projectDir }));
  return { project: selected, added };
}

function run(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Comando falhou (${code}): ${path.basename(file)} ${args[0] || ''}`)));
  });
}

export async function setup(options, hooks = {}) {
  const env = hooks.env || process.env;
  const log = hooks.log || console.log;
  const execute = hooks.run || run;
  if (Number((hooks.nodeVersion || process.versions.node).split('.')[0]) < 22) throw new Error('Instale Node.js 22 ou superior antes de configurar o Orquestra.');
  if (!fs.statSync(options.projectDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('A pasta --project-dir não existe.');
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve estar entre 1 e 65535.');
  if (!options.check && await (hooks.serviceRunning || serviceRunning)(port)) throw new Error(`Feche o Orquestra/servidor na porta ${port} antes do setup. Para diagnóstico sem alterar dados, use npm.cmd run setup -- --check.`);
  const npm = async args => {
    if (!env.npm_execpath || !fs.existsSync(env.npm_execpath)) throw new Error('Execute o configurador por npm.cmd run setup para localizar o npm com segurança.');
    await execute(process.execPath, [env.npm_execpath, ...args], { cwd: options.root, env });
  };
  const deps = (hooks.dependenciesPresent || dependenciesPresent)(options.root);
  if (!deps && options.check) {
    log('Dependências ausentes. Execute npm.cmd run setup para instalar e concluir o diagnóstico dos CLIs.');
    return { ready: false, dependencies: false };
  }
  if (!deps) { log('Instalando dependências do Orquestra pelo lockfile…'); await npm(['ci', '--no-audit', '--no-fund']); }
  else log('Dependências já instaladas; mantendo a instalação atual.');
  const { Workspace, providers, findCommand } = await (hooks.loadWorkspace || (() => import('../server/workspace.mjs')))();
  for (const id of options.installClis) {
    const provider = providers.find(p => p.id === id);
    if (findCommand(provider.command, env)) log(`${provider.name}: já instalado; nenhuma reinstalação.`);
    else { log(`Instalando ${provider.name} (${cliPackages[id]})…`); await npm(['install', '--global', cliPackages[id], '--no-audit', '--no-fund']); }
  }
  const available = providers.filter(p => !['shell', 'custom'].includes(p.id) && findCommand(p.command, env));
  const git = findCommand('git', env);
  const memory = env.ORQUESTRA_MEMORY_BIN || path.join(options.dataDir, 'runtime', 'ai-memory', process.platform === 'win32' ? 'ai-memory.exe' : 'ai-memory');
  log(`CLIs detectados: ${available.map(p => p.name).join(', ') || 'nenhum'}. Detecção não confirma login nem acesso ao modelo.`);
  if (options.check) {
    log(`Git: ${git ? 'encontrado' : 'ausente'}; AI Memory: ${fs.existsSync(memory) ? 'encontrado' : 'ausente'}; interface: ${fs.existsSync(path.join(options.root, 'dist/index.html')) ? 'compilada' : 'ausente'}.`);
    return { ready: !!git && fs.existsSync(memory) && fs.existsSync(path.join(options.root, 'dist/index.html')), dependencies: true, providers: available.map(p => p.id) };
  }
  if (!options.skipMemory) {
    if (!git) throw new Error('Git não foi encontrado no PATH. Instale Git for Windows, reabra o terminal e repita o setup; ou use --skip-memory para preparar sem memória.');
    if (env.ORQUESTRA_MEMORY_BIN && !fs.statSync(memory, { throwIfNoEntry: false })?.isFile()) throw new Error('ORQUESTRA_MEMORY_BIN aponta para um arquivo inexistente. Corrija a variável ou remova-a para usar o instalador.');
    if (!fs.existsSync(memory)) {
      log('Preparando AI Memory oficial e verificando SHA-256…');
      await execute(process.execPath, [path.join(options.root, 'scripts/install-memory.mjs')], { cwd: options.root, env: { ...env, ORQUESTRA_MEMORY_INSTALL_DIR: path.dirname(memory) } });
      if (!fs.statSync(memory, { throwIfNoEntry: false })?.isFile()) throw new Error('O instalador não produziu o executável AI Memory esperado.');
    } else log('AI Memory encontrado; preservando instalação e dados.');
  } else log('AI Memory ignorado por --skip-memory. Notas/captura exigem configuração posterior.');
  log('Compilando a interface…');
  await npm(['run', 'build']);
  const result = configureWorkspace(Workspace, options.dataDir, options.projectDir, available);
  log(`Projeto: ${result.project.name}. ${result.added.length} novo(s) agente(s); os cadastros e logins existentes foram preservados.`);
  log(`Dados: ${options.dataDir}`);
  if (!available.length) log('Instale um CLI e autentique sua conta; depois repita o setup para cadastrá-lo.');
  for (const id of options.installClis) if (!available.some(p => p.id === id)) log(`Atenção: ${id} continua fora do PATH. Reabra o terminal após ajustar o PATH e repita o setup.`);
  log('Configuração concluída. Abra com npm.cmd start e acesse http://127.0.0.1:' + port + '.');
  log('O login de cada CLI e as aprovações de confiança são feitos por você. O MCP/hooks serão preparados ao abrir novas sessões pelo aplicativo.');
  if (options.dataDir !== path.join(options.root, '.local')) log('Para iniciar, mantenha ORQUESTRA_DATA_DIR apontando para a pasta de dados acima; --data-dir não altera o ambiente do seu terminal.');
  return { ready: true, dependencies: true, providers: available.map(p => p.id), ...result };
}

const help = `Configuração do Orquestra (execute com o serviço fechado)
  npm.cmd run setup
  npm.cmd run setup -- --install-clis codex,opencode,gemini
  npm.cmd run setup -- --project-dir "C:\\Projetos\\Meu projeto"

Opções:
  --install-clis LISTA  Instala somente CLIs ausentes da lista codex,opencode,gemini.
  --project-dir PASTA   Projeto a cadastrar (padrão: pasta do Orquestra).
  --data-dir PASTA      Dados a configurar (padrão: ORQUESTRA_DATA_DIR ou .local).
  --skip-memory        Prepara sem instalar/verificar o AI Memory.
  --check              Diagnóstico somente leitura, sem login nem chamadas a modelos.
  --help               Exibe este guia.

Repetir o setup não duplica agentes/projetos e não altera autenticações.
Instalação de CLIs só ocorre com --install-clis; OAuth/login continua manual.`;
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseSetupArgs(process.argv.slice(2));
    if (options.help) console.log(help);
    else { const report = await setup(options); if (options.check && !report.ready) process.exitCode = 1; }
  } catch (error) { console.error(`Setup: ${error.message}`); process.exitCode = 1; }
}
