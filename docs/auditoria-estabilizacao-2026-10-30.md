# Estabilização de memória e delegação — 30/10/2026

## Escopo da revisão

Três agentes trabalharam em memória/captura, delegação/fila e interface. A revisão principal integrou os resultados, examinou os diffs e verificou API, descoberta dos CLIs, terminais, persistência e worktrees. As alterações locais anteriores em `server/terminals.mjs`, `src/main.jsx`, `src/style.css`, `tests/core.test.mjs` e `.agents/` foram preservadas e não incluídas nos commits desta revisão.

Referência de produto consultada: [Orca](https://github.com/stablyai/orca), especialmente o [README](https://github.com/stablyai/orca/blob/main/README.md). Foram adotadas a clareza do fluxo entre agentes, a separação entre projeto e sessão e a apresentação de worktrees/revisão como recursos avançados. Não houve cópia de código ou substituição da arquitetura existente.

## Problemas corrigidos

| Área | Problema e comportamento corrigido | Commit |
| --- | --- | --- |
| Memória | Projeto ausente ou inválido podia chegar ao engine sem escopo; operações e captura agora exigem projeto explícito. Caminhos absolutos e segmentos vazios são recusados. | `89d2a8c` |
| Captura OpenCode | Aliases e identidades inferidas do repositório podiam remapear o projeto. Os parâmetros de roteamento são removidos e o acesso global fica desabilitado. | `89d2a8c` |
| Retomada | Eventos persistidos apontavam para rotas esquecidas após reiniciar. O gateway restaura os projetos autorizados junto à porta persistida. | `90c2369` |
| Antigravity | Sessões de projetos diferentes na mesma pasta compartilhavam um hook com destino fixo. O comando agora resolve binário, dados e destino pelo ambiente de cada sessão; sem esse ambiente não captura. Outros hooks nomeados são preservados. | `b2d24a6` |
| Fila | Uma falha síncrona de inicialização podia reentrar no escalonador e iniciar outro trabalho duas vezes. O escalonamento agora impede reentrância. | `20d4705` |
| Pastas | O bloqueio de uma raiz, como a raiz de um disco, não reconhecia seus descendentes. A comparação trata corretamente o separador final. | `20d4705` |
| Cancelamento | Uma conclusão tardia podia liberar o bloqueio antes da saída real do terminal. A tarefa em interrupção recusa confirmação/conclusão até a saída do PTY. | `dfdd1ee` |
| Entrega | Uma tarefa cancelada durante a consulta de contexto ainda podia ser enviada ao executor. A entrega pendente agora é descartada. | `cdcdfac` |
| Responsividade | A detecção de Antigravity/Hermes usava processos síncronos, bloqueando terminais e timers de confirmação. As sondagens agora são assíncronas, paralelas e limitadas por tempo. | `2e0acdd` |
| Editor de memória | Respostas antigas podiam atualizar o painel depois de uma troca de projeto; ações concorrentes também podiam sobrescrever o estado. O painel tem ciclo de vida por projeto, serializa ações e desabilita mutações durante carga/indisponibilidade. | `bd7d0d6` |
| Handoff | O contexto aceito desaparecia da lista sem continuar visível para retomada. O resumo aceito permanece na tela. A edição também oferece cancelamento. | `bd7d0d6` |
| Orquestração | Seleções podiam permanecer inválidas após a saída de um executor. Há fallback para executor atual, escopo defensivo por projeto e indicação de falhas ao salvar memória. | `b6692a8` |
| Worktrees e quadro | Estado de formulário podia atravessar projetos; havia opção de cancelamento duplicada e controles inadequados offline. Os painéis reiniciam por projeto e restringem controles. | `8153081` |

## Validação final

- `npm.cmd test`: **93 testes passaram**, zero falhas, cancelamentos ou testes ignorados. Inclui API HTTP/WebSocket, PTYs reais com CLI de fixture, MCP stdio real, fila, cancelamento, revisão cruzada, worktrees Git, persistência, memória, captura e quatro testes SSR dos painéis React.
- `npm.cmd run check`: sintaxe de 59 arquivos e consistência entre manifesto e lockfile verificadas.
- `npm.cmd run build`: build de produção concluído, com 1590 módulos transformados.
- `git diff --check 65a5173..HEAD`: sem erros de whitespace nas alterações desta revisão.
- `node scripts/check-memory.mjs`: passou com o engine AI Memory oficial instalado, em diretório temporário isolado. Verificou três escritas concorrentes, Unicode, busca, isolamento entre projetos, edição condicional, criação exclusiva, contexto hidratado, handoff consumido uma vez e persistência após reiniciar. Não chamou modelos.
- O teste de hook Antigravity executou PowerShell de verdade com fixture em caminho Unicode, dois destinos de projeto e ausência de ambiente de captura.

O sandbox impediu o encerramento de árvores de processos Windows no teste de timeout e a leitura de configuração pelo esbuild no build convencional. Os comandos completos passaram com a execução fora do sandbox autorizada pela revisão automática. Não foi necessário alterar testes para ignorar esses cenários.

## Limites e uso após atualizar

Reinicie o serviço e reabra as sessões dos agentes para carregar os hooks e variáveis novos. Sessões abertas antes da atualização mantêm sua configuração anterior.

O CLI `agy` foi encontrado e sua versão respondeu. A tentativa de delegar uma revisão somente leitura exigiu autenticação e expirou; por isso ele não participou como agente de programação. A integração de captura foi testada por fixture, sem conversa autenticada no Antigravity.

Não foi executada uma tarefa real de modelo nesta revisão. O protocolo de delegação foi validado com MCP e terminais reais usando executores de teste. Login, disponibilidade de modelo, confiança no MCP e aprovação dos hooks continuam dependendo de cada CLI; no Codex, revise os hooks em `/hooks`.

A interface foi compilada e renderizada em SSR. Acesso automatizado ao navegador não estava disponível; não houve validação visual ou teste interativo em navegador nesta rodada. O executável desktop não foi reempacotado.

Executores gerenciados continuam sendo Codex, OpenCode e Claude; coordenadores continuam sendo Codex, OpenCode, Claude e Freebuff. Antigravity/Hermes continuam como terminais manuais com captura. Esta revisão não adiciona suporte a delegação nesses dois provedores.

A suíte comprova os cenários descritos; não equivale a ausência de todos os bugs possíveis no aplicativo.
