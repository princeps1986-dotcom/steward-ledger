// contextBridge로 렌더러에 최소 API만 노출합니다 (src/services/desktopBridge.ts의 DesktopApi).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getDefaultBackupDir: () => ipcRenderer.invoke('backup:default-dir'),
  selectBackupDir: () => ipcRenderer.invoke('backup:select-dir'),
  getAutoBackupStatus: () => ipcRenderer.invoke('backup:get-status'),
  ackAutoBackupStatus: () => ipcRenderer.invoke('backup:ack-status'),
  savePdf: (name) => ipcRenderer.invoke('report:save-pdf', name),
  openFile: (file) => ipcRenderer.invoke('file:open', file),
  showInFolder: (file) => ipcRenderer.invoke('file:show', file),
  onDownloadDone: (handler) => {
    const listener = (_event, info) => handler(info);
    ipcRenderer.on('download:done', listener);
    return () => ipcRenderer.removeListener('download:done', listener);
  },
  autoBackupBegin: (dir) => ipcRenderer.invoke('backup:auto-begin', dir),
  autoBackupWrite: (line) => ipcRenderer.invoke('backup:auto-write', line),
  autoBackupEnd: () => ipcRenderer.invoke('backup:auto-end'),
  saveEmergencyBackup: (name, json) => ipcRenderer.invoke('backup:save-emergency', name, json),
  saveBackupAs: (name, json) => ipcRenderer.invoke('backup:save-as', name, json),
  skipBackup: () => ipcRenderer.send('backup:skip'),
  onBackupCancelled: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('backup:cancelled', listener);
    return () => ipcRenderer.removeListener('backup:cancelled', listener);
  },
  onBackupRequest: (handler) => {
    const listener = async (_event, requestId) => {
      let payload = null;
      try {
        payload = await handler();
      } catch (err) {
        // 오류를 '백업 없음'으로 숨기지 않고 알려서, 메인이 실패 안내(종료 취소 여부 묻기)를 하게 합니다.
        payload = { error: String((err && err.message) || err) };
      }
      ipcRenderer.send('backup:response', requestId, payload);
    };
    ipcRenderer.on('backup:request', listener);
    return () => ipcRenderer.removeListener('backup:request', listener);
  },
});
