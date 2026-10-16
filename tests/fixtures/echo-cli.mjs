const name = process.argv[2] || 'test';
process.stdout.write(`READY_${name}\r\n`);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let buffer = '';
process.stdin.on('data', data => {
  for (const c of data.toString()) {
    if (c === '\u0003') process.exit(0);
    else if (c === '\r' || c === '\n') {
      process.stdout.write(`RESULT_${name}:${buffer}\r\n`);
      buffer = '';
    } else buffer += c;
  }
});
process.stdin.resume();
