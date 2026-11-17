// Electron 스모크 시험: 빌드된 앱(dist)을 임시 데이터 폴더로 실제로 띄워, 시작·저장소·보안 설정·IPC가 동작하는지 확인합니다.
// 사용: npm run build 후 `npm run smoke`. 실제 사용자 데이터(%APPDATA%\StewardLedger)는 건드리지 않습니다(APPDATA를 임시 폴더로 바꿈).
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
const child = spawn(exe || electronPath, exe ? [`--remote-debugging-port=${PORT}`] : ['.', `--remote-debugging-port=${PORT}`], { env: { ...process.env, APPDATA: appData, STEWARD_TEST_BACKUP_DIR: backupDir }, stdio: 'ignore' });
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
  check('보안: 최소 API만 노출', (await ev('typeof window.desktop?.autoBackupBegin')) === 'function');
  const csp = await ev('fetch(location.href).then(r => r.headers.get("content-security-policy"))');
  check('보안: CSP 헤더가 있음', typeof csp === 'string' && csp.includes("default-src 'self'"));
  const perm = await ev('new Promise((res) => navigator.geolocation.getCurrentPosition(() => res("허용됨"), (e) => res(e.code === 1 ? "거부" : "오류" + e.code)))');
  check('보안: 위치 권한 요청이 거부됨', perm === '거부', perm);
  const db = await ev(`new Promise((res, rej) => { const r = indexedDB.open('church-offering-ledger'); r.onsuccess = () => { const d = r.result; const o = { v: d.version, s: [...d.objectStoreNames].sort().join(',') }; d.close(); res(JSON.stringify(o)); }; r.onerror = () => rej(r.error); })`);
  check('저장소: kv와 donations가 만들어짐', JSON.parse(db).s === 'donations,kv', db);
  const stale = await ev('window.desktop.autoBackupWrite(999, "x").then(() => "통과됨", (e) => "거부")');
  check('백업 IPC: 모르는 세션의 쓰기는 거부', stale === '거부', stale);
  if (!exe) {
    // 포장하지 않은 실행에서는 백업 폴더를 임시 폴더로 바꿀 수 있어, 백업 쓰기·검증·이름 바꾸기·보관 정리를 끝까지 시험합니다.
    const NL = String.fromCharCode(10);
    const written = await ev(`(async () => { const id = await window.desktop.autoBackupBegin('C:/Windows/Temp/evil', 'periodic'); await window.desktop.autoBackupWrite(id, JSON.stringify({ ndjson: 3 }) + String.fromCharCode(10)); await window.desktop.autoBackupWrite(id, JSON.stringify({ t: 'members', data: [] }) + String.fromCharCode(10)); return await window.desktop.autoBackupEnd(id); })()`);
    const { readdirSync, existsSync } = await import('node:fs');
    check('백업 IPC: 주기 백업 파일이 검증을 거쳐 저장됨', typeof written === 'string' && /autosave_\d{8}_\d{6}\.json\.gz$/.test(written) && existsSync(written), String(written));
    check('보안: 임의 폴더를 보내도 허용된 폴더에만 씀', String(written).startsWith(backupDir), String(written));
    check('백업 IPC: 임시 파일이 남지 않음', readdirSync(backupDir).every((n) => !n.endsWith('.tmp')));
    void NL;
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
