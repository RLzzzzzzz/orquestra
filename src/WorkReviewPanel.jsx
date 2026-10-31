import React, { useEffect, useState } from 'react';

const labels = { implementing: 'Implementação', reviewing: 'Revisão', testing: 'Teste pelo agente', awaiting_validation: 'Aguardando validação local', validating: 'Validando', approved: 'Aprovada', needs_changes: 'Correções solicitadas', validation_failed: 'Validação reprovada', blocked: 'Bloqueada', interrupted: 'Interrompida' };
export default function WorkReviewPanel(props) {
  if (!props.project) return null;
  return <ProjectWorkReviewPanel key={props.project.id} {...props} agents={props.agents.filter(agent => agent.projectId === props.project.id)} />;
}

function ProjectWorkReviewPanel({ project, agents, connected, request, notify }) {
  const [trees, setTrees] = useState([]), [reviews, setReviews] = useState([]), [tree, setTree] = useState(null);
  const [selected, setSelected] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(''), [roles, setRoles] = useState({ implementer: '', reviewer: '', tester: '' }), [cycles, setCycles] = useState(1);
  const base = `/projects/${project.id}`;
  const workers = agents.filter(a => !a.coordinator && a.status === 'running' && a.mode === 'agent' && a.managed && a.mcpReady && !a.taskId);
  const refresh = async () => {
    const [a, b] = await Promise.all([request(base + '/worktrees'), request(base + '/reviews')]);
    setTrees(a); setReviews(b);
  };
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try { const [a, b] = await Promise.all([request(base + '/worktrees'), request(base + '/reviews')]); if (!disposed) { setTrees(a); setReviews(b); } }
      catch (error) { if (!disposed) notify(error.message, true); }
    };
    load(); const timer = setInterval(load, 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [base, request, notify]);
  const act = async fn => { setBusy(true); try { await fn(); await refresh(); } catch (error) { notify(error.message, true); } finally { setBusy(false); } };
  return <section className="git-review-panel">
    <h3>Worktrees e revisão cruzada</h3>
    <p>Prepare a worktree antes de abrir o terminal. Cada agente recebe uma branch única baseada no último commit; alterações sem commit na pasta original não são copiadas.</p>
    <div className="git-toolbar"><select aria-label="Agente para worktree" disabled={!connected || busy} value={selected} onChange={e => { setSelected(e.target.value); setTree(null); }}><option value="">Escolha um agente</option>{agents.filter(a => !a.coordinator).map(a => <option value={a.id} key={a.id}>{a.name}{a.worktree ? ' · isolado' : ''}</option>)}</select>
      <button className="button" disabled={!connected || busy || !selected} onClick={() => act(async () => { await request(`${base}/worktrees/${selected}/prepare`, 'POST', {}); notify('Worktree preparada. Agora abra o terminal do agente.'); })}>Preparar worktree</button>
      <button className="button" disabled={!connected || busy || !selected} onClick={() => act(async () => setTree(await request(`${base}/worktrees/${selected}`)))}>Revisar diff e commits</button></div>
    {trees.map(t => <details key={t.agentId}><summary>{t.agentName} · {t.branch}</summary><code>{t.cwd}</code>{t.error ? <p className="task-error">{t.error}</p> : <><p>{t.changedFiles.length} arquivos · {t.commits.length} commits · {t.conflicts.length} conflitos Git</p><pre>{t.changedFiles.join('\n') || 'Sem alterações'}</pre>{t.possibleConflicts.length > 0 && <p className="task-error">Possíveis conflitos: {t.possibleConflicts.map(c => c.path).join(', ')}</p>}</>}</details>)}
    {tree && <div className="git-diff"><h4>Revisão antes do commit</h4><code>{tree.branch}</code><pre>{tree.files.map(f => `${f.status} ${f.path}`).join('\n') || 'Sem alterações pendentes'}</pre><pre>{tree.diff || 'Sem diff rastreado'}{tree.untracked.map(f => `\nNovo arquivo: ${f.path}\n${f.text}`).join('')}</pre><details><summary>Commits da branch</summary><pre>{tree.commits.join('\n') || 'Nenhum commit'}</pre></details>
      <label><input type="checkbox" checked={tree.autoCommit} disabled={!connected || busy} onChange={e => { const enabled = e.target.checked; if (enabled && !window.confirm('Autorizar este agente a criar commits na sua branch sem nova confirmação?')) return; act(async () => { await request(`${base}/worktrees/${selected}/settings`, 'POST', { autoCommit: enabled }); setTree(await request(`${base}/worktrees/${selected}`)); }); }} /> Permitir commits automáticos para este agente</label>
      <form className="git-toolbar" onSubmit={e => { e.preventDefault(); if (!window.confirm('Autorizar um commit com todos os arquivos pendentes listados nesta worktree?')) return; act(async () => { setTree(await request(`${base}/worktrees/${selected}/commit`, 'POST', { message, revision: tree.revision, authorized: true })); setMessage(''); }); }}><input aria-label="Mensagem do commit" value={message} onChange={e => setMessage(e.target.value)} maxLength={500} placeholder="feat: descreva a alteração" /><button className="button" disabled={!connected || busy || !message.trim() || !tree.files.length}>Autorizar commit revisado</button></form></div>}
    <h4>Implementador → revisor → testador</h4><p>Abra ao menos dois executores. O revisor deve ser diferente do implementador; ele também pode testar. A seleção automática usa os terminais disponíveis.</p>
    <form className="delegate-form" onSubmit={e => { e.preventDefault(); act(async () => { await request(base + '/reviews', 'POST', { prompt, ...Object.fromEntries(Object.entries(roles).filter(([, value]) => value)), maxCycles: cycles }); setPrompt(''); }); }}>
      <div className="git-toolbar">{[['implementer', 'Implementador'], ['reviewer', 'Revisor'], ['tester', 'Testador']].map(([role, label]) => <label key={role}>{label}<select disabled={!connected || busy} value={roles[role]} onChange={e => setRoles({ ...roles, [role]: e.target.value })}><option value="">Automático</option>{workers.filter(a => role !== 'implementer' || a.worktree).map(a => <option value={a.id} key={a.id}>{a.name} · {a.provider}</option>)}</select></label>)}<label>Limite de ciclos<select value={cycles} onChange={e => setCycles(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label></div>
      <label>Objetivo<textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000} required /></label><button className="button primary" disabled={!connected || busy || !prompt.trim() || workers.length < 2 || !workers.some(a => a.worktree) || Object.entries(roles).some(([role, id]) => id && !workers.some(a => a.id === id && (role !== 'implementer' || a.worktree))) || (roles.implementer && roles.implementer === roles.reviewer)}>Iniciar revisão cruzada</button></form>
    {reviews.slice().reverse().map(r => <article className="review-report" key={r.id}><h4>{r.prompt}</h4><strong>{labels[r.status] || r.status} · ciclo {r.cycle}/{r.maxCycles}</strong><p>Implementador: {r.roles.implementer.name} · Revisor: {r.roles.reviewer.name} · Testador: {r.roles.tester.name}</p><code>{r.branch}</code><details><summary>Arquivos e commits</summary><pre>{(r.files || []).join('\n') || 'Aguardando implementação'}{'\n'}{(r.commits || []).join('\n')}</pre></details><details><summary>Relatórios dos agentes</summary><pre>{JSON.stringify(r.stages, null, 2)}</pre></details><p>Problemas: {r.findings.join('; ') || 'Nenhum registrado'}</p>{r.tests.map((t, i) => <details key={i}><summary>{t.passed ? 'Aprovado' : 'Reprovado'} · {t.command} · saída {t.exitCode ?? 'indisponível'}</summary><pre>{t.output}{t.error}</pre></details>)}{r.pending.map((p, i) => <p key={i} className="field-help">{p}</p>)}<div className="git-toolbar">{['awaiting_validation', 'validation_failed'].includes(r.status) && <button className="button" disabled={!connected || busy} onClick={() => act(() => request(`${base}/reviews/${r.id}/validate`, 'POST', {}))}>Executar check/test/build e validar</button>}{['blocked', 'needs_changes', 'interrupted', 'validation_failed'].includes(r.status) && <button className="button" disabled={!connected || busy || r.cycle >= r.maxCycles} onClick={() => act(() => request(`${base}/reviews/${r.id}/retry`, 'POST', {}))}>Encaminhar correções ao implementador</button>}</div></article>)}
  </section>;
}
