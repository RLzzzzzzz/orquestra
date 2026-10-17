# Build de memória e notificações — 17/10/2026

Continuação do chat anexado, preservando as alterações existentes e as sessões do usuário. Esta rodada conclui as validações pendentes e o empacotamento; os relatórios anteriores representam o estado das respectivas revisões.

## Captura nativa

| CLI | Implementação | Evidência e limite |
| --- | --- | --- |
| OpenCode | Plugin oficial gerado pelo AI Memory, escopo do projeto do aplicativo | Prova anterior em `.local-core-e2e-YRMB9P/result.json`: dois agentes reais, captura e retomada. |
| Gemini | Perfil privado com hooks de usuário; timeout em milissegundos e comando Windows codificado | Prova anterior pendente, agora lida: `.local-provider-capture-NC6tBa/result.json`, saída 0, 1 sessão e 5 observações. Nova prova: 1 sessão e 3 observações; a resposta do modelo atingiu o limite de 60 segundos. Captura comprovada; esta última resposta não foi concluída. |
| Antigravity | Hooks locais em `.agents/hooks.json`, preservando outras entradas | Nova prova: saída 0, 1 sessão e 2 observações. |
| Hermes | Perfil isolado em caminho curto, plugin de eventos do runtime instalado | Nova prova: saída 0, 1 sessão e 4 observações. |
| Codex | Hooks inline na configuração do processo, sem alterar login ou aprovar confiança automaticamente | Configuração implementada; a execução anterior respondeu, mas capturou 0 sessões. Requer revisão dos hooks em `/hooks`; captura real após aprovação ainda não comprovada. |
| Claude | Eventos nativos com `--settings` na sessão gerenciada | Configuração coberta pelos testes; CLI não instalado neste ambiente, sem prova real. |

As novas provas estão em `.local-provider-capture-VtquYB/result.json`. O gateway autentica os eventos e fixa o escopo do projeto; o engine oficial mantém sanitização, spool e IDs nativos. Integrações só carregam em novas sessões abertas pelo aplicativo. Freebuff, shell e comandos personalizados não têm captura nativa.

## Notificações

O desktop inclui `preload.cjs` e `notifications.cjs`, com ponte isolada para IPC. Somente o frame principal pode enviar avisos. Há deduplicação, supressão com a janela em foco, teste explícito nas preferências e restauração da janela ao clicar. Toasts e histórico interno continuam disponíveis.

Prova real em `.local/desktop-notification-result.json`: `supported=true`, `bridge=true`, `submission.status=submitted`, evento nativo `show`. O teste usou Electron real, o preload e o handler de produção, com `contextIsolation` e sandbox do renderer ativos. Isso comprova aceitação pelo Windows; não é uma observação visual do banner nem um ensaio de clique no pacote instalado. O teste é repetível com Electron executando `scripts/check-desktop-notifications.cjs`; remova `ELECTRON_RUN_AS_NODE` do ambiente.

Para usar: Preferências → Notificações do sistema → Testar aviso do sistema. Os eventos normais são enviados com a janela em segundo plano.

## Verificações

- 76 testes aprovados fora do sandbox. Dentro dele, o teste que encerra árvore Windows atingiu timeout; a execução externa passou.
- Sintaxe de 55 arquivos e consistência entre manifesto e lockfile aprovadas.
- Build Vite aprovada, incluindo a orientação específica de `/hooks`.
- Engine oficial aprovado: escrita concorrente, controle de versão, leitura de contexto, Unicode, isolamento de projeto, persistência após reinício e handoff consumido uma vez. Evidência: `.local-memory-check-33SwLd`.
- O verificador do empacotamento compara main/preload/notificações dentro de `app.asar` e memória/captura/helper Hermes/interface no backend com as fontes atuais; também valida resolução local das dependências e imports usando o Node incluído.

## Distribuição

Pacotes gerados em `release/memoria-notificacoes-20261017/`, com instalador `Orquestra-0.1.0-x64-nsis.exe` (169.720.289 bytes) e portátil `Orquestra-0.1.0-x64-portable.exe` (169.490.420 bytes). Cabeçalhos executáveis Windows e hashes SHA-256 das cópias conferidos. Os hashes estão em `checksums.json`, junto das evidências de captura e notificação. Só os arquivos desta pasta correspondem a esta rodada. Feche o Orquestra antes de instalar e abra novas sessões para carregar os hooks. Os dados existentes não são removidos pelo instalador. A instalação sobre o perfil do usuário não foi executada nesta validação.

Sem commit, push ou mudança automática das aprovações de confiança dos CLIs.

## Correção posterior: inicialização do Codex

A build acima apresentou uma regressão real: os hooks inline aumentaram os argumentos do Codex para 14.432 caracteres, dos quais 10.659 eram hooks. O shim npm `codex.cmd` passa pelo limite de 8.191 caracteres do `cmd.exe`; o terminal exibiu `Linha de comando muito longa.` e caiu no shell de fallback. Os testes anteriores não cobriam o launcher com argumentos desse tamanho.

O launcher agora reconhece o formato canônico dos shims Node do npm e executa seu arquivo JavaScript diretamente pelo Node, preservando os argumentos. Wrappers personalizados continuam usando seu comportamento original. Novos testes verificam a execução real com argumento de 15.000 caracteres, caminhos com espaços/acentos e preservação de wrappers personalizados. Os 78 testes passaram.

Prova isolada em `.local-codex-startup-xHSUdl/result.json`: Codex real abriu e apresentou a revisão de hooks. No aplicativo instalado, os dois módulos do launcher foram atualizados com backup em `.local/codex-launcher-backup-20261017`; só a sessão de fallback do Codex foi reiniciada. A confirmação posterior mostrou `mode=agent`, `status=running` e `mcpReady=true`, com OpenCode preservado na sessão original. Nenhuma aprovação de hooks foi feita pelo agente.

**Use a distribuição corrigida em `release/codex-launch-fix-20261017/`.** Ela substitui a distribuição `memoria-notificacoes-20261017` descrita acima. A correção também está aplicada à instalação local; não é necessário reinstalar para abrir o Codex nesta máquina.
