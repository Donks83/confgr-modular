// The only bridge between the renderer and Node. Same `window.confgr` shape as
// confgr-studio so habits transfer, minus everything not needed yet.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confgr', {
  projects: {
    list: () => ipcRenderer.invoke('project:list'),
    load: (id) => ipcRenderer.invoke('project:load', id),
    save: (project) => ipcRenderer.invoke('project:save', project),
    delete: (id) => ipcRenderer.invoke('project:delete', id),
  },
  fs: {
    readModel: (filePath) => ipcRenderer.invoke('fs:readModel', filePath),
    listModels: (dirPath) => ipcRenderer.invoke('fs:listModels', dirPath),
  },
  dialog: {
    openModels: () => ipcRenderer.invoke('dialog:openModels'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  },
  shellUtil: {
    showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  },
  app: {
    testAssetsDir: () => ipcRenderer.invoke('app:testAssetsDir'),
    catalogue: () => ipcRenderer.invoke('app:catalogue'),
  },
});
