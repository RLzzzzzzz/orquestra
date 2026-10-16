// Requires the local app to be running. Opens its coordinator without sending a model prompt.
import headless from '@xterm/headless';
import { WebSocket } from 'ws';
const origin = `http://127.0.0.1:${process.env.PORT || 4317}`;
const home = await fetch(origin);
const cookie = home.headers.get('set-cookie').split(';')[0];
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
const state = await (await fetch(origin + '/api/state', { headers })).json();
const response = await fetch(origin + `/api/projects/${state.projects[0].id}/coordinator`, { method: 'POST', headers });
const coordinator = await response.json();
if (!response.ok) throw new Error(coordinator.error);
const term = new headless.Terminal({ cols: 100, rows: 28, allowProposedApi: true });
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers });
const send = message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
term.onData(data => send({ type: 'input', id: coordinator.id, data }));
ws.on('message', raw => {
  const event = JSON.parse(raw);
  if (event.id === coordinator.id && ['output', 'replay'].includes(event.type)) term.write(event.data);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const screen = () => Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true) || '').join('\n');
try {
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const deadline = Date.now() + 25000;
  while (!screen().includes('Ask Codex to do anything') && Date.now() < deadline) await pause(250);
  const ready = screen().includes('Ask Codex to do anything');
  let keyboard = false;
  if (ready) {
    send({ type: 'input', id: coordinator.id, data: 'orquestra_keyboard_check' }); await pause(700);
    keyboard = screen().includes('orquestra_keyboard_check');
    send({ type: 'input', id: coordinator.id, data: '\u0015' }); await pause(200);
  }
  const current = await (await fetch(origin + '/api/state', { headers })).json();
  const agent = current.agents.find(a => a.id === coordinator.id);
  const passed = ready && keyboard && agent.mode === 'coordinator';
  console.log(JSON.stringify({ passed, promptReady: ready, keyboardVerified: keyboard, mode: agent.mode, id: agent.id }));
  if (!passed) { console.log(screen()); process.exitCode = 1; }
} finally { ws.close(); term.dispose(); }
