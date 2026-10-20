// What the Settings window may ask the hub to do. Nothing else gets through.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgs', {
  get: () => ipcRenderer.invoke('rgs:get'),
  saveMenu: (m) => ipcRenderer.invoke('rgs:save-menu', m),
  saveAI: (v) => ipcRenderer.invoke('rgs:save-ai', v),
  saveShortcuts: (v) => ipcRenderer.invoke('rgs:save-shortcuts', v),
  testKey: (key, model) => ipcRenderer.invoke('rgs:test-key', { key, model }),
  status: () => ipcRenderer.invoke('rgs:status'),
  restartHelper: () => ipcRenderer.invoke('rgs:restart-helper'),
  rescan: () => ipcRenderer.invoke('rgs:rescan'),
  closeConflicts: () => ipcRenderer.invoke('rgs:close-conflicts'),
  openUninstall: () => ipcRenderer.invoke('rgs:open-uninstall'),
  openDataFolder: () => ipcRenderer.invoke('rgs:open-data-folder'),
  pickFile: (kind) => ipcRenderer.invoke('rgs:pick-file', kind),
  tryRing: (m) => ipcRenderer.invoke('rgs:try-ring', m),
  setPaused: (p) => ipcRenderer.invoke('rgs:set-paused', p),
  runHelperAction: (id) => ipcRenderer.invoke('rgs:run-helper-action', id),
  onTab: (cb) => ipcRenderer.on('rgs:tab', (_e, tab) => cb(tab)),
});
