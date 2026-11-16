// contextBridge로 렌더러에 최소 API만 노출합니다 (src/services/desktopBridge.ts의 DesktopApi).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getDefaultBackupDir: () => ipcRenderer.invoke('backup:default-dir'),
  selectBackupDir: () => ipcRenderer.invoke('backup:select-dir'),
  getAutoBackupStatus: () => ipcRenderer.invoke('backup:get-status'),
  ackAutoBackupStatus: () => ipcRenderer.invoke('backup:ack-status'),
  openFile: (file) => ipcRenderer.invoke('file:open', file),
  showInFolder: (file) => ipcRenderer.invoke('file:show', file),
  onDownloadDone: (handler) => {
    const listener = (_event, info) => handler(info);
    ipcRenderer.on('download:done', listener);
    return () => ipcRenderer.removeListener('download:done', listener);
  },
  onBackupRequest: (handler) => {
    const listener = async (_event, requestId) => {
      let payload = null;
      try {
        payload = await handler();
      } catch {
        payload = null;
      }
      ipcRenderer.send('backup:response', requestId, payload);
    };
    ipcRenderer.on('backup:request', listener);
    return () => ipcRenderer.removeListener('backup:request', listener);
  },
});
