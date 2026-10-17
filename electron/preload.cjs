const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orquestraDesktop', Object.freeze({
  notify: ({ body, key, test = false }) => ipcRenderer.invoke('orquestra:notification', { body, key, test: test === true }),
}));
