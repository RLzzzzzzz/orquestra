import { test } from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import { createTerminalSizer } from '../src/terminal-sizing.mjs';

function fixture() {
  const frames = new Map(), timers = new Map(), sent = [], resized = [], refreshed = [];
  let nextId = 0;
  const element = { clientWidth: 800, clientHeight: 400, isConnected: true };
  const dimensions = { cols: 80, rows: 20 };
  const terminal = { cols: 100, rows: 28,
    resize(cols, rows) { this.cols = cols; this.rows = rows; resized.push({ cols, rows }); },
    refresh(first, last) { refreshed.push([first, last]); } };
  const sizer = createTerminalSizer({ terminal, element, fit: { proposeDimensions: () => dimensions }, onResize: size => sent.push(size),
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    setTimer(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); } });
  const flush = callbacks => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(); };
  return { sizer, element, dimensions, terminal, frames, timers, sent, resized, refreshed,
    paint: () => flush(frames), publish: () => flush(timers) };
}

test('resize bursts fit once per frame and publish the latest geometry without flooding PTY', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) f.sizer.schedule();
  assert.equal(f.frames.size, 1);
  f.paint();
  assert.deepEqual(f.resized, [], 'xterm retains the PTY geometry until publication');
  assert.deepEqual(f.sent, []);
  f.dimensions.cols = 60; f.sizer.schedule(); f.paint();
  f.dimensions.cols = 45; f.sizer.schedule(); f.paint();
  assert.equal(f.timers.size, 1);
  f.publish();
  assert.deepEqual(f.sent, [{ cols: 45, rows: 20 }]);
  assert.deepEqual(f.resized, [{ cols: 45, rows: 20 }]);
  f.sizer.schedule(); f.paint(); f.publish();
  assert.equal(f.sent.length, 1, 'unchanged dimensions do not resend or reflow');
});

test('hidden panes keep their buffer geometry and refit when revealed', () => {
  const f = fixture();
  f.sizer.schedule(); f.paint();
  f.element.clientHeight = 0; f.sizer.schedule(); f.paint(); f.publish();
  assert.deepEqual(f.sent, [], 'a pending send is discarded when the pane becomes hidden');
  assert.equal(f.terminal.rows, 28, 'hidden pane retains the last published geometry');
  f.element.clientHeight = 400;
  f.sizer.schedule(); f.paint();
  assert.deepEqual(f.sent, [{ cols: 80, rows: 20 }]);
  assert.deepEqual(f.refreshed, [[0, 19]]);
});

test('font readiness and session reconnect repaint and resend even at the same geometry', () => {
  const f = fixture();
  f.sizer.schedule({ force: true }); f.paint();
  f.sizer.schedule({ force: true }); f.sizer.schedule(); f.paint();
  assert.equal(f.resized.length, 1, 'repaint does not reflow unchanged text');
  assert.equal(f.sent.length, 2, 'new PTY/session still receives the current dimensions');
  assert.equal(f.refreshed.length, 2);
  f.dimensions.cols = NaN; f.sizer.schedule({ force: true }); f.paint();
  assert.equal(f.sent.length, 2, 'unmeasured font dimensions never reach xterm or PTY');
  f.dimensions.cols = 90; f.sizer.schedule(); f.paint();
  assert.deepEqual(f.sent.at(-1), { cols: 90, rows: 20 }, 'force survives until font measurement becomes valid');
});

test('very small and very large panes use dimensions accepted by the PTY backend', () => {
  const f = fixture();
  f.dimensions.cols = 1; f.dimensions.rows = 1;
  f.sizer.schedule({ force: true }); f.paint();
  assert.deepEqual(f.sent.at(-1), { cols: 2, rows: 2 });
  f.dimensions.cols = 2000; f.dimensions.rows = 900;
  f.sizer.schedule({ force: true }); f.paint();
  assert.deepEqual(f.sent.at(-1), { cols: 500, rows: 300 });
  assert.deepEqual({ cols: f.terminal.cols, rows: f.terminal.rows }, f.sent.at(-1));
});

test('disposing a pane cancels scheduled work and late font callbacks', () => {
  const f = fixture();
  f.sizer.schedule(); f.paint();
  f.sizer.schedule({ force: true });
  f.sizer.dispose();
  f.paint(); f.publish(); f.sizer.schedule();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.sent, []);
});

test('actual xterm buffer preserves completed Unicode lines while shrinking and expanding', async t => {
  const terminal = new headless.Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  t.after(() => terminal.dispose());
  const text = 'BEGIN_' + 'ação_0123456789_'.repeat(12) + '_END';
  // Completed output lines reflow; the live cursor line belongs to the CLI,
  // which receives a PTY resize and redraws its prompt or alternate screen.
  await new Promise(resolve => terminal.write(text + '\r\n', resolve));
  const f = fixture();
  let frame;
  const sizer = createTerminalSizer({ terminal: {
    get cols() { return terminal.cols; }, get rows() { return terminal.rows; },
    resize: (cols, rows) => terminal.resize(cols, rows), refresh() {},
  }, fit: { proposeDimensions: () => f.dimensions }, element: f.element, onResize() {},
  requestFrame(callback) { frame = callback; return 1; }, cancelFrame() { frame = null; }, setTimer() { return 1; }, clearTimer() {} });
  t.after(() => sizer.dispose());
  const bufferText = () => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i).translateToString(true)).join('');
  f.dimensions.cols = 18; f.dimensions.rows = 6;
  sizer.schedule({ force: true }); frame();
  assert.equal(terminal.cols, 18);
  assert.equal(bufferText(), text);
  f.dimensions.cols = 120; f.dimensions.rows = 20;
  sizer.schedule({ force: true }); frame();
  assert.equal(terminal.cols, 120);
  assert.equal(bufferText(), text);
});

test('an alternate-screen frame cannot wrap into a size the PTY never received', async t => {
  const terminal = new headless.Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  t.after(() => terminal.dispose());
  const frames = [], timers = [], sent = [];
  let dimensions = { cols: 80, rows: 20 };
  const sizer = createTerminalSizer({ terminal: {
    get cols() { return terminal.cols; }, get rows() { return terminal.rows; },
    resize: (cols, rows) => terminal.resize(cols, rows), refresh() {},
  }, fit: { proposeDimensions: () => dimensions }, element: { clientWidth: 800, clientHeight: 400 },
  onResize: size => sent.push(size), requestFrame: callback => (frames.push(callback), frames.length),
  cancelFrame() {}, setTimer: callback => (timers.push(callback), timers.length), clearTimer() {} });
  t.after(() => sizer.dispose());
  const paint = () => frames.shift()();
  await new Promise(resolve => terminal.write('\x1b[?1049h', resolve));
  sizer.schedule({ force: true }); paint();
  dimensions = { cols: 40, rows: 20 };
  sizer.schedule(); paint();
  // The CLI still sees 80 columns while the resize timer is pending. Its next
  // frame must be parsed with that same geometry, including alternate-screen.
  const frame = 'A'.repeat(60) + 'RIGHT_EDGE';
  await new Promise(resolve => terminal.write('\x1b[H' + frame, resolve));
  dimensions = { cols: 80, rows: 20 };
  sizer.schedule(); paint(); timers.shift()();
  assert.deepEqual(sent, [{ cols: 80, rows: 20 }], 'the round trip needs no PTY resize');
  assert.equal(terminal.buffer.active.getLine(0).translateToString(true), frame);
  assert.equal(terminal.buffer.active.getLine(1).translateToString(true), '');
});
