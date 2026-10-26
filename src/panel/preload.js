// What the helper's small windows (toolbar, cards, picker, toast) may ask the
// hub to do. Nothing else gets through.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgpn', {
  get: () => ipcRenderer.invoke('rgpn:get'),
  act: (id) => ipcRenderer.invoke('rgpn:act', id),
  copy: (text) => ipcRenderer.invoke('rgpn:copy', text),
  close: () => ipcRenderer.invoke('rgpn:close'),
  size: (h) => ipcRenderer.invoke('rgpn:size', h),
  drag: (phase, dx, dy) => ipcRenderer.invoke('rgpn:drag', phase, dx, dy),
  collapse: (on) => ipcRenderer.invoke('rgpn:collapse', on),
  onData: (cb) => ipcRenderer.on('rgpn:data', (_e, d) => cb(d)),
});
