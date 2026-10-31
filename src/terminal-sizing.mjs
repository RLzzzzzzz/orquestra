// Layout notifications can arrive during layout, font loading and tab switches.
// Fit once per animation frame and send only the latest PTY dimensions per burst.
export function createTerminalSizer({ terminal, fit, element, onResize, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, setTimer = setTimeout, clearTimer = clearTimeout, interval = 60 }) {
  let frame = null, timer = null, disposed = false, force = false;
  let pending = null, published = null;
  const visible = () => element.isConnected !== false && element.clientWidth > 0 && element.clientHeight > 0;
  const publish = () => {
    timer = null;
    if (disposed || !visible() || !pending) return;
    const next = pending; pending = null;
    const changed = terminal.cols !== next.cols || terminal.rows !== next.rows;
    // A full-screen CLI may draw while a resize burst is being coalesced. Keep
    // xterm at the last published PTY size until both ends can change together;
    // otherwise a frame drawn for 80 columns can wrap into a temporary 40-column
    // canvas even when the final 80-column size needs no remote resize at all.
    if (changed) terminal.resize(next.cols, next.rows);
    if (changed || next.force) terminal.refresh(0, next.rows - 1);
    if (!published || next.force || next.cols !== published.cols || next.rows !== published.rows) {
      onResize({ cols: next.cols, rows: next.rows });
      published = next;
    }
  };
  const resize = () => {
    frame = null;
    if (disposed || !visible()) {
      clearTimer(timer); timer = null; pending = null;
      // Returning to the same dimensions still needs a repaint and PTY sync.
      // No React prop changes when the whole terminal workspace is display:none.
      if (!disposed) force = true;
      return;
    }
    const dimensions = fit.proposeDimensions();
    if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
    // Match the backend bounds so the canvas and its PTY always agree, even
    // with a tiny pane, a very large display or a small terminal font.
    const cols = Math.max(2, Math.min(500, Math.floor(dimensions.cols)));
    const rows = Math.max(2, Math.min(300, Math.floor(dimensions.rows)));
    const changed = terminal.cols !== cols || terminal.rows !== rows;
    // Retain the final measurement even if it returns to the current size;
    // that replaces an intermediate pending size without ever applying it.
    if (changed || force || !published || pending) {
      pending = { cols, rows, force };
      if (force) { clearTimer(timer); publish(); }
      else if (timer === null) timer = setTimer(publish, interval);
    }
    force = false;
  };
  return {
    schedule(options = {}) {
      if (disposed) return;
      force ||= options.force === true;
      if (frame === null) frame = requestFrame(resize);
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelFrame(frame);
      if (timer !== null) clearTimer(timer);
      pending = null;
    },
  };
}
