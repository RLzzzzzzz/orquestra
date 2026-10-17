import crossSpawn from 'cross-spawn';
import { resolveCliLaunch } from './cli-process.mjs';

// Passing arguments through a Node launcher keeps nested TOML quotes intact in
// Windows npm shims. The capability itself is only in the inherited environment.
const launch = JSON.parse(process.env.ORQUESTRA_LAUNCH || '{}');
delete process.env.ORQUESTRA_LAUNCH;
if (typeof launch.file !== 'string' || !Array.isArray(launch.args)) process.exit(1);
const command = resolveCliLaunch(launch.file, launch.args);
const child = crossSpawn(command.file, command.args, { stdio: 'inherit', env: process.env, windowsHide: true });
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
