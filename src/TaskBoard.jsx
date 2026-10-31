import React, { useState } from 'react';
import { ListTodo, Plus, Pause, CircleCheck, Ban, Play, CircleAlert } from 'lucide-react';

const labels = { todo: 'A fazer', in_progress: 'Em andamento', paused: 'Pausada', blocked: 'Bloqueada', done: 'Concluída', cancelled: 'Cancelada', queued: 'Na fila', running: 'Executando', cancelling: 'Cancelando', succeeded: 'Concluída', failed: 'Falhou', interrupted: 'Interrompida', awaiting_approval: 'Precisa de ação' };
const columns = ['todo', 'in_progress', 'paused', 'blocked', 'done', 'cancelled'];
const executionState = task => ({ queued: 'todo', running: 'in_progress', cancelling: 'paused', succeeded: 'done', cancelled: 'cancelled', failed: 'blocked', interrupted: 'blocked', awaiting_approval: 'paused' }[task.status] || 'todo');
const icons = { todo: ListTodo, in_progress: Play, paused: Pause, blocked: CircleAlert, done: CircleCheck, cancelled: Ban };

export default function TaskBoard(props) {
  if (!props.project) return <p className="orchestration-empty">Selecione um projeto para organizar as tarefas.</p>;
  return <ProjectTaskBoard key={props.project.id} {...props} />;
}

function ProjectTaskBoard({ project, tasks, request, notify, connected }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false);
  const board = tasks.filter(task => task.projectId === project?.id);
  const create = async event => {
    event.preventDefault(); if (!connected || busy || !title.trim()) return;
    setBusy(true); try { await request(`/projects/${project.id}/board-tasks`, 'POST', { title, description, status: 'todo' }); setTitle(''); setDescription(''); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  };
  const change = async (task, status) => {
    if (!connected || busy || task.kind !== 'board') return;
    setBusy(true); try { await request(`/projects/${project.id}/board-tasks/${task.id}`, 'PATCH', { status }); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  };
  return <div className="orchestration-view task-board-view">
    <p className="field-help"><strong>Projeto: {project.name}</strong> · Tarefas da equipe neste projeto.</p>
    <div className="orchestration-intro"><div><span className="eyebrow">QUADRO DO PROJETO</span><h2>O trabalho de todos, em um só lugar.</h2><p>Você, o coordenador e os executores compartilham este quadro. Delegações aparecem automaticamente e os agentes podem criar ou atualizar tarefas pelo terminal.</p></div></div>
    <form className="task-create" onSubmit={create}><input value={title} maxLength={140} onChange={event => setTitle(event.target.value)} placeholder="Nova tarefa do projeto" aria-label="Título da tarefa" /><input value={description} maxLength={16000} onChange={event => setDescription(event.target.value)} placeholder="Contexto ou resultado esperado (opcional)" aria-label="Descrição da tarefa" /><button className="button primary" disabled={!connected || busy || !title.trim()}><Plus size={14} />Adicionar tarefa</button></form>
    <div className="task-board">{columns.map(status => { const Icon = icons[status]; const items = board.filter(task => (task.kind === 'board' ? task.status : executionState(task)) === status); return <section key={status} className="task-column"><header><Icon size={14} /><strong>{labels[status]}</strong><span>{items.length}</span></header><div>{items.map(task => <article key={task.id} className={`board-card ${task.kind === 'delegated' ? 'delegated' : ''}`}><span className="board-card-source">{task.kind === 'delegated' ? `Delegada · ${task.agentName}` : task.source === 'executor' ? 'Criada por executor' : task.source === 'coordenador' ? 'Criada pelo coordenador' : 'Criada por você'}</span><strong>{task.title}</strong>{(task.description || task.kind === 'delegated') && <p>{task.description || task.prompt}</p>}<footer>{task.kind === 'board' ? <select aria-label={`Status de ${task.title}`} value={task.status} disabled={busy || !connected} onChange={event => change(task, event.target.value)}>{columns.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select> : <span className={`task-state task-${task.status}`}>{labels[task.status]}</span>}</footer></article>)}{!items.length && <p className="task-column-empty">Nenhuma tarefa.</p>}</div></section>; })}</div>
    <p className="field-help">Tarefas delegadas refletem automaticamente o estado real da execução. Tarefas criadas no quadro podem ser atualizadas por você ou pelos agentes conectados.</p>
  </div>;
}
