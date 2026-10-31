// A real console input reader is needed for Windows resize events.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const render = () => process.stdout.write(`\x1b[2J\x1b[HGEOMETRY:${process.stdout.columns}x${process.stdout.rows}\r\n`);
process.stdout.on('resize', render);
process.stdin.on('data', data => { if (data.toString().includes('q')) process.exit(0); });
render();
process.stdin.resume();
