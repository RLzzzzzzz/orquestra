import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const endpoint = process.env.ORQUESTRA_MCP_URL;
const token = process.env.ORQUESTRA_MCP_TOKEN;
if (!endpoint || !token) { console.error('Inicie o coordenador pela interface do Orquestra.'); process.exit(1); }
const url = new URL(endpoint);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/internal/orchestration') throw new Error('O MCP só pode se conectar ao serviço local do Orquestra.');
const server = new McpServer({ name: 'orquestra', version: '0.2.0' }, { instructions: 'Você coordena os executores externos deste projeto. Liste agentes, delegue tarefas com request_id único e consulte até terminar. Não confunda executando com concluído. Não use subagentes internos no lugar dos executores cadastrados. Respeite permissões e relate erros.' });
const taskId = z.string().uuid();
const definitions = [
  ['buscar_memoria', 'Busca memória persistente deste projeto no AI Memory.', { query: z.string().min(1).max(2000) }],
  ['salvar_memoria', 'Salva decisão, aprendizado ou instrução durável no AI Memory. Não grave segredos.', { path: z.string().max(200), body: z.string().min(1).max(32000), tier: z.enum(['working', 'episodic', 'semantic', 'procedural']).optional(), pinned: z.boolean().optional() }],
  ['ler_memoria', 'Lê uma página de memória deste projeto.', { path: z.string().max(200) }],
  ['resumo_memoria', 'Consulta contexto recente e decisões compartilhadas do projeto, sem chamada adicional a um modelo.', {}],
  ['listar_handoffs', 'Lista passagens de contexto pendentes deste projeto.', {}],
  ['criar_handoff', 'Guarda uma passagem de contexto ao encerrar trabalho para outro agente ou sessão.', { summary: z.string().min(1).max(4000), next_steps: z.array(z.string().max(1000)).max(15).optional() }],
  ['aceitar_handoff', 'Consome uma passagem de contexto por ID, uma única vez.', { handoff_id: z.string().min(1).max(120) }],
  ['concluir_tarefa', 'O executor confirma o resultado da tarefa recebida neste próprio terminal. Obrigatório ao terminar, inclusive em falha.', { task_id: taskId, status: z.enum(['succeeded', 'failed']), result: z.string().min(1).max(48000) }],
  ['criar_tarefa', 'Cria uma tarefa compartilhada no quadro deste projeto. Use para registrar trabalho que você ou outro agente precisa executar.', { title: z.string().min(1).max(140), description: z.string().max(16000).optional(), status: z.enum(['todo', 'in_progress', 'paused', 'blocked', 'done', 'cancelled']).optional() }],
  ['atualizar_tarefa', 'Atualiza título, descrição ou status de uma tarefa manual do quadro. Use paused se precisar aguardar uma decisão, blocked se houver impedimento e done ao concluir.', { task_id: taskId, title: z.string().min(1).max(140).optional(), description: z.string().max(16000).optional(), status: z.enum(['todo', 'in_progress', 'paused', 'blocked', 'done', 'cancelled']).optional() }],
  ['listar_agentes', 'Lista os executores cadastrados neste projeto, suas responsabilidades e disponibilidade.', {}],
  ['enviar_tarefa', 'Delega uma tarefa a um executor. Retorna imediatamente um task_id. Reutilize request_id somente ao repetir a mesma solicitação. Consulte o resultado antes de afirmar que terminou.', { agent_id: z.string().uuid(), instruction: z.string().min(1).max(16000), title: z.string().max(140).optional(), request_id: z.string().min(1).max(120) }],
  ['consultar_tarefa', 'Consulta status, resultado e erros. Aguarda até wait_ms (máximo 25000) se a tarefa ainda estiver ativa.', { task_id: taskId, wait_ms: z.number().int().min(0).max(25000).optional() }],
  ['listar_tarefas', 'Lista o histórico de tarefas deste projeto.', {}],
  ['cancelar_tarefa', 'Cancela uma tarefa em fila ou encerra o processo de uma tarefa em execução deste projeto.', { task_id: taskId }],
];
for (const [name, description, inputSchema] of definitions) server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: ['listar_agentes', 'consultar_tarefa', 'listar_tarefas'].includes(name), destructiveHint: ['enviar_tarefa', 'cancelar_tarefa', 'criar_tarefa', 'atualizar_tarefa'].includes(name), openWorldHint: name === 'enviar_tarefa' } }, async args => {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }], ...(response.ok ? {} : { isError: true }) };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: `Não foi possível acessar o Orquestra: ${error.message}` }] }; }
});
await server.connect(new StdioServerTransport());
