import assert from 'node:assert/strict';
import path from 'node:path';
import { Terminals } from '../../server/terminals.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (check()) return; await pause(30); }
  throw new Error(`Timeout: ${label}`);
}
let output = '';
const terminals = new Terminals(event => { if (event.type === 'output') output += event.data; });
let exitCode = 0;
try {
  const agent = { id: 'resize-fixture', provider: 'opencode', command: 'opencode', cwd: process.cwd() };
  terminals.start(agent, { managed: true, launch: { file: process.execPath, args: [path.resolve('tests/fixtures/resize-cli.mjs')] } });
  await until(() => output.includes('GEOMETRY:100x28'), 'initial geometry reaches managed CLI');
  const info = terminals.info(agent.id);
  assert.equal(info.windowsPty.backend, 'conpty');
  assert.ok(info.windowsPty.buildNumber > 0);
  for (const [cols, rows] of [[60, 20], [120, 36], [45, 18], [100, 28]]) {
    output = '';
    terminals.resize(agent.id, cols, rows, info.sessionId);
    await until(() => output.includes(`GEOMETRY:${cols}x${rows}`), `${cols}x${rows} reaches CLI`);
    assert.equal(terminals.info(agent.id).pid, info.pid);
  }
  terminals.write(agent.id, 'q', info.sessionId);
  await until(() => terminals.info(agent.id).mode === 'fallback', 'natural exit starts recovery shell');
  assert.equal(terminals.info(agent.id).windowsPty.backend, 'winpty');
  assert.notEqual(terminals.info(agent.id).sessionId, info.sessionId);
  console.log('RESIZE_AND_FALLBACK_OK');
} catch (error) { console.error(error); exitCode = 1; }
finally {
  terminals.dispose();
  // Same bounded, process-owned shutdown as server/index.mjs.
  setTimeout(() => process.exit(exitCode), 1500);
}
