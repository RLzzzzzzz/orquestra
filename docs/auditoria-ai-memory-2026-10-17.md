# Auditoria do core e da integração AI Memory — 17/10/2026

## Resultado observado no aplicativo aberto

O engine oficial está conectado e consegue salvar/buscar páginas. A integração atual é programática: notas deliberadas e registros de tarefas delegadas. Ela não implementa o ciclo de captura de sessões dos CLIs que caracteriza a experiência completa do AI Memory.

Consulta autenticada à API do aplicativo, sem enviar prompts ou comandos aos agentes:

| Projeto | Páginas atuais | Versões | Sessões | Observações | Evidências |
| --- | ---: | ---: | ---: | ---: | ---: |
| orquestra (`8576c8e6-4197-4b5d-a555-5d674e2ada81`) | 11 | 13 | 0 | 0 | 0 |
| Documentos | 1 | 1 | 0 | 0 | 0 |

Também havia um handoff manual aberto no projeto orquestra. Consultá-lo não o consumiu. `from_agent=other`, `from_session_id=null` e `owner_user=null` são coerentes com o contrato nativo de handoff manual sobre uma conexão sem identidade de operador; não provam falha de armazenamento.

O Codex coordenador estava concluindo a etapa anterior de estabilização, registrando notas/handoff e reportando testes e empacotamento. A saída observada citava 57 testes; esta auditoria acrescentou regressões e validou 61 testes. Nenhuma mensagem foi enviada ao coordenador nem foi delegada outra tarefa durante a auditoria.

O aplicativo em uso era o portátil extraído em `%TEMP%/3Knyv2fkbVNYx9QwUaLc9DEJ6Wf/resources/backend`. Sua API não retornava `sessionId`/`mcpReady`, embora esses campos já existissem no código local. O hash de `server/memory.mjs` do portátil também difere do arquivo local atualizado. Alterar o checkout não troca os módulos carregados nem o backend já empacotado.

## Fonte de comparação

Repositório oficial baixado integralmente em `.local-ai-memory-audit`, ignorado pelo Git do aplicativo. Tag instalada: `v3.1.0`, commit `8daaf92829ccc55fc0d203a758eb455dd86eb4ac`. HEAD consultado: `584ab792a2ac506445ca27629f040311ad8dc0d2`; a diferença para a tag estava limitada a dois documentos de contribuição, sem mudança no código do engine.

A revisão cobriu arquitetura, memória programática, captura externa, autoescopo, Windows, workstreams e os caminhos de implementação relevantes: transporte `serve`, schemas/handlers MCP, payloads e síntese de sessões, composição dos módulos de armazenamento/wiki/consolidação, além do fluxo local de terminais, delegação, tarefas, bridge e painel. Não é uma alegação de leitura linha a linha dos 1.193 arquivos, nem uma auditoria de segurança de todo o projeto Rust.

Referências primárias:

- [Arquitetura](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/ARCHITECTURE.md)
- [Integração programática e escritas condicionais](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/programmatic-memory.md)
- [Contrato de captura externa](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/external-lifecycle.md)
- [Workstreams e retomada entre fornecedores](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/managed-workstreams.md)
- [Autoescopo e identidade](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/auto-scope.md)
- [Windows](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/windows.md)

## Achados e correções desta auditoria

### Contexto delegado continha descritores, sem o conteúdo das decisões

`memory_briefing` retorna listas de caminhos/títulos, contagens e atividade. O código serializava esse objeto e cortava nos primeiros 4.500 caracteres. Isso não lia as páginas; ainda podia cortar o JSON no meio e eliminar pins que aparecessem depois da lista recente.

Correção em `Memory.context`: briefing + busca relacionada ao pedido + leitura oficial de até cinco páginas distintas. Até dois pins têm prioridade; os resultados relevantes e páginas consolidadas/recentes completam a seleção. O pacote inclui corpos limitados e indicação de abreviação, mantendo JSON válido dentro de 4.500 caracteres. Falhas parciais ficam em `contextStatus=partial` e `contextError`. Os caminhos permitem ao agente buscar a página completa pelo MCP.

O pacote é uma seleção limitada, não uma garantia de recuperação de todo fato relevante nem uma reconstrução da conversa do fornecedor.

### Edição concorrente podia apagar a alteração de outro agente

A fila do cliente serializa chamadas, mas não protege o intervalo entre ler uma página e editá-la. A ferramenta nativa suporta `expected_page_id` e `create_only`; o adaptador e a interface não encaminhavam essas condições na escrita.

Correção: os dois campos atravessam o adaptador e o schema MCP. A interface envia a versão lida ao editar e `create_only` ao criar. Uma edição obsoleta é recusada pelo engine e o texto do editor permanece disponível. A interface também preserva `tier` e `pinned`, que antes podiam voltar aos valores padrão ao editar uma nota prioritária. Agentes devem ler antes de editar e passar o `page_id`; chamadas antigas sem condição permanecem compatíveis.

### Aceite de handoff anunciava sucesso mesmo sem ganhar a disputa

O engine pode retornar `none_pending` ou `consumed_by_hook` com sucesso de transporte. A interface anunciava contexto aceito em qualquer resposta.

Correção: somente `status=claimed` anuncia um novo aceite; os demais estados informam indisponibilidade e atualizam a lista. O consumo único continua pertencendo ao engine.

### Relógio de recebimento começava antes do envio

O prazo de confirmação já corria durante a recuperação de memória. Com fila lenta no engine, o terminal podia ser encerrado antes de receber a instrução.

Correção: o prazo começa depois da entrega ao PTY. Uma confirmação recebida durante o envio não é sobrescrita. O limite total da tarefa continua sendo controlado pelo TaskManager.

### Redação de credenciais deixava o valor de cabeçalhos

O filtro anterior podia remover apenas a palavra `Bearer` de `Authorization: Bearer <credencial>`, preservando a credencial seguinte.

Correção: os esquemas Bearer/Basic são removidos com seu valor antes do filtro de atribuições. Isso amplia um filtro específico; não promete detectar todo segredo possível.

### Estado “conectado” não distinguia captura de sessões

O status local agora informa `transport=stdio`, `lifecycleCapture=false` e o escopo de captura. A interface explica que conversas manuais e eventos internos dos CLIs ainda não são capturados. O diagnóstico `check-core-session.mjs inspect` passou a mostrar contagens por projeto, identidade de sessão e prontidão MCP quando publicadas pelo backend.

## Lacunas estruturais que continuam abertas

1. **Captura nativa não conectada.** `server/memory.mjs` inicia `serve --transport stdio`; nesse modo o próprio engine não cria o router de hooks. Não existem nesta integração `SessionStart`, `UserPromptSubmit`, `PostToolUse`, compactação e `SessionEnd`. Consequentemente, não há síntese de página de sessão, evidência de sessão ou handoff automático a partir do trabalho real. Adicionar mais prompts para “lembrar” não resolve a ausência desses eventos.
2. **Histórico de tarefa não é sessão nativa.** `recordTask` produz `tasks/<id>.md`, sem uma sessão reconhecida pelo engine. Acrescentar o UUID do PTY como texto à página não registra a identidade nativa do Codex/OpenCode. Reiniciar o backend não retoma automaticamente a conversa.
3. **Escopo interno e escopo nativo precisam ser unificados.** O adaptador fixa `workspace=orquestra` e `project=<UUID do aplicativo>`, o que é correto para o isolamento atual. Hooks instalados com autodetecção de repositório podem escolher outro nome e criar uma segunda memória. Devem receber exatamente as mesmas coordenadas, inclusive em worktrees.
4. **Suporte de memória e suporte de delegação são independentes.** `liveProviders` aceita Codex, OpenCode e Claude. Antigravity, Gemini e Hermes estavam abertos como terminais manuais; o coordenador não pode delegar a eles nesse fluxo. A presença de Gemini no adaptador de execução separada não o torna executor da conversa interativa. No aplicativo observado havia dois OpenCode gerenciados; Claude não estava instalado.
5. **Orquestração por pasta é conservadora.** Tarefas na mesma pasta entram em fila; agentes abertos ali não produzirão paralelismo de edição gerenciado. Worktrees distintas permitem concorrência, com revisão posterior. Digitação manual ainda contorna a fila de tarefas.
6. **A atualização não está aplicada ao processo aberto.** É preciso abrir um build atualizado e recriar os terminais para carregar instruções/ferramentas da nova sessão. A auditoria não encerrou o aplicativo nem os CLIs do usuário.

## Caminho para completar a captura oficial

O engine já fornece os contratos necessários; não é preciso criar outro banco ou memória paralela.

1. Executar **uma instância HTTP local do engine para o mesmo diretório de dados**, com autenticação e supervisão. Migrar o cliente MCP para essa instância; não iniciar simultaneamente um engine stdio e outro HTTP sobre os mesmos dados.
2. Escolher um produtor de eventos por CLI: hooks/plugins oficiais, ou captura externa pelo Orquestra. Preferir hooks nativos quando o Orquestra não consegue observar a semântica do fornecedor. Capturar ANSI ou teclas do terminal não identifica com confiabilidade prompts, ferramentas ou fim de turno.
3. Configurar escopo explícito e identidade de sessão **nativa**, sem trocar pelo ID lógico do agente ou pelo UUID do PTY. Instalações devem ser isoladas por sessão/projeto para evitar reconfigurar silenciosamente as ferramentas pessoais do usuário.
4. No caminho externo, seguir `/hook/batch`: persistir eventos e chaves estáveis antes de enviar, manter ordem por sessão, conferir ACK por item, repetir apenas não confirmados e aplicar a política de captura antes de enfileirar. Usar `AI_MEMORY_CAPTURE_OWNER` somente nos processos cujo produtor externo estiver realmente completo, evitando silenciar hooks sem reposição.
5. `SessionEnd` deve significar que a execução acabou; `concluir_tarefa` normalmente encerra uma tarefa dentro de um CLI que continua aberto. Não transformar toda conclusão em encerramento de sessão nem disputar um handoff já entregue pelo hook de startup.
6. Para continuidade da conversa entre fornecedores, avaliar `ai-memory run` e workstreams nomeados por linha de trabalho. Isso é separado de memória compartilhada; não aplicar um único workstream simultâneo a todos os agentes.
7. Validar com cada fornecedor real: eventos aumentam, página de sessão e handoff surgem ao encerrar, nova sessão recupera conteúdo ausente do prompt, isolamento permanece e indisponibilidade/reinício não perde eventos nem duplica capturas.

Essa migração não foi implementada nesta auditoria. Os ajustes desta entrega corrigem recuperação, edição e diagnóstico da integração programática existente; não devem ser apresentados como conclusão da captura automática de todos os CLIs.

## Verificação desta entrega

- `npm.cmd test`: **61/61 aprovados**, sem cancelamentos ou skips, fora do sandbox. Dentro do sandbox houve 60 aprovados e um teste cancelado por timeout ao encerrar árvore de processos; não foi tratado como aprovação.
- `npm.cmd run check`: 46 arquivos com sintaxe válida e manifesto/lockfile consistentes.
- `npm.cmd run build`: aprovado fora do sandbox; o esbuild teve acesso negado a diretório ancestral dentro dele.
- `node scripts/check-memory.mjs`: binário oficial, dados temporários `.local-memory-check-RRQOzO`; gravações concorrentes serializadas, escrita condicional, criação exclusiva, leitura de corpo no contexto, Unicode, isolamento, consumo único de handoff e persistência após reinício aprovados. A primeira tentativa no sandbox teve timeout MCP; fora dele passou.
- `git diff --check`: aprovado.
- Nenhuma chamada nova a modelos ou revisão por subagentes foi executada. A validação desta auditoria não equivale a um novo E2E com Codex/OpenCode autenticados.

## Aplicativo atualizado

Backend preparado com dependências de produção e Node.js incluído. O empacotamento verificou a resolução local das dependências e os imports reais do backend. O arquivo `server/memory.mjs` empacotado tem o mesmo SHA-256 do código corrigido.

Portátil: `release/auditoria-ai-memory-20261017/Orquestra-0.1.0-x64-portable.exe`. O primeiro empacotamento recebeu `EPERM` ao renomear a pasta de saída dentro do OneDrive. O empacotamento fora dele, em `%TEMP%/orquestra-auditoria-ai-memory-20261017`, concluiu com saída 0; o executável final foi copiado ao caminho acima. Não foi necessário repetir os testes ou alterar código para essa recuperação.

Para aplicar, encerre suas sessões quando terminar o trabalho, feche o Orquestra atual e abra esse novo executável. Ele usa o mesmo perfil de dados do desktop. Não abra uma segunda instância sobre os mesmos dados. Esta auditoria não iniciou o novo pacote nem fez inspeção visual da janela Electron.

Instalador Windows gerado posteriormente a partir do mesmo `win-unpacked` validado: `release/auditoria-ai-memory-20261017/Orquestra-0.1.0-x64-nsis.exe`. Build NSIS concluído com saída 0; arquivo final copiado e cabeçalho executável Windows verificado. É instalação por usuário, com escolha de diretório e desinstalador. O portátil anterior não executa instalação. O instalador não foi executado automaticamente na máquina do usuário.
