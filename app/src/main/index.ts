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

import { createReadStream, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, shell, BrowserWindow, Menu, net, protocol, session } from 'electron';

import { parseRange } from '../shared/range';

import { disposeIpc, registerIpc, watchedRoot } from './ipc';
import { runSmoke } from './smoke';

/**
 * A scheme for streaming working-tree files to the renderer.
 *
 * Media cannot go through IPC as base64: a 50MB video becomes a 67MB string,
 * built in main, copied across the boundary, and held in renderer memory —
 * which is a freeze, not a preview. A protocol streams from disk and gives
 * `<video>` real range requests, so seeking works.
 *
 * Must be registered before the app is ready, hence module scope.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'grove-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

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
    // `grove-file:` serves working-tree files; see the protocol handler for the
    // containment check that keeps it to the open repository.
    `img-src 'self' data: grove-file:`,
    `media-src 'self' grove-file:`,
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
    backgroundColor: '#0b0b0d',
    // The OS title bar and Grove's own bar were two strips of chrome stacked on
    // top of each other, one of them empty. Hiding the frame and overlaying the
    // system controls gives that row back to the app: the repo bar *is* the
    // title bar now. Colours come from the design system so the controls sit on
    // --bg rather than on a slab of blue.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : {
          titleBarOverlay: {
            color: '#0b0b0d',
            symbolColor: '#9a9a97',
            height: 34,
          },
        }),
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

  // Serve working-tree files to the renderer, confined to the open repository.
  // A scheme that reads off disk is an arbitrary-read primitive unless it is
  // fenced, so every request is resolved and checked for containment before
  // anything is opened — `..` cannot climb out, because `resolve` collapses it
  // first and the prefix check then fails.
  protocol.handle('grove-file', async (request) => {
    const root = watchedRoot();
    if (!root) return new Response('no repository open', { status: 403 });

    let relative: string;
    try {
      relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (relative === '') return new Response('bad request', { status: 400 });

    const rootAbs = resolve(root);
    const full = resolve(rootAbs, relative);
    if (full !== rootAbs && !full.startsWith(rootAbs + sep)) {
      return new Response('outside the open repository', { status: 403 });
    }

    // Range requests are handled here rather than delegated. `net.fetch` on a
    // file URL returns the whole body as a single 200 and advertises no
    // `Accept-Ranges`, so a media element has no way to ask for an earlier
    // offset — playback works and seeking backwards does not.
    let size: number;
    try {
      size = statSync(full).size;
    } catch {
      return new Response('not found', { status: 404 });
    }

    const range = parseRange(request.headers.get('Range'), size);
    if (range === 'unsatisfiable') {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }

    if (range === null) {
      const whole = await net.fetch(pathToFileURL(full).toString());
      const headers = new Headers(whole.headers);
      headers.set('Accept-Ranges', 'bytes');
      return new Response(whole.body, { status: 200, headers });
    }

    // A stream, not a buffer: a seek into a 400MB video must not read 400MB.
    const { start, end } = range;
    const stream = createReadStream(full, { start, end }) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  });

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
