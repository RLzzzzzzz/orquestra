# Revalidação do AI Memory e auditoria desktop — 17/10/2026

## Conclusão principal

O código atual já usa um engine oficial AI Memory HTTP e o plugin nativo oficial do OpenCode. O diagnóstico antigo de integração somente stdio está superado. A captura OpenCode funciona fora do ambiente restrito, comprovada novamente nesta rodada. A captura nativa do Codex e dos demais fornecedores continua ausente nesta integração; coordenar tarefas pelo Codex não comprova captura dos seus próprios eventos.

O aplicativo atual na porta 4317 estava com MCP e memória programática conectados, mas com `lifecycleCapture=false`. A preparação do plugin falhou ao consultar `opencode --version`: `EEXIST: file already exists, mkdir .../.config/opencode`. O mesmo comando oficial, sem mudança no código, passou fora do sandbox e produziu 133.963 caracteres de plugin com o ponto de integração esperado. Não foi executado `install-hooks --apply`, nem alterada configuração pessoal. A reprodução demonstra dependência das permissões do ambiente; não demonstra corrupção da pasta OpenCode.

As três coordenadas de projeto do aplicativo aberto retornavam zero sessões e zero observações. Isso não invalida as provas anteriores: as 3 sessões e 22 observações documentadas em `mcp-estabilizacao-2026-10-17.md` pertenciam a diretórios isolados de E2E, não ao perfil atual. Os arquivos de resultados anteriores foram preservados.

## Estado por funcionalidade

“Anterior” descreve a evidência disponível antes desta rodada, sem transformar alegações anteriores em validação. Provas por fixture ou inspeção de código são identificadas explicitamente.

| Funcionalidade | Status anterior | Status comprovado | Evidência | Correção realizada |
| --- | --- | --- | --- | --- |
| Engine AI Memory HTTP/MCP | IMPLEMENTADO e validado em E2Es anteriores | FUNCIONA fora do sandbox; PARCIAL no processo aberto | Ferramentas oficiais passaram em `.local-memory-check-mI484c`; API 4317 conectada, com erro de preparação de captura | Diagnóstico de captura conserva o erro útil e remove ANSI/credencial |
| Captura nativa OpenCode | FUNCIONA nos testes anteriores: 3 sessões/22 observações em dois diretórios | FUNCIONA em nova prova isolada; inativa no processo atual | E2E desta rodada: 2 sessões nativas/19 observações, persistidas após reinício; gerador falha dentro e passa fora do sandbox | Fluxo nativo estabilizado preservado; não se contornaram as permissões |
| Captura nativa Codex | NÃO IMPLEMENTADO no adaptador atual | NÃO IMPLEMENTADO | `agentCapture` retorna configuração somente para OpenCode; Codex coordenador não recebe hooks | Nenhuma captura simulada ou configuração global adicionada |
| Captura Claude/Gemini/Antigravity/Hermes | NÃO IMPLEMENTADO nesta integração | NÃO IMPLEMENTADO | Ausência de configuração nativa de captura nesses lançamentos | Nenhuma afirmação de suporte universal |
| AI Memory — painel e indicadores | IMPLEMENTADO, NÃO VALIDADO visualmente | IMPLEMENTADO, NÃO VALIDADO visualmente | Campos de sessões/observações/captura e erros no código; compilação aprovada | Falha de `memory/status` deixa de ser convertida silenciosamente em `null` |
| Memória: escrita, busca, contexto, handoff e recuperação | FUNCIONA nas provas anteriores | FUNCIONA com engine oficial em dados isolados | `check-memory.mjs`: CAS, criação exclusiva, busca, corpo de contexto, Unicode, isolamento, claim único e restart | Mantidas proteções anteriores |
| Relay externo `/hook/batch` | Helper implementado, sem produtor produtivo | PARCIAL; contrato corrigido e testado com fixture | ACK parcial HTTP 429; teste de identidade divergente e corpo sem `session_id` | Corpo recebe ID validado; divergência é recusada. Não é alegado que o helper realiza a captura OpenCode |
| Orquestração e MCP | FUNCIONA nos E2Es anteriores | FUNCIONA em E2E real isolado | Coordenador OpenCode → executor OpenCode; receipt, conclusão, memória, WebSocket e recuperação | Sem mudança no fluxo de delegação |
| Orquestração — interface | IMPLEMENTADO, NÃO VALIDADO visualmente | IMPLEMENTADO, NÃO VALIDADO visualmente | Estados de tarefa reais por API/WS; janela não acessível para inspeção | Nenhuma mudança visual especulativa |
| Terminais estilo OpenCode: ANSI, entrada e isolamento | IMPLEMENTADO; PTYs anteriormente testados | PARCIAL | PTYs/entrada/replay/resize reais com fixtures, 11 testes; visual, scroll e seleção não inspecionados | Nenhuma refatoração |
| Menu de contexto | IMPLEMENTADO, NÃO VALIDADO | IMPLEMENTADO, NÃO VALIDADO | Código de clique direito e ações Nova sessão/Fechar/Remover da lista | Não foi alegado clique real |
| Duas instâncias do mesmo CLI | IMPLEMENTADO e anteriormente testado | FUNCIONA em execução isolada real | Dois OpenCode com duas sessões nativas distintas no E2E; fixtures também isolam entrada/saída/PIDs | Nenhuma mudança necessária |
| Fechar/ocultar sessões | IMPLEMENTADO | PARCIAL | Backend para/reinicia/remove PTYs em testes reais; UI possui confirmação para tarefas ativas e ocultação de sessões paradas; interação visual não validada | Sem alteração |
| Toasts automáticos | IMPLEMENTADO, NÃO VALIDADO no desktop | IMPLEMENTADO, NÃO VALIDADO no desktop | Eventos de conclusão/erro/intervenção e antirreplay testados; tarefa real produziu estados WS; exibição não observada | Nenhuma reescrita |
| Histórico de notificações | IMPLEMENTADO, NÃO VALIDADO | IMPLEMENTADO, NÃO VALIDADO | Botão/modal, últimos 50 avisos, leitura e dispensa presentes; persistência em localStorage | Sem alteração |
| Notificações Windows em segundo plano | IMPLEMENTADO por Web Notification, NÃO VALIDADO | IMPLEMENTADO, NÃO VALIDADO | Depende de preferência e `Notification.permission=granted`; não houve observação de toast nativo no desktop empacotado | Não alteradas permissões nem configurações Windows |
| Atividade e filtros | IMPLEMENTADO | PARCIAL | Filtros por projeto/agente/tipo e fronteiras testados; UI não inspecionada | Sem alteração |
| Ícone de alaúde | NÃO IMPLEMENTADO no código inspecionado | NÃO IMPLEMENTADO; opcional | Marca CSS e símbolos de fornecedores presentes; nenhum alaúde localizado em `src`/`electron` | Fora da prioridade |
| ASCII animado | NÃO IMPLEMENTADO no código inspecionado | NÃO IMPLEMENTADO; opcional | Nenhuma implementação localizada em `src`/`electron` | Fora da prioridade |
| Inicialização/encerramento/reconexão | Implementados e testados anteriormente | PARCIAL | Backend/PTY/WS e recuperação aprovados; tentativa Electron isolada iniciou backend, sem janela acessível | Árvore exclusiva de auditoria encerrada; app principal preservado |
| Desktop empacotado atual | Artefatos anteriores existentes | NÃO VALIDADO nesta rodada | Build web aprovado; nenhum novo pacote produzido ou instalado | Não foi confundido build web com validação de notificações Windows |

## Defeitos concretos corrigidos

1. `captureError` usava os primeiros 500 caracteres de `execFile.message`. O erro observado mostrava comando e log de startup, ocultando a causa OpenCode. A nova função `captureFailure` prefere stderr, remove ANSI e o bearer do engine, aplica o filtro de segredos e conserva até 1.200 caracteres finais. Regressão verifica ruído longo, causa final, remoção de ANSI e credencial.
2. `postHookBatch` validava `event.sessionId` mas enviava somente `event.body`. Um evento aceito pelo helper podia sair sem `session_id`, ou com outro ID, sendo descartado/atribuído incorretamente pelo engine. Agora o ID nativo validado é incluído e conflito explícito é recusado antes do HTTP. O teste usa servidor de fixture com ACK parcial 429. O helper não tem fila durável nem constitui o produtor nativo atualmente usado.
3. O painel convertia erro de `memory/status` em `null` tanto no carregamento quanto na atualização. Agora a falha chega ao tratamento já existente de `loadError`/notificação, em vez de simular carregamento bem-sucedido sem indicadores. A compilação passou; a exibição do erro não foi validada visualmente.

## Agentes e delegações efetivamente usados

Uma execução de `node scripts/check-core-e2e.mjs`, fora do sandbox, abriu coordenador e executor **OpenCode reais**, com login já existente, e utilizou a orquestração real do Orquestra. O coordenador delegou uma tarefa de leitura/escrita de memória ao executor, que confirmou recebimento e concluiu pelo MCP. Não foram subagentes internos nem simulações.

- Tarefa: `c9df6d87-c864-414b-9b88-3a041028d97d`.
- Sessão operacional do executor: `ec15e704-ad69-43f7-a888-d1a6ba3e6287`.
- Resultado: sucesso, `memoryStatus=saved`, duas sessões nativas e 19 observações novas.
- Evidência: `.local-core-e2e-YRMB9P/result.json`, ignorada pelo Git.
- Reinício limitado ao servidor de teste; notas, tarefa e contagens recuperadas.

Esses agentes executaram a prova operacional de memória; não foram três auditores de UI/Desktop/Core. A análise de código e as correções foram feitas localmente. Não foram lançados outros modelos, nem atribuída revisão independente a quem não a fez. O Codex coordenador já aberto na porta 4317 não recebeu comandos desta auditoria e permaneceu ativo.

## Validações desta rodada

- Direcionados `memory`, `coordinator`, `ui-events`, `core`, `live-tasks`: **29/29** aprovados.
- `tests/server.test.mjs`, fora do sandbox: **11/11**, com HTTP, WebSocket e PTYs reais de fixture. Cobrem autenticação, duas sessões, entrada isolada, resize, replay, fallback, stop/restart/remove e persistência sem iniciar agentes automaticamente.
- `node scripts/check-memory.mjs`, fora do sandbox: aprovado com engine oficial em `.local-memory-check-mI484c`.
- `node scripts/check-core-e2e.mjs`, fora do sandbox: aprovado uma vez; captura, delegação real, recuperação e memória descritas acima.
- `npm.cmd run check`: 48 arquivos; manifesto/lockfile consistentes.
- `git diff --check`: aprovado.
- **Um único** `npm.cmd run build`: aprovado, 1.590 módulos. Nenhum instalador/portátil novo foi gerado.
- Não foi repetida a suíte inteira, porque as verificações direcionadas e integrações acima cobrem os arquivos alterados.

## Limite de validação desktop

Computer Use não encontrou janela Orquestra inicialmente. Foi iniciado um Electron de desenvolvimento a partir do código existente, com porta `14339`, dados e perfil exclusivos em `.local-desktop-audit-WSmPlO`. O log confirmou o backend pronto; o processo ficou sem janela principal acessível ao Computer Use. Isso não foi tratado como validação visual nem como prova de um defeito específico da interface. A árvore de processos exclusiva desse ensaio foi encerrada, preservando a porta 4317 e o perfil principal.

O pacote Electron instalado precisou obter seu binário de runtime ao ser acessado pela primeira vez; isso foi feito pelo próprio pacote existente. Nenhuma dependência de aplicação foi adicionada, nenhum instalador executado e nenhuma configuração de segurança/notificação Windows foi alterada.

Notificações Windows efetivamente entregues em segundo plano, menu acionado por clique, seleção/scroll e histórico visual continuam sem prova operacional. O código usa Web Notification e a permissão do renderer; a presença desse código não demonstra integração nativa funcional do pacote NSIS. Não foi reescrito esse caminho sem uma falha reproduzida.

## Arquivos alterados nesta rodada

- `server/memory.mjs`: erro útil de captura e identidade de evento externo.
- `src/MemoryPanel.jsx`: propagação de falha dos indicadores.
- `tests/memory.test.mjs`: regressões dos contratos acima.
- Este relatório. `dist` foi recompilado e é ignorado pelo Git; evidências temporárias também são ignoradas.

Todas as demais alterações anteriores foram preservadas. Sem commit, push ou PR; sem pesquisa na internet; sem reescrever a captura nativa estabilizada.

## Pendências e retomada

1. Durante a inspeção inicial, o backend principal conservava os módulos e o erro de preparação capturados no startup. Para aplicar o diagnóstico corrigido e carregar o plugin, a aplicação precisa ser iniciada com acesso normal à configuração do OpenCode, e novas sessões OpenCode devem ser abertas. Não reiniciamos o coordenador do usuário.
2. Captura nativa Codex continua necessária. Deve conservar ID nativo, escopo do aplicativo e credenciais, sem substituir `CODEX_HOME` por uma pasta vazia que perca login/configurações ou instalar hooks globais silenciosamente.
3. Claude/Gemini/Antigravity/Hermes precisam de seus próprios adaptadores e prova por fornecedor. O `status=running` de um terminal não comprova captura.
4. Falta ensaio de desktop **empacotado** com janela visível e evento real em segundo plano. Não declarar notificações Windows aprovadas até observá-las.
5. Falha offline prolongada, crash abrupto com ferramenta em voo e captura dupla por plugins pessoais continuam fora das provas desta rodada. Não há alegação de cobertura universal por causa do E2E positivo.

Na checagem final, `127.0.0.1:4317` respondeu `ECONNREFUSED` e o PID operacional do coordenador, `56020`, já não estava presente. Nenhum comando foi enviado para parar a porta 4317 ou esse agente. A única árvore explicitamente encerrada pela auditoria foi o Electron de teste `61112`, cujo caminho foi verificado antes do `taskkill`. Não há evidência suficiente para atribuir o encerramento do serviço principal ao usuário, ao ambiente ou a outra causa. Ele não foi reiniciado automaticamente. A porta isolada 14339 também foi encerrada.

Se o contexto desta conversa precisar ser compactado, interromper o trabalho antes disso, conforme instrução explícita do usuário. Este arquivo guarda o ponto de retomada sem depender de resumir a conversa automaticamente.
