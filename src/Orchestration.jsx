import React, { useEffect, useRef, useState } from 'react';
import { Network, Play, Send, Square, RotateCcw, Terminal, Check, Clock, AlertCircle } from 'lucide-react';
import WorkReviewPanel from './WorkReviewPanel.jsx';

const labels = { queued: 'Na fila', running: 'Executando', cancelling: 'Cancelando', succeeded: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', interrupted: 'Interrompida', awaiting_approval: 'Precisa de ação' };
const active = task => ['queued', 'running', 'cancelling'].includes(task.status);
export default function OrchestrationPanel({ project, agents, providers, tasks, connected, request, onCoordinator, notify }) {
  const [leader, setLeader] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [worker, setWorker] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDelegate, setShowDelegate] = useState(false);
  const outputRef = useRef(null);
  const coordinator = agents.find(a => a.coordinator);
  const candidates = agents.filter(a => !a.coordinator && providers.some(p => p.id === a.provider && p.coordinator && p.available));
  const leaderId = candidates.some(a => a.id === leader) ? leader : candidates.find(a => a.id === coordinator?.sourceAgentId)?.id || candidates[0]?.id || '';
  const workers = agents.filter(a => !a.coordinator && a.status === 'running' && a.mode === 'agent' && a.managed && a.mcpReady);
  const history = tasks.filter(t => t.projectId === project?.id && t.kind === 'delegated').slice().reverse();
  const selectedId = history.some(t => t.id === selected) ? selected : history[0]?.id;
  const selectedTask = history.find(t => t.id === selectedId);
  useEffect(() => { setSelected(null); setWorker(''); setInstruction(''); }, [project?.id]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let disposed = false, timer;
    setDetail(null);
    const refresh = async () => {
      try {
        const next = await request(`/tasks/${selectedId}`);
        if (!disposed) { setDetail(next); if (active(next)) timer = setTimeout(refresh, 1000); }
      } catch (error) { if (!disposed) { notify(error.message, true); timer = setTimeout(refresh, 3000); } }
    };
    refresh(); return () => { disposed = true; clearTimeout(timer); };
  }, [selectedId, selectedTask?.status, request, notify]);
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [detail?.output]);
  const perform = async action => {
    setBusy(true); try { await action(); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  };
  return <div className="orchestration-view">
    {project && <WorkReviewPanel key={project.id} project={project} agents={agents} connected={connected} request={request} notify={notify} />}
    <div className="orchestration-intro"><div><span className="eyebrow">COORDENADOR DO PROJETO</span><h2>Um objetivo. Uma equipe de agentes.</h2><p>Escolha quem coordena e descreva o objetivo no terminal dele. O agente distribui o trabalho e consulta os resultados pelo Orquestra.</p></div><div className="coordinator-choice"><label>Quem coordena?<select aria-label="Escolher coordenador" value={leaderId} onChange={e => setLeader(e.target.value)} disabled={busy}>{!candidates.length && <option value="">Adicione um CLI compatível</option>}{candidates.map(a => <option key={a.id} value={a.id}>{a.name} · {a.provider}</option>)}</select></label><small>Abre uma sessão separada. Trocar encerra a sessão anterior do coordenador.</small><button className="button primary" disabled={!connected || busy || !project || !leaderId} onClick={() => perform(() => onCoordinator(leaderId))}><Network size={15} />{coordinator?.status === 'running' && coordinator.mode === 'coordinator' && coordinator.sourceAgentId === leaderId ? 'Ver coordenador' : 'Abrir coordenador'}</button></div></div>
    <p className="field-help">Coordenadores: Codex, OpenCode, Claude e Freebuff. Antigravity e Hermes: terminais manuais, sem automação habilitada. O Freebuff pode solicitar confiança no MCP na primeira abertura.</p>
    <div className="orchestration-stats"><span><Network size={15} /><strong>{workers.length}</strong> executores disponíveis</span><span><Play size={14} /><strong>{history.filter(t => t.status === 'running').length}</strong> executando</span><span><Clock size={14} /><strong>{history.filter(t => ['queued', 'awaiting_approval'].includes(t.status)).length}</strong> aguardando</span><span><Check size={14} /><strong>{history.filter(t => t.status === 'succeeded').length}</strong> concluídas</span><span><AlertCircle size={14} /><strong>{history.filter(t => ['failed', 'interrupted'].includes(t.status)).length}</strong> com erro</span></div>
    <div className="orchestration-guide"><p><strong>Como começar:</strong> adicione executores em “Novo agente”, abra o coordenador e peça, por exemplo: “Delegue ao OpenCode a revisão do README e depois resuma o resultado”.</p><p>Tarefas automáticas na mesma pasta entram em fila. Em pastas separadas, até três podem executar em paralelo. O coordenador envia a tarefa à conversa já aberta de cada executor. Veja as respostas ao vivo na aba Terminais.</p></div>
    <div className="task-history-heading"><h3>Tarefas delegadas</h3><button className="button" disabled={!workers.length || !connected} onClick={() => setShowDelegate(!showDelegate)}><Send size={13} />Delegar diretamente</button></div>
    {showDelegate && <form className="delegate-form" onSubmit={event => {
      event.preventDefault(); perform(async () => {
        const created = await request('/tasks', 'POST', { projectId: project.id, agentId: worker || workers[0]?.id, prompt: instruction, requestId: crypto.randomUUID() });
        setSelected(created.id); setInstruction(''); setShowDelegate(false);
      });
    }}><label>Executor<select value={worker || workers[0]?.id || ''} onChange={event => setWorker(event.target.value)}>{workers.map(a => <option key={a.id} value={a.id}>{a.name} · {a.provider}</option>)}</select></label><label>Instrução<textarea value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={16000} required placeholder="Descreva uma tarefa com resultado esperado…" /></label><button type="submit" className="button primary" disabled={busy || !instruction.trim() || !connected}>Enviar para a fila</button></form>}
    {!history.length ? <div className="orchestration-empty"><Network size={30} /><h3>Pronto para a primeira delegação.</h3><p>As tarefas criadas pelo coordenador aparecerão aqui com saída ao vivo e resultado.</p>{!workers.length && <p>Abra um terminal Codex, OpenCode ou Claude para disponibilizá-lo ao coordenador.</p>}</div> : <div className="task-monitor">
      <div className="task-history">{history.map(task => <button key={task.id} className={`task-history-item ${selectedId === task.id ? 'selected' : ''}`} onClick={() => setSelected(task.id)}><span className={`task-state task-${task.status}`}>{labels[task.status] || task.status}</span><strong>{task.title}</strong><span>{task.agentName} · {new Date(task.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>
      <section className="task-detail">{detail && detail.id === selectedId ? <><header><div><strong>{detail.agentName}</strong><span className={`task-state task-${detail.status}`}>{labels[detail.status]}</span></div>{active(detail) ? <button className="button" disabled={busy || !connected || detail.status === 'cancelling'} onClick={() => perform(() => request(`/tasks/${detail.id}/cancel`, 'POST'))}><Square size={12} />Cancelar</button> : <button className="button" disabled={busy || !connected || !workers.some(w => w.id === detail.agentId)} onClick={() => perform(async () => { const next = await request('/tasks', 'POST', { projectId: project.id, agentId: detail.agentId, prompt: detail.prompt, title: detail.title, requestId: crypto.randomUUID() }); setSelected(next.id); })}><RotateCcw size={12} />Reexecutar</button>}</header><details className="task-instruction"><summary>Instrução e pasta de trabalho</summary><code>{detail.cwd}</code><p>{detail.prompt}</p></details>{detail.error && <div className="task-error"><AlertCircle size={15} /><span>{detail.error}</span></div>}<div className="task-output-label"><Terminal size={13} />Saída da execução <span>Atualiza a cada segundo</span></div><pre className="task-output" ref={outputRef}>{detail.output || 'Aguardando executor e pasta disponíveis…'}</pre>{detail.result && <div className="task-result"><h4>Resultado do executor</h4><pre>{detail.result}</pre></div>}</> : <p className="task-loading">Carregando tarefa…</p>}</section>
    </div>}
  </div>;
}
