# Orquestra

Painel local para reunir vários agentes de IA, cada um em seu próprio terminal. Envie tarefas, veja o que cada CLI está fazendo e, quando quiser, escolha um dos agentes compatíveis para coordenar os demais.

## Aplicação desktop para Windows

O desktop mantém a interface React/Vite e o servidor Node.js existentes. O Electron abre a interface em uma janela, aguarda o servidor ficar pronto e solicita seu encerramento por IPC ao fechar. Os terminais, a fila e o MCP continuam no mesmo backend. Uma segunda abertura foca a janela existente.

O pacote inclui uma cópia do `node.exe` usado na preparação e instala as dependências de produção em uma pasta separada. Assim o `node-pty` continua usando a ABI do Node.js, sem recompilação para Electron. Esse runtime também fica no PATH dos terminais e dos CLIs iniciados pelo aplicativo. O usuário do executável não precisa instalar Node.js separadamente.

Para desenvolver ou gerar os executáveis, use Windows x64 com Node.js 22+ x64 e acesso à internet:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run desktop
```

Para gerar o portátil, feche a janela de desenvolvimento e execute:

```powershell
# Opcional: inclui o AI Memory no pacote, se ainda não estiver instalado.
npm.cmd run memory:install
npm.cmd run desktop:portable
```

Saída: `release/Orquestra-0.1.0-x64-portable.exe`. O portátil extrai seus arquivos de execução temporariamente; os dados persistem no perfil do usuário. Ele não exige instalação, mas não transporta automaticamente os dados junto com o `.exe`.

Outras opções:

```powershell
# Pasta com o aplicativo completo, útil para diagnosticar antes do portátil:
npm.cmd run desktop:pack
# Instalador NSIS por usuário, com escolha de diretório:
npm.cmd run desktop:installer
```

O instalador fica em `release/Orquestra-0.1.0-x64-nsis.exe`. A pasta de diagnóstico fica em `release/win-unpacked`; ao distribuí-la, mantenha todos os arquivos juntos. A versão do nome acompanha `package.json`. Os executáveis não têm assinatura digital configurada.

Antes de compactar, `scripts/verify-desktop.cjs` verifica as dependências dentro de `resources/backend/node_modules` e carrega os módulos do servidor com o Node incluído. Dependências encontradas apenas no repositório não passam nessa checagem.

`desktop:prepare` copia apenas código do servidor, interface compilada, dependências de produção, runtime e avisos de licença para `.desktop/backend`. Ele executa `npm ci --omit=dev` nessa pasta, sem alterar o `node_modules` de desenvolvimento. O Electron é empacotado separadamente. Se o `node-pty` precisar compilar em vez de usar seus binários prontos, instale as ferramentas exigidas por ele (Python e Visual Studio Build Tools com C++). Nenhum projeto, credencial, banco, wiki ou histórico de `.local` entra no pacote. Do AI Memory local, apenas o executável e sua licença são incluídos, quando disponíveis.

CLIs de IA e suas autenticações continuam sendo instalados pelo usuário. O runtime incluído atende também aos CLIs baseados em Node encontrados no PATH; não inclui npm, Python, Git ou outros runtimes externos. A memória continua exigindo Git no PATH. `ORQUESTRA_MEMORY_BIN` continua permitindo selecionar outro binário de memória.

Dados do desktop: `%APPDATA%\Orquestra\data`. Log do servidor: `%APPDATA%\Orquestra\server.log` (substituído a cada abertura). Preferências da interface ficam no perfil do Electron, separado do navegador. O primeiro projeto novo usa a pasta Documentos; adicione ou selecione a pasta real de trabalho na interface.

Para reaproveitar os dados atuais, encerre o serviço antigo e o desktop e copie o conteúdo de `.local` para `%APPDATA%\Orquestra\data`, preservando uma cópia de segurança. Outra opção é definir `ORQUESTRA_DATA_DIR` com o caminho absoluto da `.local` existente antes de abrir o desktop. Não execute dois servidores sobre os mesmos dados. A porta continua sendo `4317` (ou `PORT`, se definido), mantendo a origem das preferências estável; encerre `npm start`/`npm run dev` antes de abrir o desktop para liberar essa porta.

Validação local sugerida, sem chamadas automáticas aos modelos:

1. Execute `npm.cmd test` e os comandos acima para abrir o desktop.
2. Abra um terminal, digite um comando e confira redimensionamento e saída ao vivo.
3. Abra um CLI já autenticado e confira o MCP/coordenação com o fluxo habitual; uma tarefa real pode consumir chamadas do modelo.
4. Feche a janela e confirme que o servidor e os processos iniciados pelos terminais encerraram; reabra e confira projetos, histórico e preferências.
5. Execute o portátil em uma máquina Windows x64 sem Node no PATH; confira o terminal e os CLIs disponíveis. Faça a mesma verificação com o instalador, se for distribuí-lo.

O empacotamento e os testes de execução precisam ser feitos localmente. Para referência, a separação do runtime evita a [diferença de ABI dos módulos nativos no Electron](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules); a janela usa isolamento de contexto, sandbox e Node desabilitado conforme as [orientações do Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Requisitos para executar pelo código-fonte

- Windows 10 versão 1809 ou superior.
- Node.js 22 ou superior.
- Pelo menos um CLI de IA instalado e autenticado para usar agentes de IA. Cada CLI usa a conta, o modelo e as permissões já configurados para ele.

## Início rápido

1. Baixe ou clone o projeto.
2. Abra `iniciar.cmd` ou execute no PowerShell:

   ```powershell
   npm.cmd install
   npm.cmd run memory:install
   npm.cmd run build
   npm.cmd start
   ```

3. Abra http://127.0.0.1:4317.
4. Selecione **Novo agente**, escolha um CLI e inicie o terminal.

Mantenha a janela do serviço aberta. Para desenvolvimento, use `npm.cmd run dev`. O `iniciar.cmd` também compila a interface antes de abrir o serviço.

## Agentes e coordenação

Cada agente tem um terminal próprio. Inicie os executores Codex, OpenCode ou Claude Code antes de delegar. Na aba **Orquestração**, escolha Codex, OpenCode, Claude ou Freebuff como coordenador, abra sua sessão e descreva o objetivo no terminal. Por exemplo:

> Delegue ao OpenCode a revisão do README, sem alterar arquivos. Aguarde e resuma o resultado.

O coordenador usa os terminais abertos deste projeto: a instrução entra na conversa existente e a resposta aparece ao vivo no próprio painel do executor. Nenhum segundo processo de execução é criado para essa tarefa. Ao terminar, o executor chama `concluir_tarefa` pelo MCP para confirmar o resultado ao coordenador. Se precisar de uma aprovação, ela aparece no próprio terminal. Não há conclusão presumida por tempo ou por texto da tela.

As tarefas e seus resultados também aparecem em **Orquestração**. É possível delegar diretamente, cancelar e repetir tarefas. Cancelar encerra o terminal executor para interromper o trabalho antes de liberar a pasta; reabra-o para continuar. Ao atingir 30 minutos, a execução também é encerrada. A fila não controla instruções digitadas manualmente, então evite inserir uma nova tarefa enquanto ele executa uma delegação. O Freebuff pode solicitar confiança no MCP na primeira abertura; continua compatível como coordenador, mas não como executor gerenciado.

Antigravity (`agy`), Freebuff (`freebuff`), Gemini e Hermes (`hermes`) também podem ser cadastrados como terminais manuais. Nesta versão eles não recebem delegações na sessão aberta. A disponibilidade do CLI indica que o comando está no PATH; a lista oferecida ao coordenador contém apenas executores com terminal gerenciado aberto. Login e acesso ao modelo continuam sendo gerenciados pelo CLI.

## AI Memory

A aba **Memória** usa o mecanismo original [akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory), versão 3.1.0, executado localmente pelo serviço do Orquestra. O instalador baixa a release oficial para a plataforma e confere seu SHA-256 antes de extrair. Windows nativo é experimental no projeto original. É necessário Git no PATH. Para usar outro binário, defina `ORQUESTRA_MEMORY_BIN` com seu caminho completo.

- Notas em Markdown, busca textual, histórico Git e índice local do AI Memory.
- Decisões, aprendizados e resultados compartilhados entre os agentes do mesmo projeto.
- Registro automático da instrução e do resultado das tarefas delegadas; erros de gravação ficam em `memoryError` na tarefa.
- Contexto recente inserido na próxima delegação, além de ferramentas MCP para consultar e salvar memórias.
- Handoffs explícitos para passar contexto entre agentes ou sessões, aceitos uma única vez.

Os agentes podem usar `buscar_memoria`, `salvar_memoria`, `ler_memoria`, `resumo_memoria`, `criar_handoff`, `listar_handoffs` e `aceitar_handoff`. A integração fixa o projeto no servidor; o modelo não escolhe o escopo de outros projetos. Notas também podem ser criadas, editadas e consultadas na interface. Cada tarefa recebe um contexto limitado, para não reenviar toda a memória.

A wiki fica em `.local/memory/wiki`, com seu próprio Git, e o índice em `.local/memory/db`. O serviço não instala hooks globais, não importa conversas antigas dos fornecedores e não captura automaticamente toda conversa manual: a captura automática desta integração abrange tarefas delegadas. Consolidação com modelo, embeddings e rotinas de reescrita continuam nas configurações do AI Memory e não são ativadas por esta integração. O caminho padrão não precisa de chave de API nem faz chamadas adicionais a modelos para armazenar e buscar memória.

Tarefas na mesma pasta, ou em pastas sobrepostas, entram em fila. Até três tarefas em pastas distintas podem rodar ao mesmo tempo. Os terminais interativos não são bloqueados pela fila. Evite editar os mesmos arquivos em mais de um agente simultaneamente.

## Interface

- Alterne entre uma, duas ou várias colunas e coloque um terminal em foco.
- Arraste o canto inferior direito do painel para mudar seu tamanho. Dê duplo clique para restaurar.
- Arraste a alça de pontos no cabeçalho de um terminal sobre outro para trocar suas posições.
- Use a **Central de tarefas** para enviar uma instrução a um ou mais terminais.

## Instalação dos CLIs

Instale e autentique cada CLI conforme as instruções do seu fornecedor. O Orquestra não pede nem armazena chaves de API. Depois de instalar um CLI ou mudar o PATH, reinicie o Orquestra para atualizar a detecção. Inicie pelo `iniciar.cmd` ou em um terminal normal do seu usuário para que os processos encontrem os CLIs e suas autenticações.

## Desenvolvimento e verificação

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

`node scripts/check-cli.mjs codex opencode` verifica se os CLIs abrem e aceitam digitação sem enviar tarefa. `node scripts/check-live-orchestration.mjs` verifica a delegação real Codex → OpenCode com dois terminais abertos, mesmo PID do executor, resposta visível e gravação no AI Memory; consome chamadas dos modelos. Os outros scripts de verificação também podem iniciar chamadas ou confirmações de confiança; execute-os somente quando desejar essa interação.

## Dados e privacidade

O serviço local escuta em `127.0.0.1` e protege a interface com uma sessão local. Não o exponha à internet.

- Projetos e agentes ficam em `.local/workspace.json`.
- Instruções, status, resultados e saída das tarefas ficam em `.local/tasks.json`.
- Esses dados e o estado do serviço são ignorados pelo Git.
- O layout e as ações recentes ficam no armazenamento do navegador.
- Reiniciar o serviço encerra os terminais e interrompe tarefas em andamento. Agentes e tarefas concluídas continuam no histórico.

As tarefas usam as permissões configuradas em cada CLI. A conclusão do processo confirma que ele terminou, não que o resultado está correto. O Orquestra não cria worktrees nem mescla alterações automaticamente.

## Estrutura

- `server/`: serviço local, terminais, fila de tarefas e conexão MCP.
- `src/`: interface React e painéis de terminal.
- `scripts/`: inicialização e verificações dos CLIs.
- `tests/`: testes de API, terminais, fila e coordenação.

O projeto foi inspirado na organização visual do [Alethe Agents](https://github.com/Kc1t/alethe-agents). A implementação é independente e não copia código, logotipo ou material visual do projeto.
