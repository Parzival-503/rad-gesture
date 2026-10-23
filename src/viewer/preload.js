// What the reference viewer may ask the hub to do. Nothing else gets through.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgv', {
  get: (id) => ipcRenderer.invoke('rgv:get', id),
  openLink: (url) => ipcRenderer.invoke('rgv:open-link', url),
  edit: (id) => ipcRenderer.invoke('rgv:edit', id),
  close: () => ipcRenderer.invoke('rgv:close'),
  onShow: (cb) => ipcRenderer.on('rgv:show', (_e, id) => cb(id)),
});
