import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { BookOpen, Plus, Folder, FolderOpen, ChevronDown, ChevronRight, Terminal, LayoutGrid, Columns2, Square, Play, SquareArrowOutUpRight, X, Settings2, ArrowUpRight, Send, Radio, PanelRightClose, PanelRightOpen, CircleHelp, Activity, Command, Maximize2, Minimize2, RotateCcw, Trash2, Download, Check, PanelLeftClose, PanelLeftOpen, Network, Keyboard, Palette, ListTodo } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { GripVertical } from 'lucide-react';
import './style.css';
import OrchestrationPanel from './Orchestration.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import TaskBoard from './TaskBoard.jsx';
import { Bell, Copy, Eye, AlertCircle } from 'lucide-react';
import { snapshotEvents, sessionDraft, filterActivity } from './ui-events.mjs';
import { createTerminalSizer } from './terminal-sizing.mjs';

const providerMeta = {
  codex: { name: 'Codex', color: '#b6ed85', mark: '✳' },
  claude: { name: 'Claude Code', color: '#e9a184', mark: '✺' },
  gemini: { name: 'Gemini CLI', color: '#93b8fb', mark: '✦' },
  opencode: { name: 'OpenCode', color: '#c7a4ed', mark: '◈' },
  antigravity: { name: 'Antigravity', color: '#8ab4f8', mark: '△' },
  freebuff: { name: 'Freebuff', color: '#f6a5d0', mark: '✧' },
  hermes: { name: 'Hermes', color: '#edb76b', mark: '☿' },
  shell: { name: 'Terminal', color: '#a9b1c1', mark: '>_' },
  custom: { name: 'Personalizado', color: '#e5cd87', mark: '⌘' },
};
const colorThemes = {
  // OpenCode TUI dark palette: anomalyco/opencode, theme/assets/opencode.json.
  opencode: { name: 'OpenCode', swatch: '#fab283', terminal: { background: '#0a0a0a', foreground: '#eeeeee', cursor: '#fab283', cursorAccent: '#0a0a0a', selectionBackground: '#3c3c3c', black: '#141414', red: '#e06c75', green: '#7fd88f', yellow: '#e5c07b', blue: '#5c9cf5', magenta: '#9d7cd8', cyan: '#56b6c2', white: '#eeeeee', brightBlack: '#808080', brightRed: '#ef8a92', brightGreen: '#a1e6ad', brightYellow: '#f0d799', brightBlue: '#8bb9ff', brightMagenta: '#bda1ef', brightCyan: '#81cdd5', brightWhite: '#ffffff' } },
  orquestra: { name: 'Orquestra', swatch: '#b6ed85', terminal: { background: '#141518', foreground: '#e0e2e7', cursor: '#b6ed85', cursorAccent: '#141518', selectionBackground: '#40513e', black: '#24262c', red: '#ef8585', green: '#b6ed85', yellow: '#e7cd8a', blue: '#96b4f4', magenta: '#c7a4ed', cyan: '#89d3d2', white: '#e1e4e9', brightBlack: '#858c99', brightRed: '#ffa1a1', brightGreen: '#c9f5a3', brightYellow: '#f6dfa0', brightBlue: '#b3caff', brightMagenta: '#ddbeff', brightCyan: '#a5edeb', brightWhite: '#ffffff' } },
  dracula: { name: 'Dracula', swatch: '#bd93f9', terminal: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2' } },
  nord: { name: 'Nord', swatch: '#88c0d0', terminal: { background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', selectionBackground: '#4c566a', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#eceff4' } },
  monokai: { name: 'Monokai', swatch: '#a6e22e', terminal: { background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#49483e', black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2' } },
  tokyo: { name: 'Tokyo Night', swatch: '#7aa2f7', terminal: { background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c', black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5' } },
};
const buffers = new Map();
const liveTerms = new Map();
const terminalSizers = new Map();
const terminalActivity = new Map();
const terminalSessions = new Map();
const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const statusLabel = a => a.status === 'running' ? (a.mode === 'fallback' ? 'Shell disponível · agente saiu' : 'Em execução') : a.status === 'exited' ? 'Encerrado' : 'Pronto para iniciar';
const canReceiveTask = a => !a.taskId && a.status === 'running' && a.provider !== 'shell' && a.mode !== 'fallback';
async function api(url, method = 'GET', data) {
  const response = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data !== undefined && { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a ação.');
  return result;
}
function Button({ icon: Icon, children, className = '', ...props }) {
  return <button className={`button ${className}`} {...props}>{Icon && <Icon size={15} />}{children}</button>;
}
function IconButton({ icon: Icon, label, ...props }) { return <button type="button" className="icon-button" title={label} aria-label={label} {...props}><Icon size={15} /></button>; }
function Mark({ provider, small = false }) {
  const meta = providerMeta[provider] || providerMeta.custom;
  return <span className={`provider-mark ${small ? 'small' : ''}`} style={{ '--provider': meta.color }}>{meta.mark}</span>;
}
function Modal({ title, subtitle, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="Fechar janela" onClick={onClose} /></div>{children}
  </dialog>;
}
function TerminalPane({ agent, send, onAction, focused, onFocus, fontSize, terminalTheme, hidden, connected, draggingId, dropTargetId, onDragBegin, onDragTarget, onDragFinish, onSwap, onMove }) {
  const paneRef = useRef(null);
  const dragRef = useRef(null);
  const [paneSize, setPaneSize] = useState(() => readLocal(`pane-size:${agent.id}`, null));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [inputError, setInputError] = useState('');
  const [receiving, setReceiving] = useState(false);
  const canCompose = connected && agent.status === 'running' && ['agent', 'coordinator'].includes(agent.mode) && !agent.taskId;
  useEffect(() => {
    let timer;
    terminalActivity.set(agent.id, () => {
      setReceiving(true); clearTimeout(timer);
      timer = setTimeout(() => setReceiving(false), 650);
    });
    return () => { clearTimeout(timer); terminalActivity.delete(agent.id); };
  }, [agent.id]);
  useEffect(() => { setInputError(''); setReceiving(false); }, [agent.sessionId]);
  const submitDraft = async event => {
    event.preventDefault();
    if (!canCompose || sending || !draft.trim()) return;
    const submitted = draft;
    setSending(true); setInputError('');
    try {
      await api(`/agents/${agent.id}/prompt`, 'POST', { text: submitted, submit: true, bracketed: true, sessionId: agent.sessionId });
      setDraft(current => current === submitted ? '' : current);
    } catch (error) { setInputError(error.message); }
    finally { setSending(false); }
  };
  const container = useRef(null);
  const termRef = useRef(null);
  const sizingRef = useRef(null);
  const meta = providerMeta[agent.provider];
  useEffect(() => {
    localStorage.setItem(`pane-size:${agent.id}`, JSON.stringify(paneSize));
  }, [agent.id, paneSize]);
  const applySize = (width, height) => {
    const available = paneRef.current.parentElement.clientWidth;
    setPaneSize({ width: Math.round(Math.max(Math.min(320, available), Math.min(available, width))), height: Math.round(Math.max(430, Math.min(2000, height))) });
  };
  const beginResize = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = paneRef.current.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, scrollTop: paneRef.current.parentElement.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizePane = event => {
    const drag = dragRef.current;
    if (!drag) return;
    applySize(drag.width + event.clientX - drag.x, drag.height + event.clientY - drag.y + paneRef.current.parentElement.scrollTop - drag.scrollTop);
  };
  const finishResize = event => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true, cursorStyle: 'bar', fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, monospace', fontSize,
      lineHeight: 1.35, fontWeight: '400', fontWeightBold: '600', scrollback: 6000, allowProposedApi: false,
      theme: terminalTheme,
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current);
    termRef.current = term; liveTerms.set(agent.id, term);
    term.write(buffers.get(agent.id) || '');
    const sizing = createTerminalSizer({ terminal: term, fit, element: container.current,
      onResize: dimensions => send({ type: 'resize', id: agent.id, ...dimensions }) });
    sizingRef.current = sizing; terminalSizers.set(agent.id, sizing);
    const resize = () => sizing.schedule();
    const repaint = () => sizing.schedule({ force: true });
    const observer = new ResizeObserver(resize); observer.observe(container.current);
    window.addEventListener('resize', resize);
    const onVisibility = () => { if (!document.hidden) repaint(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.fonts?.addEventListener('loadingdone', repaint);
    document.fonts?.ready.then(() => sizing.schedule({ force: true }));
    const input = term.onData(data => send({ type: 'input', id: agent.id, data }));
    repaint();
    return () => {
      observer.disconnect(); sizing.dispose(); input.dispose();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.fonts?.removeEventListener('loadingdone', repaint);
      terminalSizers.delete(agent.id); sizingRef.current = null;
      liveTerms.delete(agent.id); term.dispose();
    };
  }, [agent.id, send]);
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    sizingRef.current?.schedule({ force: true });
  }, [fontSize, agent.id, send]);
  useEffect(() => {
    if (!hidden) sizingRef.current?.schedule({ force: true });
  }, [hidden, focused, agent.sessionId, connected]);
  useEffect(() => { if (termRef.current) termRef.current.options.theme = terminalTheme; }, [terminalTheme]);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = !connected || agent.status !== 'running';
    if (connected && agent.status === 'running' && !hidden) term.focus();
  }, [connected, agent.status, agent.mode, hidden]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([buffers.get(agent.id) || ''], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${agent.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.txt`; a.click(); URL.revokeObjectURL(url);
  };
  return <section ref={paneRef} className={`terminal-pane ${receiving ? 'receiving-output' : ''} ${focused ? 'focused' : ''} ${draggingId === agent.id ? 'pane-dragging' : ''} ${dropTargetId === agent.id ? 'pane-drop-target' : ''}`} style={{ '--provider': meta.color, '--terminal-bg': terminalTheme.background, display: hidden ? 'none' : undefined, ...(!focused && paneSize && { width: paneSize.width, height: paneSize.height }) }} aria-label={`Terminal de ${agent.name}`}
    onDragOver={event => {
      if (!draggingId || draggingId === agent.id || focused) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; onDragTarget(agent.id);
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) onDragTarget(null); }}
    onDrop={event => {
      if (!draggingId || focused) return;
      event.preventDefault(); onSwap(draggingId, agent.id); onDragFinish();
    }}>
    <header className="pane-heading">
      {!focused && <button type="button" className="pane-move-handle" draggable aria-label={`Mover terminal de ${agent.name}`} title="Arraste sobre outro terminal para trocar de lugar. Use as setas para mover pelo teclado."
        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', agent.id); event.dataTransfer.setDragImage(paneRef.current, 25, 18); onDragBegin(agent.id); }}
        onDragEnd={onDragFinish}
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); onMove(agent.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
          }
        }}><GripVertical size={15} /></button>}
      <Mark provider={agent.provider} small /><strong>{agent.name}</strong><span className="pane-provider">{agent.coordinator ? 'Coordenador' : meta.name}</span>
      <span className={`status-dot ${agent.status}`} title={statusLabel(agent)} />
      <div className="pane-actions">
        {agent.mode === 'fallback' && <IconButton icon={RotateCcw} label={`Reiniciar agente ${agent.name}`} disabled={!connected} onClick={() => onAction(agent, 'start')} />}
        {agent.status === 'running' ? <IconButton icon={Square} label={`Encerrar ${agent.name}`} disabled={!connected} onClick={() => onAction(agent, 'stop')} /> : <IconButton icon={Play} label={`Iniciar ${agent.name}`} disabled={!connected} onClick={() => onAction(agent, 'start')} />}
        <IconButton icon={Download} label={`Exportar saída de ${agent.name}`} onClick={download} />
        <IconButton icon={focused ? Minimize2 : Maximize2} label={focused ? 'Sair do foco' : `Focar ${agent.name}`} onClick={onFocus} />
      </div>
    </header>
    {agent.taskId && <div className="terminal-notice task-live-notice"><span>Coordenador delegou: {agent.taskTitle}</span><button onClick={() => onAction(agent, 'cancel-task')}>Cancelar tarefa</button></div>}
    {agent.mode === 'fallback' && agent.status === 'running' && <div className="terminal-notice"><span>O agente saiu (código {agent.agentExitCode}). Shell liberado para digitar.</span><button disabled={!connected} onClick={() => onAction(agent, 'start')}>Reiniciar agente</button></div>}
    {agent.status === 'exited' && <div className="terminal-notice"><span>Este processo encerrou. Reinicie para voltar a digitar.</span><button disabled={!connected} onClick={() => onAction(agent, 'start')}>Reabrir terminal</button></div>}
    <div className="terminal-body" onPointerDown={() => termRef.current?.focus()}><div className="xterm-container" ref={container} />
      {agent.status === 'idle' && <div className="terminal-placeholder"><Mark provider={agent.provider} /><h3>{agent.name}</h3><p>{agent.role || 'Seu próximo agente começa aqui.'}</p><code>{agent.command || 'powershell'}</code><Button icon={Play} className="primary" disabled={!connected} onClick={() => onAction(agent, 'start')}>Iniciar terminal</Button></div>}
    </div>
    <form className="terminal-composer" onSubmit={submitDraft} aria-label={`Mensagem para ${agent.name}`}>
      <div className="composer-topline"><span>{agent.mode === 'coordinator' ? 'Coordenador' : 'Terminal'} <b>{meta.name}</b></span><span className={`terminal-stream-status ${receiving ? 'active' : ''}`}><i aria-hidden="true"><i /><i /><i /><i /></i>{receiving ? 'Recebendo saída' : agent.taskId ? 'Tarefa delegada' : canCompose ? 'Pronto' : 'Entrada pelo terminal'}</span></div>
      <textarea aria-label={`Escrever para ${agent.name}`} placeholder={canCompose ? `O que vamos construir com ${meta.name}?` : agent.taskId ? 'O coordenador está usando esta sessão.' : 'Use a entrada nativa do terminal acima.'} value={draft} maxLength={16000} rows={2} disabled={!canCompose || sending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} />
      <div className="composer-bottomline"><small>enter <span>enviar</span> <span className="composer-divider">/</span> shift + enter <span>nova linha</span></small><button type="submit" disabled={!canCompose || sending || !draft.trim()} aria-label={`Enviar mensagem para ${agent.name}`}><Send size={14} />{sending ? 'Enviando…' : 'Enviar'}</button></div>
      {inputError && <p className="composer-error" role="alert">{inputError}</p>}
    </form>
    <footer className="pane-footer"><span title={agent.cwd}><Folder size={11} />{agent.cwd}</span><span>{agent.status === 'running' ? `${agent.mode === 'fallback' ? 'Shell' : 'Terminal'} · PID ${agent.pid}` : agent.status === 'exited' ? `Encerrado${agent.exitCode !== undefined ? ` · saída ${agent.exitCode}` : ''}` : 'Não iniciado'}</span></footer>
    {!focused && <button type="button" className="pane-resize-handle" aria-label={`Redimensionar terminal de ${agent.name}`} title="Arraste para ajustar largura e altura. Clique duas vezes para restaurar. Setas ajustam; Home restaura."
      onPointerDown={beginResize} onPointerMove={resizePane} onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={() => { dragRef.current = null; }}
      onDoubleClick={() => setPaneSize(null)} onKeyDown={event => {
        if (event.key === 'Home') { event.preventDefault(); setPaneSize(null); return; }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const rect = paneRef.current.getBoundingClientRect();
        const step = event.shiftKey ? 50 : 10;
        applySize(rect.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), rect.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
      }}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M8 12l4-4M12 12h.01" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>}
  </section>;
}
function ActivityEntry({ event }) {
  const [detail, setDetail] = useState('');
  const load = async e => {
    if (!e.currentTarget.open) return;
    try {
      if (event.taskId) { const task = await api(`/tasks/${event.taskId}`); setDetail([task.prompt, task.output, task.result, task.error].filter(Boolean).join('\n\n')); }
      else if (event.agentId && (!event.sessionId || terminalSessions.get(event.agentId) === event.sessionId)) setDetail(buffers.get(event.agentId) || 'Sem saída disponível nesta página.');
      else setDetail('A sessão já mudou. A saída antiga não está mais no buffer desta página.');
    } catch (error) { setDetail(error.message); }
  };
  return <article className={`activity-row event-${event.kind || 'state'}`}><span className="activity-icon">{event.kind === 'error' ? <AlertCircle size={14} /> : event.kind === 'delegation' ? <Network size={14} /> : <Terminal size={14} />}</span><div className="activity-content"><p>{event.message}</p>{event.detail && <small>{event.detail}</small>}{event.sessionId && <small>Sessão {event.sessionId.slice(0, 8)}</small>}{(event.taskId || event.kind === 'output') && <details onToggle={load}><summary>{event.taskId ? 'Ver mensagens, saída e resultado' : 'Ver saída recente da sessão'}</summary><pre>{detail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-8000) || 'Carregando…'}</pre></details>}</div><time dateTime={new Date(event.time).toISOString()}>{new Date(event.time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></article>;
}
function App() {
  const [state, setState] = useState({ projects: [], agents: [] });
  const [providers, setProviders] = useState([]);
  const [projectId, setProjectId] = useState(() => readLocal('project', null));
  const [connected, setConnected] = useState(false);
  const [layout, setLayout] = useState(() => readLocal('layout', 'grid'));
  const [focus, setFocus] = useState(null);
  const [paneOrders, setPaneOrders] = useState(() => readLocal('pane-orders', {}));
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 650);
  const [taskPanel, setTaskPanel] = useState(() => window.innerWidth > 980);
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState(() => readLocal('notifications', []).slice(0, 50));
  const [nativeNotices, setNativeNotices] = useState(() => readLocal('native-notices', false));
  const [contextMenu, setContextMenu] = useState(null);
  const [hiddenSessions, setHiddenSessions] = useState(() => readLocal('hidden-sessions', []));
  const [activityAgent, setActivityAgent] = useState('');
  const [activityKind, setActivityKind] = useState('');
  const [view, setView] = useState('terminals');
  const [fontSize, setFontSize] = useState(() => readLocal('fontSize', 14));
  const [colorTheme, setColorTheme] = useState(() => readLocal('opencode-style-version', 0) < 1 ? 'opencode' : readLocal('colorTheme', 'opencode'));
  const [task, setTask] = useState('');
  const [targets, setTargets] = useState([]);
  const [submitTask, setSubmitTask] = useState(true);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState(() => readLocal('events', []));
  const wsRef = useRef(null);
  const previousSnapshot = useRef(null), seenNotices = useRef(new Map()), outputTicks = useRef(new Map()), intentionalStops = useRef(new Set());
  const nativeRef = useRef(nativeNotices), projectRef = useRef(projectId);
  nativeRef.current = nativeNotices; projectRef.current = projectId;
  const log = useCallback((message, meta = {}) => setEvents(prev => [{ id: crypto.randomUUID(), message, time: Date.now(), projectId: projectRef.current, kind: 'state', ...meta }, ...prev].slice(0, 200)), []);
  const notify = useCallback((message, error = false, meta = {}) => {
    const now = Date.now(), key = meta.key || `${error}:${message}`;
    if (now - (seenNotices.current.get(key) || 0) < 30000) return;
    seenNotices.current.set(key, now);
    if (seenNotices.current.size > 500) seenNotices.current.delete(seenNotices.current.keys().next().value);
    const notice = { ...meta, id: crypto.randomUUID(), message, error, time: now, read: false };
    setToasts(items => [...items, notice].slice(-3));
    setNotifications(items => [notice, ...items].slice(0, 50));
    if (meta.native && nativeRef.current && window.orquestraDesktop?.notify) {
      window.orquestraDesktop.notify({ body: message, key: key.slice(0, 256) }).catch(() => { /* Toast and history remain available. */ });
    } else if (meta.native && nativeRef.current && (!document.hasFocus() || document.hidden) && 'Notification' in window && Notification.permission === 'granted') {
      try { const system = new Notification('Orquestra', { body: message, tag: key, silent: true }); system.onclick = () => { window.focus(); system.close(); }; setTimeout(() => system.close(), 10000); } catch { /* Toast remains available. */ }
    }
  }, []);
  const send = useCallback(message => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ ...message, ...(message.id && { sessionId: terminalSessions.get(message.id) }) })); }, []);
  useEffect(() => {
    let disposed = false, timer, disconnectTimer, opened = false;
    const connect = async () => {
      try { await fetch('/'); } catch { /* retry below */ }
      if (disposed) return;
      const ws = new WebSocket(`ws://${location.host}/ws`); wsRef.current = ws;
      ws.onopen = () => {
        if (disposed) return ws.close();
        setConnected(true);
        clearTimeout(disconnectTimer); disconnectTimer = undefined;
        if (opened) { notify('Conexão com o serviço restabelecida.', false, { key: 'connection:online', native: true }); log('Serviço reconectado', { kind: 'state' }); }
        opened = true;
        api('/providers').then(setProviders).catch(e => notify(e.message, true));
      };
      ws.onmessage = ({ data }) => {
        const event = JSON.parse(data);
        if (event.type === 'state') {
          const changes = snapshotEvents(previousSnapshot.current, event);
          const taskErrors = new Set(changes.filter(item => item.taskId && item.error).map(item => item.agentId));
          for (const item of changes) {
            log(item.message, item);
            if (item.kind !== 'state' && !intentionalStops.current.has(item.agentId) && (item.taskId || !taskErrors.has(item.agentId))) notify(item.message, item.error, item);
          }
          previousSnapshot.current = event;
          for (const a of event.agents) terminalSessions.set(a.id, a.sessionId);
          setState(event);
        }
        if (event.type === 'output' || event.type === 'replay') {
          if (event.sessionId && terminalSessions.get(event.id) && event.sessionId !== terminalSessions.get(event.id)) return;
          const term = liveTerms.get(event.id);
          if (event.type === 'replay') { buffers.set(event.id, ''); term?.reset(); }
          buffers.set(event.id, ((buffers.get(event.id) || '') + event.data).slice(-262144));
          term?.write(event.data);
          if (event.type === 'output') terminalActivity.get(event.id)?.();
          if (event.type === 'output' && Date.now() - (outputTicks.current.get(event.id) || 0) > 5000) {
            outputTicks.current.set(event.id, Date.now());
            const a = previousSnapshot.current?.agents.find(a => a.id === event.id);
            if (a) log(`${a.name} · saída recebida`, { kind: 'output', agentId: a.id, projectId: a.projectId, sessionId: event.sessionId });
          }
          if (event.type === 'replay' && term) terminalSizers.get(event.id)?.schedule({ force: true });
        }
        if (event.type === 'reset') {
          terminalSessions.set(event.id, event.sessionId);
          buffers.set(event.id, ''); const term = liveTerms.get(event.id); term?.reset();
          if (term) terminalSizers.get(event.id)?.schedule({ force: true });
        }
        if (event.type === 'error') { notify(event.message, true); log(event.message, { kind: 'error' }); }
      };
      ws.onclose = () => { if (disposed) return; setConnected(false); if (!disconnectTimer && opened) disconnectTimer = setTimeout(() => { notify('Serviço desconectado. Reconectando automaticamente…', true, { key: 'connection:offline', native: true }); log('Serviço desconectado', { kind: 'error' }); }, 2500); timer = setTimeout(connect, 1800); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(disconnectTimer); wsRef.current?.close(); };
  }, [notify, send, log]);
  useEffect(() => { if (state.projects.length && !state.projects.some(p => p.id === projectId)) setProjectId(state.projects[0].id); }, [state.projects, projectId]);
  useEffect(() => { localStorage.setItem('project', JSON.stringify(projectId)); setTargets([]); setFocus(null); setActivityAgent(''); }, [projectId]);
  useEffect(() => localStorage.setItem('layout', JSON.stringify(layout)), [layout]);
  useEffect(() => localStorage.setItem('fontSize', JSON.stringify(fontSize)), [fontSize]);
  useEffect(() => { localStorage.setItem('colorTheme', JSON.stringify(colorTheme)); localStorage.setItem('opencode-style-version', '1'); document.documentElement.dataset.theme = colorTheme; }, [colorTheme]);
  useEffect(() => localStorage.setItem('events', JSON.stringify(events)), [events]);
  useEffect(() => localStorage.setItem('notifications', JSON.stringify(notifications)), [notifications]);
  useEffect(() => localStorage.setItem('native-notices', JSON.stringify(nativeNotices)), [nativeNotices]);
  useEffect(() => localStorage.setItem('hidden-sessions', JSON.stringify(hiddenSessions)), [hiddenSessions]);
  useEffect(() => { const timer = setInterval(() => setToasts(items => items.filter(item => Date.now() - item.time < 6500)), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null), key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('resize', close); };
  }, [contextMenu]);
  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyN') { e.preventDefault(); setModal('agent'); }
      if (e.key === 'Escape') setFocus(null);
    };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  }, []);
  const project = state.projects.find(p => p.id === projectId);
  const savedOrder = paneOrders[projectId] || [];
  const positions = new Map(savedOrder.map((id, index) => [id, index]));
  const allAgents = state.agents.filter(a => a.projectId === projectId).sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  const agents = allAgents.filter(a => !hiddenSessions.includes(a.id) || a.status === 'running');
  const visibleEvents = filterActivity(events, { projectId, agentId: activityAgent, kind: activityKind });
  const agentMeta = agent => ({ agentId: agent.id, projectId: agent.projectId, sessionId: agent.sessionId });
  const finishMove = () => { setDraggingId(null); setDropTargetId(null); };
  const swapPanes = (source, target) => {
    const order = agents.map(a => a.id);
    const from = order.indexOf(source), to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    [order[from], order[to]] = [order[to], order[from]];
    setPaneOrders(previous => {
      const next = { ...previous, [projectId]: order };
      localStorage.setItem('pane-orders', JSON.stringify(next));
      return next;
    });
  };
  const movePane = (id, direction) => {
    const neighbor = agents[agents.findIndex(a => a.id === id) + direction];
    if (neighbor) swapPanes(id, neighbor.id);
  };
  const running = agents.filter(a => a.status === 'running');
  const focusedId = agents.some(a => a.id === focus) ? focus : null;
  const action = async (agent, type) => {
    try {
      const current = state.agents.find(item => item.id === agent.id);
      if (agent.sessionId && current?.sessionId && agent.sessionId !== current.sessionId) throw new Error('A sessão mudou. Abra o menu novamente para agir na sessão atual.');
      if (type === 'stop') {
        const active = (state.tasks || []).filter(t => t.agentId === agent.id && ['queued', 'running', 'cancelling'].includes(t.status));
        if (active.length && !window.confirm(`A sessão “${agent.name}” tem ${active.length} tarefa(s) ativa(s). Cancelar e fechar somente esta sessão?`)) return;
        intentionalStops.current.add(agent.id);
        for (const task of active) await api(`/tasks/${task.id}/cancel`, 'POST');
      }
      if (type === 'start') { intentionalStops.current.delete(agent.id); setHiddenSessions(ids => ids.filter(id => id !== agent.id)); }
      if (type === 'cancel-task') { await api(`/tasks/${agent.taskId}/cancel`, 'POST'); log(`${agent.name}: tarefa cancelada`, { ...agentMeta(agent), kind: 'delegation' }); return; }
      await api(`/agents/${agent.id}/${type}`, 'POST');
      log(`${agent.name}: terminal ${type === 'start' ? 'iniciado' : 'encerrado'}`, agentMeta(agent));
    } catch (error) { if (type === 'stop') intentionalStops.current.delete(agent.id); notify(error.message, true); }
  };
  const newSession = async agent => {
    setContextMenu(null); setBusy(true);
    try {
      const next = await api('/agents', 'POST', sessionDraft(agent, state.agents));
      setView('terminals'); setFocus(next.id);
      await action(next, 'start');
      notify(`Nova sessão criada · ${next.name}`);
    } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  };
  const hideSession = agent => {
    setContextMenu(null);
    if (agent.status === 'running' || (state.tasks || []).some(t => t.agentId === agent.id && ['queued', 'running', 'cancelling'].includes(t.status))) { notify('Feche a sessão e aguarde as tarefas encerrarem antes de removê-la da lista.', true); return; }
    setHiddenSessions(ids => [...new Set([...ids, agent.id])]); buffers.delete(agent.id); setTargets(ids => ids.filter(id => id !== agent.id));
    log(`${agent.name}: sessão ocultada da lista`, agentMeta(agent));
    notify('Sessão removida da lista. O CLI e os registros de tarefas foram preservados.');
  };
  const openSessionMenu = (event, agent) => { event.preventDefault(); setContextMenu({ agent, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)) }); };
  const startAll = async () => {
    setBusy(true);
    for (const agent of agents.filter(a => a.status !== 'running')) await action(agent, 'start');
    setBusy(false);
  };
  const dispatch = async e => {
    e.preventDefault();
    const recipients = agents.filter(a => targets.includes(a.id) && canReceiveTask(a));
    if (!task.trim() || !recipients.length) return;
    setBusy(true);
    let delivered = 0;
    try {
      for (const agent of recipients) {
        // Preserve multiline prompts using the CLI's bracketed-paste terminal mode.
        const term = liveTerms.get(agent.id);
        if (!term) throw new Error('Abra a aba Terminais antes de enviar uma tarefa.');
        await api(`/agents/${agent.id}/prompt`, 'POST', { text: task, submit: submitTask, bracketed: term.modes.bracketedPasteMode, sessionId: agent.sessionId });
        delivered++;
        log(`${agent.name} · mensagem ${submitTask ? 'enviada' : 'inserida'}`, { ...agentMeta(agent), kind: 'message' });
      }
      log(`Tarefa enviada para ${recipients.map(a => a.name).join(', ')}`);
      notify(`Tarefa ${submitTask ? 'enviada' : 'inserida'} em ${delivered} ${delivered === 1 ? 'terminal' : 'terminais'}.`); setTask('');
    } catch (error) { notify(`${error.message}${delivered ? ` ${delivered} terminal(is) já receberam o texto.` : ''}`, true); }
    finally { setBusy(false); }
  };
  const createAgent = async (data, start) => {
    const agent = await api('/agents', 'POST', { ...data, projectId });
    log(`${agent.name}: agente adicionado`, agentMeta(agent)); setModal(null); setView('terminals');
    if (start) await action(agent, 'start');
  };
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'} ${taskPanel ? '' : 'tasks-hidden'}`}>
    <header className="app-bar"><a className="brand" href="/" aria-label="Orquestra início"><span className="brand-symbol"><i /><i /><i /></span>orquestra<span className="version">LOCAL</span></a><div className="app-bar-center"><Network size={13} /> Um workspace. Vários agentes.</div><div className="app-bar-actions"><span className={`connection ${connected ? 'online' : ''}`}><span />{connected ? 'Conectado localmente' : 'Reconectando…'}</span><button className="icon-button notification-bell" title="Notificações recentes" aria-label="Notificações recentes" onClick={() => { setModal('notifications'); setNotifications(items => items.map(item => ({ ...item, read: true }))); }}><Bell size={16} />{notifications.some(item => !item.read) && <i />}</button><IconButton icon={CircleHelp} label="Como funciona" onClick={() => setModal('help')} /><IconButton icon={Settings2} label="Preferências" onClick={() => setModal('settings')} /></div></header>
    {sidebar && <aside className="sidebar"><div className="sidebar-top"><span>WORKSPACE</span><IconButton icon={PanelLeftClose} label="Recolher projetos" onClick={() => setSidebar(false)} /></div><button className="workspace-name" onClick={() => setModal('project')}><span className="workspace-avatar">O</span><span>Meu workspace<small>Ambiente local</small></span><ChevronDown size={14} /></button><div className="section-label">PROJETOS <IconButton icon={Plus} label="Novo projeto" onClick={() => setModal('project')} /></div><nav className="projects">{state.projects.map(p => <div key={p.id}><button className={`project-item ${p.id === projectId ? 'active' : ''}`} onClick={() => { setProjectId(p.id); setView('terminals'); }}><ChevronDown size={13} /><Folder size={15} /><span>{p.name}</span><span className="count">{state.agents.filter(a => a.projectId === p.id).length}</span></button>{p.id === projectId && <div className="project-agents">{agents.map(a => <button key={a.id} className={focusedId === a.id ? 'selected' : ''} title={`${a.name} · ${statusLabel(a)} · ${a.sessionId?.slice(0, 8) || a.id.slice(0, 8)}`} onContextMenu={e => openSessionMenu(e, a)} onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const rect = e.currentTarget.getBoundingClientRect(); e.preventDefault(); setContextMenu({ agent: a, x: rect.left, y: Math.min(rect.bottom, window.innerHeight - 220) }); } }} onClick={() => { setFocus(a.id); setView('terminals'); }}><Mark provider={a.provider} small /><span className="session-label">{a.name}<small>{statusLabel(a)} · {(a.sessionId || a.id).slice(0, 6)}</small></span><span className={`status-dot ${a.status}`} /></button>)}<button className="add-inline" disabled={!connected} onClick={() => setModal('agent')}><Plus size={13} />Adicionar agente</button>{allAgents.some(a => hiddenSessions.includes(a.id) && a.status !== 'running') && <button className="add-inline" onClick={() => setHiddenSessions(ids => ids.filter(id => !allAgents.some(a => a.id === id)))}><Eye size={13} />Mostrar sessões removidas</button>}</div>}</div>)}</nav><Button icon={Plus} className="new-project" disabled={!connected} onClick={() => setModal('project')}>Novo projeto</Button><div className="sidebar-bottom"><div className="local-note"><span className="local-icon"><Radio size={16} /></span><div>Tudo no seu computador<small>Seus CLIs. Suas sessões.</small></div></div><button className="shortcuts" onClick={() => setModal('help')}><Keyboard size={14} /> Guia rápido <ArrowUpRight size={13} /></button><div className="build-label"><span>ORQUESTRA</span><span>v0.1.0</span></div></div></aside>}
    <main className="main"><div className="workspace-header"><div className="breadcrumbs">{!sidebar && <IconButton icon={PanelLeftOpen} label="Mostrar projetos" onClick={() => setSidebar(true)} />}<Folder size={14} /><span>Projetos</span><ChevronRight size={13} /><strong>{project?.name || 'Workspace'}</strong></div><div className="workspace-title"><div><h1>{project?.name || 'Seu workspace'}<span className="local-badge">LOCAL</span></h1><p title={project?.cwd}>{project?.cwd || 'Conectando ao serviço local…'}</p></div><Button icon={Plus} className="primary" disabled={!connected || !project} onClick={() => setModal('agent')}>Novo agente<kbd>Ctrl Alt N</kbd></Button></div></div>
      <div className="workspace-toolbar"><div className="view-tabs"><button className={view === 'terminals' ? 'active' : ''} onClick={() => setView('terminals')}><Terminal size={15} />Terminais <span>{agents.length}</span></button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><ListTodo size={15} />Tarefas <span>{(state.tasks || []).filter(t => t.projectId === projectId && !['done', 'succeeded', 'cancelled'].includes(t.status)).length}</span></button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity size={15} />Atividade</button><button className={view === 'orchestration' ? 'active' : ''} onClick={() => setView('orchestration')}><Network size={15} />Orquestração</button><button className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}><BookOpen size={15} />Memória</button></div><div className="toolbar-actions"><span className="running-count"><span className={`status-dot ${running.length ? 'running' : ''}`} />{running.length} ativos</span><div className="layout-switch" aria-label="Layout dos terminais">{[[Square, 'single', 'Uma coluna'], [Columns2, 'columns', 'Duas colunas'], [LayoutGrid, 'grid', 'Grade automática']].map(([Icon, value, label]) => <button key={value} className={layout === value && !focusedId ? 'active' : ''} title={label} aria-label={label} onClick={() => { setLayout(value); setFocus(null); }}><Icon size={14} /></button>)}</div><IconButton icon={taskPanel ? PanelRightClose : PanelRightOpen} label={taskPanel ? 'Recolher tarefas' : 'Mostrar tarefas'} onClick={() => setTaskPanel(!taskPanel)} /></div></div>
      {!connected && <div className="offline-banner">Aguardando o serviço local. Os controles serão reativados ao reconectar.</div>}
      <div className={`terminal-workspace ${view !== 'terminals' ? 'invisible' : ''}`}>
        {agents.length === 0 ? <div className="empty-workspace"><div className="empty-art"><span className="empty-wire" /><div className="mini-pane"><span><i />codex</span><b>❯_</b></div><div className="mini-pane"><span><i />claude</span><b>✺</b></div><div className="mini-pane"><span><i />gemini</span><b>✦</b></div></div><span className="eyebrow">SEU PRÓXIMO PROJETO, EM BOA COMPANHIA</span><h2>Cada agente no seu terminal.<br />Você no controle de todos.</h2><p>Reúna seus CLIs em um só lugar. Distribua tarefas<br className="desktop-break" /> e acompanhe o trabalho, lado a lado.</p><Button icon={Plus} className="primary" disabled={!connected} onClick={() => setModal('agent')}>Adicionar primeiro agente</Button><div className="supported">{['codex', 'claude', 'gemini'].map(p => <span key={p}><Mark provider={p} small />{providerMeta[p].name}</span>)}<span>+ qualquer CLI</span></div><div className="getting-started"><span><b>01</b> Escolha seu CLI</span><ChevronRight size={12} /><span><b>02</b> Abra o terminal</span><ChevronRight size={12} /><span><b>03</b> Distribua tarefas</span></div></div> : <><div className="grid-caption"><span>{focusedId ? 'MODO FOCO' : 'TERMINAIS DO PROJETO'}</span>{focusedId ? <button onClick={() => setFocus(null)}>Ver todos <Minimize2 size={12} /></button> : <button disabled={busy || !connected || running.length === agents.length} onClick={startAll}><Play size={12} />Iniciar todos</button>}</div><div className={`terminal-grid layout-${layout} ${focusedId ? 'has-focus' : ''}`} style={{ '--pane-count': agents.length, '--rows-two': Math.ceil(agents.length / 2), '--rows-three': Math.ceil(agents.length / 3) }}>{agents.map(agent => <TerminalPane key={agent.id} agent={agent} send={send} onAction={action} focused={focusedId === agent.id} hidden={!!focusedId && focusedId !== agent.id} onFocus={() => setFocus(focusedId === agent.id ? null : agent.id)} fontSize={fontSize} terminalTheme={colorThemes[colorTheme]?.terminal || colorThemes.orquestra.terminal} connected={connected} draggingId={draggingId} dropTargetId={dropTargetId} onDragBegin={setDraggingId} onDragTarget={setDropTargetId} onDragFinish={finishMove} onSwap={swapPanes} onMove={movePane} />)}</div><div className="workspace-footnote"><span><Command size={12} /> Cada painel é um processo independente.</span><button onClick={() => setModal('manage')}>Gerenciar agentes <ArrowUpRight size={12} /></button></div></>}
      </div>
      {view === 'orchestration' && <OrchestrationPanel project={project} agents={allAgents} providers={providers} tasks={state.tasks || []} connected={connected} request={api} notify={notify} onCoordinator={async (agentId) => {
        const coordinator = await api(`/projects/${projectId}/coordinator`, 'POST', { agentId });
        setView('terminals'); setFocus(coordinator.id); log(`${coordinator.name} aberto com ferramentas do Orquestra`);
      }} />}
      {view === 'memory' && <MemoryPanel project={project} status={state.memory} request={api} notify={notify} />}
      {view === 'tasks' && <TaskBoard project={project} tasks={state.tasks || []} request={api} notify={notify} connected={connected} />}
      {view === 'activity' && <div className="activity-view"><div className="activity-heading"><div><span className="eyebrow">LINHA DO TEMPO</span><h2>Atividade do projeto</h2></div><span>Mais recentes primeiro · até 200 eventos</span></div><div className="activity-filters"><label>Sessão<select value={activityAgent} onChange={e => setActivityAgent(e.target.value)}><option value="">Todas as sessões</option>{allAgents.map(a => <option key={a.id} value={a.id}>{a.name} · {(a.sessionId || a.id).slice(0, 6)}</option>)}</select></label><label>Evento<select value={activityKind} onChange={e => setActivityKind(e.target.value)}><option value="">Todos os eventos</option><option value="message">Mensagens enviadas</option><option value="output">Saída / ferramentas</option><option value="delegation">Delegações e respostas</option><option value="error">Erros</option><option value="state">Estados</option></select></label></div><p className="field-help">Eventos existentes do serviço e saída dos CLIs. Comandos e ferramentas aparecem nos detalhes quando publicados pelo CLI; entradas privadas do terminal não são registradas aqui.</p>{visibleEvents.length ? visibleEvents.map(event => <ActivityEntry key={event.id} event={event} />) : <div className="activity-empty"><Activity size={28} /><h3>Nenhum evento para este filtro.</h3><p>Abra uma sessão ou envie uma tarefa para acompanhar a atividade.</p></div>}</div>}
    </main>
    {taskPanel && <aside className="task-panel"><div className="task-panel-title"><Send size={15} /><strong>Central de tarefas</strong><span className="tiny-badge">MANUAL</span><IconButton icon={X} label="Fechar central de tarefas" onClick={() => setTaskPanel(false)} /></div><p className="task-intro">Uma instrução. Os agentes certos.</p><form onSubmit={dispatch}><label className="section-label" htmlFor="task">O QUE VAMOS FAZER?</label><textarea id="task" placeholder="Descreva a tarefa ou compartilhe contexto com seus agentes…" value={task} maxLength={16000} onChange={e => setTask(e.target.value)} /><div className="task-counter">{task.length.toLocaleString('pt-BR')} / 16.000</div><div className="section-label target-heading">ENVIAR PARA <span>{targets.filter(id => agents.some(a => a.id === id && canReceiveTask(a))).length} selecionados</span></div><div className="targets">{agents.filter(a => a.provider !== 'shell').length ? agents.filter(a => a.provider !== 'shell').map(a => <label key={a.id} className={`target ${!canReceiveTask(a) ? 'disabled' : ''}`}><input type="checkbox" checked={targets.includes(a.id)} disabled={!canReceiveTask(a) || !connected} onChange={e => setTargets(e.target.checked ? [...targets, a.id] : targets.filter(id => id !== a.id))} /><Mark provider={a.provider} small /><span>{a.name}<small>{statusLabel(a)}</small></span><span className={`status-dot ${a.status}`} /></label>) : <div className="no-targets"><Network size={20} /><p>Seus agentes aparecerão aqui.<br />Adicione um para começar.</p></div>}</div><label className="enter-option"><input type="checkbox" checked={submitTask} onChange={e => setSubmitTask(e.target.checked)} />Pressionar Enter após inserir</label><Button type="submit" className="primary send-task" icon={Send} disabled={!connected || busy || !task.trim() || !agents.some(a => targets.includes(a.id) && canReceiveTask(a))}>{busy ? 'Enviando…' : 'Enviar tarefa'}<ArrowUpRight size={14} /></Button><p className="task-tip">O texto é inserido nos terminais selecionados. Acompanhe a resposta em cada painel.</p></form><div className="tip-card"><span><Network size={15} /> Trabalhe em paralelo</span><p>Um agente implementa, outro revisa. Dê a cada um uma responsabilidade clara.</p></div><div className="task-panel-bottom"><span className="status-dot running" /> Conexões diretas com seus CLIs</div></aside>}
    <footer className="status-bar"><span><span className={`status-dot ${connected ? 'running' : ''}`} />{connected ? 'Serviço local conectado' : 'Serviço desconectado'}</span><span>{state.projects.length} {state.projects.length === 1 ? 'projeto' : 'projetos'}<i />{state.agents.filter(a => a.status === 'running').length} terminais ativos</span><span>127.0.0.1<Radio size={11} /></span></footer>
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">{toasts.map(item => <div key={item.id} className={`toast ${item.error ? 'error' : ''}`}><span>{item.error ? <AlertCircle size={17} /> : <Check size={17} />}</span><span>{item.message}</span><IconButton icon={X} label="Dispensar aviso" onClick={() => setToasts(items => items.filter(n => n.id !== item.id))} /></div>)}</div>
    {contextMenu && <div className="session-context" role="menu" aria-label={`Sessão ${contextMenu.agent.name}`} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); }}>
      <span className="context-caption">{contextMenu.agent.name}</span>
      <button role="menuitem" autoFocus disabled={!connected || busy} onClick={() => newSession(contextMenu.agent)}><Copy size={14} />Nova sessão</button>
      <button role="menuitem" disabled={!connected || contextMenu.agent.status !== 'running'} onClick={() => { action(contextMenu.agent, 'stop'); setContextMenu(null); }}><Square size={14} />Fechar sessão</button>
      <button role="menuitem" disabled={contextMenu.agent.status === 'running'} title={contextMenu.agent.status === 'running' ? 'Feche a sessão antes de remover da lista' : 'Ocultar histórico visual; não desinstala o CLI'} onClick={() => hideSession(contextMenu.agent)}><Trash2 size={14} />Remover da lista</button>
      <small>As outras sessões continuam abertas.</small>
    </div>}
    {modal === 'notifications' && <Modal title="Notificações" subtitle="Últimos 50 avisos deste navegador." onClose={() => setModal(null)}><div className="notification-history">{notifications.length ? notifications.map(item => <article className={item.error ? 'notice-error' : ''} key={item.id}><span>{item.error ? <AlertCircle size={16} /> : <Bell size={16} />}</span><div><p>{item.message}</p><time>{new Date(item.time).toLocaleString('pt-BR')}</time></div><IconButton icon={X} label="Remover notificação" onClick={() => { setNotifications(items => items.filter(n => n.id !== item.id)); setToasts(items => items.filter(n => n.id !== item.id)); }} /></article>) : <p className="field-help">Tudo em dia. Conclusões, delegações e erros aparecerão aqui.</p>}</div><div className="modal-footer"><Button onClick={() => setNotifications([])} disabled={!notifications.length}>Limpar histórico</Button><Button className="primary" onClick={() => setModal(null)}>Fechar</Button></div></Modal>}
    {modal === 'agent' && project && <AgentModal providers={providers} project={project} onClose={() => setModal(null)} onCreate={createAgent} />}
    {modal === 'project' && <ProjectModal onClose={() => setModal(null)} onCreate={async data => { const p = await api('/projects', 'POST', data); setProjectId(p.id); setModal(null); log(`Projeto ${p.name} adicionado`); }} />}
    {modal === 'settings' && <Modal title="Preferências" subtitle="Um ambiente confortável para trabalhar." onClose={() => setModal(null)}><div className="settings-field"><label htmlFor="color-theme">Tema de cores</label><select id="color-theme" value={colorTheme} onChange={e => setColorTheme(e.target.value)}>{Object.entries(colorThemes).map(([id, theme]) => <option key={id} value={id}>{theme.name}</option>)}</select></div><div className="theme-preview" aria-label="Prévia do tema">{Object.entries(colorThemes).map(([id, theme]) => <button key={id} type="button" className={id === colorTheme ? 'selected' : ''} onClick={() => setColorTheme(id)}><span style={{ background: theme.swatch }} /><Palette size={13} />{theme.name}</button>)}</div><div className="settings-field"><label htmlFor="font-size">Tamanho do texto dos terminais</label><select id="font-size" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>{[11, 12, 13, 14, 15, 16, 18, 20].map(n => <option key={n} value={n}>{n} px</option>)}</select></div><div className="settings-field notification-settings"><label htmlFor="native-notices">Notificações do sistema<small>Somente eventos relevantes com a janela em segundo plano.</small></label><input id="native-notices" type="checkbox" checked={nativeNotices} disabled={!window.orquestraDesktop?.notify && !('Notification' in window)} onChange={async e => { if (!e.target.checked) { setNativeNotices(false); return; } try { if (window.orquestraDesktop?.notify) { setNativeNotices(true); return; } const permission = await Notification.requestPermission(); setNativeNotices(permission === 'granted'); if (permission !== 'granted') notify('Notificações do sistema não autorizadas. Os avisos internos continuam disponíveis.'); } catch { notify('Este ambiente não oferece notificações nativas.', true); } }} /></div><Button disabled={!nativeNotices} onClick={async () => { try { if (window.orquestraDesktop?.notify) { const result = await window.orquestraDesktop.notify({ body: "Teste do Orquestra.", key: `test:${Date.now()}`, test: true }); notify(result.status === "submitted" ? "Teste enviado ao sistema. Confira os avisos do Windows." : `Falha ao enviar o teste (${result.status}).`, result.status !== "submitted"); } else if ("Notification" in window && Notification.permission === "granted") { const notice = new Notification("Orquestra", { body: "Teste do Orquestra.", silent: true }); notice.onclick = () => { window.focus(); notice.close(); }; notify("Teste enviado ao sistema."); } else { notify("Sistema sem acesso aos avisos nativos.", true); } } catch { notify("Falha ao enviar o aviso de teste.", true); } }}>Testar aviso do sistema</Button><p className="modal-note">Preferências, tema e layout são salvos neste navegador. Projetos e agentes são salvos localmente pelo aplicativo.</p><div className="modal-footer"><Button className="primary" onClick={() => setModal(null)}>Concluído</Button></div></Modal>}
    {modal === 'help' && <Modal title="Seu workspace de agentes" subtitle="O essencial, sem complicação." onClose={() => setModal(null)}><div className="help-content"><p><b>1. Adicione um projeto.</b> Informe a pasta em que os agentes vão trabalhar.</p><p><b>2. Adicione os agentes.</b> Escolha Codex, Claude, Gemini, OpenCode ou um comando personalizado. O CLI precisa estar instalado e autenticado.</p><p><b>3. Inicie os terminais.</b> Digite diretamente em cada painel ou use a central para enviar uma tarefa a vários agentes.</p><p><b>Continue de onde estava.</b> Recarregar a página preserva os processos enquanto o serviço local estiver ligado. Reiniciar o serviço preserva os cadastros, mas inicia novas sessões.</p><p>O indicador “Em execução” descreve o processo, não a conclusão da tarefa. Na aba Orquestração, abra um coordenador Codex para delegar tarefas e acompanhar os resultados automaticamente.</p><div className="shortcut-row"><kbd>Ctrl Alt N</kbd><span>Novo agente</span><kbd>Esc</kbd><span>Sair do foco</span></div></div></Modal>}
    {modal === 'manage' && <Modal title="Gerenciar agentes" subtitle="Remover um agente também encerra seu terminal." onClose={() => setModal(null)}><div className="manage-list">{agents.map(a => <div key={a.id}><Mark provider={a.provider} small /><span><strong>{a.name}</strong><small>{statusLabel(a)}</small></span><IconButton icon={Trash2} label={`Remover ${a.name}`} onClick={() => setModal({ delete: a })} /></div>)}</div></Modal>}
    {modal?.delete && <Modal title={`Remover ${modal.delete.name}?`} subtitle="O processo será encerrado. Os arquivos do projeto serão preservados." onClose={() => setModal(null)}><div className="modal-footer"><Button onClick={() => setModal('manage')}>Cancelar</Button><Button className="danger" icon={Trash2} onClick={async () => { try { await api(`/agents/${modal.delete.id}`, 'DELETE'); buffers.delete(modal.delete.id); log(`${modal.delete.name}: agente removido`); setModal(null); } catch (e) { notify(e.message, true); } }}>Remover agente</Button></div></Modal>}
  </div>;
}
function AgentModal({ providers, project, onClose, onCreate }) {
  const [provider, setProvider] = useState('codex');
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(project.cwd);
  const [role, setRole] = useState('');
  const [command, setCommand] = useState('');
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const chooseDirectory = async () => { setPicking(true); setError(''); try { const result = await api('/select-directory', 'POST'); if (result.path) setCwd(result.path); } catch (e) { setError(e.message); } finally { setPicking(false); } };
  return <Modal title="Novo agente" subtitle="Um CLI, um terminal, uma responsabilidade." onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onCreate({ provider, name: name.trim() || providerMeta[provider].name, cwd, role, command }, start); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field-label">ESCOLHA O CLI</label><div className="provider-options">{Object.entries(providerMeta).map(([id, p]) => <button key={id} type="button" className={provider === id ? 'chosen' : ''} onClick={() => setProvider(id)}><Mark provider={id} small /><span>{p.name}<small>{id === 'custom' ? 'Seu comando' : providers.find(p => p.id === id)?.available ? 'Disponível' : 'Não detectado'}</small></span>{provider === id && <Check size={14} />}</button>)}</div><label className="field-label" htmlFor="agent-name">NOME DO AGENTE</label><input id="agent-name" placeholder={providerMeta[provider].name} value={name} maxLength={120} onChange={e => setName(e.target.value)} /><label className="field-label" htmlFor="agent-role">RESPONSABILIDADE <span>opcional</span></label><input id="agent-role" placeholder="Ex.: implementar o backend, revisar código…" value={role} maxLength={200} onChange={e => setRole(e.target.value)} />{provider === 'custom' && <><label className="field-label" htmlFor="agent-command">COMANDO DO TERMINAL</label><input id="agent-command" required placeholder="Ex.: ollama run seu-modelo" value={command} maxLength={2000} onChange={e => setCommand(e.target.value)} /><p className="field-help">Executado no shell local exatamente como informado.</p></>}<label className="field-label" htmlFor="agent-cwd">PASTA DE TRABALHO</label><div className="directory-picker"><input id="agent-cwd" required value={cwd} onChange={e => setCwd(e.target.value)} /><Button type="button" icon={FolderOpen} disabled={picking} onClick={chooseDirectory}>{picking ? 'Abrindo…' : 'Escolher pasta'}</Button></div><label className="enter-option"><input type="checkbox" checked={start} onChange={e => setStart(e.target.checked)} />Iniciar terminal ao adicionar</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><Button type="button" onClick={onClose}>Cancelar</Button><Button className="primary" type="submit" icon={Plus} disabled={busy}>{busy ? 'Adicionando…' : 'Adicionar agente'}</Button></div></form></Modal>;
}
function ProjectModal({ onClose, onCreate }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [cwd, setCwd] = useState(''); const [picking, setPicking] = useState(false);
  const chooseDirectory = async () => { setPicking(true); setError(''); try { const result = await api('/select-directory', 'POST'); if (result.path) setCwd(result.path); } catch (e) { setError(e.message); } finally { setPicking(false); } };
  return <Modal title="Novo projeto" subtitle="Organize os agentes por pasta de trabalho." onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onCreate({ name: new FormData(e.currentTarget).get('name'), cwd }); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field-label" htmlFor="project-name">NOME DO PROJETO</label><input id="project-name" name="name" required maxLength={120} placeholder="Meu próximo projeto" /><label className="field-label" htmlFor="project-cwd">CAMINHO COMPLETO DA PASTA</label><div className="directory-picker"><input id="project-cwd" name="cwd" required value={cwd} onChange={e => setCwd(e.target.value)} placeholder="C:\Users\voce\projetos\meu-projeto" /><Button type="button" icon={FolderOpen} disabled={picking} onClick={chooseDirectory}>{picking ? 'Abrindo…' : 'Escolher pasta'}</Button></div><p className="field-help">Escolha uma pasta existente no Explorador de Arquivos.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><Button type="button" onClick={onClose}>Cancelar</Button><Button className="primary" type="submit" disabled={busy} icon={Folder}>{busy ? 'Adicionando…' : 'Adicionar projeto'}</Button></div></form></Modal>;
}
createRoot(document.getElementById('root')).render(<App />);
