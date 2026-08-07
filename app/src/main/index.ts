/**
 * Main process: window lifecycle and the security posture.
 *
 * Grove renders diffs, commit messages, and file contents from whatever
 * repository the user opens — content Grove did not write and cannot vet. In a
 * renderer with Node access, an XSS in that content is arbitrary code execution
 * on a machine that holds the user's SSH keys. So the renderer is sandboxed,
 * context-isolated, Node-free, and forbidden from navigating anywhere. None of
 * the settings below are defaults worth relaxing for convenience.
 */

import { join } from 'node:path';

import { app, shell, BrowserWindow, Menu, session } from 'electron';

import { disposeIpc, registerIpc } from './ipc';
import { runSmoke } from './smoke';

/** Vite's dev server URL in `electron-vite dev`; undefined in a packaged app. */
const DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const isDev = Boolean(DEV_URL);

/**
 * `--smoke[=path]` runs the headless bridge check and exits. With no path it
 * targets Grove's own repository, two levels up from the built main bundle.
 */
const SMOKE_ARG = process.argv.find((a) => a.startsWith('--smoke'));
const SMOKE_REPO = SMOKE_ARG
  ? SMOKE_ARG.split('=')[1] || join(__dirname, '..', '..', '..')
  : null;

let mainWindow: BrowserWindow | null = null;

/**
 * Content-Security-Policy for the renderer.
 *
 * `style-src` allows inline styles because bundlers inject them; everything
 * else is locked to the app's own origin. In dev the Vite client needs a
 * websocket for HMR, and that is the only difference from production.
 */
function csp(): string {
  const connect = isDev ? `'self' ${DEV_URL} ws: http://localhost:*` : `'self'`;
  // React Refresh injects an inline preamble in dev, which `'self'` alone
  // blocks. Production stays strict — this relaxation must never leak there,
  // which is why it keys off ELECTRON_RENDERER_URL rather than NODE_ENV.
  const script = isDev ? `'self' 'unsafe-inline'` : `'self'`;
  return [
    `default-src 'self'`,
    `script-src ${script}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src ${connect}`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The three that matter. `sandbox` puts the renderer in the OS sandbox,
      // `contextIsolation` keeps the preload's world separate from page script,
      // and `nodeIntegration: false` means page script has no require at all.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // No embedded frames, no remote module, no bypassing the origin rules.
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // Avoid the white flash before the renderer paints. In smoke mode the window
  // stays hidden so a CI run (or a run alongside the user's work) never steals
  // focus.
  if (!SMOKE_REPO) win.once('ready-to-show', () => win.show());

  // Dropping the menu also drops its devtools accelerator, so put it back —
  // but only in dev, so a packaged build has no key that opens an inspector.
  if (isDev) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const isToggle =
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i');
      if (isToggle) win.webContents.toggleDevTools();
    });
  }

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}

/**
 * Navigation and window-opening rules, applied to every webContents Electron
 * creates rather than just the one we make ourselves.
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_e, contents) => {
    // A link to an external site opens in the user's real browser; it must
    // never load inside a window that has the Grove bridge attached.
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
      return { action: 'deny' };
    });

    // In-place navigation away from the app is always a bug or an attack.
    contents.on('will-navigate', (event, url) => {
      const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
        if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
      }
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

// Enforce the sandbox process-wide, not only for windows we remember to flag.
app.enableSandbox();

void app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp()],
      },
    });
  });

  // Nothing in Grove needs a camera, a microphone, or a location; deny the lot
  // rather than trusting that no dependency ever asks.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  // Electron's stock File/Edit/View/Window menu is noise on a tool this size,
  // and none of its items do anything Grove needs. Removed on Windows and
  // Linux; kept on macOS, where the app menu is what makes the standard
  // copy/paste and quit accelerators work at all.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  hardenWebContents();
  registerIpc(() => mainWindow);

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (SMOKE_REPO) {
    const win = mainWindow;
    win.webContents.once('did-finish-load', () => {
      void runSmoke(win, SMOKE_REPO).then((failed) => {
        quitting = true; // skip the will-quit dance; we are exiting deliberately
        void disposeIpc().finally(() => app.exit(failed === 0 ? 0 : 1));
      });
    });
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Stop the watcher before exiting so no git subprocess outlives the window.
// Guarded and time-boxed: a shutdown hook that can hang is worse than a
// watcher that outlives the window by a second.
let quitting = false;

app.on('will-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();

  const deadline = new Promise((resolve) => setTimeout(resolve, 1000));
  void Promise.race([disposeIpc(), deadline]).finally(() => app.exit(0));
});
