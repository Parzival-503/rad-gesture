// The only bridge between the ring page and the hub. The page never gets Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radgesture', {
  onOpen: (cb) => ipcRenderer.on('rg:open', (_e, data) => cb(data)),
  // The hub asks "what is under the pointer?" when the trigger is released.
  onRelease: (cb) =>
    ipcRenderer.on('rg:release', (_e, { id }) => ipcRenderer.send('rg:release-result', { id, result: cb() })),
  onClose: (cb) => ipcRenderer.on('rg:close', () => cb()),
  select: (item) => ipcRenderer.send('rg:select', { name: item.name, action: item.action }),
  dismiss: () => ipcRenderer.send('rg:dismiss'),
});
