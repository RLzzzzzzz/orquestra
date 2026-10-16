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
   npm.cmd run build
   npm.cmd start
   ```

3. Abra http://127.0.0.1:4317.
4. Selecione **Novo agente**, escolha um CLI e inicie o terminal.

Mantenha a janela do serviço aberta. Para desenvolvimento, use `npm.cmd run dev`. O `iniciar.cmd` também compila a interface antes de abrir o serviço.

## Agentes e coordenação

Cada agente tem um terminal próprio. Codex, OpenCode, Claude Code e Gemini CLI podem executar tarefas delegadas em processos separados. Na aba **Orquestração**, escolha Codex, OpenCode, Claude ou Freebuff como coordenador, abra sua sessão e descreva o objetivo no terminal. Por exemplo:

> Delegue ao OpenCode a revisão do README, sem alterar arquivos. Aguarde e resuma o resultado.

As tarefas e seus resultados aparecem na mesma aba. Também é possível delegar diretamente a um executor ou cancelar e repetir tarefas. O Freebuff precisa ser instalado e pode solicitar confirmação para conectar ao MCP na primeira vez.

Antigravity (`agy`), Freebuff (`freebuff`) e Hermes (`hermes`) também podem ser cadastrados como terminais. Antigravity e Hermes ainda não possuem integração para receber tarefas automáticas. A disponibilidade indica que o comando está no PATH; login e acesso ao modelo continuam sendo gerenciados pelo CLI.

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

`node scripts/check-cli.mjs codex opencode` verifica se esses CLIs abrem e aceitam digitação sem enviar uma tarefa. Os scripts `check-orchestration.mjs` e `check-freebuff-terminal.mjs` iniciam chamadas reais aos modelos ou a confirmação de confiança; execute-os somente quando desejar essa interação.

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
