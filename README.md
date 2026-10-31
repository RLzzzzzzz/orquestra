# Orquestra

Your AI agents in one local workspace: side-by-side terminals, a coordinator that delegates tasks, shared memory for each project, and code review with optional Git worktrees.

This guide explains how to set up your environment, connect your CLIs, and run your first delegated task. Commands use PowerShell on Windows; run them from the folder where you downloaded Orquestra. Using `npm.cmd` avoids issues with PowerShell's execution policy.

## 1. Choose your starting point

### I already have the CLIs installed and authenticated

Close Orquestra and run:

```powershell
npm.cmd run setup
npm.cmd start
```

Open **http://127.0.0.1:4317**. Setup detects your existing CLIs and registers any missing agents in the project. Your existing accounts, agent names, roles, and worktrees are preserved.

You can also double-click `iniciar.cmd`: it runs the same setup and starts the service. You still need to sign in to each provider yourself.

### I'm setting up a new machine

Install [Node.js 22 or later](https://nodejs.org/en/download) and [Git for Windows](https://git-scm.com/downloads/win). Reopen PowerShell and verify:

```powershell
node --version
npm.cmd --version
git --version
```

Download this repository, extract it if necessary, and open a terminal in its folder. To set up Orquestra and install any missing Codex, OpenCode, and Gemini CLIs:

```powershell
npm.cmd run setup -- --install-clis codex,opencode,gemini
```

Next, sign in to the CLIs you intend to use, as described in section 3. You can choose just one or two: `--install-clis codex,opencode` also works. Setup finishes without opening conversations or making model calls.

### What automatic setup does

1. Checks Node.js, the project folder, and whether the service is stopped.
2. Installs dependencies from the lockfile using `npm ci` if they are missing.
3. Installs only the missing CLIs specified in `--install-clis`; new OpenCode installations are pinned to major version 1, which is compatible with the current adapter.
4. Sets up the official AI Memory engine if it is not installed, verifying the download's SHA-256 hash; Git is required.
5. Builds the interface.
6. Registers the project and one agent for each detected CLI, without duplicating existing entries.

You remain responsible for provider sign-in, model access, and trust approvals. Orquestra prepares MCP integration and memory hooks when you open new sessions through the application; you do not need to manually configure a global MCP server.

The default setup configures the `.local` data directory used by `npm start`. For the desktop app, see section 9: it uses a different directory by default.

## 2. Configure the folder your agents will work in

If your code is in another folder, configure it before starting:

```powershell
npm.cmd run setup -- --project-dir "C:\Projetos\Minha aplicação"
npm.cmd start
```

The directory must already exist. Setup identifies registered projects by their actual folder paths and only adds missing agents. You can also click **Novo projeto** (New project), enter a name, and select a folder in the interface.

To check the environment without installing packages, registering agents, or starting models:

```powershell
npm.cmd run setup -- --check
```

The diagnostic reports dependencies, CLIs, Git, the memory executable, and the build. **CLI detected** only means the command was found; it does not confirm successful authentication or model availability.

Other options:

| Command/option | When to use it |
| --- | --- |
| `npm.cmd run setup -- --help` | Display all available options. |
| `--install-clis codex,opencode,gemini` | Install missing CLIs from these three providers. Does not update or reinstall commands already found. |
| `--skip-memory` | Set up the application without installing or checking the memory engine; memory and capture must be configured later. |
| `--data-dir "C:\Dados\Orquestra"` | Configure a different data directory. Set `ORQUESTRA_DATA_DIR` to the same path when starting the application. |

Setup does not change model settings, reset passwords, or remove existing agents. Close running servers and the desktop app before running it to prevent two processes from writing to the same data.

## 3. Install and authenticate your CLIs

Run only the commands for providers you want to use. If a CLI already works in your terminal, keep its existing installation and authentication.

### Codex

Setup can install the official package. To install it separately:

```powershell
npm.cmd install -g @openai/codex
codex
```

On first launch, select an available sign-in method and complete the browser authentication flow. Orquestra uses that authentication for sessions started under the same Windows user. See the [Codex CLI documentation](https://developers.openai.com/codex/cli/) and [official authentication guide](https://developers.openai.com/codex/auth/).

### OpenCode

```powershell
npm.cmd install -g opencode-ai@1
opencode
```

In OpenCode, use `/connect`, select your provider, and follow its authentication flow. Each provider may require its own account or API key. This integration uses the OpenCode 1 contract, so the command and setup pin new installations to `opencode-ai@1`. OpenCode 2 uses the same `opencode` command and requires compatibility testing before migration. Setup preserves existing installations without automatically downgrading them. See the [official installation and configuration documentation](https://opencode.ai/docs/).

### Claude Code

Setup detects an installed Claude CLI. It is not included in automatic installation; install it using the [official Windows setup guide](https://code.claude.com/docs/en/setup), then run:

```powershell
claude
```

Complete the requested sign-in. See also the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart). Then close Orquestra and run `npm.cmd run setup` again to register it.

### Gemini CLI

```powershell
npm.cmd install -g @google/gemini-cli
gemini
```

Choose an available authentication method, such as **Login with Google**, and complete the process. Gemini works as a manual terminal with memory capture; it is not a managed task executor in this version. See the [official Gemini CLI guide](https://google-gemini.github.io/gemini-cli/docs/get-started/).

### Antigravity, Hermes, Freebuff, and custom commands

Install these through their providers' official channels and sign in using their CLIs. Orquestra looks for the `agy`, `hermes`, and `freebuff` commands. Here, Antigravity means the **`agy` CLI**, not a shortcut that opens the editor. On Windows, the application also searches known `agy` and `hermes` installation locations under `%LOCALAPPDATA%`.

After installing a CLI or updating your PATH, run setup again and restart Orquestra. For any other CLI, click **Novo agente → Personalizado** (New agent → Custom) and enter the command. A custom command provides a terminal but does not automatically gain delegation and memory tools.

### What each CLI can do in the application

| CLI | Manual terminal | Coordinator | Delegated task executor | Native memory capture |
| --- | --- | --- | --- | --- |
| Codex | Yes | Yes | Yes | Yes, after approving hooks in the CLI |
| OpenCode | Yes | Yes | Yes | Yes |
| Claude Code | Yes | Yes | Yes | Yes, with hooks configured |
| Freebuff | Yes | Yes | No | No |
| Gemini | Yes | No | No | Yes |
| Antigravity (`agy`) | Yes | No | No | Yes |
| Hermes | Yes | No | No | Yes |
| Terminal / custom | Yes | No | No | No |

Having capture configured does not prove an event has been received. Sessions must be opened through Orquestra; older sessions must be reopened to load new integrations. Hook availability and approval depend on the CLI version.

## 4. Open the terminals

1. Run `npm.cmd start` and leave that window open.
2. Open **http://127.0.0.1:4317** and select your project in the sidebar.
3. Agents detected during setup appear in the project. Click **Iniciar** (Start) on each agent panel.
4. To add another session, click **Novo agente** (New agent), choose the CLI, name, and folder, then start it.
5. If prompted to sign in, trust a tool, or approve an action, complete that step in the corresponding terminal.

The terminal displays the process's actual output. You can type directly into it or use the panel's message field. **Enter** sends the message; **Shift+Enter** inserts a newline. The task center on the right sends messages to selected terminals; it does not create a tracked task in the delegation queue.

Use the layout controls to switch between one column, two columns, or a grid. Focus mode enlarges one terminal; leaving focus restores the others. Use the dotted handle to reorder panels. Drag a panel's corner to resize it, or double-click to restore automatic sizing. Font and theme settings are available in preferences.

On narrower screens, the application automatically reduces the number of columns. Manual sizes are constrained by the available space; when switching tabs, changing focus, or resizing the window, terminal geometry readjusts.

If a CLI exits, Orquestra may provide a recovery shell. This shell supports diagnostics but cannot receive delegated tasks; use **Reiniciar agente** (Restart agent) to reopen the CLI.

## 5. Run your first delegated task

Start with a small read-only task to test the workflow.

1. Open at least one Codex, OpenCode, or Claude executor in the project.
2. Open **Orquestração** (Orchestration), select the coordinator, and click **Abrir coordenador** (Open coordinator). This creates a session separate from the executor.
3. In the coordinator's terminal, send something like:

   > List the available executors. Delegate a read-only review of the README to OpenCode. Wait for completion and summarize its findings.

4. The task appears under **Orquestração → Tarefas delegadas** (Orchestration → Delegated tasks); the executor's conversation remains visible under **Terminais** (Terminals).
5. The executor acknowledges receipt and calls `concluir_tarefa` through MCP when finished. The coordinator retrieves the result and responds.

An executor only becomes available after its terminal opens and MCP integration initializes. A terminal marked **Em execução** (Running) is not necessarily ready for delegation. If the available executor count remains zero, check authentication, MCP trust approval, and CLI startup errors.

You can also click **Delegar diretamente** (Delegate directly) to enqueue a task without asking the coordinator. Tasks using identical or overlapping folders run sequentially; up to three tasks in different folders can run in parallel. Manually typed instructions do not follow this locking mechanism, so avoid editing the same files from two sessions.

Canceling a task closes the executor's terminal to stop the work before releasing the folder. Reopen it to continue. When the service restarts, active tasks are marked as interrupted and are not automatically resubmitted.

## 6. Use shared memory

AI Memory collects decisions, lessons learned, and results **only for the selected project**. It uses the local [akitaonrails/ai-memory 3.1.0](https://github.com/akitaonrails/ai-memory) engine, with Markdown notes, Git history, and a search index. Basic storage and search do not require an API key.

1. Open **Memória** (Memory) and wait for **AI Memory conectado · local** (AI Memory connected · local).
2. Click **Nova memória** (New memory), write a note, and save it.
3. Search by topic; select a page to read, edit, or delete it.
4. Ask an agent: “Use `buscar_memoria` and `resumo_memoria` from Orquestra MCP before starting; save important decisions with `salvar_memoria`.”

When delegating a task, the service retrieves related context and sends a limited excerpt to the executor. The task instructions and results are recorded automatically. If task execution succeeds but the memory write fails, the result remains in the task history and the memory error is shown on the task.

To hand work over to another session, ask the agent to use `criar_handoff`. In the interface, accept the handoff and forward its summary to the next agent. Each handoff can only be accepted once.

For Codex, open `/hooks` and review/approve the AI Memory hooks within the CLI. Freebuff, terminals, and custom commands do not support native memory capture. Sessions started outside Orquestra do not automatically receive this integration. Model-based consolidation and embeddings are optional engine features, separate from basic storage.

To select a different executable:

```powershell
$env:ORQUESTRA_MEMORY_BIN = "C:\Ferramentas\ai-memory.exe"
npm.cmd start
```

## 7. Organize tasks, branches, and reviews

In the **Tarefas** (Tasks) tab, create planning items and update their statuses. Planning cards and delegated executions have separate lifecycles; changing a card does not send instructions to a CLI.

To work in isolated branches, open **Orquestração → Worktrees e revisão cruzada · opções avançadas** (Orchestration → Worktrees and cross-review · advanced options):

1. Add `.orquestra-worktrees/` to the project's `.gitignore` and make sure the Git repository has at least one commit.
2. Stop the implementer's terminal and prepare its worktree.
3. Reopen the terminal; it will now work in the isolated branch and folder.
4. Open at least two executors and choose different agents as implementer and reviewer. The reviewer can also act as the tester.
5. Submit the review objective. Inspect the reports and request fixes as needed.
6. Run local validation through the interface. Final approval requires actual project checks; an agent's statement alone is not sufficient.

Uncommitted changes in the original folder are not copied into a new worktree. Review the diff before authorizing commits. Automatic commits must be enabled for each agent. Pushes, merges, and worktree removal are not automated.

## 8. Troubleshoot common issues

| Symptom | Solution |
| --- | --- |
| `node` or `npm.cmd` not found | Install Node.js 22+ and reopen the terminal. |
| CLI does not appear | Check the command with `Get-Command codex` (or the corresponding name), update PATH, close Orquestra, and rerun setup. |
| CLI is detected but asks for sign-in | Launch the CLI itself and authenticate. Detection does not verify account access. |
| Port 4317 is in use / setup asks you to close the app | Close the other Orquestra window or service, including the desktop app. Do not run two servers against the same data. |
| Zero available executors | Open Codex/OpenCode/Claude and wait for MCP initialization; check trust, authentication, and terminal output. |
| Task is waiting for acknowledgment | Confirm the executor received the instructions and can call `confirmar_recebimento`. Resolve approvals in the terminal. |
| Memory unavailable | Check Git and run `npm.cmd run setup -- --check`; with the service stopped, rerun `npm.cmd run setup`. Check `ORQUESTRA_MEMORY_BIN` if set. |
| Terminal became too small after dragging | Double-click the resize handle to restore automatic sizing; use focus mode to expand the workspace. |
| Desktop app does not show browser projects | Their data directories differ by default; see section 9. |
| `node-pty` installation fails | Check Node.js and system architecture; if compilation is required, install Python and Visual Studio Build Tools with C++. |

To use a different port in the current PowerShell session:

```powershell
$env:PORT = "4320"
npm.cmd start
```

Open `http://127.0.0.1:4320`. The application only listens on `127.0.0.1`; keep the service local.

## 9. Run or build the desktop application

With the environment prepared by setup:

```powershell
npm.cmd run desktop
```

The desktop app uses `%APPDATA%\Orquestra\data`; `npm start` uses `.local` in the repository folder. To start the development desktop app with the data you just configured:

```powershell
$env:ORQUESTRA_DATA_DIR = (Resolve-Path .local).Path
npm.cmd run desktop
```

Stop the browser server before opening the desktop app. Alternatively, configure the desktop app's default data directory directly:

```powershell
npm.cmd run setup -- --data-dir "$env:APPDATA\Orquestra\data"
npm.cmd run desktop
```

The configured project appears in that data directory; setup does not migrate data between profiles. To migrate manually, close all instances, back up the data, and copy the contents of the data directory to the chosen destination.

To package for Windows x64:

```powershell
npm.cmd run desktop:pack
npm.cmd run desktop:portable
npm.cmd run desktop:installer
```

Use only the distribution format you need. Outputs are written to `release/`: the `win-unpacked` folder, portable `Orquestra-0.1.1-x64-portable.exe`, and installer `Orquestra-0.1.1-x64-nsis.exe`. The version follows `package.json`. The package includes the Node.js runtime and backend dependencies; users still need to install Git and their CLIs and configure their accounts. AI Memory is bundled if it exists in the default local runtime during packaging. Project data, credentials, and history are not bundled. The executables are not configured with digital signatures.

### Update the executable after changing the code

1. Close Orquestra, including desktop windows and terminal-launched servers. CLI sessions will be terminated; finish your work or save the context first.
2. In the repository folder, run `npm.cmd ci` if `package-lock.json` or dependencies have changed.
3. Rebuild the distribution format you use:

   ```powershell
   # Portable: also builds the interface and prepares the updated backend.
   npm.cmd run desktop:portable

   # Alternative for the installed version:
   npm.cmd run desktop:installer
   ```

4. For the portable version, copy the new `.exe` from `release/` to your usual location and update the shortcut. For the installed version, run the new installer under the same Windows user and installation directory.
5. Reopen the application and check the version at the bottom of the project sidebar. This fix is version **0.1.1**. Reopen the terminals to load the new backend; an existing session does not switch transports while running.

The build and executable do not replace `%APPDATA%\Orquestra\data` or the directory specified by `ORQUESTRA_DATA_DIR`. Preserve this directory to keep your projects, history, and memory. Running only `npm.cmd run build` updates the source-based interface; it does not modify an already generated `.exe`.

To use the updated source version, run `npm.cmd run build` followed by `npm.cmd start` or `npm.cmd run desktop`. In the browser, reload the page after restarting the server.

## 10. Data, updates, and development

| Data | Source-based installation | Default desktop app |
| --- | --- | --- |
| Projects and agents | `.local/workspace.json` | `%APPDATA%\Orquestra\data\workspace.json` |
| Task history | `.local/tasks.json` | Inside the `data` directory |
| Wiki and index | `.local/memory/wiki` and `.local/memory/db` | Inside `data\memory` |
| Visual preferences | Browser storage | Electron profile |
| Desktop server log | — | `%APPDATA%\Orquestra\server.log` |

`ORQUESTRA_DATA_DIR` changes the data directory. Setup does not permanently set this environment variable; use the same value when starting with `npm start`. Back up your data before migrating or restoring it. Restarting the service closes the terminals but preserves stored projects and history.

To update dependencies after changing the code or lockfile, with the application closed:

```powershell
npm.cmd ci
npm.cmd run setup
```

For development and validation:

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run check:layout
```

Automated tests use fixtures without authenticating accounts or calling models. `check-live-*` scripts and some provider checks may start real sessions: read each script before running it.

`check:layout` requires a build and opens a hidden Electron renderer with temporary data and test terminals. It tests 45 scenarios covering sizing, layouts, focus, and fonts without changing your projects or calling models. The reference screenshot is saved to `coverage/terminal-layout.png`.

To specifically test native OpenCode UI redraw behavior, run `npm.cmd run check:opencode-resize` after building. This check opens an isolated session, resizes the window, verifies the prompt/footer/centering, and requires the same process to remain running. It does not send model instructions. Results and screenshots are saved under `coverage/opencode-resize/`.

After packaging, `npm.cmd run check:opencode-resize -- --packaged` repeats the check using the backend, interface, and `node.exe` from `release/win-unpacked/resources/backend`.

Project structure: `src/` contains the interface; `server/` handles terminals, MCP, the task queue, and memory; `scripts/` contains setup and validation tools; `tests/` contains regression tests; and `electron/` contains the desktop application.

For technical details, see the [session and delegation contract](docs/core-estabilizacao.md), [CI, worktrees, and review](docs/ci-worktrees-revisao.md), and [memory and delegation audit](docs/auditoria-estabilizacao-2026-10-30.md). The interface and workflows draw product inspiration from [Alethe Agents](https://github.com/Kc1t/alethe-agents) and [Orca](https://github.com/stablyai/orca), with an independent implementation. Dependencies and notices are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

[![GitHub](https://img.shields.io/badge/GitHub-RLzzzzzzz-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/RLzzzzzzz)
