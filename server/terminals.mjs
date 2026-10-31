import * as pty from 'node-pty';
import { findCommand, directory } from './workspace.mjs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MAX_HISTORY = 256 * 1024;
export class Terminals {
  constructor(emit, memory = null) {
    this.sessions = new Map();
    this.emit = emit;
    this.memory = memory;
  }
  info(id) {
    const session = this.sessions.get(id);
    return session ? { sessionId: session.id, mcpReady: session.mcpReady === true, status: session.status, mode: session.mode, managed: session.managed === true, pid: session.pid, exitCode: session.exitCode, agentExitCode: session.agentExitCode, startedAt: session.startedAt } : { status: 'idle' };
  }
  start(agent, options = {}) {
    const previous = this.sessions.get(agent.id);
    if (previous?.status === 'running') {
      if (previous.mode !== 'fallback') return;
      this.stop(agent.id);
    }
    if ([...this.sessions.values()].filter(s => s.status === 'running').length >= 16) {
      throw new Error('Limite de 16 terminais simultâneos.');
    }
    directory(agent.cwd);
    let command = agent.command;
    if (!options.launch && !['shell', 'custom'].includes(agent.provider)) {
      const executable = findCommand(command);
      if (!executable) throw new Error(`${command} não foi encontrado no PATH. Instale o CLI e reinicie o Orquestra.`);
      // Launch npm's .cmd shim on Windows, avoiding PowerShell execution-policy issues.
      command = `"${executable}"`;
    }
    const windows = process.platform === 'win32';
    const executable = windows
      ? (agent.provider === 'shell' ? 'powershell.exe' : (process.env.ComSpec || 'cmd.exe'))
      : (process.env.SHELL || '/bin/bash');
    const args = agent.provider === 'shell'
      ? (windows ? ['-NoLogo', '-NoProfile'] : ['-i'])
      // cmd uses different quote rules than CommandLineToArgvW. Pass its command
      // line verbatim so quoted paths with spaces/accented characters survive.
      : (windows ? `/d /s /c "${command}"` : ['-lc', command]);
    const proc = pty.spawn(options.launch ? process.execPath : executable, options.launch ? [fileURLToPath(new URL('./cli-launcher.mjs', import.meta.url))] : args, {
      name: 'xterm-256color', cwd: options.launch?.cwd || agent.cwd, cols, rows,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...options.env, ...(options.launch && { ORQUESTRA_LAUNCH: JSON.stringify(options.launch) }) },
    });
    const session = { id: randomUUID(), proc, cols, rows, cwd: options.launch?.cwd || agent.cwd, status: 'running', managed: options.managed === true, mode: options.mode || (agent.provider === 'shell' ? 'shell' : 'agent'), pid: proc.pid, history: '', startedAt: Date.now() };
    this.sessions.set(agent.id, session);
    this.emit({ type: 'reset', id: agent.id, sessionId: session.id });
    this.attach(agent, session);
    this.emit({ type: 'changed' });
    const cols = previous?.cols || 100, rows = previous?.rows || 28;
  }
  attach(agent, session) {
    const proc = session.proc;
    proc.onData(data => {
      if (this.sessions.get(agent.id) !== session) return;
      session.history = (session.history + data).slice(-MAX_HISTORY);
      this.emit({ type: 'output', id: agent.id, sessionId: session.id, data });
    });
    proc.onExit(({ exitCode }) => {
      session.status = 'exited'; session.exitCode = exitCode;
      if (this.sessions.get(agent.id) !== session) return;
      if (['agent', 'coordinator'].includes(session.mode) && !session.intentionalStop) {
        this.fallback(agent, session, exitCode);
      } else this.emit({ type: 'changed' });
    });
  }
  fallback(agent, previous, exitCode) {
    const notice = `\r\n\x1b[33m[Orquestra] O comando do agente encerrou (saída ${exitCode}).\r\nShell disponível: você pode digitar comandos abaixo. Use "Reiniciar agente" para tentar novamente.\x1b[0m\r\n`;
    try {
      const windows = process.platform === 'win32';
      const proc = pty.spawn(windows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash'), windows ? ['/d', '/q'] : ['-i'], {
        name: 'xterm-256color', cwd: agent.cwd, cols: previous.cols || 100, rows: previous.rows || 28,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      const session = { id: randomUUID(), proc, cols: previous.cols || 100, rows: previous.rows || 28, cwd: agent.cwd, status: 'running', mode: 'fallback', pid: proc.pid, history: (previous.history + notice).slice(-MAX_HISTORY), agentExitCode: exitCode, startedAt: Date.now() };
      this.sessions.set(agent.id, session);
      this.attach(agent, session);
      // Publish the new identity before output, so clients do not discard it as stale.
      this.emit({ type: 'changed' });
      this.emit({ type: 'output', id: agent.id, sessionId: session.id, data: notice });
      return;
    } catch (error) {
      const data = `\r\n[Orquestra] Não foi possível abrir o shell: ${error.message}\r\n`;
      previous.history = (previous.history + data).slice(-MAX_HISTORY);
      this.emit({ type: 'output', id: agent.id, data });
    }
    this.emit({ type: 'changed' });
  }
  write(id, data, sessionId) {
    const session = this.sessions.get(id);
    if (session?.status !== 'running') throw new Error('O terminal não está em execução.');
    if (sessionId && session.id !== sessionId) throw new Error('A sessão do terminal mudou. Reconecte antes de enviar.');
    if (typeof data !== 'string' || data.length > 32768) throw new Error('Entrada muito longa.');
    session.proc.write(data);
  }
  async prompt(id, text, { submit = true, bracketed = false, limit = 16000, expectedSession, sessionId } = {}) {
    const session = this.sessions.get(id);
    if (session?.status !== 'running' || !['agent', 'coordinator'].includes(session.mode)) throw new Error('O agente não está ativo. O texto não foi enviado ao shell.');
    if (expectedSession && session !== expectedSession) throw new Error('A sessão mudou antes do envio.');
    if (sessionId && session.id !== sessionId) throw new Error('A sessão mudou antes do envio.');
    if (typeof text !== 'string' || !text.trim() || text.length > limit) throw new Error('Tarefa inválida ou muito longa.');
    if (session.sendingPrompt) throw new Error('Aguarde o envio anterior terminar.');
    session.sendingPrompt = true;
    try {
      const data = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
      // Pasted multiline text uses LF; CR belongs only to the final Enter key.
      const payload = bracketed ? data : data.replace(/\n/g, '\r');
      session.proc.write(bracketed ? `\x1b[200~${payload}\x1b[201~` : payload);
      if (submit) {
        await new Promise(resolve => setTimeout(resolve, bracketed ? 750 : 150));
        if (this.sessions.get(id) !== session || session.status !== 'running') throw new Error('O agente encerrou durante o envio. O shell não recebeu a tarefa.');
        session.proc.write('\r');
      }
    } finally { session.sendingPrompt = false; }
  }
  resize(id, cols, rows, sessionId) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 300) return;
    const session = this.sessions.get(id);
    if (sessionId && session?.id !== sessionId) return;
    if (session?.status !== 'running' || (session.cols === cols && session.rows === rows)) return;
    // Repeating an unchanged size forces some TUIs to redraw/reflow unnecessarily.
    // Only remember dimensions accepted by the PTY, so failed resizes can retry.
    session.proc.resize(cols, rows);
    session.cols = cols; session.rows = rows;
  }
  stop(id) {
    const session = this.sessions.get(id);
    if (session?.status === 'running') {
      session.intentionalStop = true;
      session.proc.kill();
      session.status = 'exited';
      this.emit({ type: 'changed' });
    }
  }
  dispose() { for (const id of this.sessions.keys()) this.stop(id); }
}
