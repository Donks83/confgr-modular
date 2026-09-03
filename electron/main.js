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
  const query = process.env.CONFGR_DEMO ? '?demo=1' : '';

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
          // Read the WebGL buffer from inside the page first. capturePage()
          // returns an empty image on Windows when the window is not composited,
          // and a blank canvas in an OS screenshot cannot be told apart from a
          // canvas that legitimately drew nothing.
          const dataUrl = await mainWindow.webContents.executeJavaScript(
            'window.__spikeCapture ? window.__spikeCapture() : null',
          );

          if (dataUrl && dataUrl.length > 1000) {
            fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
            process.stdout.write(`[capture] canvas readback -> ${target}\n`);
          } else {
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

// Where the bundled test components live, so the spike can load them without a
// file dialog. In a packaged build they sit beside the app resources.
ipcMain.handle('app:testAssetsDir', () => (
  isDev
    ? path.join(__dirname, '..', 'test-assets')
    : path.join(process.resourcesPath, 'test-assets')
));
