# CI, worktrees e revisão cruzada

## Arquitetura reutilizada

O backend é Node.js ESM com HTTP local, WebSocket, `node-pty`, fila por pastas sobrepostas e persistência JSON atômica. A interface é React/Vite em JSX; não há TypeScript ou configuração de lint neste projeto. O desktop Electron existente continua usando um backend Node separado. As novas funcionalidades usam esses componentes, os adaptadores de CLIs e o AI Memory já integrados. Nenhuma dependência nova foi acrescentada.

Já existiam testes de inicialização HTTP, segurança da sessão local, comunicação por WebSocket, terminais reais com CLIs simulados, encerramento e reconexão de terminais, descoberta de executáveis, projetos/agentes, fila/cancelamento, recuperação após reinício, protocolo MCP e operações de memória. Não havia gerenciamento de Git/worktrees ou fluxo de revisão cruzada.

## Executar as verificações do CI

Use Windows x64, Git no PATH e Node.js 22 atualizado ou Node.js 24. O workflow usa as duas versões em `windows-latest`.

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run check
npm.cmd run test:unit -- --coverage
npm.cmd run build
npm.cmd run test:integration -- --coverage
npm.cmd run test:regression -- --coverage
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm.cmd run desktop:pack -- --publish never
```

Para uma execução completa dos testes com um único relatório:

```powershell
npm.cmd run test:coverage
```

`check` verifica sintaxe dos módulos Node, transforma JSX com o esbuild já fornecido pelo Vite e compara dependências/engines com o lockfile. Não substitui lint semântico ou verificação de tipos. O build verifica a integração dos imports da interface. O empacotamento desktop instala as dependências de produção em uma pasta separada e verifica o backend incluído. Downloads de dependências, Electron e licença do Node exigem internet; os testes não exigem serviços externos.

| Suíte | Cenários principais |
| --- | --- |
| `test:unit` | Workspace e descoberta de CLIs, coordenador, seletor de pasta simulado, protocolo de eventos, delegação em terminal simulado, escopo/erros/redação do AI Memory |
| `test:integration` | Servidor HTTP real, cookie/origem/Host, WebSocket, PTYs e CLIs de fixture, persistência/reinício, rotas Git/revisão, Git worktrees reais em repositórios temporários |
| `test:regression` | Fila e cancelamento, reservas durante validação, MCP stdio real, permissões Git por agente, papéis de revisão, diff/revisão, ciclos, falhas, reinício, execução real de scripts npm e timeout |

Os testes de Git criam commits apenas em repositórios temporários descartáveis dentro do workspace; não alteram a branch ou o histórico do repositório do aplicativo. O runner de testes força um caminho inexistente de AI Memory para não iniciar o serviço pessoal instalado. As operações de memória são verificadas com mocks do cliente oficial. Os scripts `check-*` que usam contas reais permanecem opcionais e não são chamados pelo workflow.

O teste de timeout encerra uma árvore de processos própria. Um sandbox que proíba `taskkill` pode impedir essa verificação; execute em um terminal Windows normal com permissão para encerrar seus próprios processos. A mesma restrição pode impedir o esbuild de ler diretórios ancestrais durante o build.

Os relatórios LCOV ficam em `coverage/`, ignorada pelo Git, e são enviados como artifacts do workflow. O relatório cobre módulos `server/**` carregados pelo processo instrumentado dos testes. Ele não inclui automaticamente o frontend, a janela Electron ou módulos carregados apenas nos subprocessos de integração, como o servidor principal e os PTYs. Os testes desses subprocessos têm asserções funcionais, mas não entram necessariamente no percentual. Não há limiar artificial de cobertura. Novos arquivos de teste precisam ser classificados em `scripts/test.mjs`, evitando omissão silenciosa no CI.

## Validar no GitHub

O workflow `.github/workflows/ci.yml` executa em todos os PRs, em pushes para `main`/`master` e por `workflow_dispatch`. Se a branch principal tiver outro nome, ajuste o filtro. Ele possui permissão de leitura do repositório, não conserva credenciais do checkout, não usa tokens de fornecedores, não executa CLIs autenticados e não publica pacotes ou releases. Qualquer etapa obrigatória reprovada reprova o job. O upload de relatórios também tenta executar após uma falha.

Depois de publicar as alterações com autorização, abra **Actions → CI Windows → Run workflow**. Confira os dois jobs Node 22/24, os logs de instalação/testes/build/empacotamento e os artifacts LCOV. Um teste intencionalmente reprovado em uma branch de teste deve reprovar o respectivo job. Configure proteção da branch no GitHub se desejar exigir os checks antes de integrar alterações. Essa configuração não é feita pelo aplicativo.

Uma validação local não comprova que o GitHub Actions executou. O workflow remoto deve ser conferido no GitHub; este desenvolvimento não criou commit, push ou PR no repositório do aplicativo.

## Worktrees por agente

1. O projeto precisa ser um repositório Git com ao menos um commit e `.orquestra-worktrees/` no `.gitignore`. O Orquestra não altera silenciosamente a configuração de outro repositório.
2. Na aba **Orquestração → Worktrees e revisão cruzada**, selecione o agente com terminal encerrado e sem tarefas ativas. Clique **Preparar worktree**.
3. O Orquestra cria `.orquestra-worktrees/<UUID>` com branch `orquestra/<ID do agente>/<UUID>`, a partir do HEAD do projeto. A identidade independe do fornecedor. Dois agentes Codex recebem branches diferentes.
4. Abra o terminal do agente. Suas tarefas usam o diretório isolado e guardam a identificação da worktree no histórico. A aplicação verifica branch/repositório ao abrir e delegar. Um terminal ainda aberto em outra pasta é recusado.
5. Use **Revisar diff e commits** para consultar alterações rastreadas, novos arquivos, commits e o identificador da versão revisada. A lista de worktrees também aponta conflitos Git existentes e arquivos alterados por mais de um agente; essa sobreposição é um alerta de possível conflito, não uma simulação de merge.

Alterações ainda sem commit na pasta original não são copiadas. Dependências ignoradas, como `node_modules`, também não são copiadas: prepare as dependências na worktree antes de testar. As pastas irmãs podem executar em paralelo; uma tarefa na raiz do projeto ainda se sobrepõe às worktrees internas e respeita a fila. Terminais manuais não são bloqueados pela fila.

Worktrees, arquivos e branches nunca são removidos automaticamente, inclusive ao remover um agente. A metadata fica no `workspace.json`; se a pasta desaparecer ou mudar de branch, a interface informa erro. Não há integração automática na branch principal. Merge, push e limpeza devem ser avaliados e autorizados separadamente pelo usuário.

## Commits

Por padrão, o agente não pode fazer commit por ferramenta MCP. A interface mostra os arquivos e o diff; informe uma mensagem descritiva, preferencialmente Conventional Commits, e use **Autorizar commit revisado**. Isso inclui todos os arquivos pendentes da worktree. Se o conteúdo mudar desde a revisão, a operação é recusada. Conflitos Git também bloqueiam o commit. A autorização não inclui push ou merge.

O usuário pode habilitar **Permitir commits automáticos para este agente**. Nesse caso, o próprio executor pode usar `consultar_worktree` e `commit_worktree` com a revisão atual, inclusive durante sua tarefa. Executores só acessam a própria worktree pelo MCP. O coordenador não pode habilitar essa configuração pelo MCP. Commits pela interface aguardam tarefas ativas; commits também aguardam validações locais. Se um hook de commit falhar, o Git pode deixar arquivos preparados no índice; eles continuam visíveis para revisão.

As ferramentas respeitam o fluxo de autorização do Orquestra. Os CLIs continuam sujeitos às permissões configuradas pelo usuário: a worktree é isolamento de arquivos Git, não uma barreira de sistema operacional contra comandos arbitrários de um CLI.

## Revisão cruzada

Prepare a worktree do implementador e abra ao menos dois executores gerenciados. Escolha implementador, revisor e testador, ou use seleção automática. O revisor é sempre outro agente. Com dois executores, o revisor também testa; com três disponíveis, a seleção automática prefere um terceiro testador. A descoberta verifica terminais disponíveis, não autenticação, assinatura ou qualidade de modelo. Provedores sem adaptador de executor gerenciado continuam disponíveis como terminais manuais e não entram nessa seleção.

O fluxo cria tarefas reais na fila existente: implementação → revisão do diff → teste pelo agente. Os revisores recebem a pasta, branch, base Git, arquivos e uma prévia limitada do diff, com instruções para ler o conteúdo completo no disco. Eles retornam JSON com `revision`, `verdict`, `findings` e evidências de testes. Texto livre ou uma revisão de código diferente não aprova a etapa. Resultados declarados dos agentes ficam separados dos comandos executados pelo backend.

Depois dos dois pareceres aprovados, a revisão fica **Aguardando validação local**. O botão **Executar check/test/build e validar** executa os scripts existentes nessa worktree. O script `test` é obrigatório; `check` e `build` são executados quando definidos. Cada comando registra saída, código e aprovação, com limite de dois minutos. A pasta fica reservada contra outras tarefas da fila durante essa validação. A aprovação exige comandos bem-sucedidos e conteúdo idêntico ao revisado. Scripts são código do projeto: use o botão apenas para projetos nos quais deseja executar esses comandos.

Se houver problemas, use **Encaminhar correções ao implementador**. O limite de ciclos é configurável de um a três; cada nova tentativa é explícita e carrega os achados. Falhas, pedidos de aprovação, agentes indisponíveis e relatórios inválidos deixam pendências visíveis. Reiniciar o servidor interrompe o fluxo sem reenviar tarefas automaticamente.

O relatório mostra agentes, branch, arquivos, commits, etapas, achados, testes executados, códigos de saída, pendências e estado final. Ele se refere à revisão identificada; alterações posteriores exigem outra revisão. O estado persiste em `reviews.json`. O AI Memory existente guarda uma única página de resumo por revisão com referências às tarefas, sem duplicar os transcripts já registrados. Falhas de memória ficam em `memoryError` e não são confundidas com falhas de código.

Ferramentas MCP novas: `preparar_worktree`, `listar_worktrees`, `consultar_worktree`, `commit_worktree`, `iniciar_revisao`, `consultar_revisao` e `retomar_revisao`. A validação final e a configuração de commits automáticos são ações da interface autenticada. Reabra as sessões dos CLIs para carregar a nova lista de ferramentas após atualizar o aplicativo.

## Limites de validação

Não há teste automatizado visual completo do frontend nem da janela Electron. O CI compila a interface e empacota/verifica o backend; a navegação visual, autenticação real dos CLIs e integração com o binário oficial AI Memory devem ser verificadas manualmente quando desejadas. A suíte usa mocks e fixtures e não presume aprovação de um agente externo. Diffs muito grandes ou novos arquivos acima de 1 MiB são recusados pela inspeção, com erro explícito, em vez de uma aprovação parcial.
