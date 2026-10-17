# Estabilização MCP, orquestração e captura — 17/10/2026

## Estado recuperado e autoria

Foram lidos `auditoria-ai-memory-2026-10-17.md`, `diagnostico-core-ai-memory-2026-10-17.md` e `core-validacao-2026-10-17.md`, o histórico MCP e o diff real. As alterações anteriores foram preservadas. A auditoria relevante do AI Memory v3.1.0 já existia; foram conferidos novamente os contratos necessários no clone de referência, sem alterá-lo.

A investigação anterior `937f025e-a6c1-4047-ac77-e564e6a83a59` e a tentativa de implementação `2689860e-80d1-430c-90e1-7c072a76645f` foram delegações reais a sessões distintas **OpenCode**, não a duas instâncias Codex. A tentativa corretiva seguinte foi cancelada após retries do provedor. A afirmação anterior de correção completa não se sustentava: `reportLifecycleEvent` não tinha chamadores e anunciava captura ativa. Esta etapa delegou diagnóstico (`bbd0cf9c-18f3-4d2a-aec5-d5b2875ae5b3`, concluído) e revisão independente; a implementação desta etapa foi feita pelo coordenador. O diagnóstico delegado sobre a causa do E2E era genérico e não foi aceito como evidência.

## Problemas, causas e resultados

| Problema | Causa-raiz | Correção | Evidência | Resultado |
| --- | --- | --- | --- | --- |
| `check-memory.mjs`: conexão MCP encerrada | Restrição do ambiente de execução: mesmo código/binário passa fora do sandbox; o sandbox também recusou spawn do executável instalado com ENOENT | Execução de integração real com autorização normal; falhas agora incluem etapa de startup e diagnóstico limitado, sem bearer | Reprodução sem edição falhou no sandbox; fora passou em `.local-memory-check-mmiuo8` | Memória oficial, escrita concorrente serializada, CAS, busca, Unicode, isolamento, contexto e handoff único aprovados |
| `check-core-e2e.mjs`: `-32001` | Falha de inicialização/acesso ao engine no sandbox, anterior aos modelos; não foi causada pela delegação ou falta de resposta do agente nessa ocorrência | Prontidão HTTP antes de inicializar MCP; falha explícita quando engine fica indisponível; E2E grava etapa em `failure.json` | `.local-core-e2e-2fUvHC` e `.local-core-e2e-Ezxjjg`: zero agentes e tarefas; mesmo core sem mudanças passou fora em `.local-core-e2e-UQ7W3d` | E2E real final passou fora do sandbox, sem aumentar os prazos |
| Teste de encerramento excede 15 s | Encerramento de árvore de processos não funciona no mesmo ambiente restrito; a operação fica aguardando `close`; não há prova de que aumentar prazo resolva | Nenhum aumento de timeout. Validar os processos Windows com as permissões normais | Reprodução direcionada cancelada aos 15 s no sandbox; mesma versão passou fora em 2,8 s; suíte final também passou | Restrição ambiental documentada; não se declara suporte a encerramento sob essa restrição |
| Páginas existem, sessões/observações não | Apenas chamadas deliberadas MCP e `recordTask`; engine stdio não expunha router HTTP de hooks | Um único engine oficial supervisionado HTTP atende MCP e hooks; plugin nativo gerado pelo próprio binário | `Memory.start`, `Memory.agentCapture`, `coordinatorCommand`; contagens após E2E/restart | OpenCode nativo capturado |
| Captura parcial anterior não funcionava | `execFile` assíncrono não envia `input` ao stdin; diretório divergente, sem scope oficial; chave baseada em horário; métodos sem chamadores | Substituição pelo plugin oficial, mantendo seus IDs nativos, política, spool, retries e eventos | Diff de `server/memory.mjs`; contrato `external-lifecycle.md` e gerador `install_hooks.rs` | Não há parser de ANSI nem segundo banco de memória |
| Eventos poderiam cair em outro projeto | Autodetecção de nome de repositório difere do UUID do aplicativo | Adaptador mínimo no plugin gerado fixa workspace `orquestra` e UUID do projeto após a resolução de política | Testes de configuração e consulta oficial ao mesmo projeto do E2E | Notas, tarefas, sessões e observações no mesmo escopo |
| Destino de spool mudaria ao reiniciar | URLs das entradas oficiais incluem endereço do engine | Porta local persistida por diretório de dados; plugin regenerado para esse destino | `orquestra-http-port.json`; E2E recupera contagens após restart | Destino estável; replay offline prolongado ainda não ensaiado com CLI real |
| Falso sucesso em captura e encerramento | Flag fixa verdadeira e engine separado sem supervisão | Estado derivado da preparação do plugin, erro separado e escopo explícito; supervisão do processo e kill limitado durante dispose | Regressão de engine inexistente; API `stage`, `captureError`, `captureScope` | Startup falha claramente; não ativa captura para CLI não integrado |

A diferença sandbox/execução normal é reproduzível. A política interna exata do sandbox que impede cada syscall não foi identificada; não atribuímos uma mensagem específica de acesso negado ao `taskkill` sem capturá-la. Não foi observada mistura de stdout com JSON-RPC: bridge Orquestra mantém stdio MCP; o engine AI Memory usa HTTP, com stdout/stderr separados e limitados para diagnóstico de inicialização.

## Decisão técnica e alternativas

Antes de implementar, foi adotada a alternativa já documentada na auditoria: **um engine HTTP**, usando o `StreamableHTTPClientTransport` da dependência MCP existente e o plugin oficial gerado por `ai-memory install-hooks --agent opencode` (modo impressão, sem `--apply`). A configuração é injetada somente nos processos OpenCode abertos pelo Orquestra. Nenhum arquivo de configuração pessoal ou `.ai-memory.toml` do repositório é alterado. Credencial somente no ambiente do filho; o gerador é invocado sem o bearer do servidor e a saída é verificada para não persistir esse bearer.

Manter stdio junto de um segundo engine HTTP sobre os mesmos dados foi rejeitado por concorrência de armazenamento. Criar produtor externo universal foi rejeitado porque o PTY não fornece IDs/eventos semânticos nativos confiáveis. `ai-memory run` permanece alternativa futura para continuidade entre fornecedores; não foi ativado porque auto-wire/workstreams mudariam configurações e comportamento de lançamento além desta correção.

O plugin oficial conserva o spool e a fila oficiais e seus eventos reais `session.created`, `chat.message`, ferramentas, `session.idle` e `session.deleted`. Concluir tarefa não é sintetizado como fim de sessão. O UUID do terminal continua sendo a identidade operacional do Orquestra, separada do ID nativo conservado pelo plugin. Não foi definido `AI_MEMORY_CAPTURE_OWNER` para simular um produtor externo: as novas sessões usam captura nativa.

O helper externo `/hook/batch` exige projeto e chave estável, envia proveniência e conserva ACK parcial inclusive em 429. Seu teste usa servidor HTTP de fixture; **o fluxo produtivo validado usa o plugin oficial**, não um novo relay do Orquestra.

## Validação progressiva

- Direcionados: 19/19, incluindo startup falho, escopo nativo, configuração isolada e recibo parcial 429 com servidor de fixture.
- Suíte final: `npm.cmd test`, **64/64**, nenhuma falha/cancelamento/skip, fora do sandbox. Inclui handshake MCP stdio real com bridge, HTTP/WebSocket/PTY de fixture, identidade de sessão obsoleta, recebimento, cancelamento, concorrência por pasta e persistência. CLIs de fixture não são agentes autenticados.
- `npm.cmd run check`: 46 arquivos; manifesto e lockfile consistentes. `git diff --check`: aprovado.
- `npm.cmd run build`: compilação web aprovada. Nenhum empacotamento/executável gerado. Inspeção de processos fora do sandbox confirmou zero engines remanescentes nos diretórios dos E2Es concluídos; a consulta WMI no sandbox foi recusada com acesso negado.
- Revisão independente `5872ae6c-7299-41bb-bf4d-55203a9f99b2`: OpenCode leu o diff real, concluiu pelo MCP e não reportou regressão concreta. Não executou testes adicionais nem editou arquivos; sua revisão complementa as validações locais.
- Engine oficial HTTP: `node scripts/check-memory.mjs`, aprovado em `.local-memory-check-ULnmWB`, incluindo reinício, isolamento e handoff consumido uma vez.
- E2E real com dois OpenCode: tarefa `1b478d8b-7e22-4891-93b3-235465569d9d`, `.local-core-e2e-sTfuHd/result.json`; consulta oficial posterior confirmou **2 sessões / 13 observações**, após reinício. A primeira consulta manual usou caminho relativo e abriu outro diretório de teste; foi descartada e corrigida com caminho absoluto. `Memory` agora normaliza o diretório para absoluto.
- E2E final misto: `ORQUESTRA_E2E_COORDINATOR=codex node scripts/check-core-e2e.mjs`, tarefa `2050ae99-757d-4a59-a184-53008b758a40`, `.local-core-e2e-WrxNs5/result.json`. **Codex coordenador → OpenCode executor**, MCP inicializado, receipt, leitura/escrita, resultado ao coordenador, estado WebSocket e recuperação após reiniciar somente o servidor isolado. **1 sessão nativa / 9 observações** persistidas, medidas por asserções do próprio E2E. A sessão capturada é do OpenCode; o Codex coordenador não tem captura nativa configurada nesta entrega.

Foram efetivamente observadas **3 sessões e 22 observações** nesses dois diretórios isolados com captura, não no perfil do aplicativo que hospeda o chat. O E2E anterior à correção confirmou delegação/nota, mas não foi contado como captura.

## Arquivos desta etapa e limites

Alterados nesta etapa: `server/memory.mjs`, `server/orchestration.mjs`, `scripts/check-core-e2e.mjs`, `src/MemoryPanel.jsx`, `tests/memory.test.mjs`, `tests/coordinator.test.mjs`, `README.md` e este relatório. Outros arquivos já estavam modificados e foram preservados.

Não foram instaladas dependências, alterado o projeto oficial, criado executável, commit, push, merge ou PR. O perfil aberto deste chat conserva os módulos anteriores: aplicar exige reabrir o backend atualizado e novas sessões dos CLIs. Não reiniciamos o aplicativo do usuário.

Captura nativa validada somente no OpenCode. Codex foi validado como coordenador real; captura dos seus próprios eventos e Claude/Gemini/Antigravity/Hermes não foram ativadas nem declaradas validadas. Instalações pessoais prévias do plugin AI Memory podem gerar captura dupla e precisam de verificação antes de serem combinadas. Reinício limpo e recuperação foram testados; crash abrupto com ferramenta em voo, recuperação offline prolongada e múltiplos operadores ainda não foram validados com CLIs reais. Falhas/retry/cancelamento/sessões simultâneas têm cobertura de fixture, não equivalem a essas provas reais.

O critério de fluxo real, captura e recuperação foi demonstrado para **Codex coordenador + OpenCode executor**. A estabilização de captura universal dos demais CLIs continua incompleta.
