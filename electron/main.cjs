// Electron main 프로세스 (Windows 전용 데스크톱 셸)
// - 단일 인스턴스 잠금
// - app:// 커스텀 프로토콜로 dist 서빙 + CSP 헤더 강제
// - 종료 시 자동 로컬 백업 (렌더러에 백업 내용 요청 → 파일 기록 → 최근 10개 보관)
// - mailto: 링크는 OS 기본 메일 앱으로, 그 외 외부 탐색은 차단
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { pickBackupDir, resolveBackupDir, resolveUserDataDir } = require('./dataPaths.cjs');
const { verifyBackupFile } = require('./backupVerify.cjs');

const DEV_URL = process.env.ELECTRON_DEV_URL;
const DIST = path.join(__dirname, '..', 'dist');
const AUTO_BACKUP_KEEP = 10;
// 이번 실행 중 앱이 저장한 엑셀 파일 경로. 렌더러가 임의 경로를 열지 못하도록 이 목록에 있는 파일만 열어 줍니다.
const savedFiles = new Set();
const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.json(\.gz)?$/;
// 앱을 쓰는 동안 주기적으로 만드는 백업(autosave_*)은 종료 때 백업(backup_*)과 따로 최근 3개만 보관합니다.
const PERIODIC_BACKUP_KEEP = 3;
const PERIODIC_BACKUP_FILE_RE = /^autosave_\d{8}_\d{6}\.json\.gz$/;
const BACKUP_TIMEOUT_MS = 300000; // 종료 시 자동 백업을 기다리는 최대 시간(5분)
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

// 데이터 폴더는 영문 경로(%APPDATA%\StewardLedger)입니다. 이전 버전의 한글 폴더(교회헌금회계)는 처음 한 번 옮겨 기존 데이터를 이어 씁니다.
// 단일 인스턴스 잠금도 userData 기준이므로 잠금보다 먼저 지정해야 합니다.
app.setPath('userData', resolveUserDataDir(app.getPath('appData')));

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
  // 포장하지 않은 실행(스모크 시험 등)에서만 환경 변수로 백업 폴더를 바꿀 수 있습니다(실제 문서 폴더를 건드리지 않고 시험하려는 용도).
  const defaultBackupDir = () => (!app.isPackaged && process.env.STEWARD_TEST_BACKUP_DIR) || resolveBackupDir(app.getPath('documents'));

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
    const all = await fs.readdir(dir);
    // 쓰다 중단된 임시 파일은 지웁니다.
    for (const n of all.filter((x) => /^(backup|autosave)_\d{8}_\d{6}\.json(\.gz)?\.tmp$/.test(x))) await fs.unlink(path.join(dir, n)).catch(() => undefined);
    for (const [re, keep] of [[AUTO_BACKUP_FILE_RE, AUTO_BACKUP_KEEP], [PERIODIC_BACKUP_FILE_RE, PERIODIC_BACKUP_KEEP]]) {
      const names = all.filter((n) => re.test(n)).sort();
      for (const n of names.slice(0, Math.max(0, names.length - keep))) await fs.unlink(path.join(dir, n)).catch(() => undefined);
    }
  }

  // 자동 백업 폴더: 화면이 임의의 경로를 보내도 쓰지 않도록, 사용자가 [폴더 선택]으로 고른 폴더(또는 기본 폴더)만 씁니다.
  const backupDirFile = () => path.join(app.getPath('userData'), 'backup-dir.json');
  let chosenBackupDir = null;
  try {
    const saved = JSON.parse(fsSync.readFileSync(backupDirFile(), 'utf8'));
    if (typeof saved.dir === 'string' && path.isAbsolute(saved.dir)) chosenBackupDir = saved.dir;
  } catch {
    /* 아직 고른 적 없음 */
  }
  const allowedBackupDir = (dir) => pickBackupDir(dir, chosenBackupDir, defaultBackupDir());

  // 자동 백업은 렌더러가 월 단위 줄(NDJSON)을 하나씩 보내면 main이 해시를 이어 계산하며 gzip 파일로 바로 씁니다.
  // 전체 JSON을 메모리에 만들지 않으므로 데이터가 커도 메모리가 한 달치 수준에 머뭅니다.
  let autoSession = null;
  async function abortAutoSession() {
    const s = autoSession;
    autoSession = null;
    if (!s) return;
    s.gz.destroy();
    s.out.destroy();
    await fs.unlink(s.tmp).catch(() => undefined);
  }
  // 세션 번호: 서로 다른 백업(주기·종료·직접·긴급)이 겹쳐도 줄이 섞이지 않게 합니다(새로 시작하면 이전 세션은 취소됨).
  // 백업은 렌더러가 한 달치씩 줄 단위(NDJSON)로 보내고 main이 gzip 파일로 바로 씁니다. 메모리는 한 달치 수준에 머뭅니다.
  let sessionCounter = 0;
  const SAFE_STREAM_NAME_RE = /^[A-Za-z0-9_-]+\.json\.gz$/;
  function startSession(file, kind) {
    const tmp = `${file}.tmp`;
    const out = fsSync.createWriteStream(tmp);
    const gz = zlib.createGzip();
    const sess = { id: ++sessionCounter, kind, file, tmp, out, gz, hash: crypto.createHash('sha256'), error: null };
    out.on('error', (e) => (sess.error = e));
    gz.on('error', (e) => (sess.error = e));
    gz.pipe(out);
    autoSession = sess;
    return sess.id;
  }
  // 백업 시작. kind: close(종료 때) · periodic(앱을 쓰는 동안) · emergency(복원·초기화 직전, 기본 폴더에 이름 지정) · manual(저장 위치를 고름, 취소하면 null)
  ipcMain.handle('backup:begin', async (event, spec) => {
    await abortAutoSession();
    const kind = spec && spec.kind;
    if (kind === 'manual' || kind === 'emergency') {
      if (typeof spec.name !== 'string' || !SAFE_STREAM_NAME_RE.test(spec.name)) throw new Error('잘못된 백업 요청');
      if (kind === 'emergency') {
        const dir = defaultBackupDir();
        await fs.mkdir(dir, { recursive: true });
        return startSession(path.join(dir, spec.name), kind);
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      const res = await dialog.showSaveDialog(win, {
        title: '백업 파일 저장',
        defaultPath: path.join(defaultBackupDir(), spec.name),
        filters: [{ name: '백업 파일(압축)', extensions: ['gz'] }],
      });
      if (res.canceled || !res.filePath) return null;
      return startSession(res.filePath, kind);
    }
    if (kind !== 'close' && kind !== 'periodic') throw new Error('잘못된 백업 종류');
    const d = allowedBackupDir(spec.dir);
    await fs.mkdir(d, { recursive: true });
    return startSession(path.join(d, `${kind === 'periodic' ? 'autosave' : 'backup'}_${stamp()}.json.gz`), kind);
  });
  const sessionOf = (id) => {
    const s = autoSession;
    if (!s || s.id !== id) throw new Error('백업이 취소되었거나 시작되지 않았습니다.');
    return s;
  };
  ipcMain.handle('backup:write', (_event, id, line) => {
    const s = sessionOf(id);
    if (typeof line !== 'string') throw new Error('잘못된 백업 줄');
    if (s.error) throw s.error;
    s.hash.update(line);
    return new Promise((resolve, reject) => s.gz.write(line, (err) => (err ? reject(err) : resolve(true))));
  });
  // 같은 대상 파일로 처음부터 다시 씁니다(백업하는 도중 내역이 달을 넘어 옮겨져 다시 읽어야 할 때; 저장 대화상자를 다시 열지 않음).
  ipcMain.handle('backup:restart', async (_event, id) => {
    const s = sessionOf(id);
    await abortAutoSession();
    return startSession(s.file, s.kind);
  });
  ipcMain.handle('backup:abort', async (_event, id) => {
    if (autoSession && autoSession.id === id) await abortAutoSession();
    return true;
  });
  ipcMain.handle('backup:end', async (_event, id) => {
    const s = sessionOf(id);
    if (s.error) throw s.error;
    // 끝 줄: 앞의 모든 줄에 대한 SHA-256. 복원할 때 이 값으로 파일이 온전한지 확인합니다.
    const endLine = `${JSON.stringify({ t: 'end', sha256: s.hash.digest('hex') })}\n`;
    await new Promise((resolve, reject) => {
      s.out.once('finish', resolve);
      s.out.once('error', reject);
      s.gz.end(endLine);
    });
    autoSession = null;
    try {
      await verifyBackupFile(s.tmp);
    } catch (err) {
      await fs.unlink(s.tmp).catch(() => undefined); // 검증에 실패한 파일은 남기지 않습니다(이미 있는 좋은 백업은 그대로)
      throw err;
    }
    // 임시 파일에 다 쓰고 검증한 뒤 이름을 바꿔, 쓰는 도중 전원이 꺼져도 잘린 백업 파일이 남지 않게 합니다.
    await fs.rename(s.tmp, s.file);
    // 오래된 파일 정리는 종료·주기 백업만(직접·긴급 백업 파일은 지우지 않음). 정리 실패로 이미 저장된 백업을 실패로 알리지 않습니다.
    if (s.kind === 'close' || s.kind === 'periodic') await pruneBackups(path.dirname(s.file)).catch(() => undefined);
    return s.file;
  });

  /**
   * 렌더러에 백업 내용을 요청하고 지정 폴더에 기록합니다. 끝날 때까지 기다리며(큰 데이터는 오래 걸릴 수 있음),
   * 화면에는 렌더러가 "백업 중" 안내를 띄웁니다. 사용자가 [백업 없이 종료]를 누르거나 화면이 죽으면 기다리지 않습니다.
   * 반환값: true = 종료해도 됨, false = 백업이 실패했고 사용자가 종료를 취소함.
   */
  function runAutoBackup(win) {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      let done = false;
      const cleanup = () => {
        ipcMain.removeListener('backup:response', onResponse);
        ipcMain.removeListener('backup:skip', onSkip);
        win.webContents.removeListener('render-process-gone', onGone);
        clearTimeout(ceiling);
      };
      const finish = async (payload, abort) => {
        if (done) return;
        done = true;
        cleanup();
        if (abort) {
          await abortAutoSession();
          await writeStatus({ ok: false, at: new Date().toISOString(), error: abort });
          return resolve(true);
        }
        if (!payload) return resolve(true); // 비활성 또는 변경 없음
        try {
          if (typeof payload.file !== 'string') throw new Error(payload.error || '잘못된 백업 내용');
          await writeStatus({ ok: true, at: new Date().toISOString(), file: payload.file });
        } catch (err) {
          await abortAutoSession();
          const msg = String(err && err.message ? err.message : err);
          await writeStatus({ ok: false, at: new Date().toISOString(), error: msg });
          // 백업이 실패했는데 그냥 닫으면 데이터를 지킬 기회를 잃으므로 사용자에게 묻습니다.
          const r = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['그래도 종료', '종료 취소'],
            defaultId: 1,
            cancelId: 1,
            message: '자동 백업에 실패했습니다.',
            detail: `${msg}

백업 폴더(설정 정보 > 자동 로컬 백업)를 확인하세요. 데이터는 앱 안에 그대로 있습니다. 종료를 취소하면 앱을 계속 쓸 수 있습니다.`,
          });
          if (r.response === 1) {
            if (!win.isDestroyed()) win.webContents.send('backup:cancelled');
            return resolve(false);
          }
        }
        resolve(true);
      };
      const onResponse = (event, id, payload) => {
        if (event.sender !== win.webContents || id !== requestId) return;
        void finish(payload, null);
      };
      const onSkip = (event) => {
        if (event.sender === win.webContents) void finish(null, '사용자가 백업 없이 종료함');
      };
      const onGone = () => void finish(null, '화면이 종료되어 백업하지 못함');
      ipcMain.on('backup:response', onResponse);
      ipcMain.on('backup:skip', onSkip);
      win.webContents.once('render-process-gone', onGone);
      // 정말 멈춘 경우만 막기 위한 상한(정상적인 큰 백업은 이보다 훨씬 먼저 끝남)
      const ceiling = setTimeout(() => void finish(null, `백업 응답 시간 초과(${BACKUP_TIMEOUT_MS / 1000}초)`), BACKUP_TIMEOUT_MS);
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

    // 화면(렌더러)이 죽거나 응답이 없어도 데이터는 IndexedDB에 있으므로, 다시 불러오면 이어서 쓸 수 있습니다.
    let reloads = [];
    win.webContents.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      const now = Date.now();
      reloads = reloads.filter((t) => now - t < 60000);
      if (reloads.length >= 3) {
        void dialog.showMessageBox(win, { type: 'error', message: '화면이 반복해서 멈춥니다.', detail: '데이터는 안전합니다. 앱을 닫았다가 다시 실행해 주세요.' });
        return;
      }
      reloads.push(now);
      if (!win.isDestroyed()) win.webContents.reload();
    });
    win.on('unresponsive', () => {
      void dialog
        .showMessageBox(win, { type: 'warning', buttons: ['기다리기', '다시 불러오기'], defaultId: 0, message: '앱이 응답하지 않습니다.', detail: '큰 보고서를 계산하는 중일 수 있습니다. 데이터는 안전합니다.' })
        .then((r) => {
          if (r.response === 1 && !win.isDestroyed()) win.webContents.reload();
        });
    });

    let backupFinished = false;
    // Windows가 종료·로그오프 중이면 사용자 확인 없이 닫혀야 하므로 백업을 기다리며 종료를 막지 않습니다.
    win.on('session-end', () => {
      backupFinished = true;
    });
    let backingUp = false;
    win.on('close', (e) => {
      if (backupFinished) return;
      e.preventDefault();
      if (backingUp) return; // 이미 백업을 기다리는 중(닫기를 여러 번 눌러도 한 번만)
      backingUp = true;
      void runAutoBackup(win).then((ok) => {
        backingUp = false;
        if (!ok || win.isDestroyed()) return;
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
    if (res.canceled || res.filePaths.length === 0) return null;
    chosenBackupDir = res.filePaths[0];
    await fs.writeFile(backupDirFile(), JSON.stringify({ dir: chosenBackupDir }), 'utf8').catch(() => undefined);
    return chosenBackupDir;
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

  // PDF 저장: 현재 화면을 인쇄 모양(A4 가로, @page)대로 PDF로 만들어 저장 위치를 고르게 합니다. 저장하면 download:done으로 알립니다.
  ipcMain.handle('report:save-pdf', async (event, name) => {
    if (typeof name !== 'string' || !/^[^\\/:*?"<>|]+\.pdf$/i.test(name)) throw new Error('잘못된 파일 이름');
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: 'PDF 저장',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'PDF 파일', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return false;
    const data = await event.sender.printToPDF({ preferCSSPageSize: true, printBackground: true });
    await fs.writeFile(res.filePath, data);
    savedFiles.add(res.filePath);
    if (!win.isDestroyed()) win.webContents.send('download:done', { path: res.filePath, name: path.basename(res.filePath) });
    return true;
  });

  app.whenReady().then(() => {
    // 이 앱은 카메라·위치·알림 같은 권한이 필요 없으므로 모든 권한 요청을 거부합니다.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
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
