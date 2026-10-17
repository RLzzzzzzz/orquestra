# Tema OpenCode nos terminais — 17/10/2026

Aplicado ao aplicativo instalado e incluído na distribuição `release/opencode-theme-20261017/`, preservando as correções de memória, notificações e abertura do Codex.

- Paleta escura baseada no [tema TUI oficial do OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/theme/assets/opencode.json): preto, superfícies neutras e destaque pêssego.
- Mesma paleta ANSI, fonte monoespaçada, moldura, foco, cabeçalhos e caixa de entrada em todos os painéis.
- Entrada por painel: Enter envia, Shift+Enter insere uma linha. Envio direcionado à sessão atual, com colagem multilinha e preservação do texto se houver erro. Shells, sessões encerradas e sessões com tarefa delegada mantêm a entrada comum desabilitada.
- Animação de entrada e indicador animado durante recebimento real de saída. Replay não dispara esse indicador. A preferência de movimento reduzido desativa as animações.
- Altura mínima dos painéis ajustada para acomodar a área de entrada. Tema salvo nas preferências; nesta atualização, OpenCode é aplicado uma vez como padrão. As outras opções continuam disponíveis.

A apresentação desenhada internamente por cada CLI continua nativa: menus, ferramentas, modelos e prompts não são reimplementados ou transformados em outro CLI. A identidade comum é aplicada ao terminal e à interface do Orquestra. Isso inclui as novas caixas de entrada, além dos controles nativos que cada CLI já desenha.

## Validação

78 testes aprovados, incluindo isolamento de sessão e colagem multilinha; build Vite e verificações de sintaxe aprovadas. A janela real do aplicativo instalado foi recarregada, inspecionada por acessibilidade e por captura de tela: OpenCode e Codex têm a nova entrada comum e a paleta aplicada. Ambos conservaram as sessões anteriores (`e96e709c…` e `0e9062fd…`) e MCP conectado. Nenhum prompt de teste foi enviado a esses agentes.

Prévia isolada em `.local-theme-preview-Vi4v74`, com três CLIs sem iniciar processos; medições de layout em `.local/theme-ui-validation.json`. O pacote confere a interface atual e os módulos do launcher que corrigem o limite de linha do Windows.

Backup da interface instalada: `.local/opencode-theme-backup-20261017`. A atualização substituiu os arquivos estáticos e recarregou somente a interface, sem reiniciar backend ou CLIs.
