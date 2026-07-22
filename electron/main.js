'use strict';

/**
 * Electron main process for the PDB Structure Tracker desktop app.
 *
 * Responsibilities:
 *   1. Spawn the Next.js standalone server on a free local port and wait
 *      until it's accepting HTTP traffic before opening a BrowserWindow.
 *   2. Point the BrowserWindow at http://127.0.0.1:<port>.
 *   3. Cleanly tear down the child server on app quit.
 *
 * Why we wrap Next.js standalone instead of running it as a separate
 * process the user has to launch: the goal is a single .dmg the user
 * double-clicks and immediately sees the PDB tracker UI.
 */

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const STANDALONE_ENTRY = path.join(
  app.getAppPath(),
  '.next',
  'standalone',
  'server.js',
);

/**
 * Find a free TCP port by asking the kernel for one. We bind to port 0
 * (kernel assigns), read the assigned port, then close the socket.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Poll a TCP port until it accepts connections (server is ready).
 * Next.js standalone writes "Ready in" to stdout; we don't rely on the
 * log line — port readiness is the source of truth.
 */
function waitForPort(port, attempts = 60, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        n += 1;
        if (n >= attempts) reject(new Error(`Port ${port} never opened`));
        else setTimeout(tryOnce, intervalMs);
      });
    };
    tryOnce();
  });
}

let serverProc = null;
let mainWindow = null;

async function createWindow() {
  const port = await getFreePort();

  serverProc = spawn(
    process.execPath,
    [STANDALONE_ENTRY],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        ELECTRON_RUN_AS_NODE: '1',
        // Suppress Next.js telemetry download attempts inside the bundle.
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(STANDALONE_ENTRY),
    },
  );

  // Surface server errors but don't crash the app — Next.js writes to
  // stdout/stderr and the user can still see the page once it's up.
  serverProc.stdout.on('data', (b) => process.stdout.write(`[next] ${b}`));
  serverProc.stderr.on('data', (b) => process.stderr.write(`[next] ${b}`));
  serverProc.on('exit', (code) => {
    console.log(`[next] standalone server exited with code ${code}`);
    serverProc = null;
  });

  await waitForPort(port);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'PDB Structure Tracker',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('Failed to start PDB tracker:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
    serverProc = null;
  }
});