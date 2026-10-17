import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { BookOpen, Plus, Folder, ChevronDown, ChevronRight, Terminal, LayoutGrid, Columns2, Square, Play, SquareArrowOutUpRight, X, Settings2, ArrowUpRight, Send, Radio, PanelRightClose, PanelRightOpen, CircleHelp, Activity, Command, Maximize2, Minimize2, RotateCcw, Trash2, Download, Check, PanelLeftClose, PanelLeftOpen, Network, Keyboard } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { GripVertical } from 'lucide-react';
import './style.css';
import OrchestrationPanel from './Orchestration.jsx';
import MemoryPanel from './MemoryPanel.jsx';

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
const buffers = new Map();
const liveTerms = new Map();
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
function TerminalPane({ agent, send, onAction, focused, onFocus, fontSize, hidden, connected, draggingId, dropTargetId, onDragBegin, onDragTarget, onDragFinish, onSwap, onMove }) {
  const paneRef = useRef(null);
  const dragRef = useRef(null);
  const [paneSize, setPaneSize] = useState(() => readLocal(`pane-size:${agent.id}`, null));
  const container = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const meta = providerMeta[agent.provider];
  useEffect(() => {
    localStorage.setItem(`pane-size:${agent.id}`, JSON.stringify(paneSize));
  }, [agent.id, paneSize]);
  const applySize = (width, height) => {
    const available = paneRef.current.parentElement.clientWidth;
    setPaneSize({ width: Math.round(Math.max(Math.min(320, available), Math.min(available, width))), height: Math.round(Math.max(290, Math.min(2000, height))) });
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
      cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize,
      lineHeight: 1.28, scrollback: 6000, allowProposedApi: false,
      theme: { background: '#141518', foreground: '#d9dce1', cursor: '#b6ed85', selectionBackground: '#3e4d36', black: '#24262c', red: '#ef8585', green: '#b6ed85', yellow: '#e7cd8a', blue: '#96b4f4', magenta: '#c7a4ed', cyan: '#89d3d2', white: '#e1e4e9' },
    });
    const fit = new FitAddon(); fitRef.current = fit; term.loadAddon(fit); term.open(container.current);
    termRef.current = term; liveTerms.set(agent.id, term);
    term.write(buffers.get(agent.id) || '');
    const resize = () => {
      if (!container.current || !container.current.clientWidth || !container.current.clientHeight) return;
      fit.fit(); send({ type: 'resize', id: agent.id, cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(resize); observer.observe(container.current);
    const input = term.onData(data => send({ type: 'input', id: agent.id, data }));
    resize();
    return () => { observer.disconnect(); input.dispose(); liveTerms.delete(agent.id); term.dispose(); };
  }, [agent.id, send]);
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    if (container.current?.clientWidth && container.current?.clientHeight) {
      fitRef.current?.fit();
      send({ type: 'resize', id: agent.id, cols: termRef.current.cols, rows: termRef.current.rows });
    }
  }, [fontSize, agent.id, send]);
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
  return <section ref={paneRef} className={`terminal-pane ${focused ? 'focused' : ''} ${draggingId === agent.id ? 'pane-dragging' : ''} ${dropTargetId === agent.id ? 'pane-drop-target' : ''}`} style={{ '--provider': meta.color, display: hidden ? 'none' : undefined, ...(!focused && paneSize && { width: paneSize.width, height: paneSize.height }) }} aria-label={`Terminal de ${agent.name}`}
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
  const [toast, setToast] = useState(null);
  const [view, setView] = useState('terminals');
  const [fontSize, setFontSize] = useState(() => readLocal('fontSize', 13));
  const [task, setTask] = useState('');
  const [targets, setTargets] = useState([]);
  const [submitTask, setSubmitTask] = useState(true);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState(() => readLocal('events', []));
  const wsRef = useRef(null);
  const notify = useCallback((message, error = false) => setToast({ message, error }), []);
  const log = (message) => setEvents(prev => [{ id: crypto.randomUUID(), message, time: Date.now() }, ...prev].slice(0, 100));
  const send = useCallback(message => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(message)); }, []);
  useEffect(() => {
    let disposed = false, timer;
    const connect = async () => {
      try { await fetch('/'); } catch { /* retry below */ }
      if (disposed) return;
      const ws = new WebSocket(`ws://${location.host}/ws`); wsRef.current = ws;
      ws.onopen = () => {
        if (disposed) return ws.close();
        setConnected(true);
        api('/providers').then(setProviders).catch(e => notify(e.message, true));
      };
      ws.onmessage = ({ data }) => {
        const event = JSON.parse(data);
        if (event.type === 'state') setState(event);
        if (event.type === 'output' || event.type === 'replay') {
          const term = liveTerms.get(event.id);
          if (event.type === 'replay') { buffers.set(event.id, ''); term?.reset(); }
          buffers.set(event.id, ((buffers.get(event.id) || '') + event.data).slice(-262144));
          term?.write(event.data);
          if (event.type === 'replay' && term) send({ type: 'resize', id: event.id, cols: term.cols, rows: term.rows });
        }
        if (event.type === 'reset') {
          buffers.set(event.id, ''); const term = liveTerms.get(event.id); term?.reset();
          if (term) send({ type: 'resize', id: event.id, cols: term.cols, rows: term.rows });
        }
        if (event.type === 'error') notify(event.message, true);
      };
      ws.onclose = () => { setConnected(false); if (!disposed) timer = setTimeout(connect, 1800); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [notify, send]);
  useEffect(() => { if (state.projects.length && !state.projects.some(p => p.id === projectId)) setProjectId(state.projects[0].id); }, [state.projects, projectId]);
  useEffect(() => { localStorage.setItem('project', JSON.stringify(projectId)); setTargets([]); setFocus(null); }, [projectId]);
  useEffect(() => localStorage.setItem('layout', JSON.stringify(layout)), [layout]);
  useEffect(() => localStorage.setItem('fontSize', JSON.stringify(fontSize)), [fontSize]);
  useEffect(() => localStorage.setItem('events', JSON.stringify(events)), [events]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); } }, [toast]);
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
  const agents = state.agents.filter(a => a.projectId === projectId).sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
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
      if (type === 'cancel-task') { await api(`/tasks/${agent.taskId}/cancel`, 'POST'); log(`${agent.name}: tarefa cancelada`); return; }
      await api(`/agents/${agent.id}/${type}`, 'POST');
      log(`${agent.name}: terminal ${type === 'start' ? 'iniciado' : 'encerrado'}`);
    } catch (error) { notify(error.message, true); }
  };
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
        await api(`/agents/${agent.id}/prompt`, 'POST', { text: task, submit: submitTask, bracketed: term.modes.bracketedPasteMode });
        delivered++;
      }
      log(`Tarefa enviada para ${recipients.map(a => a.name).join(', ')}`);
      notify(`Tarefa ${submitTask ? 'enviada' : 'inserida'} em ${delivered} ${delivered === 1 ? 'terminal' : 'terminais'}.`); setTask('');
    } catch (error) { notify(`${error.message}${delivered ? ` ${delivered} terminal(is) já receberam o texto.` : ''}`, true); }
    finally { setBusy(false); }
  };
  const createAgent = async (data, start) => {
    const agent = await api('/agents', 'POST', { ...data, projectId });
    log(`${agent.name}: agente adicionado`); setModal(null); setView('terminals');
    if (start) await action(agent, 'start');
  };
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'} ${taskPanel ? '' : 'tasks-hidden'}`}>
    <header className="app-bar"><a className="brand" href="/" aria-label="Orquestra início"><span className="brand-symbol"><i /><i /><i /></span>orquestra<span className="version">LOCAL</span></a><div className="app-bar-center"><Network size={13} /> Um workspace. Vários agentes.</div><div className="app-bar-actions"><span className={`connection ${connected ? 'online' : ''}`}><span />{connected ? 'Conectado localmente' : 'Reconectando…'}</span><IconButton icon={CircleHelp} label="Como funciona" onClick={() => setModal('help')} /><IconButton icon={Settings2} label="Preferências" onClick={() => setModal('settings')} /></div></header>
    {sidebar && <aside className="sidebar"><div className="sidebar-top"><span>WORKSPACE</span><IconButton icon={PanelLeftClose} label="Recolher projetos" onClick={() => setSidebar(false)} /></div><button className="workspace-name" onClick={() => setModal('project')}><span className="workspace-avatar">O</span><span>Meu workspace<small>Ambiente local</small></span><ChevronDown size={14} /></button><div className="section-label">PROJETOS <IconButton icon={Plus} label="Novo projeto" onClick={() => setModal('project')} /></div><nav className="projects">{state.projects.map(p => <div key={p.id}><button className={`project-item ${p.id === projectId ? 'active' : ''}`} onClick={() => { setProjectId(p.id); setView('terminals'); }}><ChevronDown size={13} /><Folder size={15} /><span>{p.name}</span><span className="count">{state.agents.filter(a => a.projectId === p.id).length}</span></button>{p.id === projectId && <div className="project-agents">{agents.map(a => <button key={a.id} className={focusedId === a.id ? 'selected' : ''} onClick={() => { setFocus(a.id); setView('terminals'); }}><Mark provider={a.provider} small /><span>{a.name}</span><span className={`status-dot ${a.status}`} /></button>)}<button className="add-inline" disabled={!connected} onClick={() => setModal('agent')}><Plus size={13} />Adicionar agente</button></div>}</div>)}</nav><Button icon={Plus} className="new-project" disabled={!connected} onClick={() => setModal('project')}>Novo projeto</Button><div className="sidebar-bottom"><div className="local-note"><span className="local-icon"><Radio size={16} /></span><div>Tudo no seu computador<small>Seus CLIs. Suas sessões.</small></div></div><button className="shortcuts" onClick={() => setModal('help')}><Keyboard size={14} /> Guia rápido <ArrowUpRight size={13} /></button><div className="build-label"><span>ORQUESTRA</span><span>v0.1.0</span></div></div></aside>}
    <main className="main"><div className="workspace-header"><div className="breadcrumbs">{!sidebar && <IconButton icon={PanelLeftOpen} label="Mostrar projetos" onClick={() => setSidebar(true)} />}<Folder size={14} /><span>Projetos</span><ChevronRight size={13} /><strong>{project?.name || 'Workspace'}</strong></div><div className="workspace-title"><div><h1>{project?.name || 'Seu workspace'}<span className="local-badge">LOCAL</span></h1><p title={project?.cwd}>{project?.cwd || 'Conectando ao serviço local…'}</p></div><Button icon={Plus} className="primary" disabled={!connected || !project} onClick={() => setModal('agent')}>Novo agente<kbd>Ctrl Alt N</kbd></Button></div></div>
      <div className="workspace-toolbar"><div className="view-tabs"><button className={view === 'terminals' ? 'active' : ''} onClick={() => setView('terminals')}><Terminal size={15} />Terminais <span>{agents.length}</span></button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity size={15} />Atividade</button><button className={view === 'orchestration' ? 'active' : ''} onClick={() => setView('orchestration')}><Network size={15} />Orquestração</button><button className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}><BookOpen size={15} />Memória</button></div><div className="toolbar-actions"><span className="running-count"><span className={`status-dot ${running.length ? 'running' : ''}`} />{running.length} ativos</span><div className="layout-switch" aria-label="Layout dos terminais">{[[Square, 'single', 'Uma coluna'], [Columns2, 'columns', 'Duas colunas'], [LayoutGrid, 'grid', 'Grade automática']].map(([Icon, value, label]) => <button key={value} className={layout === value && !focusedId ? 'active' : ''} title={label} aria-label={label} onClick={() => { setLayout(value); setFocus(null); }}><Icon size={14} /></button>)}</div><IconButton icon={taskPanel ? PanelRightClose : PanelRightOpen} label={taskPanel ? 'Recolher tarefas' : 'Mostrar tarefas'} onClick={() => setTaskPanel(!taskPanel)} /></div></div>
      {!connected && <div className="offline-banner">Aguardando o serviço local. Os controles serão reativados ao reconectar.</div>}
      <div className={`terminal-workspace ${view !== 'terminals' ? 'invisible' : ''}`}>
        {agents.length === 0 ? <div className="empty-workspace"><div className="empty-art"><span className="empty-wire" /><div className="mini-pane"><span><i />codex</span><b>❯_</b></div><div className="mini-pane"><span><i />claude</span><b>✺</b></div><div className="mini-pane"><span><i />gemini</span><b>✦</b></div></div><span className="eyebrow">SEU PRÓXIMO PROJETO, EM BOA COMPANHIA</span><h2>Cada agente no seu terminal.<br />Você no controle de todos.</h2><p>Reúna seus CLIs em um só lugar. Distribua tarefas<br className="desktop-break" /> e acompanhe o trabalho, lado a lado.</p><Button icon={Plus} className="primary" disabled={!connected} onClick={() => setModal('agent')}>Adicionar primeiro agente</Button><div className="supported">{['codex', 'claude', 'gemini'].map(p => <span key={p}><Mark provider={p} small />{providerMeta[p].name}</span>)}<span>+ qualquer CLI</span></div><div className="getting-started"><span><b>01</b> Escolha seu CLI</span><ChevronRight size={12} /><span><b>02</b> Abra o terminal</span><ChevronRight size={12} /><span><b>03</b> Distribua tarefas</span></div></div> : <><div className="grid-caption"><span>{focusedId ? 'MODO FOCO' : 'TERMINAIS DO PROJETO'}</span>{focusedId ? <button onClick={() => setFocus(null)}>Ver todos <Minimize2 size={12} /></button> : <button disabled={busy || !connected || running.length === agents.length} onClick={startAll}><Play size={12} />Iniciar todos</button>}</div><div className={`terminal-grid layout-${layout} ${focusedId ? 'has-focus' : ''}`} style={{ '--pane-count': agents.length, '--rows-two': Math.ceil(agents.length / 2), '--rows-three': Math.ceil(agents.length / 3) }}>{agents.map(agent => <TerminalPane key={agent.id} agent={agent} send={send} onAction={action} focused={focusedId === agent.id} hidden={!!focusedId && focusedId !== agent.id} onFocus={() => setFocus(focusedId === agent.id ? null : agent.id)} fontSize={fontSize} connected={connected} draggingId={draggingId} dropTargetId={dropTargetId} onDragBegin={setDraggingId} onDragTarget={setDropTargetId} onDragFinish={finishMove} onSwap={swapPanes} onMove={movePane} />)}</div><div className="workspace-footnote"><span><Command size={12} /> Cada painel é um processo independente.</span><button onClick={() => setModal('manage')}>Gerenciar agentes <ArrowUpRight size={12} /></button></div></>}
      </div>
      {view === 'orchestration' && <OrchestrationPanel project={project} agents={agents} providers={providers} tasks={state.tasks || []} connected={connected} request={api} notify={notify} onCoordinator={async (agentId) => {
        const coordinator = await api(`/projects/${projectId}/coordinator`, 'POST', { agentId });
        setView('terminals'); setFocus(coordinator.id); log(`${coordinator.name} aberto com ferramentas do Orquestra`);
      }} />}
      {view === 'memory' && <MemoryPanel project={project} status={state.memory} request={api} notify={notify} />}
      {view === 'activity' && <div className="activity-view"><div className="activity-heading"><h2>Atividade do workspace</h2><span>Últimas 100 ações</span></div>{events.length ? events.map(event => <div className="activity-row" key={event.id}><span className="activity-icon"><Terminal size={14} /></span><p>{event.message}</p><time>{new Date(event.time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>) : <div className="activity-empty"><Activity size={28} /><h3>A história começa com o primeiro agente.</h3><p>Criações, inicializações e envios de tarefas aparecem aqui.</p></div>}</div>}
    </main>
    {taskPanel && <aside className="task-panel"><div className="task-panel-title"><Send size={15} /><strong>Central de tarefas</strong><span className="tiny-badge">MANUAL</span><IconButton icon={X} label="Fechar central de tarefas" onClick={() => setTaskPanel(false)} /></div><p className="task-intro">Uma instrução. Os agentes certos.</p><form onSubmit={dispatch}><label className="section-label" htmlFor="task">O QUE VAMOS FAZER?</label><textarea id="task" placeholder="Descreva a tarefa ou compartilhe contexto com seus agentes…" value={task} maxLength={16000} onChange={e => setTask(e.target.value)} /><div className="task-counter">{task.length.toLocaleString('pt-BR')} / 16.000</div><div className="section-label target-heading">ENVIAR PARA <span>{targets.filter(id => agents.some(a => a.id === id && canReceiveTask(a))).length} selecionados</span></div><div className="targets">{agents.filter(a => a.provider !== 'shell').length ? agents.filter(a => a.provider !== 'shell').map(a => <label key={a.id} className={`target ${!canReceiveTask(a) ? 'disabled' : ''}`}><input type="checkbox" checked={targets.includes(a.id)} disabled={!canReceiveTask(a) || !connected} onChange={e => setTargets(e.target.checked ? [...targets, a.id] : targets.filter(id => id !== a.id))} /><Mark provider={a.provider} small /><span>{a.name}<small>{statusLabel(a)}</small></span><span className={`status-dot ${a.status}`} /></label>) : <div className="no-targets"><Network size={20} /><p>Seus agentes aparecerão aqui.<br />Adicione um para começar.</p></div>}</div><label className="enter-option"><input type="checkbox" checked={submitTask} onChange={e => setSubmitTask(e.target.checked)} />Pressionar Enter após inserir</label><Button type="submit" className="primary send-task" icon={Send} disabled={!connected || busy || !task.trim() || !agents.some(a => targets.includes(a.id) && canReceiveTask(a))}>{busy ? 'Enviando…' : 'Enviar tarefa'}<ArrowUpRight size={14} /></Button><p className="task-tip">O texto é inserido nos terminais selecionados. Acompanhe a resposta em cada painel.</p></form><div className="tip-card"><span><Network size={15} /> Trabalhe em paralelo</span><p>Um agente implementa, outro revisa. Dê a cada um uma responsabilidade clara.</p></div><div className="task-panel-bottom"><span className="status-dot running" /> Conexões diretas com seus CLIs</div></aside>}
    <footer className="status-bar"><span><span className={`status-dot ${connected ? 'running' : ''}`} />{connected ? 'Serviço local conectado' : 'Serviço desconectado'}</span><span>{state.projects.length} {state.projects.length === 1 ? 'projeto' : 'projetos'}<i />{state.agents.filter(a => a.status === 'running').length} terminais ativos</span><span>127.0.0.1<Radio size={11} /></span></footer>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{toast.message}</span><IconButton icon={X} label="Dispensar aviso" onClick={() => setToast(null)} /></div>}
    {modal === 'agent' && project && <AgentModal providers={providers} project={project} onClose={() => setModal(null)} onCreate={createAgent} />}
    {modal === 'project' && <ProjectModal onClose={() => setModal(null)} onCreate={async data => { const p = await api('/projects', 'POST', data); setProjectId(p.id); setModal(null); log(`Projeto ${p.name} adicionado`); }} />}
    {modal === 'settings' && <Modal title="Preferências" subtitle="Um ambiente confortável para trabalhar." onClose={() => setModal(null)}><div className="settings-field"><label htmlFor="font-size">Tamanho do texto dos terminais</label><select id="font-size" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>{[11, 12, 13, 14, 15, 16, 18, 20].map(n => <option key={n} value={n}>{n} px</option>)}</select></div><p className="modal-note">Preferências e layout são salvos neste navegador. Projetos e agentes são salvos localmente pelo aplicativo.</p><div className="modal-footer"><Button className="primary" onClick={() => setModal(null)}>Concluído</Button></div></Modal>}
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
  return <Modal title="Novo agente" subtitle="Um CLI, um terminal, uma responsabilidade." onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onCreate({ provider, name: name.trim() || providerMeta[provider].name, cwd, role, command }, start); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field-label">ESCOLHA O CLI</label><div className="provider-options">{Object.entries(providerMeta).map(([id, p]) => <button key={id} type="button" className={provider === id ? 'chosen' : ''} onClick={() => setProvider(id)}><Mark provider={id} small /><span>{p.name}<small>{id === 'custom' ? 'Seu comando' : providers.find(p => p.id === id)?.available ? 'Disponível' : 'Não detectado'}</small></span>{provider === id && <Check size={14} />}</button>)}</div><label className="field-label" htmlFor="agent-name">NOME DO AGENTE</label><input id="agent-name" placeholder={providerMeta[provider].name} value={name} maxLength={120} onChange={e => setName(e.target.value)} /><label className="field-label" htmlFor="agent-role">RESPONSABILIDADE <span>opcional</span></label><input id="agent-role" placeholder="Ex.: implementar o backend, revisar código…" value={role} maxLength={200} onChange={e => setRole(e.target.value)} />{provider === 'custom' && <><label className="field-label" htmlFor="agent-command">COMANDO DO TERMINAL</label><input id="agent-command" required placeholder="Ex.: ollama run seu-modelo" value={command} maxLength={2000} onChange={e => setCommand(e.target.value)} /><p className="field-help">Executado no shell local exatamente como informado.</p></>}<label className="field-label" htmlFor="agent-cwd">PASTA DE TRABALHO</label><input id="agent-cwd" required value={cwd} onChange={e => setCwd(e.target.value)} /><label className="enter-option"><input type="checkbox" checked={start} onChange={e => setStart(e.target.checked)} />Iniciar terminal ao adicionar</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><Button type="button" onClick={onClose}>Cancelar</Button><Button className="primary" type="submit" icon={Plus} disabled={busy}>{busy ? 'Adicionando…' : 'Adicionar agente'}</Button></div></form></Modal>;
}
function ProjectModal({ onClose, onCreate }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="Novo projeto" subtitle="Organize os agentes por pasta de trabalho." onClose={onClose}><form onSubmit={async e => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError(''); try { await onCreate(Object.fromEntries(form)); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field-label" htmlFor="project-name">NOME DO PROJETO</label><input id="project-name" name="name" required maxLength={120} placeholder="Meu próximo projeto" /><label className="field-label" htmlFor="project-cwd">CAMINHO COMPLETO DA PASTA</label><input id="project-cwd" name="cwd" required placeholder="C:\Users\voce\projetos\meu-projeto" /><p className="field-help">Use uma pasta que já existe no computador.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><Button type="button" onClick={onClose}>Cancelar</Button><Button className="primary" type="submit" disabled={busy} icon={Folder}>{busy ? 'Adicionando…' : 'Adicionar projeto'}</Button></div></form></Modal>;
}
createRoot(document.getElementById('root')).render(<App />);
