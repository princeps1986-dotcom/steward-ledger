// contextBridge로 렌더러에 최소 API만 노출합니다 (src/services/desktopBridge.ts의 DesktopApi).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  backupBegin: (spec) => ipcRenderer.invoke('backup:begin', spec),
  backupWrite: (id, line) => ipcRenderer.invoke('backup:write', id, line),
  backupRestart: (id) => ipcRenderer.invoke('backup:restart', id),
  backupAbort: (id) => ipcRenderer.invoke('backup:abort', id),
  backupEnd: (id) => ipcRenderer.invoke('backup:end', id),
  // 고른 파일의 경로를 main에 넘겨 체크섬을 확인합니다(경로를 모르는 파일이면 null: 화면 쪽에서 확인).
  verifyBackupFile: (file) => {
    const path = webUtils.getPathForFile(file);
    return path ? ipcRenderer.invoke('backup:verify-file', path) : Promise.resolve(null);
  },
  skipBackup: () => ipcRenderer.send('backup:skip'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateProgress: (handler) => {
    const listener = (_event, percent) => handler(percent);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
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
