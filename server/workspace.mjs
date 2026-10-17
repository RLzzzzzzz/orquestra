import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { saveJson } from './persistence.mjs';

export const providers = [
  { id: 'codex', name: 'Codex', command: 'codex', color: '#b6ed85', mark: '✳' },
  { id: 'claude', name: 'Claude Code', command: 'claude', color: '#e9a184', mark: '✺' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', color: '#93b8fb', mark: '✦' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', color: '#c7a4ed', mark: '◈' },
  { id: 'antigravity', name: 'Antigravity', command: 'agy', color: '#8ab4f8', mark: '△', note: 'CLI agy; não é o atalho do editor Antigravity.' },
  { id: 'freebuff', name: 'Freebuff', command: 'freebuff', color: '#f6a5d0', mark: '✧', note: 'Terminal interativo. Esta versão não oferece execução estruturada de tarefas.' },
  { id: 'hermes', name: 'Hermes', command: 'hermes', color: '#edb76b', mark: '☿', note: 'Requer Hermes CLI instalado e autenticado neste ambiente.' },
  { id: 'shell', name: 'Terminal', command: '', color: '#a9b1c1', mark: '>_' },
  { id: 'custom', name: 'Personalizado', command: '', color: '#e5cd87', mark: '⌘' },
];

export function textField(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`${label} inválido.`);
  }
  return value.trim();
}

export function directory(value) {
  const result = path.resolve(textField(value, 'Diretório', 4096));
  if (!fs.statSync(result, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Essa pasta não existe. Informe o caminho completo de uma pasta local.');
  }
  return result;
}

export function findCommand(command, env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter);
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), command + ext);
      if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
  }
  // Antigravity's Windows installer currently keeps its CLI outside PATH.
  // Keep this provider-specific fallback after PATH so a user-selected agy wins.
  const localBinaries = {
    agy: ['agy', 'bin', 'agy.exe'],
    // Hermes installs a command wrapper which sets up its bundled Python runtime.
    hermes: ['hermes', 'bin', 'hermes.cmd'],
  };
  const localBinary = platform === 'win32' && env.LOCALAPPDATA && localBinaries[command.toLowerCase()];
  if (localBinary) {
    const candidate = path.join(env.LOCALAPPDATA, ...localBinary);
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}

export function commandCanStart(command, env = process.env, platform = process.platform, starter = spawnSync) {
  const file = findCommand(command, env, platform);
  if (!file) return false;
  const isWindowsScript = platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  const executable = isWindowsScript ? (env.ComSpec || 'cmd.exe') : file;
  const args = isWindowsScript ? ['/d', '/c', `${file} --version`] : ['--version'];
  const result = starter(executable, args, {
    env,
    windowsHide: true,
    stdio: 'ignore',
    timeout: 15000,
  });
  return !result.error && !result.signal && result.status === 0;
}

export class Workspace {
  constructor(dataDir, cwd) {
    this.file = path.join(dataDir, 'workspace.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.state.projects) || !Array.isArray(this.state.agents)) {
        throw new Error('workspace.json inválido. Preserve o arquivo antes de restaurá-lo.');
      }
    } else {
      this.state = { projects: [{ id: randomUUID(), name: path.basename(cwd), cwd }], agents: [] };
      this.save();
    }
  }
  save() {
    saveJson(this.file, this.state);
  }
  addProject(input) {
    const project = { id: randomUUID(), name: textField(input.name, 'Nome'), cwd: directory(input.cwd) };
    this.state.projects.push(project);
    this.save();
    return project;
  }
  addAgent(input) {
    const project = this.state.projects.find(p => p.id === input.projectId);
    if (!project) throw new Error('Projeto não encontrado.');
    if (this.state.agents.length >= 48) throw new Error('Limite de 48 agentes cadastrados.');
    const provider = providers.find(p => p.id === input.provider);
    if (!provider) throw new Error('Tipo de agente inválido.');
    const agent = {
      id: randomUUID(), projectId: project.id, provider: provider.id,
      name: textField(input.name, 'Nome'),
      command: provider.id === 'custom' ? textField(input.command, 'Comando', 2000) : provider.command,
      cwd: directory(input.cwd || project.cwd),
      role: typeof input.role === 'string' ? input.role.slice(0, 200) : '',
    };
    this.state.agents.push(agent);
    this.save();
    return agent;
  }
  removeAgent(id) {
    this.state.agents = this.state.agents.filter(a => a.id !== id);
    this.save();
  }
}
