// What the proofread window may ask the hub to do. Nothing else gets through.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgp', {
  get: () => ipcRenderer.invoke('rgp:get'),
  find: (seq, i) => ipcRenderer.invoke('rgp:find', seq, i),
  copy: (text) => ipcRenderer.invoke('rgp:copy', text),
  resolved: (seq, list) => ipcRenderer.invoke('rgp:resolved', seq, list),
  close: () => ipcRenderer.invoke('rgp:close'),
  onShow: (cb) => ipcRenderer.on('rgp:show', (_e, d) => cb(d)),
  onToast: (cb) => ipcRenderer.on('rgp:toast', (_e, m) => cb(m)),
});
