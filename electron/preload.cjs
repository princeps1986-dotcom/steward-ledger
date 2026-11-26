// contextBridge로 렌더러에 최소 API만 노출합니다 (src/services/desktopBridge.ts의 DesktopApi).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 문자열은 main이 알려 준 전체 복원 표식('auto:latest')만 받습니다. 임의 경로 문자열은 넘기지 못합니다.
const pathOf = (file) => (file === 'auto:latest' ? file : webUtils.getPathForFile(file));

contextBridge.exposeInMainWorld('desktop', {
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
  // 선택한 파일의 경로를 main에 넘겨 체크섬을 확인합니다(경로를 모르는 파일이면 null: 화면 쪽에서 확인).
  // file은 선택한 File 또는 경로 문자열(전체 복원이 main이 알려 준 경로를 그대로 씀)
  verifyBackupFile: (file, password) => {
    const path = pathOf(file);
    return path ? ipcRenderer.invoke('backup:verify-file', path, password) : Promise.resolve(null);
  },
  inspectBackupFile: (file) => {
    const path = pathOf(file);
    return path ? ipcRenderer.invoke('backup:inspect-file', path) : Promise.resolve(null);
  },
  latestAutoBackup: () => ipcRenderer.invoke('backup:latest-auto'),
  openBackupReader: (file, password) => ipcRenderer.invoke('backup:open-reader', pathOf(file), password),
  readBackup: (id) => ipcRenderer.invoke('backup:read', id),
  closeBackupReader: (id) => ipcRenderer.invoke('backup:close-reader', id),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: (opts) => ipcRenderer.invoke('auth:login', opts),
  authSetPin: (pin) => ipcRenderer.invoke('auth:set-pin', pin),
  authVerifyPin: (pin) => ipcRenderer.invoke('auth:verify-pin', pin),
  usersList: () => ipcRenderer.invoke('users:list'),
  usersLog: () => ipcRenderer.invoke('users:log'),
  usersAckRebuilt: () => ipcRenderer.invoke('users:ack-rebuilt'),
  usersAdd: (user) => ipcRenderer.invoke('users:add', user),
  usersSetRole: (email, role) => ipcRenderer.invoke('users:set-role', email, role),
  usersSetDisabled: (email, disabled) => ipcRenderer.invoke('users:set-disabled', email, disabled),
  dataKey: () => ipcRenderer.invoke('data:key'),
  dataKeyReplace: () => ipcRenderer.invoke('data:key-replace'),
  authCancel: () => ipcRenderer.invoke('auth:cancel'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  skipBackup: () => ipcRenderer.send('backup:skip'),
  logRestore: (entry) => ipcRenderer.send('restore:log', entry),
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

// PC앱 전용 보호: 오른쪽 버튼 메뉴를 막고(붙여넣기는 Ctrl+V), 디스크가 부족해도 저장소가 자동 정리되지 않게 영구 저장소를 요청합니다(main이 이 권한만 허용).
window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
void navigator.storage?.persist?.().catch(() => undefined);
