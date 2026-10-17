# Core: sessões, tarefas e memória

Esta etapa preserva CI, worktrees, revisão cruzada, persistência JSON, terminais e interface existentes. Não inclui redesign visual ou dependências novas.

## Contrato operacional

Cada abertura de terminal tem um `sessionId` próprio. O identificador do agente permanece estável; a sessão muda ao reiniciar ou entrar no shell de recuperação. As capacidades MCP de uma sessão anterior são recusadas quando o terminal correspondente encerra ou muda de identidade. Saída, replay e entrada do painel carregam a referência da sessão; entradas antigas com essa referência são recusadas após reinício. Clientes antigos sem esse campo continuam aceitos para compatibilidade.

Um processo em execução não comprova que o MCP está conectado. O bridge registra a sessão após receber a notificação de inicialização do protocolo MCP. Somente executores gerenciados com esse registro entram como disponíveis. Sessões manuais, shells de recuperação e terminais ainda inicializando não recebem tarefas gerenciadas.

A tarefa mantém o contrato `queued → running → succeeded/failed/cancelled/interrupted`, com informação de entrega separada:

- `sending`: preparação e envio da instrução;
- `sent`: instrução enviada ao PTY, ainda sem prova de recebimento pelo modelo;
- `acknowledged`: o executor chamou `confirmar_recebimento` ou devolveu uma conclusão válida;
- `unconfirmed`: não houve confirmação no prazo de 90 segundos.

A confirmação de recebimento não conclui a tarefa. `concluir_tarefa` exige o projeto, o agente, o ID da tarefa e a sessão atuais. Uma repetição idêntica na mesma sessão confirma a conclusão já registrada, sem duplicar o resultado; um resultado diferente é recusado. A deduplicação de `request_id` permite recuperar uma tarefa existente mesmo após o executor desconectar. Não reenvia a instrução.

Sem confirmação no prazo, o terminal executor é encerrado e a tarefa falha com motivo explícito; não se presume recebimento pelo texto renderizado. O limite total de execução continua separado. Cancelar uma tarefa antiga não encerra uma sessão que a substituiu. Reiniciar o servidor interrompe tarefas em andamento e preserva o histórico, sem executá-las novamente.

O envelope operacional e o contexto limitado de memória têm orçamento separado dos 16 mil caracteres permitidos para a instrução. Texto colado entre marcadores de bracketed paste preserva LF; Enter é enviado separadamente. O parser HTTP acumula bytes antes de decodificar UTF-8 para preservar caracteres divididos entre pacotes.

## Memória compartilhada e memória do CLI

O Orquestra continua usando o binário oficial `akitaonrails/ai-memory` pelo cliente MCP existente. O escopo é fixado pelo servidor ao projeto autorizado. Leitura e busca consultam o estado atual; o briefing inserido na instrução é apenas uma referência limitada de contexto.

As chamadas desse cliente são serializadas porque o engine usa uma wiki Git compartilhada. Isso evita que gravações de agentes e o registro de várias tarefas operem simultaneamente sobre o mesmo índice por esse cliente. Erros MCP com `isError` também são tratados como erros na inicialização do projeto, e não como sucesso silencioso. Inicialização e chamadas têm prazos definidos. A gravação automática informa `memoryStatus: pending/saved/failed` e `memoryError`; uma falha de memória não transforma uma execução bem-sucedida em falha de código.

O registro da tarefa usa a página existente `tasks/<ID>.md` e inclui pedido, agente, sessão, entrega e resultado. Não foi criado outro sistema de memória ou de histórico de conversas. A serialização cobre o cliente desta instância do Orquestra; não é uma trava global para vários servidores escrevendo simultaneamente nos mesmos dados. Continue usando uma instância por diretório de dados.

O erro `Unknown action 'status'` foi localizado na ferramenta `memory` interna da instalação Hermes: ela aceita `add`, `patch` e `remove`. Esse contrato não é o do AI Memory do projeto. O arquivo instalado também descreve `MEMORY.md`/`USER.md` como snapshots inseridos no começo da sessão. Receber esses blocos não demonstra consulta ou sincronização do projeto. Use `ler_memoria`, `buscar_memoria`, `salvar_memoria` e `resumo_memoria` do MCP Orquestra. O adaptador do Orquestra traduz sua operação `status` para a ferramenta oficial `memory_status`, validada com o binário real.

## Chat e painel

O chat interativo continua pertencendo ao CLI e à sessão do terminal. A instrução delegada entra na mesma conversa e traz o ID operacional da tarefa. A conclusão volta por MCP, vinculada à tarefa/sessão, e os eventos WebSocket atualizam o painel. Não se extrai sucesso de texto da tela ou de código de saída isolado.

O Orquestra mantém um buffer limitado do terminal para reconexões durante a execução. O histórico conversacional durável completo continua sob responsabilidade do CLI. `tasks.json` guarda instruções, resultados e referências operacionais; AI Memory guarda informações relevantes compartilhadas. Reiniciar o backend não restaura automaticamente o processo ou a conversa anterior. O novo `sessionId` impede atribuir respostas ou entradas antigas ao processo novo. Não foi acrescentada captura permanente de todo conteúdo digitado pelo usuário.

## Verificações disponíveis

Testes automatizados usam fixtures e mocks para inicialização MCP, confirmação de recebimento, timeout, resultado duplicado, sessão substituída, revogação de capacidade, limites de envelope, memória serializada e erros MCP. Os testes de servidor usam HTTP/WebSocket e PTYs reais com CLI de fixture, incluindo entrada obsoleta após reinício. Eles não demonstram inferência de um agente real.

Comandos opcionais para integração real, usando logins já existentes:

```powershell
# Inspeciona o aplicativo em execução; não envia prompt a modelos.
node scripts/check-core-session.mjs inspect
# Abre uma nova sessão gerenciada no aplicativo atual, sem enviar tarefa.
node scripts/check-core-session.mjs prepare opencode
# Verifica o binário AI Memory real com dados temporários e reinício do cliente.
node scripts/check-memory.mjs
# Envia uma tarefa por dois agentes OpenCode reais, em outra instância isolada.
node scripts/check-core-e2e.mjs
```

O E2E usa porta `14329`, duas sessões OpenCode e dados em `.local-core-e2e-*`. Ele pode consumir chamadas do modelo. Verifica solicitação ao coordenador, delegação MCP, confirmação do executor, leitura de valor desconhecido pelo prompt, escrita compartilhada, conclusão, estado WebSocket e recuperação da tarefa/nota após reiniciar somente o servidor de teste. Usa renderização headless do terminal para responder às consultas de terminal; não é teste visual do navegador. Guarda um `result.json` sem credenciais na pasta de evidências. Não encerra as sessões do aplicativo principal.

Esses comandos reais não fazem parte do CI e podem precisar de execução fora de sandboxes que bloqueiem o engine Git/AI Memory ou o encerramento de processos próprios. Falhas por cota, autenticação ou indisponibilidade do modelo devem ser registradas como limitações externas; não comprovam defeito do Orquestra.

Hermes, Gemini e Antigravity continuam manuais quando não possuem adaptador gerenciado. Não basta marcar um CLI como disponível para torná-lo executor MCP. Nesta etapa a comunicação real foi validada com OpenCode; não foi presumido suporte gerenciado Hermes nem alterada sua configuração pessoal.
