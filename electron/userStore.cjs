// 계정·역할 목록(%APPDATA%\StewardLedger\users.json, IndexedDB 밖·백업 제외)과 자동 잠금 해제용 PIN.
// 규칙은 docs/plans/권한-체계-계획.md 4·6장: 목록이 비었을 때 처음 로그인한 사람이 관리자, 이메일 사전 등록 → 첫 로그인에서 sub 결합,
// 목록에 없거나 사용 중지된 계정은 거절, 최대 10명, 관리자 1~2명(마지막 관리자는 내리거나 중지할 수 없음).
// 역할은 앱 안의 규칙입니다: 같은 Windows 계정이면 이 파일을 직접 고칠 수 있습니다(문서의 한계).
// 파일 읽기·쓰기만 하므로 Electron 없이 시험할 수 있습니다(src/services/userStore.test.ts).
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { writeKeyFile } = require('./pcKey.cjs');

const scrypt = promisify(crypto.scrypt);
const ROLES = ['admin', 'finance', 'viewer'];
const MAX_USERS = 10;
const MAX_ADMINS = 2;
const PIN_MAX_FAILS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{6}$/;
const MAX_LOG = 100;
const CORRUPT = '계정 목록 파일을 읽을 수 없습니다. 이 PC의 소유자가 파일(users.json)을 확인하세요.';

const fail = (msg) => {
  throw new Error(msg);
};

function createUserStore({ dir, now = Date.now }) {
  const file = path.join(dir, 'users.json');
  // 읽고 고쳐 쓰는 동작을 한 줄로 세워, 동시에 불려도 서로의 변경을 덮어쓰지 않게 합니다.
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
  let curLog = [];
  const pinFails = new Map(); // sub → 연속 실패 횟수(메모리에만: 앱을 다시 켜면 어차피 구글 로그인부터)

  /** 파일이 없을 때만 빈 목록입니다. 깨진 파일을 빈 목록으로 보면 아무나 관리자가 되므로 오류로 알립니다. */
  async function read() {
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        curLog = [];
        return [];
      }
      throw err;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return fail(CORRUPT);
    }
    if (!data || !Array.isArray(data.users)) fail(CORRUPT);
    curLog = Array.isArray(data.log) ? data.log : [];
    return data.users;
  }
  // 기록(로그인·계정 변경, 최근 100건)은 계정 목록과 한 파일에 둡니다. 이메일·역할만 적고 토큰·PIN은 없습니다. 읽기→쓰기는 exclusive 안이라 curLog가 섞이지 않습니다.
  const write = (users, ...notes) => {
    curLog = [...curLog, ...notes.map(([who, text]) => ({ at: new Date(now()).toISOString(), who: mailOf(who), text }))].slice(-MAX_LOG);
    return writeKeyFile(file, JSON.stringify({ version: 1, users, log: curLog }, null, 2));
  };
  // 거절 기록은 덤입니다: 기록을 쓰다 실패해도(디스크 오류 등) 원래의 거절 사유가 가려지지 않게 오류를 삼킵니다.
  const note = (users, who, text) => write(users, [who, text]).catch(() => undefined);
  const find = (users, email) => users.find((u) => u.email === email);
  const adminCount = (users) => users.filter((u) => u.role === 'admin').length;
  const activeAdminCount = (users) => users.filter((u) => u.role === 'admin' && !u.disabled).length;
  const newUser = (sub, email, role) => ({ sub, email, role, addedAt: new Date(now()).toISOString(), disabled: false, pin: null });
  const mailOf = (email) => String(email ?? '').trim().toLowerCase();
  const need = (users, email) => find(users, mailOf(email)) ?? fail('등록되지 않은 이메일입니다.');

  return {
    /**
     * 로그인한 구글 계정이 이 앱을 써도 되는지 확인하고 역할을 돌려줍니다({ sub, email, role }). 아니면 사유 문구로 거절.
     * 목록이 비어 있으면 이 사람이 관리자로 등록됩니다(이 PC의 첫 사용자라는 전제).
     */
    admit: ({ sub, email }) =>
      exclusive(async () => {
        const mail = mailOf(email);
        const users = await read();
        const first = users.length === 0;
        let user;
        if (users.length === 0) {
          user = newUser(sub, mail, 'admin');
          users.push(user);
        } else {
          user = users.find((u) => u.sub === sub);
          if (!user) {
            user = users.find((u) => !u.sub && u.email === mail); // 사전 등록: 첫 로그인에서 sub를 묶습니다.
            if (user) {
              user.sub = sub;
            }
          }
          // 거절도 기록합니다(구글 로그인을 마친 계정만 여기까지 오므로 아무나 기록을 채울 수는 없음).
          if (!user) {
            await note(users, mail, '로그인 거절(등록되지 않은 계정)');
            fail('등록되지 않은 계정입니다. 관리자에게 이메일 등록을 요청하세요.');
          }
          if (user.disabled) {
            await note(users, mail, '로그인 거절(사용 중지된 계정)');
            fail('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
          }
          if (user.email !== mail) {
            user.email = mail; // 구글 계정의 이메일이 바뀐 경우 sub로 알아보고 표시만 고칩니다.
          }
        }
        await write(users, [mail, first ? '로그인(처음 관리자로 등록)' : '로그인']);
        pinFails.delete(sub);
        return { sub, email: user.email, role: user.role };
      }),

    /** 화면에 보여 줄 목록(sub·PIN 해시는 빼고). registered=false는 아직 한 번도 로그인하지 않은 사전 등록 */
    list: () =>
      exclusive(async () =>
        (await read()).map((u) => ({ email: u.email, role: u.role, addedAt: u.addedAt, disabled: u.disabled, registered: !!u.sub, hasPin: !!u.pin })),
      ),

    /** 이메일 사전 등록. 목록이 비어 있으면(처음 로그인한 사람이 관리자가 되는 중) 거절 */
    add: ({ email, role }, actorEmail) =>
      exclusive(async () => {
        const mail = mailOf(email);
        if (!EMAIL_RE.test(mail)) fail('이메일 형식이 올바르지 않습니다.');
        if (!ROLES.includes(role)) fail('알 수 없는 역할입니다.');
        const users = await read();
        if (users.length === 0) fail('처음 로그인한 계정이 관리자가 됩니다. 먼저 로그인하세요.');
        if (users.length >= MAX_USERS) fail(`계정은 최대 ${MAX_USERS}명까지 등록할 수 있습니다.`);
        if (find(users, mail)) fail('이미 등록된 이메일입니다.');
        if (role === 'admin' && adminCount(users) >= MAX_ADMINS) fail(`관리자는 최대 ${MAX_ADMINS}명입니다. 먼저 다른 관리자를 내리세요.`);
        users.push(newUser(null, mail, role));
        await write(users, [actorEmail, `${mail} 등록(${role})`]);
      }),

    setRole: (email, role, actorEmail) =>
      exclusive(async () => {
        if (!ROLES.includes(role)) fail('알 수 없는 역할입니다.');
        const users = await read();
        const u = need(users, email);
        if (u.role === role) return;
        if (role === 'admin' && adminCount(users) >= MAX_ADMINS) fail(`관리자는 최대 ${MAX_ADMINS}명입니다. 먼저 다른 관리자를 내리세요.`);
        if (u.role === 'admin' && !u.disabled && activeAdminCount(users) < 2) fail('마지막 관리자는 내릴 수 없습니다. 먼저 다른 관리자를 추가하세요.');
        const was = u.role;
        u.role = role;
        await write(users, [actorEmail, `${u.email} 역할 변경(${was} → ${role})`]);
      }),

    /** actorEmail: 이 동작을 하는 관리자(자기 자신은 사용 중지할 수 없음) */
    setDisabled: (email, disabled, actorEmail) =>
      exclusive(async () => {
        const users = await read();
        const u = need(users, email);
        if (disabled && u.email === mailOf(actorEmail)) fail('자기 자신은 사용 중지할 수 없습니다.');
        if (disabled && u.role === 'admin' && !u.disabled && activeAdminCount(users) < 2) fail('마지막 관리자는 사용 중지할 수 없습니다. 먼저 다른 관리자를 추가하세요.');
        u.disabled = !!disabled;
        await write(users, [actorEmail, `${u.email} ${disabled ? '사용 중지' : '사용 재개'}`]);
      }),

    /** 최근 기록(오래된 것부터) */
    log: () => exclusive(async () => (await read(), curLog.slice())),

    /** 로그인한 계정의 지금 상태(역할·중지 여부). 목록에서 빠졌으면 null. 로그인 때 복사해 둔 값이 낡았을 수 있어 호출 때마다 다시 읽습니다. */
    current: (sub) =>
      exclusive(async () => {
        const u = (await read()).find((x) => x.sub === sub);
        return u ? { email: u.email, role: u.role, disabled: !!u.disabled } : null;
      }),

    hasPin: (sub) => exclusive(async () => !!(await read()).find((u) => u.sub === sub)?.pin),

    /** 6자리 숫자. scrypt 해시+솔트만 저장합니다(백업에는 들어가지 않음). */
    setPin: (sub, pin) =>
      exclusive(async () => {
        if (!PIN_RE.test(String(pin))) fail('PIN은 숫자 6자리여야 합니다.');
        const users = await read();
        const u = users.find((x) => x.sub === sub) ?? fail('로그인한 계정을 찾을 수 없습니다.');
        const salt = crypto.randomBytes(16);
        u.pin = { salt: salt.toString('base64'), hash: (await scrypt(String(pin), salt, 32)).toString('base64') };
        await write(users);
        pinFails.delete(sub);
      }),

    /**
     * { ok: true } · { ok: false, left } 남은 시도 · { ok: false, locked: true } 5회 연속 실패(PIN을 지우므로 구글 재로그인 후 다시 만들어야 함)
     * · { ok: false, noPin: true } PIN이 아직 없음
     */
    verifyPin: (sub, pin) =>
      exclusive(async () => {
        const users = await read();
        const u = users.find((x) => x.sub === sub);
        if (!u || u.disabled) return { ok: false, disabled: true };
        if (!u.pin) return { ok: false, noPin: true };
        const hash = await scrypt(String(pin), Buffer.from(u.pin.salt, 'base64'), 32);
        if (crypto.timingSafeEqual(hash, Buffer.from(u.pin.hash, 'base64'))) {
          pinFails.delete(sub);
          return { ok: true };
        }
        const n = (pinFails.get(sub) ?? 0) + 1;
        if (n >= PIN_MAX_FAILS) {
          u.pin = null;
          await write(users, [u.email, 'PIN 5회 실패로 잠김']);
          pinFails.delete(sub);
          return { ok: false, locked: true };
        }
        pinFails.set(sub, n);
        return { ok: false, left: PIN_MAX_FAILS - n };
      }),
  };
}

module.exports = { createUserStore, MAX_USERS, MAX_ADMINS, PIN_MAX_FAILS };
