import React, { useEffect, useState } from 'react';
import { Search, Plus, Save, BookOpen, ArrowRight, Trash2 } from 'lucide-react';

export default function MemoryPanel({ project, status, request, notify }) {
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(null);
  const [handoffs, setHandoffs] = useState([]);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const route = `/projects/${project?.id}/memory/`;
  const run = async action => { setBusy(true); try { await action(); } catch (e) { notify(e.message, true); } finally { setBusy(false); } };
  const refresh = async () => {
    const recent = await request(route + 'recent'); setPages(recent.hits || []);
    const next = await request(route + 'handoff_list'); setHandoffs(next.handoffs || []);
  };
  useEffect(() => {
    setPage(null); setEditing(false); setPages([]); setHandoffs([]); setQuery('');
    let disposed = false;
    if (project && status?.status === 'ready') {
      Promise.all([request(route + 'recent'), request(route + 'handoff_list')]).then(([r, h]) => { if (!disposed) { setPages(r.hits || []); setHandoffs(h.handoffs || []); } }).catch(e => { if (!disposed) notify(e.message, true); });
    }
    return () => { disposed = true; };
  }, [project?.id, status?.status, request, notify]);
  return <div className="orchestration-view memory-view">
    <div className="orchestration-intro"><div><span className="eyebrow">MEMÓRIA COMPARTILHADA</span><h2>O contexto acompanha sua equipe.</h2><p>Decisões, aprendizados e resultados ficam disponíveis para os agentes deste projeto, inclusive nas próximas sessões.</p></div><span className={`task-state ${status?.status === 'ready' ? 'task-succeeded' : 'task-failed'}`}>{status?.status === 'ready' ? 'AI Memory conectado · local' : status?.status === 'starting' ? 'Conectando…' : 'Memória indisponível'}</span></div>
    {status?.error && <p className="task-error">{status.error}</p>}
    <div className="memory-controls"><form onSubmit={e => { e.preventDefault(); run(async () => { if (!query.trim()) return refresh(); const result = await request(route + 'query', 'POST', { query }); setPages(result.hits || []); }); }}><input aria-label="Buscar na memória" placeholder="Buscar decisões, tarefas, aprendizados…" value={query} onChange={e => setQuery(e.target.value)} maxLength={2000} /><button className="button" disabled={busy || status?.status !== 'ready'}><Search size={14} />Buscar</button></form><button className="button primary" disabled={busy || status?.status !== 'ready'} onClick={() => { setPage(null); setBody('# Nova memória\n\n'); setEditing(true); }}><Plus size={14} />Nova memória</button></div>
    <div className="task-monitor"><div className="task-history">{pages.map(item => <button key={item.path} className={`task-history-item ${page?.path === item.path ? 'selected' : ''}`} onClick={() => run(async () => { const next = await request(route + 'read', 'POST', { path: item.path }); setPage(next); setBody(next.body); setEditing(false); })}><BookOpen size={14} /><strong>{item.title || item.path}</strong><span>{String(item.snippet || '').replace(/<\/?mark>/g, '').slice(0, 150)}</span></button>)}{!pages.length && <p>Nenhuma memória encontrada. Notas e tarefas concluídas aparecerão aqui.</p>}</div>
    <section className="task-detail">{editing ? <form className="memory-editor" onSubmit={e => { e.preventDefault(); run(async () => { const path = page?.path || `notes/${crypto.randomUUID()}.md`; await request(route + 'write', 'POST', { path, body }); setPage(await request(route + 'read', 'POST', { path })); setEditing(false); await refresh(); }); }}><label>Conteúdo da memória<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={32000} required /></label><button className="button primary" disabled={busy || !body.trim()}><Save size={14} />Salvar memória</button></form> : page ? <><header><strong>{page.title || 'Memória'}</strong><div className="memory-page-actions"><button className="button" onClick={() => setEditing(true)}>Editar</button><button className="button danger" disabled={busy} onClick={() => { if (window.confirm(`Excluir permanentemente a memória “${page.title || page.path}”?`)) run(async () => { await request(route + 'delete', 'POST', { path: page.path, expected_page_id: page.page_id }); setPage(null); setBody(''); notify('Memória excluída.'); await refresh(); }); }}><Trash2 size={14} />Excluir</button></div></header><pre className="memory-body">{page.body}</pre><small>{page.path} · O histórico é preservado pelo AI Memory.</small></> : <p>Selecione uma memória para ler, ou crie uma nota para compartilhar com os agentes.</p>}</section></div>
    <div className="task-history-heading"><h3>Passagens de contexto</h3><button className="button" disabled={busy || status?.status !== 'ready'} onClick={() => run(refresh)}>Atualizar</button></div>
    <p>O coordenador pode guardar um handoff ao encerrar o trabalho. Aceite um contexto quando quiser retomá-lo; cada handoff é consumido uma vez.</p>
    {handoffs.map(h => <article className="memory-handoff" key={h.id}><strong>{h.summary}</strong>{h.next_steps?.length > 0 && <ul>{h.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ul>}<button className="button" disabled={busy} onClick={() => run(async () => { await request(route + 'handoff_accept', 'POST', { handoff_id: h.id }); notify('Contexto aceito. Use o resumo acima para retomar o trabalho.'); await refresh(); })}><ArrowRight size={13} />Aceitar contexto</button></article>)}{!handoffs.length && <p>Nenhum handoff pendente.</p>}
  </div>;
}
