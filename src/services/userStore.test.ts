// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Role = 'admin' | 'finance' | 'viewer';
interface PinResult {
  ok: boolean;
  left?: number;
  locked?: true;
  noPin?: true;
  disabled?: true;
}
interface Store {
  admit(id: { sub: string; email: string }): Promise<{ sub: string; email: string; role: Role }>;
  list(): Promise<{ email: string; role: Role; disabled: boolean; registered: boolean; hasPin: boolean }[]>;
  add(u: { email: string; role: string }, actor?: string): Promise<void>;
  setRole(email: string, role: string, actor?: string): Promise<void>;
  log(): Promise<{ at: string; who: string; text: string }[]>;
  setDisabled(email: string, disabled: boolean, actor: string): Promise<void>;
  current(sub: string): Promise<{ email: string; role: Role; disabled: boolean } | null>;
  hasPin(sub: string): Promise<boolean>;
  setPin(sub: string, pin: string): Promise<void>;
  verifyPin(sub: string, pin: string): Promise<PinResult>;
}
const req = createRequire(import.meta.url);
const { createUserStore } = req('../../electron/userStore.cjs') as { createUserStore(o: { dir: string; now?: () => number }): Store };

const dir = () => mkdtempSync(join(tmpdir(), 'steward-users-'));
const mk = (d = dir()) => ({ d, s: createUserStore({ dir: d, now: () => Date.UTC(2026, 10, 24) }) });
const A = { sub: 'sub-a', email: 'Admin@Church.org' };
const B = { sub: 'sub-b', email: 'fin@church.org' };

/** 관리자 한 명이 로그인해 있는 상태에서 시작 */
async function withAdmin() {
  const m = mk();
  await m.s.admit(A);
  return m;
}

describe('계정 허용(admit)', () => {
  it('목록이 비어 있으면 처음 로그인한 사람이 관리자가 되고, 이메일은 소문자로 저장된다', async () => {
    const { s, d } = mk();
    expect(await s.admit(A)).toEqual({ sub: 'sub-a', email: 'admin@church.org', role: 'admin' });
    expect(readdirSync(d)).toEqual(['users.json']); // 임시 파일이 남지 않음
    expect(await s.list()).toMatchObject([{ email: 'admin@church.org', role: 'admin', registered: true, disabled: false, hasPin: false }]);
  });

  it('목록에 없는 계정은 거절하고 계정 목록은 그대로다(거절 기록만 늘어남)', async () => {
    const { s } = await withAdmin();
    const before = await s.list();
    await expect(s.admit(B)).rejects.toThrow('등록되지 않은 계정입니다');
    expect(await s.list()).toEqual(before);
  });

  it('사전 등록한 이메일은 첫 로그인에서 sub가 묶이고, 그 뒤에는 sub로 알아본다', async () => {
    const { s } = await withAdmin();
    await s.add({ email: 'FIN@church.org', role: 'finance' });
    expect((await s.list()).find((u) => u.email === 'fin@church.org')?.registered).toBe(false);
    expect(await s.admit(B)).toEqual({ sub: 'sub-b', email: 'fin@church.org', role: 'finance' });
    expect((await s.list()).find((u) => u.email === 'fin@church.org')?.registered).toBe(true);
    // 같은 이메일이어도 다른 sub(다른 구글 계정)는 이미 묶인 계정이 아니므로 거절
    await expect(s.admit({ sub: 'someone-else', email: 'fin@church.org' })).rejects.toThrow('등록되지 않은 계정');
  });

  it('구글 이메일이 바뀌어도 sub로 알아보고 표시만 고친다', async () => {
    const { s } = await withAdmin();
    expect(await s.admit({ sub: 'sub-a', email: 'new@church.org' })).toMatchObject({ email: 'new@church.org', role: 'admin' });
  });

  it('사용 중지된 계정은 거절한다', async () => {
    const { s } = await withAdmin();
    await s.add({ email: B.email, role: 'viewer' });
    await s.admit(B);
    await s.setDisabled(B.email, true, A.email);
    await expect(s.admit(B)).rejects.toThrow('사용이 중지된 계정');
    await s.setDisabled(B.email, false, A.email);
    await expect(s.admit(B)).resolves.toMatchObject({ role: 'viewer' });
  });

  it('목록 파일이 깨졌으면 빈 목록으로 보지 않고(아무나 관리자가 되지 않게) 거절한다', async () => {
    const { s, d } = mk();
    writeFileSync(join(d, 'users.json'), '{깨진');
    await expect(s.admit(A)).rejects.toThrow('계정 목록 파일을 읽을 수 없습니다');
    writeFileSync(join(d, 'users.json'), '{"users":"x"}');
    await expect(s.admit(A)).rejects.toThrow('계정 목록 파일을 읽을 수 없습니다');
    expect(readFileSync(join(d, 'users.json'), 'utf8')).toBe('{"users":"x"}'); // 덮어쓰지 않음
  });

  it('동시에 처음 로그인해도 관리자는 한 명만 생긴다', async () => {
    const { s } = mk();
    const r = await Promise.allSettled([s.admit(A), s.admit(B)]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await s.list()).toHaveLength(1);
  });
});

describe('계정 등록·역할 변경 규칙', () => {
  it('등록은 형식·역할·중복·빈 목록을 검사한다', async () => {
    const empty = mk().s;
    await expect(empty.add({ email: 'a@b.co', role: 'viewer' })).rejects.toThrow('먼저 로그인');
    const { s } = await withAdmin();
    await expect(s.add({ email: '이메일아님', role: 'viewer' })).rejects.toThrow('형식');
    await expect(s.add({ email: 'x@b.co', role: 'boss' })).rejects.toThrow('역할');
    await s.add({ email: 'x@b.co', role: 'viewer' });
    await expect(s.add({ email: 'X@B.co', role: 'viewer' })).rejects.toThrow('이미 등록');
  });

  it('계정은 최대 10명이다', async () => {
    const { s } = await withAdmin();
    for (let i = 1; i < 10; i++) await s.add({ email: `u${i}@b.co`, role: 'viewer' });
    await expect(s.add({ email: 'u10@b.co', role: 'viewer' })).rejects.toThrow('최대 10명');
  });

  it('관리자는 최대 2명이다(추가·승격 모두)', async () => {
    const { s } = await withAdmin();
    await s.add({ email: 'a2@b.co', role: 'admin' });
    await expect(s.add({ email: 'a3@b.co', role: 'admin' })).rejects.toThrow('최대 2명');
    await s.add({ email: 'f@b.co', role: 'finance' });
    await expect(s.setRole('f@b.co', 'admin')).rejects.toThrow('최대 2명');
  });

  it('관리자가 1명이면 내리거나 사용 중지할 수 없고, 2명이면 한 명을 내릴 수 있다(교체 = 추가 → 내리기)', async () => {
    const { s } = await withAdmin();
    await expect(s.setRole(A.email, 'viewer')).rejects.toThrow('마지막 관리자');
    await expect(s.setDisabled('admin@church.org', true, 'someone-else@x.co')).rejects.toThrow('마지막 관리자');
    await s.add({ email: 'a2@b.co', role: 'admin' });
    await s.setRole(A.email, 'finance'); // 2명 → 1명
    const roles = Object.fromEntries((await s.list()).map((u) => [u.email, u.role]));
    expect(roles).toEqual({ 'admin@church.org': 'finance', 'a2@b.co': 'admin' });
    await expect(s.setRole('a2@b.co', 'viewer')).rejects.toThrow('마지막 관리자');
  });

  it('자기 자신은 사용 중지할 수 없다', async () => {
    const { s } = await withAdmin();
    await s.add({ email: 'a2@b.co', role: 'admin' });
    await expect(s.setDisabled(A.email, true, 'ADMIN@church.org')).rejects.toThrow('자기 자신');
  });

  it('사용 중지한 관리자는 남은 활성 관리자 수에 세지 않는다', async () => {
    const { s } = await withAdmin();
    await s.add({ email: 'a2@b.co', role: 'admin' });
    await s.setDisabled('a2@b.co', true, A.email); // 활성 관리자 2 → 1
    await expect(s.setRole(A.email, 'viewer')).rejects.toThrow('마지막 관리자');
  });

  it('등록되지 않은 이메일을 고치려 하면 거절한다', async () => {
    const { s } = await withAdmin();
    await expect(s.setRole('none@b.co', 'viewer')).rejects.toThrow('등록되지 않은 이메일');
    await expect(s.setDisabled('none@b.co', true, A.email)).rejects.toThrow('등록되지 않은 이메일');
  });
});

describe('PIN', () => {
  it('6자리 숫자만 허용하고, 해시만 저장한다(PIN 값은 파일에 없음)', async () => {
    const { s, d } = await withAdmin();
    await expect(s.setPin('sub-a', '12345')).rejects.toThrow('숫자 6자리');
    await expect(s.setPin('sub-a', 'abcdef')).rejects.toThrow('숫자 6자리');
    await expect(s.setPin('nobody', '123456')).rejects.toThrow('로그인한 계정');
    expect(await s.hasPin('sub-a')).toBe(false);
    await s.setPin('sub-a', '123456');
    expect(await s.hasPin('sub-a')).toBe(true);
    expect(readFileSync(join(d, 'users.json'), 'utf8')).not.toContain('123456');
    expect((await s.list())[0].hasPin).toBe(true);
  });

  it('맞으면 통과, 틀리면 남은 횟수를 알려 주고, 맞으면 실패 횟수가 초기화된다', async () => {
    const { s } = await withAdmin();
    expect(await s.verifyPin('sub-a', '000000')).toEqual({ ok: false, noPin: true });
    await s.setPin('sub-a', '123456');
    expect(await s.verifyPin('sub-a', '123456')).toEqual({ ok: true });
    expect(await s.verifyPin('sub-a', '111111')).toEqual({ ok: false, left: 4 });
    expect(await s.verifyPin('sub-a', '111111')).toEqual({ ok: false, left: 3 });
    expect(await s.verifyPin('sub-a', '123456')).toEqual({ ok: true });
    expect(await s.verifyPin('sub-a', '111111')).toEqual({ ok: false, left: 4 });
  });

  it('5회 연속 실패하면 잠기고 PIN이 지워진다(올바른 PIN도 더는 안 됨, 재로그인 뒤 다시 만듦)', async () => {
    const { s } = await withAdmin();
    await s.setPin('sub-a', '123456');
    for (let i = 0; i < 4; i++) await s.verifyPin('sub-a', '999999');
    expect(await s.verifyPin('sub-a', '999999')).toEqual({ ok: false, locked: true });
    expect(await s.hasPin('sub-a')).toBe(false);
    expect(await s.verifyPin('sub-a', '123456')).toEqual({ ok: false, noPin: true });
    await s.admit(A); // 재로그인
    await s.setPin('sub-a', '654321');
    expect(await s.verifyPin('sub-a', '654321')).toEqual({ ok: true });
  });

  it('재로그인하면 실패 횟수가 초기화된다', async () => {
    const { s } = await withAdmin();
    await s.setPin('sub-a', '123456');
    for (let i = 0; i < 4; i++) await s.verifyPin('sub-a', '999999');
    await s.admit(A);
    expect(await s.verifyPin('sub-a', '999999')).toEqual({ ok: false, left: 4 });
  });

  it('PIN은 계정별이라 다른 계정의 PIN으로는 통과하지 못한다', async () => {
    const { s } = await withAdmin();
    await s.add({ email: B.email, role: 'finance' });
    await s.admit(B);
    await s.setPin('sub-a', '123456');
    expect(await s.verifyPin('sub-b', '123456')).toEqual({ ok: false, noPin: true });
  });
});

describe('로그인·계정 변경 기록', () => {
  it('로그인·등록·역할 변경·사용 중지를 사람과 함께 남기고, 토큰·PIN은 적지 않는다', async () => {
    const { s, d } = mk();
    await s.admit(A);
    await s.add({ email: 'fin@church.org', role: 'finance' }, A.email);
    await s.setRole('fin@church.org', 'viewer', A.email);
    await s.setDisabled('fin@church.org', true, A.email);
    await s.setPin(A.sub, '123456');
    const log = await s.log();
    expect(log.map((l) => l.text)).toEqual(['로그인(처음 관리자로 등록)', 'fin@church.org 등록(finance)', 'fin@church.org 역할 변경(finance → viewer)', 'fin@church.org 사용 중지']);
    expect(log[1].who).toBe('admin@church.org');
    expect(log[0].at).toBe(new Date(Date.UTC(2026, 10, 24)).toISOString());
    expect(readFileSync(join(d, 'users.json'), 'utf8')).not.toContain('123456');
  });

  it('기록은 최근 100건만 남는다', async () => {
    const { s } = mk();
    await s.admit(A);
    for (let i = 0; i < 105; i++) await s.admit(A);
    expect(await s.log()).toHaveLength(100);
  });

  it('기록이 없는 예전 파일도 읽고 계정 목록은 그대로다', async () => {
    const { s, d } = mk();
    writeFileSync(join(d, 'users.json'), JSON.stringify({ version: 1, users: [{ sub: 'x', email: 'x@y.co', role: 'admin', addedAt: '2026-01-01', disabled: false, pin: null }] }));
    expect(await s.log()).toEqual([]);
    expect((await s.list()).map((u) => u.email)).toEqual(['x@y.co']);
  });
});

describe('거절된 로그인 기록', () => {
  it('등록되지 않은 계정과 사용 중지된 계정의 로그인 시도도 기록에 남는다', async () => {
    const { s } = mk();
    await s.admit(A);
    await expect(s.admit(B)).rejects.toThrow('등록되지 않은 계정');
    await s.add({ email: B.email, role: 'viewer' }, A.email);
    await s.admit(B);
    await s.setDisabled(B.email, true, A.email);
    await expect(s.admit(B)).rejects.toThrow('사용이 중지된 계정');
    const texts = (await s.log()).map((l) => l.text);
    expect(texts).toContain('로그인 거절(등록되지 않은 계정)');
    expect(texts).toContain('로그인 거절(사용 중지된 계정)');
  });
});

describe('로그인 중인 계정의 현재 상태', () => {
  it('current는 역할 변경·사용 중지를 바로 보여 주고, 목록에서 없는 sub는 null이다', async () => {
    const { s } = mk();
    await s.admit(A);
    await s.add({ email: B.email, role: 'finance' }, A.email);
    await s.admit(B);
    expect(await s.current(B.sub)).toEqual({ email: 'fin@church.org', role: 'finance', disabled: false });
    await s.setRole(B.email, 'viewer', A.email);
    await s.setDisabled(B.email, true, A.email);
    expect(await s.current(B.sub)).toMatchObject({ role: 'viewer', disabled: true });
    expect(await s.current('nobody')).toBeNull();
  });

  it('사용 중지된 계정은 PIN이 있어도 확인되지 않는다', async () => {
    const { s } = mk();
    await s.admit(A);
    await s.add({ email: B.email, role: 'finance' }, A.email);
    await s.admit(B);
    await s.setPin(B.sub, '123456');
    expect((await s.verifyPin(B.sub, '123456')).ok).toBe(true);
    await s.setDisabled(B.email, true, A.email);
    expect(await s.verifyPin(B.sub, '123456')).toEqual({ ok: false, disabled: true });
  });
});

describe('거절 기록을 쓰지 못해도', () => {
  it('원래의 거절 사유가 그대로 나온다', async () => {
    const { s, d } = mk();
    await s.admit(A);
    mkdirSync(join(d, 'users.json.tmp')); // 임시 파일을 만들 수 없게 해 쓰기를 실패시킴
    await expect(s.admit(B)).rejects.toThrow('등록되지 않은 계정입니다');
  });
});
