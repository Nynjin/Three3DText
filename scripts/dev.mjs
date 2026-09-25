/**
 * `npm run dev`: rebuilds the @itowns/labels bundle on every source change
 * while Next serves the app, which imports that bundle. Arguments go to
 * `next dev`. Stops both when either exits.
 *
 * The bundle's .d.ts files are only written by `predev`: after a change to the
 * package's public types, restart.
 */
import { spawn, spawnSync } from 'node:child_process';

const nextArgs = process.argv.slice(2).join(' ');
const run = command => spawn(command, { stdio: 'inherit', shell: true });
const children = [run('npm run watch -w @itowns/labels'), run(`next dev --webpack ${nextArgs}`)];

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // The shell in between would survive a plain kill on Windows, leaving
    // its child running: kill the whole tree.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exitCode = code ?? 1;
}

for (const child of children) child.on('exit', code => stopAll(code));
