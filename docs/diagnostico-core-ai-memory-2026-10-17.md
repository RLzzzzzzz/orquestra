# Relatório de Diagnóstico da Fase 1: Arquitetura, AI Memory e Integração Core

**Data:** 17 de Outubro de 2026  
**Escopo:** Investigação independente da Fase 1 (Sessão externa, sem alteração de código funcional).  
**Referências:** Repositório oficial `akitaonrails/ai-memory` (tag `v3.1.0` clonado em referência externa), documentação oficial (`docs/external-lifecycle.md`, `ARCHITECTURE.md`), e base de código atual do Orquestra.

---

## 1. Arquitetura Oficial (`ai-memory` v3.1.0)

O projeto oficial `akitaonrails/ai-memory` (v3.1.0) é um mecanismo de memória de longo prazo para agentes de IA estruturado em um engine em Rust com armazenamento baseado em Git local (`.git` wiki) e banco de dados vetorial/metadados (`db`). Seus principais pilares arquiteturais são:

- **Servidor e Modos de Transporte:** O binário `ai-memory` pode operar como um servidor HTTP/API ou como um servidor MCP via protocolo `stdio` (`ai-memory serve --transport stdio`), expondo ferramentas padronizadas para leitura, escrita, busca, briefing e gerenciamento de handoffs.
- **Captura de Ciclo de Vida e Hooks Externos (`/hook/batch`):** Conforme detalhado em `docs/external-lifecycle.md`, o ecossistema oficial suporta captura externa de eventos de ciclo de vida (`session-start`, `user-prompt-submit`, `post-tool-use`, `session-end`, etc.) através do endpoint POST `/hook/batch` (ou `/hook`).
- **Idempotência e Chaves Estáveis (`ingest_key`):** Cada evento de ciclo de vida enviado por um orquestrador externo requer uma chave de ingestão determinística e única por evento (`ingest_key`, gerada por hash SHA-256 de identificadores estáveis). O servidor assegura transações atômicas onde repetições são descartadas (skip) ou retomadas sem duplicar observações.
- **Identidade e Atribuição:** Preserva IDs nativos de sessão (`session_id`), namespace de produtor (`extension`), ator e agente, permitindo que múltiplos runtimes e CLIs alimentem a mesma wiki de projeto de forma rastreável.
- **Handoffs e Recuperação de Contexto:** Mecanismos robustos de transferência de contexto entre sessões e agentes (`memory_handoff_begin`, `memory_handoff_accept`, `memory_briefing`), garantindo que o conhecimento estruturado seja consultado e consumido exatamente uma vez.

---

## 2. Arquitetura Atual (Orquestra)

O Orquestra integra o AI Memory e gerencia sessões e tarefas por meio dos seguintes componentes principais:

- **Servidor MCP e Gerenciamento de Memória (`server/memory.mjs`):** O Orquestra inicia o binário `ai-memory` localmente como subprocesso MCP via transporte `stdio`:
  ```javascript
  this.transport = new StdioClientTransport({ command: binary, args: ['--data-dir', this.dataDir, 'serve', '--transport', 'stdio'], cwd: this.dataDir, stderr: 'pipe' });
  ```
  O Orquestra expõe rotas internas em `server/index.mjs` (`/api/projects/:id/memory/*`) que traduzem requisições da interface web para chamadas de ferramentas MCP (`memory_query`, `memory_write_page`, `memory_read_page`, `memory_briefing`, `memory_handoff_*`, etc.).
- **Terminais PTY e Execução (`server/terminals.mjs`):** Gerencia processos PTY independentes (`node-pty`) para cada agente cadastrado, atribuindo IDs de sessão únicos (`sessionId`), mantendo histórico de buffer e suportando modos `agent`, `shell` e `fallback`.
- **Tarefas ao Vivo e Delegação (`server/live-tasks.mjs`, `server/task-manager.mjs`):** A delegação de tarefas é feita abrindo um prompt estruturado diretamente no terminal PTY ativo do agente (que roda com a integração MCP do Orquestra conectada). O agente confirma o recebimento (`confirmar_recebimento`) e encerra com `concluir_tarefa`.
- **Registro de Tarefas (`Memory.recordTask` em `server/memory.mjs`):** Ao concluir uma tarefa delegada, o `TaskRunner` aciona `memory.recordTask(job)`, que grava um arquivo Markdown episódico em `tasks/{job.id}.md` na wiki do projeto via `memory_write_page`.

---

## 3. Comparação: Oficial vs. Atual

| Dimensão | Arquitetura Oficial (`ai-memory` v3.1.0) | Integração Atual no Orquestra |
|---|---|---|
| **Modelo de Ingestão de Sessões** | Ingestão automática via hooks de CLI locais (`claude-code`, `codex`, `opencode`, etc.) ou POST `/hook/batch`. | Não possui interceptação automática de conversas ou comandos livres digitados no PTY do terminal. |
| **Escopo de Captura** | Captura completa de turnos, prompts, uso de ferramentas e encerramentos de sessão (`session-end`). | Restrita a notas manuais e registros de tarefas delegadas (`tasks/{id}.md`). |
| **Transporte com AI Memory** | Suporta API HTTP, Server-Sent Events e MCP via `stdio`. | Utiliza exclusivamente o transporte MCP via `stdio` (`ai-memory serve --transport stdio`). |
| **Correlação de Sessão** | Mapeamento de `session_id` nativo do CLI com deduplicação por `ingest_key`. | Correlação mantida apenas entre tarefa delegada do Orquestra (`job.id`) e PTY ativo (`session.id`), sem escuta de eventos internos do CLI do fornecedor. |
| **Handoffs e Briefing** | Suportados via CLI, plugins e protocolo MCP. | Integrado nas ferramentas MCP expostas aos agentes e nas rotas da interface web (`MemoryPanel.jsx`). |

---

## 4. Problemas Confirmados (com Arquivos, Funções e Evidências)

1. **Ausência de Ingestão Automática de Sessões e Observações (Fato Confirmado):**
   - *Evidência:* Em `server/memory.mjs` (linhas 27–42), o AI Memory é iniciado estritamente como servidor MCP via `stdio`. Não há inicialização de um servidor HTTP para `/hook` ou `/hook/batch`.
   - *Evidência:* Conforme relatado em `server/memory.mjs` (linha 42): `lifecycleCapture: false, captureScope: 'delegated-task-records'`.
   - *Consequência:* O engine AI Memory não recebe eventos de `SessionStart`, `UserPromptSubmit`, `PostToolUse` ou `SessionEnd` das sessões abertas nos terminais PTY, explicando por que conversas livres e observações cruas de CLI não geram páginas automáticas na wiki.

2. **Registro Episódico Limitado a Tarefas Delegadas:**
   - *Evidência:* Em `server/memory.mjs` (linhas 118–121, função `recordTask`):
     ```javascript
     async recordTask(job) {
       const body = `# ${job.title}\n\nTarefa: ${job.id}...`;
       await this.call(job.projectId, 'write', { path: `tasks/${job.id}.md`, tier: 'episodic', body: ... });
     }
     ```
     O único preenchimento automático da memória baseado na atividade dos agentes ocorre quando uma *tarefa delegada* pelo coordenador é concluída. Terminais em modo interativo livre ou shell não geram registros automáticos.

3. **Inexistência de Roteamento de Hooks de Fornecedores:**
   - *Evidência:* O Orquestra gerencia processos filhos via `node-pty` e lança adaptadores ou shells sem injetar variáveis de ambiente de hook do AI Memory (como `AI_MEMORY_CAPTURE_OWNER`) nem configurar hooks locais nos CLIs (`codex`, `opencode`, `claude`, `gemini`).

---

## 5. Causas-Raiz versus Hipóteses

- **Causa-Raiz Confirmada:** A integração atual foi arquitetada deliberadamente como um **modelo híbrido simplificado**: o Orquestra utiliza o binário do AI Memory como motor de wiki e busca vetorial/semântica via MCP (`stdio`), e gerencia a execução de tarefas através de PTYs e protocolo MCP proprietário (`orquestra`). Ela **não** implementou um coletor de eventos de ciclo de vida (`/hook/batch`) para interceptar o fluxo bruto de conversas dos CLIs dos fornecedores.
- **Hipótese Descartada (Diagnóstico Anterior):** O diagnóstico anterior de 11 páginas sugeria que a ausência de sessões/observações decorria de falhas de sincronização, bugs no transporte MCP ou perda de dados. A investigação real do código comprova que **não há bug de sincronização**: a funcionalidade de captura automática de sessões e observações de CLI simplesmente **não foi desenvolvida** nesta integração, pois o escopo foi restrito a notas colaborativas e registros de tarefas delegadas (`delegated-task-records`).

---

## 6. Correções Necessárias (com Prioridades)

1. **Prioridade Alta (Alinhamento de Escopo e Documentação):**
   - Consolidar na documentação do usuário (`README.md` e painel de memória) que o Orquestra fornece memória persistente colaborativa (notas, briefing, handoffs, registros de tarefas delegadas) e não rastreamento automático universal de transcripts de terminais interativos livres.
2. **Prioridade Média (Expansão Opcional de Telemetria / Relay):**
   - Avaliar, em fases futuras, a criação de um adaptador opcional de relay compatível com o protocolo `/hook/batch` do AI Memory caso seja exigida a ingestão automática de eventos de ciclo de vida dos CLIs gerenciados.
3. **Prioridade Baixa (Refinamento de Metadados):**
   - Incluir metadados adicionais de sessão PTY nos registros gravados em `tasks/{id}.md` para enriquecer a rastreabilidade na wiki.

---

## 7. Riscos de Regressão

- **Tentar injetar hooks universais sem controle de sandbox:** Forçar a instalação de hooks globais ou variáveis de ambiente de captura em CLIs de terceiros sem sandboxing adequado pode causar falhas de execução, poluição da wiki com logs de terminal de baixo sinal ou loops de gravação.
- **Modificar o transporte MCP atual:** Alterar o mecanismo de comunicação MCP (`stdio`) para tentar emular um servidor de hooks dentro do processo de memória do Orquestra pode desestabilizar a estabilidade já validada do core atual (57/57 testes aprovados).

---

## 8. Plano de Testes Automatizados e Reais

- **Testes Unitários de Memória (`tests/memory.test.mjs`):** Validar o isolamento de projetos, o tratamento de caminhos relativos, a sanitização/redact de credenciais e a formatação de briefings e gravações de tarefas (`recordTask`).
- **Testes de Integração de Servidor (`tests/server.test.mjs`):** Garantir que o start/stop de PTYs, autenticação por cookies HttpOnly/SameSite e a comunicação do MCP bridge funcionem sem regressões.
- **Validação Real (Sem Modificações):** Confirmar através de `git diff` que nenhuma alteração funcional foi introduzida pela sessão de investigação da Fase 1.
