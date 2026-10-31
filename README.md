# Orquestra

Seus agentes de IA em um workspace local: terminais lado a lado, um coordenador que delega tarefas, memória compartilhada por projeto e revisão de código com worktrees opcionais.

Este guia ensina a preparar o ambiente, conectar seus CLIs e executar a primeira delegação. Os comandos usam PowerShell no Windows; execute-os na pasta onde você baixou o Orquestra. `npm.cmd` evita problemas com a política de execução do PowerShell.

## 1. Escolha seu ponto de partida

### Já tenho os CLIs instalados e autenticados

Feche o Orquestra e execute:

```powershell
npm.cmd run setup
npm.cmd start
```

Abra **http://127.0.0.1:4317**. O setup detecta os CLIs presentes e cadastra os que ainda faltam no projeto. Suas contas, nomes de agentes, funções e worktrees existentes são preservados.

Você também pode abrir `iniciar.cmd` com duplo clique: ele executa a mesma preparação e inicia o serviço. O login de cada fornecedor continua sendo feito por você.

### Estou preparando uma máquina nova

Instale [Node.js 22 ou superior](https://nodejs.org/en/download) e [Git for Windows](https://git-scm.com/downloads/win). Reabra o PowerShell e confira:

```powershell
node --version
npm.cmd --version
git --version
```

Baixe este repositório, extraia-o se necessário e abra um terminal nessa pasta. Para preparar o Orquestra e instalar os CLIs Codex, OpenCode e Gemini que ainda não estiverem presentes:

```powershell
npm.cmd run setup -- --install-clis codex,opencode,gemini
```

Depois, faça o login dos CLIs que pretende usar, conforme a seção 3. Você pode escolher apenas um ou dois: `--install-clis codex,opencode` também funciona. O setup termina sem abrir conversas nem consumir chamadas de modelo.

### O que o comando automático faz

1. Confere Node.js, a pasta do projeto e se o serviço está fechado.
2. Instala as dependências pelo lockfile com `npm ci`, caso estejam ausentes.
3. Instala somente os CLIs ausentes solicitados em `--install-clis`; novas instalações do OpenCode ficam na versão principal 1, compatível com o adaptador atual.
4. Prepara o AI Memory oficial se não estiver instalado, conferindo SHA-256 do download; exige Git.
5. Compila a interface.
6. Cadastra o projeto e um agente para cada CLI detectado, sem duplicar os cadastros existentes.

Você continua responsável pelo login, acesso ao modelo e aprovações de confiança de cada fornecedor. A integração MCP e os hooks de memória são preparados pelo Orquestra ao abrir novas sessões pelo aplicativo; não é necessário adicionar manualmente um servidor MCP global.

O setup padrão configura os dados usados por `npm start`, em `.local`. Para o desktop, veja a seção 9: ele usa outra pasta por padrão.

## 2. Configure a pasta em que os agentes vão trabalhar

Se seu código está em outra pasta, configure-a antes de iniciar:

```powershell
npm.cmd run setup -- --project-dir "C:\Projetos\Minha aplicação"
npm.cmd start
```

O diretório precisa existir. O comando encontra projetos cadastrados pela pasta real e adiciona somente os agentes que faltam. Também é possível clicar em **Novo projeto**, informar o nome e selecionar a pasta na interface.

Para conferir o ambiente sem instalar, cadastrar ou abrir modelos:

```powershell
npm.cmd run setup -- --check
```

O diagnóstico informa dependências, CLIs, Git, executável de memória e build. **CLI detectado** significa que o comando foi encontrado; isso não comprova login ou disponibilidade do modelo.

Outras opções:

| Comando/opção | Quando usar |
| --- | --- |
| `npm.cmd run setup -- --help` | Consultar todas as opções. |
| `--install-clis codex,opencode,gemini` | Instalar CLIs ausentes desses três fornecedores. Não atualiza/reinstala comandos encontrados. |
| `--skip-memory` | Preparar a aplicação sem instalar/verificar o engine; memória e captura exigirão configuração posterior. |
| `--data-dir "C:\Dados\Orquestra"` | Preparar outra pasta de dados. Ao iniciar, defina `ORQUESTRA_DATA_DIR` com o mesmo caminho. |

O setup não troca configurações de modelo, não redefine senhas e não remove agentes anteriores. Feche servidores e o desktop antes de executá-lo para evitar que dois processos gravem os mesmos dados.

## 3. Instale e autentique seus CLIs

Execute apenas os comandos dos provedores que deseja usar. Se eles já funcionam no seu terminal, mantenha a instalação e o login existentes.

### Codex

O setup pode instalar o pacote oficial. Para instalar separadamente:

```powershell
npm.cmd install -g @openai/codex
codex
```

Na primeira abertura, escolha o método de login oferecido e conclua o fluxo no navegador. O Orquestra usará essa autenticação nas sessões iniciadas pelo mesmo usuário do Windows. Consulte [Codex CLI](https://developers.openai.com/codex/cli/) e [autenticação oficial](https://developers.openai.com/codex/auth/).

### OpenCode

```powershell
npm.cmd install -g opencode-ai@1
opencode
```

Dentro do OpenCode, use `/connect`, escolha seu provedor e siga a autenticação oferecida. Cada provedor pode exigir conta ou chave própria. Esta integração usa o contrato do OpenCode 1; por isso, o comando e o setup fixam novas instalações em `opencode-ai@1`. O OpenCode 2 compartilha o comando `opencode` e precisa de validação de compatibilidade antes de uma migração. Uma instalação existente é preservada pelo setup, sem downgrade automático. Consulte a [instalação e configuração oficiais](https://opencode.ai/docs/).

### Claude Code

O setup reconhece o Claude instalado. Ele não está na lista de instalação automática; instale-o conforme o [guia oficial para Windows](https://code.claude.com/docs/en/setup) e então execute:

```powershell
claude
```

Conclua o login solicitado. Veja também o [primeiro acesso ao Claude Code](https://code.claude.com/docs/en/quickstart). Depois, feche o Orquestra e repita `npm.cmd run setup` para cadastrá-lo.

### Gemini CLI

```powershell
npm.cmd install -g @google/gemini-cli
gemini
```

Selecione a autenticação oferecida, como **Login with Google**, e conclua-a. O Gemini funciona como terminal manual com captura de memória; não é executor gerenciado nesta versão. [Guia oficial do Gemini CLI](https://google-gemini.github.io/gemini-cli/docs/get-started/).

### Antigravity, Hermes, Freebuff e comandos personalizados

Instale-os pelos canais oficiais de seus fornecedores e faça o login no próprio CLI. Os comandos procurados são `agy`, `hermes` e `freebuff`. Antigravity aqui significa o **CLI `agy`**, não um atalho para abrir o editor. No Windows, o aplicativo também procura os locais de instalação conhecidos de `agy` e `hermes` em `%LOCALAPPDATA%`.

Repita o setup após instalar ou ajustar o PATH e reinicie o Orquestra. Para qualquer outro CLI, clique em **Novo agente → Personalizado** e informe o comando. Um comando personalizado oferece um terminal, mas não ganha automaticamente as ferramentas de delegação e memória.

### O que cada CLI pode fazer no aplicativo

| CLI | Terminal manual | Coordenador | Executor de tarefa delegada | Captura nativa de memória |
| --- | --- | --- | --- | --- |
| Codex | Sim | Sim | Sim | Sim, após aprovar hooks no CLI |
| OpenCode | Sim | Sim | Sim | Sim |
| Claude Code | Sim | Sim | Sim | Sim, com hooks configurados |
| Freebuff | Sim | Sim | Não | Não |
| Gemini | Sim | Não | Não | Sim |
| Antigravity (`agy`) | Sim | Não | Não | Sim |
| Hermes | Sim | Não | Não | Sim |
| Terminal / personalizado | Sim | Não | Não | Não |

Configuração de captura não comprova que um evento já foi recebido. Sessões devem ser abertas pelo Orquestra; sessões antigas precisam ser reabertas para carregar integrações novas. A disponibilidade e aprovação dos hooks dependem da versão do CLI.

## 4. Abra os terminais

1. Execute `npm.cmd start` e mantenha essa janela aberta.
2. Abra **http://127.0.0.1:4317** e selecione o projeto na lateral.
3. Os agentes detectados pelo setup aparecem no projeto. Clique em **Iniciar** no painel de cada agente.
4. Para adicionar outra sessão, clique em **Novo agente**, escolha o CLI, o nome e a pasta. Clique para iniciar.
5. Se houver pedido de login, confiança ou aprovação, resolva no terminal correspondente.

O terminal mostra a saída real do processo. Você pode digitar diretamente nele ou usar o campo de mensagem do painel. **Enter** envia a mensagem; **Shift+Enter** insere uma nova linha. A Central de tarefas à direita insere mensagens nos terminais selecionados; ela não cria uma delegação acompanhada pela fila.

Use os botões de layout para uma coluna, duas colunas ou grade. O botão de foco amplia um terminal; sair do foco restaura os demais. A alça de pontos permite trocar painéis de posição. Arraste o canto do painel para ajustar seu tamanho; dê duplo clique para restaurar o tamanho automático. Fonte e tema ficam nas preferências.

Em áreas estreitas, a aplicação reduz automaticamente o número de colunas. Tamanhos manuais ficam limitados à área disponível; ao trocar de aba, foco ou tamanho da janela, os terminais reajustam sua geometria.

Se o CLI encerrar, o Orquestra pode disponibilizar um shell de recuperação. Esse shell permite diagnóstico, mas não recebe tarefas delegadas; use **Reiniciar agente** para reabrir o CLI.

## 5. Faça a primeira delegação

Comece com uma tarefa pequena de leitura para verificar o fluxo.

1. Abra pelo menos um executor Codex, OpenCode ou Claude no projeto.
2. Abra **Orquestração**, escolha quem coordena e clique em **Abrir coordenador**. Isso cria uma sessão separada do executor.
3. No terminal do coordenador, envie, por exemplo:

   > Liste os executores disponíveis. Delegue ao OpenCode a leitura do README, sem alterar arquivos. Aguarde a conclusão e resuma o que ele encontrou.

4. A tarefa aparece em **Orquestração → Tarefas delegadas**; a conversa do executor continua visível em **Terminais**.
5. O executor confirma recebimento e chama `concluir_tarefa` pelo MCP ao terminar. O coordenador consulta o resultado e devolve a resposta.

Um executor só fica disponível após abrir o terminal e inicializar a integração MCP. **Em execução** no terminal não significa, por si só, que ele está pronto para delegação. Se o contador de executores continuar zerado, confira login, confiança no MCP e erros de inicialização do CLI.

Você também pode clicar em **Delegar diretamente** para criar uma tarefa na fila sem pedir ao coordenador. As tarefas que usam pastas iguais ou sobrepostas rodam em sequência; até três tarefas em pastas distintas podem executar em paralelo. Instruções digitadas manualmente não passam por esse bloqueio: evite editar os mesmos arquivos em duas sessões.

Cancelar uma tarefa encerra o terminal executor para interromper o trabalho antes de liberar a pasta. Reabra-o para continuar. Ao reiniciar o serviço, tarefas ativas ficam interrompidas e não são reenviadas automaticamente.

## 6. Use a memória compartilhada

O AI Memory reúne decisões, aprendizados e resultados **somente do projeto selecionado**. Ele usa o engine local [akitaonrails/ai-memory 3.1.0](https://github.com/akitaonrails/ai-memory), com notas Markdown, histórico Git e índice de busca. O armazenamento e a busca padrão não exigem chave de API.

1. Abra **Memória** e aguarde o indicador **AI Memory conectado · local**.
2. Clique em **Nova memória**, escreva a nota e salve.
3. Busque pelo assunto; selecione uma página para ler, editar ou excluir.
4. Peça ao agente: “Consulte `buscar_memoria` e `resumo_memoria` do MCP Orquestra antes de trabalhar; salve as decisões importantes com `salvar_memoria`”.

Ao delegar, o serviço consulta contexto relacionado e envia um trecho limitado ao executor. Instrução e resultado da tarefa são registrados automaticamente. Se uma execução concluir e a gravação falhar, o resultado continua no histórico e o erro de memória aparece na tarefa.

Para passar trabalho a outra sessão, peça que o agente use `criar_handoff`. Na interface, aceite a passagem de contexto e encaminhe o resumo ao agente que continuará. Cada handoff é aceito uma única vez.

No Codex, abra `/hooks` e revise/aprove os hooks do AI Memory no próprio CLI. Freebuff, terminal e comandos personalizados não têm captura nativa. Sessões abertas fora do Orquestra não recebem automaticamente esta integração. Consolidação com modelo e embeddings são opções do engine, separadas do armazenamento básico.

Se precisar selecionar outro executável:

```powershell
$env:ORQUESTRA_MEMORY_BIN = "C:\Ferramentas\ai-memory.exe"
npm.cmd start
```

## 7. Organize tarefas, branches e revisão

Na aba **Tarefas**, crie itens de planejamento e altere seus estados. Os cartões de planejamento e as execuções delegadas têm ciclos distintos; mudar um cartão não envia uma instrução ao CLI.

Para trabalhar em branches isoladas, abra **Orquestração → Worktrees e revisão cruzada · opções avançadas**:

1. Adicione `.orquestra-worktrees/` ao `.gitignore` do projeto e tenha pelo menos um commit no Git.
2. Encerre o terminal do implementador e prepare sua worktree.
3. Reabra o terminal; ele passará a trabalhar na branch/pasta isolada.
4. Abra ao menos dois executores e escolha implementador e revisor distintos. O revisor também pode atuar como testador.
5. Envie o objetivo da revisão. Consulte os relatórios e encaminhe correções quando necessário.
6. Execute a validação local pela interface. A aprovação final exige verificações reais do projeto; a declaração de um agente não basta.

Alterações sem commit na pasta original não são copiadas para uma nova worktree. Revise o diff antes de autorizar commits. Commits automáticos precisam ser habilitados por agente. Push, merge e remoção de worktrees não são automatizados.

## 8. Resolva problemas comuns

| Sintoma | Como resolver |
| --- | --- |
| `node` ou `npm.cmd` não encontrado | Instale Node.js 22+ e reabra o terminal. |
| CLI não aparece | Confirme o comando com `Get-Command codex` (ou o nome correspondente), ajuste o PATH, feche o Orquestra e repita o setup. |
| CLI encontrado, mas pede login | Abra o próprio CLI e conclua a autenticação. Detecção não valida conta. |
| Porta 4317 ocupada / setup pede para fechar | Feche a outra janela/serviço do Orquestra, incluindo o desktop. Não rode dois servidores sobre os mesmos dados. |
| Zero executores disponíveis | Abra um Codex/OpenCode/Claude e aguarde MCP; confira confiança, login e saída do terminal. |
| Tarefa aguardando confirmação | Confira se o executor recebeu a instrução e consegue chamar `confirmar_recebimento`. Resolva aprovações no terminal. |
| Memória indisponível | Confira Git, rode `npm.cmd run setup -- --check`; com o serviço fechado, repita `npm.cmd run setup`. Verifique `ORQUESTRA_MEMORY_BIN` se definido. |
| Terminal ficou pequeno após arrastar | Dê duplo clique na alça de redimensionamento para voltar ao tamanho automático; use foco para ampliar a área de trabalho. |
| Desktop não mostra os projetos do navegador | As pastas de dados são diferentes por padrão; siga a seção 9. |
| Instalação do `node-pty` falha | Confira Node.js e arquitetura; se a instalação exigir compilação, instale Python e Visual Studio Build Tools com C++. |

Para usar outra porta na mesma sessão do PowerShell:

```powershell
$env:PORT = "4320"
npm.cmd start
```

Abra `http://127.0.0.1:4320`. A aplicação escuta somente em `127.0.0.1`; mantenha o serviço local.

## 9. Use ou gere o aplicativo desktop

Com o ambiente preparado pelo setup:

```powershell
npm.cmd run desktop
```

O desktop usa `%APPDATA%\Orquestra\data`; `npm start` usa `.local` na pasta do repositório. Para abrir o desktop de desenvolvimento com os dados que você acabou de configurar:

```powershell
$env:ORQUESTRA_DATA_DIR = (Resolve-Path .local).Path
npm.cmd run desktop
```

Feche o servidor do navegador antes de abrir o desktop. Outra opção é configurar diretamente a pasta padrão do desktop:

```powershell
npm.cmd run setup -- --data-dir "$env:APPDATA\Orquestra\data"
npm.cmd run desktop
```

O projeto configurado aparece nessa pasta; o setup não migra dados entre perfis. Para uma migração manual, feche todas as instâncias, faça backup e copie o conteúdo da pasta de dados para o destino escolhido.

Para distribuir no Windows x64:

```powershell
npm.cmd run desktop:pack
npm.cmd run desktop:portable
npm.cmd run desktop:installer
```

Use somente o formato necessário. Saídas em `release/`: pasta `win-unpacked`, portátil `Orquestra-0.1.1-x64-portable.exe` e instalador `Orquestra-0.1.1-x64-nsis.exe`. A versão acompanha `package.json`. O pacote inclui runtime Node.js e dependências do backend; CLIs, suas contas e Git continuam sendo instalados pelo usuário. O AI Memory é incluído se estiver no runtime local padrão durante o empacotamento. Dados de projetos, credenciais e histórico não entram no pacote. Os executáveis não têm assinatura digital configurada.

### Atualize o executável depois de alterar o código

1. Feche o Orquestra, incluindo janelas do desktop e servidores abertos pelo terminal. As sessões dos CLIs serão encerradas; finalize ou guarde o contexto antes.
2. Na pasta do repositório, execute `npm.cmd ci` se o `package-lock.json` ou as dependências tiverem mudado.
3. Gere novamente o formato que você utiliza:

   ```powershell
   # Portátil: já compila a interface e prepara o backend atualizado.
   npm.cmd run desktop:portable

   # Alternativa para a versão instalada:
   npm.cmd run desktop:installer
   ```

4. No modo portátil, copie o novo `.exe` de `release/` para o local onde você costuma abri-lo e atualize o atalho para esse arquivo. No modo instalado, execute o novo instalador e use o mesmo usuário/pasta da instalação anterior.
5. Reabra o aplicativo e confira a versão no rodapé da barra de projetos. Esta correção é a **0.1.1**. Reabra os terminais para que recebam o backend novo; uma sessão antiga não troca de transporte enquanto está em execução.

O build e o executável não substituem `%APPDATA%\Orquestra\data` nem a pasta definida em `ORQUESTRA_DATA_DIR`. Preserve essa pasta para manter seus projetos, histórico e memória. Compilar apenas com `npm.cmd run build` atualiza a interface do código-fonte; isso não modifica um `.exe` gerado anteriormente.

Para usar a versão atualizada pelo código-fonte, execute `npm.cmd run build` e então `npm.cmd start` ou `npm.cmd run desktop`. No navegador, recarregue a página após reiniciar o servidor.

## 10. Dados, atualização e desenvolvimento

| Dado | Pelo código-fonte | Desktop padrão |
| --- | --- | --- |
| Projetos e agentes | `.local/workspace.json` | `%APPDATA%\Orquestra\data\workspace.json` |
| Histórico de tarefas | `.local/tasks.json` | Dentro da pasta `data` |
| Wiki e índice | `.local/memory/wiki` e `.local/memory/db` | Dentro de `data\memory` |
| Preferências visuais | Armazenamento do navegador | Perfil Electron |
| Log do servidor desktop | — | `%APPDATA%\Orquestra\server.log` |

`ORQUESTRA_DATA_DIR` altera a pasta de dados. O setup não altera permanentemente essa variável; mantenha o mesmo valor ao iniciar por `npm start`. Guarde uma cópia de segurança antes de migrar ou restaurar dados. Reiniciar o serviço encerra os terminais, preservando projetos e histórico persistidos.

Para atualizar dependências após mudar o código/lockfile, com a aplicação fechada:

```powershell
npm.cmd ci
npm.cmd run setup
```

Para desenvolver e validar:

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run check:layout
```

Os testes automatizados usam fixtures, sem autenticar contas ou chamar modelos. Scripts `check-live-*` e algumas verificações de provedores podem iniciar sessões reais: leia o script antes de executá-lo.

`check:layout` exige o build e abre um renderer Electron oculto com dados temporários e terminais de teste. Ele verifica 45 cenários de tamanho, layout, foco e fonte, sem alterar seus projetos ou chamar modelos. A captura de referência fica em `coverage/terminal-layout.png`.

Para verificar especificamente o redraw da interface nativa do OpenCode instalado, execute `npm.cmd run check:opencode-resize` após o build. Essa verificação abre uma sessão isolada, muda a janela, confere prompt/rodapé/centralização e exige que o mesmo processo continue ativo. Não envia instruções ao modelo. Resultados e capturas ficam em `coverage/opencode-resize/`.

Depois de empacotar, `npm.cmd run check:opencode-resize -- --packaged` repete a verificação usando o backend, a interface e o `node.exe` de `release/win-unpacked/resources/backend`.

Estrutura: `src/` contém a interface; `server/`, os terminais, MCP, fila e memória; `scripts/`, preparação e verificações; `tests/`, regressões; `electron/`, o desktop.

Para detalhes técnicos, consulte [contrato de sessões e delegação](docs/core-estabilizacao.md), [CI, worktrees e revisão](docs/ci-worktrees-revisao.md) e [auditoria de memória e delegação](docs/auditoria-estabilizacao-2026-10-30.md). A interface e os fluxos usam [Alethe Agents](https://github.com/Kc1t/alethe-agents) e [Orca](https://github.com/stablyai/orca) como referências de produto, com implementação independente. Dependências e avisos estão em [THIRD_PARTY.md](THIRD_PARTY.md).


[![GitHub](https://img.shields.io/badge/GitHub-RLzzzzzzz-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/RLzzzzzzz)

