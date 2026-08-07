# @grove/app

Grove's Electron shell: window lifecycle, the security posture, and the IPC
bridge onto [`@grove/engine`](../engine). **Phase 3** of the move off Tauri.

The renderer here is a deliberately plain wiring harness, not a design. Phase 4
deletes it and replaces it with the real, design-first React interface.

## Layout

```
src/main/index.ts     window lifecycle + every security decision
src/main/ipc.ts       the 33 handlers — the `invoke_handler!` block's replacement
src/main/smoke.ts     headless end-to-end check of the bridge
src/preload/index.ts  contextBridge — the only thing the renderer can reach
src/shared/ipc.ts     channel names + the `GroveApi` contract
src/renderer/         phase 3 harness (temporary)
```

## Commands

```bash
npm run dev          # vite dev server + electron, with HMR in the renderer
npm run dev:renderer # renderer only, in a browser, on fixtures (fast design loop)
npm run build        # builds the engine, then main/preload/renderer into out/
npm run smoke        # headless: drives window.grove end to end, non-zero on failure
npm run check        # typecheck (3 configs) + renderer tests
npm run package:dir  # unpacked build into release/win-unpacked — no installer
npm run package      # full installer for the host platform
```

`npm run smoke` is the one that matters for CI. It drives the *real* path —
page script calls `window.grove.*`, which crosses contextBridge → ipcRenderer →
ipcMain → engine and back — with the window hidden, so it never steals focus.
It asserts the security posture too: that `require`, `process`, and `module` are
all absent from the renderer.

## Security posture

Grove renders diffs, commit messages, and file contents from whatever repository
the user opens — content Grove did not write and cannot vet. In a renderer with
Node access, an XSS in that content is arbitrary code execution on a machine
holding the user's SSH keys. So:

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and
  `app.enableSandbox()` process-wide rather than per-window.
- `webviewTag: false`, and `will-attach-webview` is denied outright.
- A CSP is set on every response. `connect-src` widens for Vite's HMR websocket
  in dev and nothing else; production is `'self'` throughout.
- `setWindowOpenHandler` denies every popup. `http(s)` links go to the user's
  real browser via `shell.openExternal` — never into a window carrying the bridge.
- `will-navigate` blocks in-place navigation away from the app.
- All permission requests (camera, microphone, geolocation, …) are denied.
- The preload passes only the event *payload* to listeners, never the
  `IpcRendererEvent` — that object carries a `sender` handle, and handing it to
  page script would defeat context isolation.

## Notes for whoever touches this next

- **The preload is typed as `GroveApi`.** A missing or misnamed method is a
  compile error, which is why `npm run typecheck` is worth keeping green.
- **The preload must stay CommonJS.** A sandboxed preload is loaded without an
  ESM loader. That is why the config forces `format: 'cjs'` and why
  `package.json` has no `"type"` field — a bare `.js` here has to mean CJS.
- **`@grove/engine` stays external in the main bundle.** electron-vite's
  externalization ignores `ssr.noExternal`, `resolve.alias`, and
  `rollupOptions.external` overrides under Vite 7, so it is left as a runtime
  `require`. That works because Electron 43 ships Node 22, which supports
  `require(esm)` for modules without top-level await — and the engine has none.
  **This is settled: it packages correctly.** electron-builder dereferences the
  `file:` link and `require('@grove/engine')` resolves to
  `node_modules/@grove/engine/dist/index.js` inside the asar, with `chokidar`
  alongside it. The engine does not need a CJS build.
- **Do not exclude `*.json` from the engine when packaging.** It takes
  `package.json` with it, Node can then no longer resolve `@grove/engine`, and
  the app dies on its first require with no other symptom. Exclusions in
  `electron-builder.yml` are deliberately specific for this reason.
- **`npm run build` cleans `out/` first.** electron-vite does not, so a renamed
  or removed entry point keeps shipping. A stale `out/PROBE/` from a debugging
  session made it into a package before this was added.
- **Electron's binary may not download on install.** If `npm start` fails with
  `Error: Electron uninstall`, run `node node_modules/electron/install.js`.
- **Watch the port on Windows.** Hyper-V reserves several TCP ranges, and a
  bind inside one fails with `EACCES` that reads like a permissions problem but
  is not. Vite's preview default (4173) sits inside the reserved 4147–4246 on
  this machine, which is the same reason the root config moved Tauri off 1420
  to 7420. `dev:renderer` pins 5180 and binds `127.0.0.1` rather than `::1`.
  Check a candidate with `netsh int ipv4 show excludedportrange protocol=tcp`.
- Electron logs every rejected `ipcMain.handle` to stderr. Expected errors — a
  path that isn't a repository, say — will show up there even though the
  renderer handled them correctly.
- **`EBUSY: resource busy or locked` on `app.asar` when repackaging** is
  Windows Defender still scanning the file it was just handed. Wait, or build
  to a scratch output with `-c.directories.output=release-check`.
- **The browser harness tab is hidden, so Chrome clamps its timers** — a 40ms
  `setTimeout` was measured at 464ms. Poll for DOM changes when testing there
  rather than sleeping, or you will read stale state and conclude the app is
  broken. Editing `data/source.ts` also leaves HMR holding a stale module
  instance, so hard-reload before debugging anything that looks dead.
- **No application icon yet.** Packaging warns `default Electron icon is used`.
  Drop one at `packaging/icon.png` (256×256 or larger) when there is a mark to
  use; `packaging/` is the `buildResources` dir precisely so it is not caught by
  the repo's `build/` ignore rule.
