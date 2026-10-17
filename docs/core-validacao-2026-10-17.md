# Validação da estabilização do core — 17/10/2026

O trabalho anterior de CI, worktrees e revisão foi preservado. Esta etapa alterou somente o comportamento do core e a ligação de sessões/eventos com o painel, sem redesign, novas dependências, commits, push ou PR.

## Problemas e correções

| Problema encontrado | Correção |
| --- | --- |
| Terminal em execução era considerado disponível sem comprovar a conexão MCP | Registro da sessão após inicialização real do protocolo; disponibilidade exige `mcpReady` |
| Não havia distinção entre instrução enviada e recebida pelo executor | Confirmação `confirmar_recebimento`, metadados de entrega e prazo de 90 segundos |
| Identificador do agente era reutilizado após troca de processo | `sessionId` por abertura, revogação de capacidades antigas e validação da sessão na conclusão |
| Cancelamento antigo poderia atingir a sessão substituta | Encerramento vinculado ao processo original da tarefa |
| Repetições de conclusão ou pedido após perda de resposta eram recusadas desnecessariamente | Conclusão idêntica idempotente na mesma sessão; recuperação de `request_id` existente mesmo com executor desconectado |
| Contexto operacional podia exceder o limite reservado à instrução do usuário | Orçamento separado para envelope e contexto; LF preservado em bracketed paste |
| Entradas e eventos do painel não carregavam identidade da sessão | Referências de sessão em HTTP/WebSocket; recusa de entrada antiga e publicação da nova identidade antes da saída de recuperação |
| Falhas do briefing eram ocultadas e gravação da tarefa não tinha estado próprio | `contextStatus/contextError` e `memoryStatus/memoryError` separados do resultado da execução |
| Cliente podia enviar operações simultâneas à wiki Git compartilhada | Serialização das chamadas, tratamento de respostas MCP `isError` e limites de inicialização/chamada |
| `Unknown action 'status'` era interpretado como falha genérica de memória | Identificada a ferramenta interna Hermes, que aceita `add/patch/remove`; instruções e documentação distinguem essa memória do AI Memory do projeto |

O erro histórico Windows OS 183 não foi reproduzido isoladamente nesta etapa. A serialização trata o risco concreto de concorrência observado no código; não representa prova de que toda ocorrência desse erro tenha a mesma causa.

## Testes automatizados finais

Ambiente: Windows x64, Node.js 24.20.0 e npm 11.19.0.

- `npm.cmd run test:coverage`: **57 testes, 57 aprovados, nenhuma falha, cancelamento ou skip**, cerca de 11,9 segundos.
- `npm.cmd run check`: **46 arquivos aprovados**, manifesto e lockfile consistentes.
- `git diff --check`: aprovado.
- Build Vite e preparação do backend: aprovados. O empacotamento para a saída anterior recebeu `EPERM` na renomeação do diretório Windows. Somente o empacotamento foi repetido em nova saída, usando o mesmo backend preparado, e terminou com código 0: `release/core-verificacao-20261017/win-unpacked/Orquestra.exe`. O hook verificou dependências locais e imports do backend. Não foi necessário repetir os testes nem alterar o código para gerar essa saída.
- O teste de servidor usa PTYs, HTTP e WebSocket reais com CLIs de fixture; não usa agentes autenticados. Porta temporária, memória explicitamente simulada e probes de fornecedores de fixture evitam dependência das instalações pessoais.
- Regressões novas cobrem recebimento, prazo, sessão obsoleta, capacidade revogada, conclusão duplicada, cancelamento de processo substituído, limite do envelope, LF, serialização e erro MCP, recuperação idempotente e falha de persistência independente da execução.

Cobertura LCOV final: **85,76% de linhas, 74,96% de branches e 80,20% de funções** dos módulos instrumentados. O denominador agora inclui `terminals.mjs`, importado diretamente pelos novos testes; por isso não é comparável diretamente aos 90,55% anteriores. A execução completa de PTYs em subprocessos, o frontend e a janela Electron não entram automaticamente nesse percentual.

Tentativas anteriores encontraram problemas nas fixtures e no ambiente: restrições do sandbox ao engine/processos, limpeza de pasta, espera por IPC no harness, probes involuntários de CLIs instalados e timeout que disputava a inicialização do npm. As verificações direcionadas foram usadas para corrigir esses pontos. A execução final acima foi feita sem empacotamento simultâneo e encerrou normalmente; não se tratou uma execução interrompida como aprovação.

## Integrações reais aprovadas

Estes resultados são execuções com agentes e/ou engine real, separados dos mocks:

| Execução | Resultado verificável |
| --- | --- |
| Delegação nativa `e6c1c91a-a8c9-405a-9294-7ea50700c237` | OpenCode leu o checkpoint pelo MCP, retornou `CORE_REAL_OK` com 48 testes e concluiu a tarefa |
| Delegação nativa `664f9ac9-57cc-47aa-8969-68b504a4e099` | Leu um marcador escrito após inicialização e gravou `notes/core-worker-probe.md`, recuperada pelo coordenador |
| Nova sessão `bfc05af6-775e-4f49-b65c-22cfd8e133c6` | Leitura e busca recuperaram o marcador e o ID da tarefa anterior; resultado `CORE_NEW_SESSION_OK` |
| Revisão externa `3cd51248-760a-417a-91cc-ed87d744cdb7` | OpenCode revisou os módulos do core e executou 15 testes direcionados, todos aprovados, sem achados reportados |
| `node scripts/check-memory.mjs` | Binário oficial AI Memory: `memory_status`, três escritas concorrentes serializadas, leitura/busca, isolamento de projeto, handoff e recuperação após reinício do cliente aprovados |
| `node scripts/check-core-e2e.mjs` | Core atualizado em instância isolada: dois agentes OpenCode reais, solicitação ao coordenador, delegação MCP, confirmação, leitura/escrita, conclusão, estado WebSocket e recuperação após reiniciar o servidor aprovados |

O E2E real gerou a tarefa `b44146c8-083b-49f5-a40b-363693443383`, sessão `0d6158b5-fea9-49a2-8539-cf19c839fa0b`, com `memoryStatus=saved`. A evidência está em `.local-core-e2e-0FtZr9/result.json`, ignorada pelo Git. A instância de teste usou dados próprios e não reiniciou o aplicativo que hospeda este chat.

## Limites e uso após atualização

Hermes continua sendo terminal manual, sem adaptador gerenciado nesta versão. O erro de ação inválida foi diagnosticado pela implementação instalada; não foi alegada uma delegação gerenciada Hermes. A prova real desta etapa usa OpenCode, sem exigir Claude ou assinatura específica.

O E2E verifica transporte e estado com renderização headless dos terminais. Não substitui inspeção visual completa do navegador/desktop. O histórico conversacional completo permanece no CLI; o aplicativo persiste tarefas e memória relevante, com referências de sessão. Não foi acrescentado outro histórico de chat ou sistema de memória.

O processo do aplicativo já aberto mantém os módulos carregados antes da atualização. Reabra o Orquestra para carregar o novo core e recrie/reabra os terminais gerenciados para obter as ferramentas e capacidades da sessão atual. O pacote local é validado separadamente; GitHub Actions remoto e Node 22 local não foram executados nesta etapa.

Consulte [o contrato e os comandos de diagnóstico](core-estabilizacao.md) para repetir uma verificação específica, sem executar agentes reais no CI.
