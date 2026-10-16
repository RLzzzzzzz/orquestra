// Opt-in local smoke check: starts installed CLIs without submitting a model prompt.
// Only run with the normal user's permissions, as when starting iniciar.cmd.
import headless from '@xterm/headless';
import { Terminals } from '../server/terminals.mjs';
import { findCommand } from '../server/workspace.mjs';

const requested = process.argv.slice(2);
if (!requested.length || requested.some(p => !['codex', 'opencode'].includes(p))) {
  console.error('Usage: node scripts/check-cli.mjs codex opencode');
  process.exit(1);
}
const screens = new Map();
const manager = new Terminals(event => {
  if (event.type === 'output') screens.get(event.id)?.write(event.data);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = false;
function screenText(term) {
  const buffer = term.buffer.active;
  return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) || '').join('\n').trim();
}
try {
  for (const provider of requested) {
    if (!findCommand(provider)) { console.log(`${provider}: not installed`); continue; }
    const term = new headless.Terminal({ cols: 100, rows: 28, allowProposedApi: true });
    screens.set(provider, term);
    term.onData(data => {
      if (manager.info(provider).status === 'running') manager.write(provider, data);
    });
    manager.start({ id: provider, provider, command: provider, cwd: process.cwd() });
  }
  await delay(10000);
  for (const provider of requested) {
    const term = screens.get(provider);
    if (!term) continue;
    const initial = screenText(term);
    const ready = provider === 'codex' ? initial.includes('Ask Codex to do anything') : initial.includes('Ask anything');
    let keyboardVerified = false;
    if (ready && manager.info(provider).mode === 'agent') {
      // Deliberately no Enter: check input rendering without asking the model anything.
      manager.write(provider, 'orquestra_keyboard_check');
      await delay(800);
      keyboardVerified = screenText(term).includes('orquestra_keyboard_check');
    }
    if (!ready || !keyboardVerified) failed = true;
    console.log(JSON.stringify({ provider, ...manager.info(provider), promptReady: ready, keyboardVerified }, null, 2));
  }
} finally {
  manager.dispose();
  for (const term of screens.values()) term.dispose();
  setTimeout(() => process.exit(failed ? 1 : 0), 1500);
}
