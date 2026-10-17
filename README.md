# Orquestra

Painel local para reunir vários agentes de IA, cada um em seu próprio terminal. Envie tarefas, veja o que cada CLI está fazendo e, quando quiser, escolha um dos agentes compatíveis para coordenar os demais.

## Requisitos

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
