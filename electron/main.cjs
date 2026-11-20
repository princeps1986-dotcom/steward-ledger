// Electron main 프로세스 (Windows 전용 데스크톱 셸)
// - 단일 인스턴스 잠금
// - app:// 커스텀 프로토콜로 dist 서빙 + CSP 헤더 강제
// - 종료 시 자동 로컬 백업 (렌더러에 백업 내용 요청 → 파일 기록 → 최근 10개 보관)
// - mailto: 링크는 OS 기본 메일 앱으로, 그 외 외부 탐색은 차단
process.env.TZ = 'Asia/Seoul'; // 날짜·시각은 PC 설정과 상관없이 서울 기준(화면 프로세스도 상속)
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { pickBackupDir, resolveUserDataDir } = require('./dataPaths.cjs');
const { verifyBackupFile, openPlainStream, isEncryptedFile } = require('./backupVerify.cjs');
const { pcHeader, passwordHeader, parseHeader, deriveKey, keyIdOf, createEncryptStream } = require('./backupCrypto.cjs');

const DEV_URL = process.env.ELECTRON_DEV_URL;
const DIST = path.join(__dirname, '..', 'dist');
const AUTO_BACKUP_KEEP = 10;
// 이번 실행 중 앱이 저장한 PDF 파일 경로. 렌더러가 임의 경로를 열지 못하도록 이 목록에 있는 파일만 열어 줍니다.
const savedFiles = new Set();
// 백업 파일은 암호화한 .slbk입니다. 예전 형식(.json, .json.gz)도 보관 개수 정리에 함께 셉니다.
const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.(slbk|json(\.gz)?)$/;
// 앱을 쓰는 동안 주기적으로 만드는 백업(autosave_*)은 종료 때 백업(backup_*)과 따로 최근 3개만 보관합니다.
const PERIODIC_BACKUP_KEEP = 3;
const PERIODIC_BACKUP_FILE_RE = /^autosave_\d{8}_\d{6}\.(slbk|json\.gz)$/;
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
// Windows의 appData는 APPDATA 환경변수를 따르지 않으므로, 시험(개발 실행)은 STEWARD_TEST_APPDATA로 실제 데이터 폴더를 피합니다.
app.setPath('userData', resolveUserDataDir((!app.isPackaged && process.env.STEWARD_TEST_APPDATA) || app.getPath('appData')));

// 현장 장애 진단용 로그(%APPDATA%\StewardLedger\logs). 외부로 전송하지 않으며, 교인 정보가 섞이지 않도록 오류 메시지만 남깁니다.
// initialize()는 부르지 않습니다: 화면에 window.__electronLog를 노출하는 preload를 끼워 넣기 때문(로그는 main에서만 씀).
const log = require('electron-log/main');
log.transports.file.maxSize = 1024 * 1024;
// 처리 안 된 예외는 로그를 남기고 Electron 기본처럼 오류 창을 띄웁니다(조용히 묻히지 않게). Promise 거부는 Electron 기본(경고만)처럼 로그만 남깁니다.
log.errorHandler.startCatching();

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
  // 기본 백업 폴더는 앱 데이터 폴더 안(%APPDATA%\StewardLedger\backup)입니다. 설치 폴더는 업데이트·재설치 때 통째로 지워지므로 쓰지 않습니다.
  const defaultBackupDir = () => (!app.isPackaged && process.env.STEWARD_TEST_BACKUP_DIR) || path.join(app.getPath('userData'), 'backup');

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
    for (const n of all.filter((x) => /^(backup|autosave)_\d{8}_\d{6}\.(slbk|json(\.gz)?)\.tmp$/.test(x))) await fs.unlink(path.join(dir, n)).catch(() => undefined);
    for (const [re, keep] of [[AUTO_BACKUP_FILE_RE, AUTO_BACKUP_KEEP], [PERIODIC_BACKUP_FILE_RE, PERIODIC_BACKUP_KEEP]]) {
      const names = all.filter((n) => re.test(n)).sort();
      for (const n of names.slice(0, Math.max(0, names.length - keep))) await fs.unlink(path.join(dir, n)).catch(() => undefined);
    }
  }

  // 자동 백업 폴더: 화면이 임의의 경로를 보내도 쓰지 않도록, 사용자가 [폴더 선택]으로 지정한 폴더(또는 기본 폴더)만 씁니다.
  const backupDirFile = () => path.join(app.getPath('userData'), 'backup-dir.json');
  let chosenBackupDir = null;
  try {
    const saved = JSON.parse(fsSync.readFileSync(backupDirFile(), 'utf8'));
    if (typeof saved.dir === 'string' && path.isAbsolute(saved.dir)) chosenBackupDir = saved.dir;
  } catch {
    /* 아직 선택한 적 없음 */
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
  const SAFE_STREAM_NAME_RE = /^[A-Za-z0-9_-]+\.slbk$/;

  // 자동 백업(종료·주기·긴급)을 잠그는 이 PC의 키: 처음 쓸 때 무작위로 만들어 Windows 보안 저장소(DPAPI)로 잠근 뒤 앱 데이터 폴더에 둡니다.
  // 설치 파일에는 키가 없으므로 백업 파일을 다른 곳으로 가져가면 열 수 없습니다(PC를 옮길 때는 암호를 건 직접 백업을 씀).
  let pcKey = null;
  function getPcKey() {
    if (pcKey) return pcKey;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서 백업 암호화를 쓸 수 없습니다.');
    const file = path.join(app.getPath('userData'), 'backup-key.bin');
    let locked = null;
    try {
      locked = fsSync.readFileSync(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // 읽기 오류(잠김 등)로 새 키를 만들면 예전 백업을 못 열게 되므로 실패로 알립니다.
    }
    if (locked) {
      try {
        const key = Buffer.from(safeStorage.decryptString(locked), 'base64');
        if (key.length === 32) return (pcKey = key);
      } catch {
        /* Windows를 다시 설치하는 등으로 풀 수 없음: 아래에서 새 키를 만듭니다 */
      }
      fsSync.renameSync(file, `${file}.${stamp()}.old`); // 풀 수 없는 키 파일도 지우지 않고 남겨 둡니다.
    }
    const key = crypto.randomBytes(32);
    fsSync.writeFileSync(file, safeStorage.encryptString(key.toString('base64')));
    return (pcKey = key);
  }
  const OTHER_PC = '다른 PC(또는 Windows를 다시 설치하기 전)에서 만든 자동 백업이라 이 PC에서는 열 수 없습니다. PC를 옮길 때는 암호를 건 직접 백업을 쓰세요.';
  /** 백업 파일 머리말에 맞는 키: 자동 백업은 이 PC의 키(식별값이 다르면 거절), 직접 백업은 사용자 암호에서 만든 키 */
  const keyForFile = (password) => async (h) => {
    if (h.mode === 'pc') {
      const key = getPcKey();
      if (!h.keyId.equals(keyIdOf(key))) throw new Error(`백업 파일 검증 실패: ${OTHER_PC}`);
      return key;
    }
    if (typeof password !== 'string' || !password) throw new Error('백업 파일 검증 실패: 암호를 입력하세요.');
    return deriveKey(password, h.salt, h.iterations);
  };

  function startSession(file, kind, lock) {
    // 이전 세션이 남아 있으면 동기로 닫고 임시 파일을 지웁니다(겹쳐 시작될 때 파일 핸들·.tmp가 남지 않도록).
    if (autoSession) {
      const old = autoSession;
      old.gz.destroy();
      old.out.destroy();
      void fs.unlink(old.tmp).catch(() => undefined);
    }
    const tmp = `${file}.tmp`;
    const out = fsSync.createWriteStream(tmp);
    const gz = zlib.createGzip();
    const enc = createEncryptStream(lock.header, lock.key); // 줄 → gzip → 암호화 → 임시 파일
    const sess = { id: ++sessionCounter, kind, file, tmp, out, gz, enc, lock, hash: crypto.createHash('sha256'), error: null };
    out.on('error', (e) => (sess.error = e));
    gz.on('error', (e) => (sess.error = e));
    enc.on('error', (e) => (sess.error = e));
    gz.pipe(enc).pipe(out);
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
        const key = getPcKey();
        return startSession(path.join(dir, spec.name), kind, { header: pcHeader(key), key });
      }
      // 직접 백업은 사용자가 정한 암호로만 잠급니다(앱은 암호를 저장하지 않음).
      if (typeof spec.password !== 'string' || spec.password.length < 6 || spec.password.length > 256) throw new Error('암호는 6자 이상이어야 합니다.');
      const win = BrowserWindow.fromWebContents(event.sender);
      const res = await dialog.showSaveDialog(win, {
        title: '백업 파일 저장',
        defaultPath: path.join(defaultBackupDir(), spec.name),
        filters: [{ name: '청지기 장부 백업 파일', extensions: ['slbk'] }],
      });
      if (res.canceled || !res.filePath) return null;
      return startSession(res.filePath, kind, await passwordHeader(spec.password));
    }
    if (kind !== 'close' && kind !== 'periodic') throw new Error('잘못된 백업 종류');
    const d = allowedBackupDir(spec.dir);
    await fs.mkdir(d, { recursive: true });
    const key = getPcKey();
    return startSession(path.join(d, `${kind === 'periodic' ? 'autosave' : 'backup'}_${stamp()}.slbk`), kind, { header: pcHeader(key), key });
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
    return startSession(s.file, s.kind, s.lock);
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
    // 마무리하는 동안 새 백업이 시작돼도 이 세션을 강제로 닫지 않도록 먼저 떼어 냅니다(닫히면 'finish'가 오지 않아 영원히 기다림).
    autoSession = null;
    await new Promise((resolve, reject) => {
      s.out.once('finish', resolve);
      s.out.once('error', reject);
      s.gz.once('error', reject);
      s.enc.once('error', reject);
      s.gz.end(endLine);
    }).catch(async (err) => {
      s.gz.destroy();
      s.out.destroy();
      await fs.unlink(s.tmp).catch(() => undefined); // 떼어 낸 세션은 abort가 정리하지 않으므로 여기서 지웁니다.
      throw err;
    });
    try {
      await verifyBackupFile(s.tmp, () => s.lock.key);
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

    // 화면(렌더러)이 죽거나 응답이 없어도 데이터는 IndexedDB에 있으므로, 다시 불러오면 이어서 쓸 수 있습니다.
    let reloads = [];
    win.webContents.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      log.error('render-process-gone', details.reason, details.exitCode);
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
  // 화면이 고른 백업 파일 경로: 정규화한 뒤 드라이브 문자 경로만 읽는다. UNC(\\서버\공유, \/서버/공유 같은 혼합 구분자)·장치 경로는 막는다(원격 인증 정보가 나가는 것을 막음)
  const backupFilePath = (file) => {
    if (typeof file !== 'string' || !/\.(json|gz|slbk)$/i.test(file)) return null;
    const resolved = path.resolve(file);
    return /^[A-Za-z]:[\\/]/.test(resolved) ? resolved : null;
  };
  // 검증 실패 문구만 그대로 보내고, 파일 시스템 오류(경로가 섞인 메시지)는 고정 문구로 바꾼다
  const verifyMessage = (err) => {
    const msg = err instanceof Error ? err.message : '';
    return msg.startsWith('백업 파일 검증 실패') ? msg : '백업 파일을 읽을 수 없습니다.';
  };
  // 백업 파일 종류: plain(예전 일반 파일) · pc(이 PC의 자동 백업, otherPc면 열 수 없음) · password(암호가 필요한 직접 백업). 읽을 수 없는 경로면 null
  ipcMain.handle('backup:inspect-file', async (_event, file) => {
    const p = backupFilePath(file);
    if (!p) return null;
    try {
      if (!isEncryptedFile(p)) return { kind: 'plain' };
      const fd = await fs.open(p, 'r');
      const head = Buffer.alloc(26);
      const { bytesRead } = await fd.read(head, 0, head.length, 0).finally(() => fd.close());
      const h = parseHeader(head.subarray(0, bytesRead));
      if (!h) return { error: '백업 파일 검증 실패: 내용이 잘렸습니다.' };
      if (h.mode === 'password') return { kind: 'password' };
      return h.keyId.equals(keyIdOf(getPcKey())) ? { kind: 'pc' } : { kind: 'pc', error: OTHER_PC };
    } catch (err) {
      return { error: verifyMessage(err) };
    }
  });
  // 복원할 백업 파일의 체크섬 확인(내장 SHA-256이라 화면 쪽 계산보다 훨씬 빠름). ''=통과, 문구=실패, null=확인하지 않음
  ipcMain.handle('backup:verify-file', async (_event, file, password) => {
    const p = backupFilePath(file);
    if (!p) return null;
    try {
      await verifyBackupFile(p, keyForFile(password));
      return '';
    } catch (err) {
      return verifyMessage(err);
    }
  });
  // 암호화한 백업을 화면이 줄 단위로 읽도록 main이 풀어서 조각(최대 1MB)으로 건넵니다. 화면은 키를 모릅니다.
  const readers = new Map();
  let readerCounter = 0;
  ipcMain.handle('backup:open-reader', (event, file, password) => {
    const p = backupFilePath(file);
    if (!p) throw new Error('백업 파일을 읽을 수 없습니다.');
    // 닫지 않은 읽기(화면을 다시 불러온 경우 등)가 쌓이지 않게 가장 오래된 것부터 닫습니다.
    for (const [oldId, r] of readers) {
      if (readers.size < 8) break;
      readers.delete(oldId);
      r.stream.destroy();
    }
    let stream;
    try {
      // 암호화한 백업만 풀어 건넵니다(예전 일반 파일은 화면이 직접 읽으므로, 여기서 임의 파일 내용을 넘기지 않음).
      if (!isEncryptedFile(p)) throw new Error('백업 파일 검증 실패: 암호화한 백업 파일이 아닙니다.');
      stream = openPlainStream(p, keyForFile(password));
    } catch (err) {
      throw new Error(verifyMessage(err));
    }
    const id = ++readerCounter;
    readers.set(id, { stream, it: stream[Symbol.asyncIterator](), sender: event.sender });
    return id;
  });
  ipcMain.handle('backup:read', async (event, id) => {
    const r = readers.get(id);
    if (!r || r.sender !== event.sender) throw new Error('백업 파일 읽기가 끝났거나 시작되지 않았습니다.');
    const parts = [];
    let size = 0;
    try {
      while (size < 1024 * 1024) {
        const { value, done } = await r.it.next();
        if (done) break;
        parts.push(value);
        size += value.length;
      }
    } catch (err) {
      readers.delete(id);
      r.stream.destroy();
      throw new Error(verifyMessage(err));
    }
    if (parts.length === 0) {
      readers.delete(id);
      return null;
    }
    return Buffer.concat(parts);
  });
  ipcMain.handle('backup:close-reader', (_event, id) => {
    const r = readers.get(id);
    readers.delete(id);
    if (r) r.stream.destroy();
    return true;
  });
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

  // 저장한 파일을 기본 프로그램으로 열기 / 탐색기에서 위치 보기. 성공 시 빈 문자열, 실패 시 오류 문구를 반환합니다.
  ipcMain.handle('file:open', async (_event, file) => {
    if (typeof file !== 'string' || !savedFiles.has(file)) return '이 앱에서 저장한 파일만 열 수 있습니다.';
    return shell.openPath(file);
  });
  ipcMain.handle('file:show', (_event, file) => {
    if (typeof file !== 'string' || !savedFiles.has(file)) return false;
    shell.showItemInFolder(file);
    return true;
  });

  // PDF 저장: 현재 화면을 인쇄 모양(A4 가로, @page)대로 PDF로 만들어 저장 위치를 선택하게 합니다. 저장하면 download:done으로 알립니다.
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

  // 프로그램 업데이트: 사용자가 [업데이트 확인]을 누를 때만 GitHub 릴리스에 접속합니다(평소에는 인터넷을 쓰지 않음).
  // 바뀐 블록만 내려받고(차등 업데이트), 설치는 앱을 닫을 때(종료 백업이 끝난 뒤) 합니다. 강제로 다시 시작하지 않습니다.
  let updater = null;
  const getUpdater = () => {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;
      updater.logger = log;
    }
    return updater;
  };
  const updateError = (err) => {
    const msg = String((err && err.message) || err);
    log.warn('update error', msg);
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return '인터넷에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.';
    if (/404|latest\.yml|No published versions|Cannot find/i.test(msg)) return '올라온 업데이트를 찾지 못했습니다.';
    return '업데이트를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.';
  };
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    if (!app.isPackaged) return { current, error: '설치한 앱에서만 업데이트를 확인할 수 있습니다.' };
    try {
      const res = await getUpdater().checkForUpdates();
      const latest = res && res.updateInfo ? res.updateInfo.version : current;
      return { current, latest, available: !!(res && res.isUpdateAvailable) };
    } catch (err) {
      return { current, error: updateError(err) };
    }
  });
  let downloading = null;
  ipcMain.handle('update:download', (event) => {
    if (!app.isPackaged) return { error: '설치한 앱에서만 업데이트할 수 있습니다.' };
    if (downloading) return downloading; // 단추를 여러 번 눌러도 한 번만 내려받습니다.
    const u = getUpdater();
    const onProgress = (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', Math.round(p.percent));
    };
    u.on('download-progress', onProgress);
    downloading = u
      .downloadUpdate()
      .then(() => ({ ready: true }))
      .catch((err) => ({ error: updateError(err) }))
      .finally(() => {
        u.removeListener('download-progress', onProgress);
        downloading = null;
      });
    return downloading;
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
