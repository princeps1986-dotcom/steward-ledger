// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);
interface Claims {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  auth_time?: number;
}
interface Identity {
  sub: string;
  email: string;
}
const { verifyIdToken } = req('../../electron/idToken.cjs') as {
  verifyIdToken(t: string, o: { keys: unknown[]; clientId: string; nonce: string; now?: number; minAuthTime?: number }): Identity;
};
interface Admitted extends Identity {
  role: string;
}
interface Auth {
  login(o?: { reauth?: boolean }): Promise<Admitted>;
  cancel(): void;
  logout(): void;
  session(): Admitted | null;
  status(): { configured: boolean; email: string | null; role: string | null };
}
const { createAuth } = req('../../electron/auth.cjs') as {
  createAuth(o: { clientId: string; clientSecret?: string; openBrowser(u: string): Promise<void>; admit(id: Identity): Promise<Admitted>; fetch: typeof fetch; now?: () => number; timeoutMs?: number }): Auth;
};
const { createDataKeyStore } = req('../../electron/dataKey.cjs') as {
  createDataKeyStore(o: { safeStorage: FakeSafeStorage; dir: string; log: { warn(...a: unknown[]): void }; stamp(): string }): { getDataKey(): Promise<Buffer>; replaceUnreadable(): Promise<Buffer> };
};

const CLIENT = 'test-client.apps.googleusercontent.com';
const NOW = 1_800_000_000_000; // 고정 시각(ms)
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function jwt(claims: Claims, o: { alg?: string; kid?: string; key?: typeof privateKey } = {}) {
  const head = b64({ alg: o.alg ?? 'RS256', kid: o.kid ?? 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = o.alg === 'none' ? '' : sign('RSA-SHA256', Buffer.from(`${head}.${body}`), o.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const good = (nonce: string, over: Claims = {}): Claims => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  sub: '1077',
  email: 'Pastor@Example.com',
  email_verified: true,
  nonce,
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3000,
  ...over,
});

describe('ID 토큰 검증(electron/idToken.cjs)', () => {
  const opts = { keys: [jwk], clientId: CLIENT, nonce: 'n1', now: NOW };
  it('정상 토큰은 sub와 소문자 이메일을 돌려준다(email_verified는 "true" 문자열도 허용)', () => {
    expect(verifyIdToken(jwt(good('n1')), opts)).toEqual({ sub: '1077', email: 'pastor@example.com' });
    expect(verifyIdToken(jwt(good('n1', { email_verified: 'true' })), opts).sub).toBe('1077');
    expect(verifyIdToken(jwt(good('n1', { iss: 'accounts.google.com' })), opts).sub).toBe('1077');
  });
  it.each([
    ['발급자 불일치', good('n1', { iss: 'https://evil.example' })],
    ['대상(aud) 불일치', good('n1', { aud: 'other-client' })],
    ['만료', good('n1', { exp: NOW / 1000 - 120 })],
    ['미래에 발급', good('n1', { iat: NOW / 1000 + 600 })],
    ['nonce 불일치', good('other-nonce')],
    ['이메일 미확인', good('n1', { email_verified: false })],
    ['이메일 없음', good('n1', { email: undefined })],
    ['sub 없음', good('n1', { sub: '' })],
  ])('거절: %s', (_name, claims) => {
    expect(() => verifyIdToken(jwt(claims), opts)).toThrow('로그인 확인 실패');
  });
  it('거절: 다른 키로 서명 · 모르는 kid · alg none · 깨진 토큰', () => {
    expect(() => verifyIdToken(jwt(good('n1'), { key: other.privateKey }), opts)).toThrow('서명');
    expect(() => verifyIdToken(jwt(good('n1'), { kid: 'zzz' }), opts)).toThrow('서명 키');
    expect(() => verifyIdToken(jwt(good('n1'), { alg: 'none' }), opts)).toThrow('서명 방식');
    expect(() => verifyIdToken('abc', opts)).toThrow('형식');
    expect(() => verifyIdToken(jwt(good('n1')), { ...opts, nonce: '' })).toThrow('요청과 맞지 않는');
  });
});

/** 브라우저 대신 redirect_uri로 응답을 보내는 가짜 로그인: 요청 주소를 검사하고, 받은 nonce로 ID 토큰을 만든다. */
const admitAll = async (id: Identity): Promise<Admitted> => ({ ...id, role: 'admin' });
function harness(o: { admit?: (id: Identity) => Promise<Admitted>; mutate?: (q: URLSearchParams) => void; claims?: (nonce: string) => Claims; tokenStatus?: number; timeoutMs?: number; noRedirect?: boolean } = {}) {
  const seen: { authUrl?: URL; tokenBody?: URLSearchParams; redirect?: string } = {};
  const sendBack = (q: URLSearchParams, base: string) =>
    new Promise<number>((resolve) => get(`${base}/?${q}`, (r) => (r.resume(), resolve(r.statusCode ?? 0))));
  const openBrowser = async (url: string) => {
    const u = new URL(url);
    seen.authUrl = u;
    seen.redirect = u.searchParams.get('redirect_uri') ?? '';
    if (o.noRedirect) return;
    const q = new URLSearchParams({ code: 'CODE1', state: u.searchParams.get('state') ?? '' });
    o.mutate?.(q);
    setTimeout(() => void sendBack(q, seen.redirect!), 0);
  };
  const fetchFn = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes('/token')) {
      seen.tokenBody = new URLSearchParams(init?.body);
      const nonce = seen.authUrl?.searchParams.get('nonce') ?? '';
      return { ok: (o.tokenStatus ?? 200) < 400, status: o.tokenStatus ?? 200, json: async () => ({ id_token: jwt((o.claims ?? good)(nonce)), access_token: 'AT', refresh_token: 'RT' }) };
    }
    return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
  });
  const auth = createAuth({ clientId: CLIENT, clientSecret: 'shh', openBrowser, admit: o.admit ?? admitAll, fetch: fetchFn as unknown as typeof fetch, now: () => NOW, timeoutMs: o.timeoutMs ?? 5000 });
  return { auth, seen, fetchFn, sendBack };
}

describe('구글 로그인 흐름(electron/auth.cjs)', () => {
  it('PKCE·state·nonce를 담아 브라우저를 열고, 코드를 받아 계정을 확인한다(토큰은 저장하지 않음)', async () => {
    const h = harness();
    expect(h.auth.status()).toEqual({ configured: true, email: null, role: null });
    const who = await h.auth.login();
    expect(who).toEqual({ sub: '1077', email: 'pastor@example.com', role: 'admin' });
    expect(h.auth.session()).toEqual(who);
    expect(h.auth.status().email).toBe('pastor@example.com');

    const q = h.seen.authUrl!;
    expect(q.origin + q.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(q.searchParams.get('code_challenge_method')).toBe('S256');
    expect(q.searchParams.get('response_type')).toBe('code');
    expect(q.searchParams.get('scope')).toBe('openid email');
    expect(h.seen.redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const t = h.seen.tokenBody!;
    expect(t.get('grant_type')).toBe('authorization_code');
    expect(t.get('code')).toBe('CODE1');
    expect(t.get('redirect_uri')).toBe(h.seen.redirect);
    expect(t.get('client_secret')).toBe('shh');
    // code_verifier의 SHA-256(base64url)이 요청 때의 code_challenge와 같다
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(t.get('code_verifier')!).digest('base64url')).toBe(q.searchParams.get('code_challenge'));
    expect(JSON.stringify(h.auth.session())).not.toMatch(/AT|RT/);
  });

  it('로그아웃하면 계정이 사라진다', async () => {
    const h = harness();
    await h.auth.login();
    h.auth.logout();
    expect(h.auth.session()).toBeNull();
  });

  it('state가 다른 요청은 무시하고 계속 기다린다(다른 프로그램의 접속으로 로그인이 깨지지 않음)', async () => {
    const h = harness({ noRedirect: true });
    const p = h.auth.login();
    await vi.waitFor(() => expect(h.seen.redirect).toBeTruthy());
    expect(await h.sendBack(new URLSearchParams({ code: 'EVIL', state: 'wrong' }), h.seen.redirect!)).toBe(404);
    await h.sendBack(new URLSearchParams({ code: 'CODE1', state: h.seen.authUrl!.searchParams.get('state')! }), h.seen.redirect!);
    await expect(p).resolves.toMatchObject({ sub: '1077' });
    expect(h.seen.tokenBody!.get('code')).toBe('CODE1');
  });

  it('사용자가 취소하면(access_denied) 안내 문구로 실패한다', async () => {
    const h = harness({ mutate: (q) => (q.delete('code'), q.set('error', 'access_denied')) });
    await expect(h.auth.login()).rejects.toThrow('로그인을 취소했습니다.');
    expect(h.auth.session()).toBeNull();
  });

  it('시간 안에 응답이 없으면 실패한다', async () => {
    const h = harness({ noRedirect: true, timeoutMs: 50 });
    await expect(h.auth.login()).rejects.toThrow('시간이 지났습니다');
  });

  it('기다리는 중에 취소하면 바로 끝나고, 다시 로그인할 수 있다', async () => {
    const h = harness({ noRedirect: true });
    const p = h.auth.login();
    await vi.waitFor(() => expect(h.seen.redirect).toBeTruthy());
    h.auth.cancel();
    await expect(p).rejects.toThrow('로그인을 취소했습니다.');
    h.auth.cancel(); // 기다리는 로그인이 없을 때 불러도 아무 일 없음
    await expect(harness().auth.login()).resolves.toMatchObject({ sub: '1077' });
  });

  it('인터넷이 끊겨 구글에 닿지 못하면 안내 문구로 실패한다', async () => {
    const h = harness();
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const auth = createAuth({ clientId: CLIENT, admit: admitAll, openBrowser: async (u) => void setTimeout(() => void h.sendBack(new URLSearchParams({ code: 'C', state: new URL(u).searchParams.get('state')! }), new URL(u).searchParams.get('redirect_uri')!), 0), fetch: offline as unknown as typeof fetch });
    await expect(auth.login()).rejects.toThrow('인터넷에 연결할 수 없습니다');
    expect(auth.session()).toBeNull();
  });

  it('토큰 교환 실패·검증 실패(nonce 불일치)는 계정을 남기지 않는다', async () => {
    await expect(harness({ tokenStatus: 400 }).auth.login()).rejects.toThrow('로그인 확인에 실패했습니다(400)');
    const h = harness({ claims: () => good('엉뚱한-nonce') });
    await expect(h.auth.login()).rejects.toThrow('로그인 확인 실패');
    expect(h.auth.session()).toBeNull();
  });

  it('로그인 중에 또 눌러도 한 번만 진행하고, 끝나면 다시 로그인할 수 있다', async () => {
    const h = harness();
    const [a, b] = [h.auth.login(), h.auth.login()];
    expect(a).toBe(b);
    await a;
    await expect(h.auth.login()).resolves.toMatchObject({ sub: '1077' });
  });

  it('등록되지 않은 계정이라고 거절되면 로그인이 실패하고 계정을 남기지 않는다', async () => {
    const h = harness({ admit: async () => Promise.reject(new Error('등록되지 않은 계정입니다.')) });
    await expect(h.auth.login()).rejects.toThrow('등록되지 않은 계정입니다.');
    expect(h.auth.session()).toBeNull();
  });

  it('이미 로그인한 상태에서 다시 로그인하다 거절되면 이전 로그인도 사라진다', async () => {
    let reject = false;
    const h = harness({ admit: async (id) => (reject ? Promise.reject(new Error('사용이 중지된 계정입니다.')) : { ...id, role: 'admin' }) });
    await h.auth.login();
    expect(h.auth.session()).not.toBeNull();
    reject = true;
    await expect(h.auth.login()).rejects.toThrow('사용이 중지된 계정');
    expect(h.auth.session()).toBeNull();
    expect(h.auth.status()).toMatchObject({ email: null, role: null });
  });

  it('클라이언트 ID가 없으면 브라우저를 열지 않고 안내한다', async () => {
    const openBrowser = vi.fn();
    const auth = createAuth({ clientId: '', admit: admitAll, openBrowser, fetch: vi.fn() as unknown as typeof fetch });
    expect(auth.status().configured).toBe(false);
    await expect(auth.login()).rejects.toThrow('클라이언트 ID');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});

interface FakeSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(t: string): Promise<Buffer>;
  decryptStringAsync(b: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
const PREFIX = 'ENC:';
function fakeStorage() {
  const state = { available: true, reEncrypt: false };
  const storage: FakeSafeStorage = {
    isAsyncEncryptionAvailable: async () => state.available,
    encryptStringAsync: async (t) => Buffer.from(PREFIX + t),
    decryptStringAsync: async (b) => {
      const s = b.toString();
      if (!s.startsWith(PREFIX)) throw new Error('decrypt 실패');
      return { result: s.slice(PREFIX.length), shouldReEncrypt: state.reEncrypt };
    },
  };
  return { storage, state };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'steward-datakey-'));
const store = (dir: string, storage: FakeSafeStorage) => createDataKeyStore({ safeStorage: storage, dir, log: { warn: vi.fn() }, stamp: () => '20261124_000000' });

describe('데이터 열쇠(electron/dataKey.cjs)', () => {
  it('처음에는 만들어 잠가 두고, 다시 열면 같은 열쇠를 쓴다(임시 파일 없음)', async () => {
    const dir = tmp();
    const { storage } = fakeStorage();
    const a = await store(dir, storage).getDataKey();
    expect(a).toHaveLength(32);
    expect(readdirSync(dir)).toEqual(['data-key.bin']);
    expect(readFileSync(join(dir, 'data-key.bin')).toString().startsWith(PREFIX)).toBe(true);
    expect((await store(dir, storage).getDataKey()).equals(a)).toBe(true);
  });

  it('동시에 불러도 열쇠는 하나만 만든다', async () => {
    const s = store(tmp(), fakeStorage().storage);
    const [a, b] = await Promise.all([s.getDataKey(), s.getDataKey()]);
    expect(a.equals(b)).toBe(true);
  });

  it('풀 수 없으면 새로 만들지 않고 오류를 던지며 파일을 그대로 둔다', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'data-key.bin'), 'other-pc-garbage');
    await expect(store(dir, fakeStorage().storage).getDataKey()).rejects.toMatchObject({ code: 'DATA_KEY_UNREADABLE' });
    expect(readdirSync(dir)).toEqual(['data-key.bin']);
    expect(readFileSync(join(dir, 'data-key.bin'), 'utf8')).toBe('other-pc-garbage');
  });

  it('replaceUnreadable: 풀 수 없는 열쇠는 .old로 남기고 새로 만들고, 멀쩡한 열쇠는 그대로 둔다', async () => {
    const dir = tmp();
    const { storage } = fakeStorage();
    const good = await store(dir, storage).getDataKey();
    expect((await store(dir, storage).replaceUnreadable()).equals(good)).toBe(true); // 멀쩡하면 바꾸지 않음
    expect(readdirSync(dir)).toEqual(['data-key.bin']);

    writeFileSync(join(dir, 'data-key.bin'), 'other-pc-garbage');
    const s = store(dir, storage);
    await expect(s.getDataKey()).rejects.toMatchObject({ code: 'DATA_KEY_UNREADABLE' });
    const fresh = await s.replaceUnreadable();
    expect(fresh).toHaveLength(32);
    expect(fresh.equals(good)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['data-key.bin', 'data-key.bin.20261124_000000.old']);
    expect(readFileSync(join(dir, 'data-key.bin.20261124_000000.old'), 'utf8')).toBe('other-pc-garbage');
    expect((await store(dir, storage).getDataKey()).equals(fresh)).toBe(true);
  });

  it('길이가 틀린 열쇠도 풀 수 없는 것으로 본다', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'data-key.bin'), PREFIX + Buffer.from('short').toString('base64'));
    await expect(store(dir, fakeStorage().storage).getDataKey()).rejects.toMatchObject({ code: 'DATA_KEY_UNREADABLE' });
  });

  it('보안 저장소를 쓸 수 없으면 열쇠를 만들지 않는다', async () => {
    const dir = tmp();
    const { storage, state } = fakeStorage();
    state.available = false;
    await expect(store(dir, storage).getDataKey()).rejects.toMatchObject({ code: 'DATA_KEY_UNAVAILABLE' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('운영체제가 다시 잠그라고 하면 같은 열쇠를 새로 잠근다', async () => {
    const dir = tmp();
    const { storage, state } = fakeStorage();
    const a = await store(dir, storage).getDataKey();
    state.reEncrypt = true;
    expect((await store(dir, storage).getDataKey()).equals(a)).toBe(true);
  });
});

describe('재로그인(잠금 해제용)', () => {
  const fresh = (nonce: string) => good(nonce, { auth_time: NOW / 1000 });

  it('일반 로그인은 비밀번호를 다시 묻지 않지만, 재로그인은 prompt=login·max_age=0을 붙인다', async () => {
    const a = harness();
    await a.auth.login();
    expect(a.seen.authUrl!.searchParams.get('prompt')).toBeNull();
    const b = harness({ claims: fresh });
    await b.auth.login({ reauth: true });
    expect(b.seen.authUrl!.searchParams.get('prompt')).toBe('login');
    expect(b.seen.authUrl!.searchParams.get('max_age')).toBe('0');
  });

  it('방금 인증하지 않은 토큰(auth_time 없음·오래됨)은 거절하고, 이전 로그인은 그대로 둔다', async () => {
    const h = harness({ claims: (n) => good(n, { auth_time: NOW / 1000 - 3600 }) });
    await expect(h.auth.login({ reauth: true })).rejects.toThrow('방금 다시 인증');
    const h2 = harness();
    await h2.auth.login();
    const before = h2.auth.session();
    const h3 = harness({ claims: (n) => good(n) });
    await expect(h3.auth.login({ reauth: true })).rejects.toThrow('방금 다시 인증');
    expect(h2.auth.session()).toEqual(before);
  });

  it('idToken: minAuthTime이 있으면 auth_time이 그 시각 직전(여유 60초) 이후여야 한다', () => {
    const opts = { keys: [jwk], clientId: CLIENT, nonce: 'n1', now: NOW };
    expect(() => verifyIdToken(jwt(good('n1')), { ...opts, minAuthTime: NOW / 1000 })).toThrow('방금 다시 인증');
    expect(verifyIdToken(jwt(good('n1', { auth_time: NOW / 1000 - 30 })), { ...opts, minAuthTime: NOW / 1000 }).sub).toBe('1077');
    expect(() => verifyIdToken(jwt(good('n1', { auth_time: NOW / 1000 - 600 })), { ...opts, minAuthTime: NOW / 1000 })).toThrow('방금 다시 인증');
  });

  it('다른 방식의 로그인이 진행 중일 때 재로그인이 끼어들지 못한다', async () => {
    const h = harness({ noRedirect: true });
    const p = h.auth.login();
    await expect(h.auth.login({ reauth: true })).rejects.toThrow('다른 로그인이 진행 중');
    h.auth.cancel();
    await expect(p).rejects.toThrow('취소');
  });
});
