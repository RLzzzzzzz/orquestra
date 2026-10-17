import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const env = { ...process.env, ORQUESTRA_NODE_EXECUTABLE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [fileURLToPath(new URL('../electron', import.meta.url))], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
