import fs from 'node:fs';
import path from 'node:path';

// Canonical npm Windows shims re-enter cmd.exe, whose command line is limited
// to 8191 characters. Execute their Node entry point directly with argv intact.
// Unknown/custom wrappers retain their original launch behavior.
export function resolveCliLaunch(file, args, platform = process.platform) {
  if (platform !== 'win32' || !/\.cmd$/i.test(file)) return { file, args };
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/"%_prog%"\s+"%dp0%[\\/](node_modules[\\/][^"\r\n]+\.js)"\s+%\*\s*$/i);
  if (!match || !source.includes('SET "_prog=node"')) return { file, args };
  const directory = path.dirname(file);
  const script = path.resolve(directory, match[1]);
  if (!script.startsWith(path.resolve(directory) + path.sep) || !fs.statSync(script, { throwIfNoEntry: false })?.isFile()) return { file, args };
  const localNode = path.join(directory, 'node.exe');
  return { file: fs.existsSync(localNode) ? localNode : process.execPath, args: [script, ...args] };
}
