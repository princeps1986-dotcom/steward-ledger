// Electron 스모크 시험: 빌드된 앱(dist)을 임시 데이터 폴더로 실제로 띄워, 시작·저장소·보안 설정·IPC가 동작하는지 확인합니다.
// 사용: npm run build 후 `npm run smoke`. 개발 실행은 실제 사용자 데이터(%APPDATA%\StewardLedger) 대신 임시 폴더를 씁니다(STEWARD_TEST_APPDATA).
// SMOKE_EXE(포장된 앱)는 이 바꿔치기를 받지 않아 실제 데이터 폴더를 열기만 합니다(읽기 확인만 하고 쓰지 않음).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const electronPath = createRequire(import.meta.url)('electron');
const PORT = 9400 + Math.floor(Math.random() * 500);
const appData = mkdtempSync(join(tmpdir(), 'steward-smoke-'));
// SMOKE_EXE=설치 전 묶음(release\win-unpacked\StewardLedger.exe)을 주면 포장된 앱(퓨즈·asar 포함)을 시험합니다.
const exe = process.env.SMOKE_EXE;
const backupDir = join(appData, 'backups');
const child = spawn(exe || electronPath, exe ? [`--remote-debugging-port=${PORT}`] : ['.', `--remote-debugging-port=${PORT}`], { env: { ...process.env, STEWARD_TEST_APPDATA: appData, STEWARD_TEST_BACKUP_DIR: backupDir, STEWARD_TEST_NO_LOGIN: '1' }, stdio: 'ignore' });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('app://'));
      if (page) return page;
    } catch {
      /* 아직 시작 중 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('앱 창을 찾지 못했습니다(30초).');
}

try {
  const page = await waitForPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
  };
  const ev = async (expression) => {
    const r = await new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  await new Promise((r) => setTimeout(r, 2500)); // 첫 화면과 저장소 열기 대기

  check('앱이 app:// 로 뜸', page.url.startsWith('app://local/'), page.url);
  check('화면에 제목이 그려짐', (await ev('document.querySelector("h1")?.textContent')) === '청지기 장부');
  check('보안: 렌더러에서 Node 접근 불가', (await ev('typeof require + "," + typeof process')) === 'undefined,undefined');
  check('보안: 최소 API만 노출', (await ev('typeof window.desktop?.backupBegin')) === 'function');
  const csp = await ev('fetch(location.href).then(r => r.headers.get("content-security-policy"))');
  check('보안: CSP 헤더가 있음', typeof csp === 'string' && csp.includes("default-src 'self'"));
  // 권한 단계에서 답이 없으면 timeout 옵션이 적용되지 않으므로 5초 타이머와 경쟁시킵니다.
  const perm = await ev('new Promise((res) => { setTimeout(() => res("시간 초과"), 5000); navigator.geolocation.getCurrentPosition(() => res("허용됨"), (e) => res(e.code === 1 ? "거부" : "오류" + e.code)); })');
  check('보안: 위치 권한 요청이 거부됨', perm === '거부', perm);
  check('저장소: 영구 저장소 권한이 허용됨', (await ev('navigator.storage.persisted()')) === true);
  check('보안: 오른쪽 버튼 메뉴가 막힘', (await ev('(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })()')) === true);
  const db = await ev(`new Promise((res, rej) => { const r = indexedDB.open('church-offering-ledger'); r.onsuccess = () => { const d = r.result; const o = { v: d.version, s: [...d.objectStoreNames].sort().join(',') }; d.close(); res(JSON.stringify(o)); }; r.onerror = () => rej(r.error); })`);
  check('저장소: kv·donations·audits가 만들어짐', JSON.parse(db).s === 'audits,donations,kv', db);
  // 로그인 설정이 없는 환경(클라이언트 ID 없음)에서는 브라우저를 열지 않고 안내만 돌려준다. 화면에는 계정(이메일)만 오가고 토큰은 없다.
  check('로그인 IPC: 설정이 없으면 안내만 돌려줌', JSON.stringify(await ev('window.desktop.authStatus()')) === '{"configured":false,"email":null,"role":null,"locked":false,"hasPin":false}');
  const loginResult = await ev('window.desktop.authLogin()');
  check('로그인 IPC: 설정이 없으면 로그인 시도가 안내 문구로 실패', typeof loginResult?.error === 'string' && loginResult.error.includes('클라이언트 ID'), JSON.stringify(loginResult));
  // 로그인하지 않은 상태에서는 PIN 만들기·확인 모두 거절한다.
  const pinSet = await ev('window.desktop.authSetPin("123456")');
  check('로그인 IPC: 로그인 없이는 PIN을 만들 수 없음', pinSet?.error === '로그인이 필요합니다.', JSON.stringify(pinSet));
  const pinCheck = await ev('window.desktop.authVerifyPin("123456")');
  check('로그인 IPC: 로그인 없이는 PIN 확인도 거절', pinCheck?.error === '로그인이 필요합니다.', JSON.stringify(pinCheck));
  // 데이터 열쇠는 로그인한 사람에게만 넘긴다(로그인 전에 열쇠를 요청해도 거절).
  const keyAsk = await ev('window.desktop.dataKey()');
  check('열쇠 IPC: 로그인 없이는 데이터 열쇠를 주지 않음', keyAsk?.error === '로그인이 필요합니다.' && !('key' in keyAsk), JSON.stringify(keyAsk));
  const keyReplace = await ev('window.desktop.dataKeyReplace()');
  check('열쇠 IPC: 로그인 없이는 열쇠 교체도 거절', keyReplace?.error === '로그인이 필요합니다.' && !('key' in keyReplace), JSON.stringify(keyReplace));
  // 계정·역할 관리는 로그인한 관리자만(로그인 없이는 목록·등록·역할 변경 모두 거절).
  const userCalls = await ev('Promise.all([window.desktop.usersList(), window.desktop.usersAdd({ email: "x@y.co", role: "admin" }), window.desktop.usersSetRole("x@y.co", "viewer"), window.desktop.usersSetDisabled("x@y.co", true), window.desktop.usersLog()])');
  check('계정 관리 IPC: 로그인 없이는 모두 거절', userCalls.every((r) => r?.error === '로그인이 필요합니다.'), JSON.stringify(userCalls));
  const stale = await ev('window.desktop.backupWrite(999, "x").then(() => "통과됨", (e) => "거부")');
  check('백업 IPC: 모르는 세션의 쓰기는 거부', stale === '거부', stale);
  const peek = await ev('window.desktop.openBackupReader("auto:latest").then(() => "통과됨", (e) => e.message)');
  check('백업 IPC: 로그인 없이는 백업 내용을 읽을 수 없음', peek.includes('권한이 없습니다'), peek);
  if (!exe) {
    // 포장하지 않은 실행에서는 백업 폴더를 임시 폴더로 바꿀 수 있어, 백업 쓰기·검증·이름 바꾸기·보관 정리를 끝까지 시험합니다.
    const NL = String.fromCharCode(10);
    const written = await ev(`(async () => { const id = await window.desktop.backupBegin({ kind: 'periodic', dir: 'C:/Windows/Temp/evil' }); await window.desktop.backupWrite(id, JSON.stringify({ ndjson: 3 }) + String.fromCharCode(10)); await window.desktop.backupWrite(id, JSON.stringify({ t: 'members', data: [] }) + String.fromCharCode(10)); return await window.desktop.backupEnd(id); })()`);
    const { readdirSync, existsSync } = await import('node:fs');
    check('백업 IPC: 주기 백업 파일이 검증을 거쳐 저장됨', typeof written === 'string' && /autosave_\d{8}_\d{6}\.slbk$/.test(written) && existsSync(written), String(written));
    check('보안: 임의 폴더를 보내도 허용된 폴더에만 씀', String(written).startsWith(backupDir), String(written));
    check('백업 IPC: 임시 파일이 남지 않음', readdirSync(backupDir).every((n) => !n.endsWith('.tmp')));
    void NL;
    // 종료 백업(kind close)도 같은 PC 키로 잠기고, [전체 복원]이 쓰는 최신 종료 백업을 같은 키로 검증·인식하는지 봅니다.
    const closed = await ev(`(async () => { const id = await window.desktop.backupBegin({ kind: 'close' }); await window.desktop.backupWrite(id, JSON.stringify({ ndjson: 3 }) + String.fromCharCode(10)); await window.desktop.backupWrite(id, JSON.stringify({ t: 'members', data: [] }) + String.fromCharCode(10)); return await window.desktop.backupEnd(id); })()`);
    check('백업 IPC: 종료 백업 파일이 저장됨', typeof closed === 'string' && /backup_\d{8}_\d{6}\.slbk$/.test(closed) && existsSync(closed), String(closed));
    const keyDir = join(appData, 'StewardLedger');
    check('PC 키: 키 파일이 만들어지고 임시 파일은 남지 않음', existsSync(join(keyDir, 'backup-key.bin')) && readdirSync(keyDir).every((n) => !/^backup-key\.bin\.tmp$/.test(n)), readdirSync(keyDir).filter((n) => n.startsWith('backup-key')).join(','));
    const latest = await ev('window.desktop.latestAutoBackup()');
    check('PC 키: 최신 종료 백업이 [전체 복원] 대상으로 잡힘', latest?.path === 'auto:latest' && /^backup_/.test(latest?.name ?? ''), JSON.stringify(latest));
    check('PC 키: 같은 키로 검증됨(체크섬 통과)', (await ev('window.desktop.verifyBackupFile("auto:latest")')) === '');
    check('PC 키: 이 PC의 키로 잠긴 백업으로 인식됨', JSON.stringify(await ev('window.desktop.inspectBackupFile("auto:latest")')) === '{"kind":"pc"}');
  }
  ws.close();
} catch (e) {
  check('스모크 시험 진행', false, e.message);
} finally {
  // 보조 프로세스까지 모두 끝냅니다(남으면 다음 시험·종료를 막음).
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
  await new Promise((r) => setTimeout(r, 800));
  rmSync(appData, { recursive: true, force: true });
}
console.log(failures.length ? `\n실패 ${failures.length}건` : '\n모두 통과');
process.exit(failures.length ? 1 : 0);
