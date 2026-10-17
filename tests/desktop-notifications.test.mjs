import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createNotifier, registerNotifications, CHANNEL } = createRequire(import.meta.url)('../electron/notifications.cjs');

function fixture() {
  const notices = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notices.push(this); }
    show() { this.shown = true; }
  }
  const window = { focused: false, minimized: true, isDestroyed: () => false, isFocused() { return this.focused; }, isMinimized() { return this.minimized; }, restore() { this.minimized = false; }, show() { this.visible = true; }, focus() { this.focused = true; }, webContents: { mainFrame: {} } };
  let time = 100;
  const notify = createNotifier({ Notification, getWindow: () => window, now: () => time });
  return { notify, window, notices, Notification, advance: () => { time += 30001; } };
}

test('native notice submits once, restores window on click, and permits later events', () => {
  const f = fixture(), payload = { key: 'completion:session', body: 'Concluído' };
  assert.equal(f.notify(payload).status, 'submitted');
  assert.equal(f.notices[0].shown, true);
  assert.equal(f.notices[0].options.title, 'Orquestra');
  assert.equal(f.notify(payload).status, 'duplicate');
  f.advance(); assert.equal(f.notify(payload).status, 'submitted');
  f.notices[0].emit('click');
  assert.equal(f.window.minimized, false); assert.equal(f.window.visible, true); assert.equal(f.window.focused, true);
});

test('foreground events are suppressed while explicit settings tests can be submitted', () => {
  const f = fixture(); f.window.focused = true; f.window.minimized = false;
  assert.equal(f.notify({ key: 'x', body: 'hello' }).status, 'foreground');
  assert.equal(f.notify({ key: 'x', body: 'hello', test: true }).status, 'submitted');
  assert.equal(f.notify({ key: 'bad', body: 'a'.repeat(4001) }).status, 'invalid');
  assert.equal(f.notify(null).status, 'invalid');
});

test('OS failures permit retry and unsupported environments report capability', () => {
  const f = fixture(), payload = { key: 'failure', body: 'hello' };
  f.notify(payload); f.notices[0].emit('failed');
  assert.equal(f.notify(payload).status, 'submitted');
  f.Notification.isSupported = () => false;
  assert.equal(f.notify({ key: 'new', body: 'hello' }).status, 'unsupported');
});

test('IPC accepts only the application main frame', () => {
  const f = fixture(); let handler;
  registerNotifications({ ipcMain: { handle(channel, fn) { assert.equal(channel, CHANNEL); handler = fn; } }, Notification: f.Notification, getWindow: () => f.window });
  const payload = { key: 'safe', body: 'hello' };
  assert.equal(handler({ sender: {}, senderFrame: {} }, payload).status, 'forbidden');
  assert.equal(handler({ sender: f.window.webContents, senderFrame: {} }, payload).status, 'forbidden');
  assert.equal(handler({ sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame }, payload).status, 'submitted');
});
