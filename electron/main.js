// Electron main process.
//
// Deliberately minimal. This is a fresh copy of confgr-studio's shell rather
// than a link to it — see plan section 3.2, "copy, do not share". confgr-studio's
// main.js is 685 lines because it carries a vault, a preview server and orbit
// manifest handling. None of that is needed yet, and pruning it later is easier
// than untangling it.
//
// The layout under userData mirrors confgr-studio's v2 shape on purpose, so the
// two apps are navigable by the same habits:
//   projects/<id>/project.json
//   projects/<id>/assets/
//   projects/.history/

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

app.setName('confgr-modular');

const PROJECTS_DIR = path.join(app.getPath('userData'), 'projects');
const HISTORY_DIR = path.join(PROJECTS_DIR, '.history');
const HISTORY_KEEP = 15;

const MODEL_EXTENSIONS = ['glb', 'gltf'];

function ensureDirs() {
  for (const dir of [PROJECTS_DIR, HISTORY_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// An id arriving over IPC is untrusted. Anything that could climb out of the
// projects folder is refused rather than sanitised, because a silently rewritten
// id would save to a path the caller does not expect.
function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
    throw new Error('Invalid project id.');
  }
  return id;
}

const projectDir = (id) => path.join(PROJECTS_DIR, safeId(id));
const projectFile = (id) => path.join(projectDir(id), 'project.json');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#1b1815',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Forward the renderer's console to this process's stdout. Without it a
  // renderer-side error is invisible unless DevTools happens to be open, which
  // is how an empty scene looked identical to a working one on 3 Sep.
  const LEVELS = ['log', 'warn', 'error'];
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const where = sourceId ? ` (${sourceId.split('/').pop()}:${line})` : '';
    process.stdout.write(`[renderer:${LEVELS[level] || level}] ${message}${where}\n`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    process.stdout.write(`[renderer GONE] ${JSON.stringify(details)}\n`);
  });

  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    process.stdout.write(`[preload ERROR] ${preloadPath}: ${error?.message}\n`);
  });

  // CONFGR_DEMO seeds a pre-connected run on startup. Passed as a query param
  // because the renderer cannot see the main process's environment, and it
  // makes the visual check repeatable rather than depending on someone dragging
  // parts by hand the same way twice.
  const query = process.env.CONFGR_DEMO ? `?demo=${encodeURIComponent(process.env.CONFGR_DEMO)}` : '';

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5174${query}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { search: query });
  }

  // Set CONFGR_CAPTURE to a file path and the window screenshots itself once the
  // scene has settled, then quits. Lets a headless check confirm the renderer
  // actually drew something rather than inferring it from logs — "objects are in
  // the scene graph" and "objects are on screen" are different claims.
  if (process.env.CONFGR_CAPTURE) {
    const target = process.env.CONFGR_CAPTURE;
    const delay = Number(process.env.CONFGR_CAPTURE_DELAY || 6000);

    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // CONFGR_CLICK drives real input before capturing, so the
          // raycast-to-attach path is exercised rather than assumed. Steps:
          //   marker:N              click attach marker N
          //   part:NAME             click a palette entry
          //   drag:instanceId:N     drag that part onto marker N
          //   pan:X:Y:Z             shove the orbit target there, report the clamp
          //   layout                print every part's resolved world position
          //   quote                 print the bill of materials and the totals
          //   mount:floor|wall      drive the mounting dropdown for real
          //   ground                print the ground and AR state FROM THE SCENE
          //   palette[:N]           print the first N palette entries: id => label
          //   dump                  print the status line and the counts
          // e.g. "part:rack-shelf-900,marker:0,drag:i2:4,dump".
          if (process.env.CONFGR_CLICK) {
            for (const step of process.env.CONFGR_CLICK.split(',')) {
              const [kind, ...rest] = step.split(':');
              const value = rest[0];
              const js = kind === 'marker'
                ? `window.__cfgClickMarker(${Number(value) || 0})`
                : kind === 'drag'
                  ? `window.__cfgDragToMarker(${JSON.stringify(value)}, ${Number(rest[1]) || 0})`
                  : kind === 'pan'
                    ? `window.__cfgPanCheck(${Number(rest[0])}, ${Number(rest[1])}, ${Number(rest[2])})`
                    : kind === 'layout'
                    ? 'window.__cfgLayout ? window.__cfgLayout() : "no layout dump"'
                    : kind === 'quote'
                    ? 'window.__cfgQuote ? window.__cfgQuote() : "no quote"'
                    // Set the select's value and fire the event React listens
                    // for, rather than calling setMounting - so this exercises
                    // the same path a hand takes. `ground` then reads the scene
                    // back, which is what makes a no-op impossible to miss.
                    : kind === 'mount'
                    ? `(() => {
                         const el = document.querySelector('.cfg-mounting');
                         if (!el) return 'no mounting control';
                         el.value = ${JSON.stringify(value)};
                         el.dispatchEvent(new Event('change', { bubbles: true }));
                         return 'mounting set to ' + el.value;
                       })()`
                    : kind === 'ground'
                    ? 'window.__cfgGround ? window.__cfgGround() : "no ground dump"'
                    // What the palette actually SAYS. A wrong label is invisible
                    // in a screenshot and invisible in the status line, which is
                    // how four ladders read as the same part for a whole session.
                    : kind === 'palette'
                    ? `[...document.querySelectorAll('.cfg-palette button')]
                         .slice(0, Number(${JSON.stringify(value)}) || 8)
                         .map((b) => b.dataset.component + '  =>  '
                            + (b.querySelector('strong')?.textContent || '(no label)'))
                         .join('\\n')`
                    : kind === 'dump'
                    ? `[...document.querySelectorAll('.cfg-status, .cfg-panel .cfg-note')]
                         .map((n) => n.textContent.replace(/\\s+/g, ' ').trim())
                         .filter(Boolean).join(' | ')`
                    // Select by data-component, not by the button's text. The
                    // label now comes from the catalogue description, which is
                    // allowed to change; the component id is not.
                    : `(() => {
                         const b = document.querySelector(
                           '.cfg-palette button[data-component^=' + JSON.stringify(${JSON.stringify(value)}) + ']');
                         if (!b) return 'no palette entry for ${value}';
                         if (b.disabled) return '${value} is disabled - it fits nowhere right now';
                         b.click();
                         return 'clicked part ' + b.dataset.component;
                       })()`;
              // eslint-disable-next-line no-await-in-loop
              const r = await mainWindow.webContents.executeJavaScript(js);
              process.stdout.write(`[click] ${step} -> ${r}\n`);
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r2) => setTimeout(r2, 900));
            }
          }

          // Read the WebGL buffer from inside the page first. capturePage()
          // returns an empty image on Windows when the window is not composited,
          // and a blank canvas in an OS screenshot cannot be told apart from a
          // canvas that legitimately drew nothing.
          // CONFGR_CAPTURE_WINDOW captures the whole window instead, panel and
          // all - the canvas readback shows the product but not the bill of
          // materials beside it, and the panel is half of what there is to look
          // at now. Still falls through to the readback if capturePage returns
          // nothing, which it does when Windows has not composited the window.
          const dataUrl = process.env.CONFGR_CAPTURE_WINDOW
            ? null
            : await mainWindow.webContents.executeJavaScript(
              'window.__spikeCapture ? window.__spikeCapture() : null',
            );

          if (dataUrl && dataUrl.length > 1000) {
            fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
            process.stdout.write(`[capture] canvas readback -> ${target}\n`);
          } else {
            // Draw a fresh frame before the OS screenshot. capturePage takes
            // whatever the compositor last got, which after a resize is a stale
            // frame - the first whole-window capture showed the product half
            // out of view purely because of that.
            await mainWindow.webContents.executeJavaScript(
              'window.__spikeRender && window.__spikeRender(), 1',
            ).catch(() => {});
            const image = await mainWindow.webContents.capturePage();
            const png = image.toPNG();
            fs.writeFileSync(target, png);
            process.stdout.write(
              `[capture] capturePage -> ${target} (${png.length} bytes`
              + `${png.length ? '' : ' — EMPTY, window probably not composited'})\n`,
            );
          }
        } catch (err) {
          process.stdout.write(`[capture] failed: ${err.message}\n`);
        }
        app.quit();
      }, delay);
    });
  }
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- projects

ipcMain.handle('project:list', () => {
  const out = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, entry.name, 'project.json'), 'utf8'));
      out.push({ id: raw.id, name: raw.name, updatedAt: raw.updatedAt });
    } catch { /* a half-written project should not break the list */ }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
});

ipcMain.handle('project:load', (_e, id) => {
  try {
    return { ok: true, project: JSON.parse(fs.readFileSync(projectFile(id), 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project:save', (_e, project) => {
  try {
    const dir = projectDir(project.id);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

    const target = projectFile(project.id);

    // Keep the previous version before overwriting. confgr-studio learned this
    // the expensive way — a lost build is what put version control on the
    // critical path in the first place.
    if (fs.existsSync(target)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(target, path.join(HISTORY_DIR, `${project.id}-${stamp}.json`));

      const mine = fs.readdirSync(HISTORY_DIR)
        .filter((f) => f.startsWith(`${project.id}-`))
        .sort()
        .reverse();
      for (const stale of mine.slice(HISTORY_KEEP)) {
        try { fs.unlinkSync(path.join(HISTORY_DIR, stale)); } catch { /* best effort */ }
      }
    }

    // Write to a temp file then rename. A crash mid-write leaves the previous
    // project.json intact rather than a truncated one.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2), 'utf8');
    fs.renameSync(tmp, target);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project:delete', (_e, id) => {
  try {
    fs.rmSync(projectDir(id), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------- files

ipcMain.handle('fs:readModel', (_e, filePath) => {
  try {
    // Models cross the IPC boundary as a plain array because only
    // structured-cloneable values survive it. The renderer rebuilds a
    // Uint8Array; GLTFLoader.parse takes the ArrayBuffer directly.
    const buf = fs.readFileSync(filePath);
    return { ok: true, bytes: Array.from(buf), name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:openModels', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import components',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '3D models', extensions: MODEL_EXTENSIONS }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('fs:listModels', (_e, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && MODEL_EXTENSIONS.includes(d.name.split('.').pop().toLowerCase()))
      .map((d) => path.join(dirPath, d.name));
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('shell:showInFolder', (_e, p) => { shell.showItemInFolder(p); });

// The commercial catalogue: article numbers, descriptions and prices. Read from
// disk on request rather than bundled, because a price list changes on a
// different schedule from the app and nobody should need a rebuild to correct a
// price. A missing file is not an error worth crashing over - the configurator
// still works, it just cannot quote, and it says so.
ipcMain.handle('app:catalogue', () => {
  // CONFGR_CATALOGUE points at a different price list. That exists so a demo or
  // a probe can run against example numbers WITHOUT editing the real
  // catalogue - the alternative is typing prices into the committed file and
  // hoping to remember to take them out, which is how fictional money ends up
  // in a repo looking exactly like the real thing.
  const file = process.env.CONFGR_CATALOGUE
    || (isDev
      ? path.join(__dirname, '..', 'youk', 'catalogue.json')
      : path.join(process.resourcesPath, 'catalogue.json'));
  try {
    return { ok: true, catalogue: JSON.parse(fs.readFileSync(file, 'utf8')), path: file };
  } catch (err) {
    return { ok: false, error: err.message, path: file };
  }
});

// Where the bundled test components live, so the spike can load them without a
// file dialog. In a packaged build they sit beside the app resources.
ipcMain.handle('app:testAssetsDir', () => (
  isDev
    ? path.join(__dirname, '..', 'test-assets')
    : path.join(process.resourcesPath, 'test-assets')
));
