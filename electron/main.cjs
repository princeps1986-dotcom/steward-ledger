// Electron main 프로세스 (Windows 전용 데스크톱 셸)
// - 단일 인스턴스 잠금
// - app:// 커스텀 프로토콜로 dist 서빙 + CSP 헤더 강제
// - 종료 시 자동 로컬 백업 (렌더러에 백업 내용 요청 → 파일 기록 → 최근 10개 보관)
// - mailto: 링크는 OS 기본 메일 앱으로, 그 외 외부 탐색은 차단
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.ELECTRON_DEV_URL;
const DIST = path.join(__dirname, '..', 'dist');
const AUTO_BACKUP_KEEP = 10;
// 이번 실행 중 앱이 저장한 엑셀 파일 경로. 렌더러가 임의 경로를 열지 못하도록 이 목록에 있는 파일만 열어 줍니다.
const savedFiles = new Set();
const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.json$/;
const BACKUP_TIMEOUT_MS = 5000;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Radix(react-remove-scroll)가 <style>을 주입하고, 가상 스크롤·인쇄용 제한적 인라인 스타일을 허용합니다.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// 이름을 바꿔도 기존 데이터 폴더를 계속 사용합니다 (이전 productName = 교회헌금회계).
// 단일 인스턴스 잠금도 userData 기준이므로 잠금보다 먼저 지정해야 합니다.
app.setPath('userData', path.join(app.getPath('appData'), '교회헌금회계'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const statusFile = () => path.join(app.getPath('userData'), 'auto-backup-status.json');
  const defaultBackupDir = () => path.join(app.getPath('documents'), '교회헌금백업');

  function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function writeStatus(status) {
    try {
      await fs.writeFile(statusFile(), JSON.stringify(status), 'utf8');
    } catch {
      /* 상태 기록 실패는 무시 */
    }
  }

  async function pruneBackups(dir) {
    const names = (await fs.readdir(dir)).filter((n) => AUTO_BACKUP_FILE_RE.test(n)).sort();
    const remove = names.slice(0, Math.max(0, names.length - AUTO_BACKUP_KEEP));
    for (const n of remove) await fs.unlink(path.join(dir, n)).catch(() => undefined);
  }

  /** 렌더러에 백업 내용을 요청하고 지정 폴더에 기록합니다. 실패해도 종료를 막지 않습니다. */
  function runAutoBackup(win) {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      let done = false;
      const finish = async (payload, timedOut) => {
        if (done) return;
        done = true;
        ipcMain.removeListener('backup:response', onResponse);
        if (timedOut) {
          await writeStatus({ ok: false, at: new Date().toISOString(), error: '백업 응답 시간 초과(5초)' });
          return resolve();
        }
        if (!payload) return resolve(); // 비활성 또는 변경 없음
        try {
          const dir = typeof payload.dir === 'string' && path.isAbsolute(payload.dir) ? payload.dir : defaultBackupDir();
          if (typeof payload.json !== 'string') throw new Error('잘못된 백업 내용');
          JSON.parse(payload.json); // 형식 확인
          await fs.mkdir(dir, { recursive: true });
          const file = path.join(dir, `backup_${stamp()}.json`);
          await fs.writeFile(file, payload.json, 'utf8');
          await pruneBackups(dir);
          await writeStatus({ ok: true, at: new Date().toISOString(), file });
        } catch (err) {
          await writeStatus({ ok: false, at: new Date().toISOString(), error: String(err && err.message ? err.message : err) });
        }
        resolve();
      };
      const onResponse = (event, id, payload) => {
        if (event.sender !== win.webContents || id !== requestId) return;
        void finish(payload, false);
      };
      ipcMain.on('backup:response', onResponse);
      setTimeout(() => void finish(null, true), BACKUP_TIMEOUT_MS);
      win.webContents.send('backup:request', requestId);
    });
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: '청지기 장부',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    // 외부 탐색 차단, mailto:만 OS로 위임
    const allowed = DEV_URL ? new URL(DEV_URL).origin : 'app://local';
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(allowed)) return;
      e.preventDefault();
      if (url.startsWith('mailto:')) void shell.openExternal(url);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('mailto:')) void shell.openExternal(url);
      return { action: 'deny' };
    });

    // 엑셀 저장(다운로드)이 끝나면 저장된 경로를 렌더러에 알려 [파일 열기] 버튼을 띄웁니다.
    win.webContents.session.on('will-download', (_e, item) => {
      item.once('done', (_ev, state) => {
        if (state !== 'completed') return;
        const file = item.getSavePath();
        if (!/\.xlsx$/i.test(file)) return;
        savedFiles.add(file);
        if (!win.isDestroyed()) win.webContents.send('download:done', { path: file, name: path.basename(file) });
      });
    });

    let backupFinished = false;
    win.on('close', (e) => {
      if (backupFinished) return;
      e.preventDefault();
      void runAutoBackup(win).finally(() => {
        backupFinished = true;
        win.close();
      });
    });
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null;
    });

    if (DEV_URL) void win.loadURL(DEV_URL);
    else void win.loadURL('app://local/index.html');
    return win;
  }

  ipcMain.handle('backup:default-dir', () => defaultBackupDir());
  ipcMain.handle('backup:select-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: '자동 백업 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  ipcMain.handle('backup:get-status', async () => {
    try {
      return JSON.parse(await fs.readFile(statusFile(), 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('backup:ack-status', async () => {
    await fs.unlink(statusFile()).catch(() => undefined);
  });

  // 저장한 엑셀 파일을 기본 프로그램으로 열기 / 탐색기에서 위치 보기. 성공 시 빈 문자열, 실패 시 오류 문구를 반환합니다.
  ipcMain.handle('file:open', async (_event, file) => {
    if (typeof file !== 'string' || !savedFiles.has(file)) return '이 앱에서 저장한 파일만 열 수 있습니다.';
    return shell.openPath(file);
  });
  ipcMain.handle('file:show', (_event, file) => {
    if (typeof file !== 'string' || !savedFiles.has(file)) return false;
    shell.showItemInFolder(file);
    return true;
  });

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const { pathname } = new URL(request.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    });
    mainWindow = createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
