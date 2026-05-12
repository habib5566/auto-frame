'use strict';
/**
 * Local audit server + public HTTPS tunnel (ngrok or localtunnel).
 * Use when the checklist UI is hosted elsewhere (e.g. Vercel) and you need /api/scan on the internet.
 *
 *   npm run go-live:audit:tunnel
 *
 * Optional:
 *   GO_LIVE_AUDIT_PORT=3940          (default 3940)
 *   GO_LIVE_AUDIT_TUNNEL=ngrok     (default) | localtunnel | lt
 *
 * Copy the printed https URL into the UI field "Scan API base", then Run quick scan.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const port = String(process.env.GO_LIVE_AUDIT_PORT || 3940);
const mode = (process.env.GO_LIVE_AUDIT_TUNNEL || 'ngrok').toLowerCase();

/** If ComSpec points at something odd (e.g. ffmpeg), shell:true breaks spawn('npx', …). */
function childEnv() {
  const e = { ...process.env };
  if (process.platform === 'win32') {
    const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    e.ComSpec = cmd;
  }
  return e;
}

/**
 * Run an npx command without relying on a broken %ComSpec%.
 * Windows: explicit System32\cmd.exe /d /s /c …
 */
function spawnNpxTunnel(commandLine) {
  const env = childEnv();
  if (process.platform === 'win32') {
    const cmdPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    return spawn(cmdPath, ['/d', '/s', '/c', commandLine], {
      cwd: root,
      stdio: 'inherit',
      env,
      windowsHide: true,
    });
  }
  return spawn('/bin/sh', ['-c', commandLine], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
}

const serverScript = path.join(root, 'scripts', 'go-live-audit-server.js');
const server = spawn(process.execPath, [serverScript], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv(),
});

let tunnelProc;
if (mode === 'localtunnel' || mode === 'lt') {
  tunnelProc = spawnNpxTunnel(`npx -y localtunnel --port ${port}`);
} else {
  tunnelProc = spawnNpxTunnel(`npx -y ngrok http ${port}`);
}

function shutdown() {
  try {
    tunnelProc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  try {
    server.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('exit', (code, signal) => {
  if (signal) shutdown();
  else if (code !== 0 && code !== null) process.exit(code);
});

tunnelProc.on('exit', (code, signal) => {
  if (signal) return;
  if (code !== 0 && code !== null) {
    console.error('Tunnel process exited with code', code);
    shutdown();
  }
});
