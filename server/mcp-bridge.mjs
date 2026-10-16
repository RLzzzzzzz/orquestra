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
  ['listar_agentes', 'Lista os executores cadastrados neste projeto, suas responsabilidades e disponibilidade.', {}],
  ['enviar_tarefa', 'Delega uma tarefa a um executor. Retorna imediatamente um task_id. Reutilize request_id somente ao repetir a mesma solicitação. Consulte o resultado antes de afirmar que terminou.', { agent_id: z.string().uuid(), instruction: z.string().min(1).max(16000), title: z.string().max(140).optional(), request_id: z.string().min(1).max(120) }],
  ['consultar_tarefa', 'Consulta status, resultado e erros. Aguarda até wait_ms (máximo 25000) se a tarefa ainda estiver ativa.', { task_id: taskId, wait_ms: z.number().int().min(0).max(25000).optional() }],
  ['listar_tarefas', 'Lista o histórico de tarefas deste projeto.', {}],
  ['cancelar_tarefa', 'Cancela uma tarefa em fila ou encerra o processo de uma tarefa em execução deste projeto.', { task_id: taskId }],
];
for (const [name, description, inputSchema] of definitions) server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: ['listar_agentes', 'consultar_tarefa', 'listar_tarefas'].includes(name), destructiveHint: ['enviar_tarefa', 'cancelar_tarefa'].includes(name), openWorldHint: name === 'enviar_tarefa' } }, async args => {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }], ...(response.ok ? {} : { isError: true }) };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: `Não foi possível acessar o Orquestra: ${error.message}` }] }; }
});
await server.connect(new StdioServerTransport());
