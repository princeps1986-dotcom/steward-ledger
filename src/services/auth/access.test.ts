// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation } from '../../contexts/types';
import { resetAllData, replaceAllData } from '../backup/backupService';
import { restoreFromFile } from '../backup/streamRestore';
import { createDemoData, removeDemoData } from '../demo/demoService';
import { db } from '../storage/db';
import { KEYS, readMonth, rowWrite, transact } from '../storage/storageService';
import { allowed, assertAllowed, currentRole, NOT_ALLOWED } from './access';
import { setCurrentUser } from './currentUser';
import type { Role } from './roles';

const don = (id: string): Donation => ({ id, date: '2026-03-01', memberId: 'm1', donorDisplayName: '홍길동', offeringTypeId: 't1', amount: 1000, createdAt: `c${id}` });
const write = () => transact(async () => ({ writes: [rowWrite('2026-03', { puts: [don('a')], deletes: [] })], result: null }));
const asDesktop = (role: Role | null) => {
  vi.stubGlobal('window', { desktop: {} });
  setCurrentUser(role ? { email: 'a@b.c', role } : null);
};

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await db.audits.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentUser(null);
});

describe('역할 판단(access)', () => {
  it('로그인이 없는 브라우저(시연) 모드는 모든 작업이 열려 있다', () => {
    expect(currentRole()).toBe('admin');
    expect(allowed('data:reset')).toBe(true);
    expect(() => assertAllowed('accounts:manage')).not.toThrow();
  });

  it('PC앱은 로그인한 역할을 따르고, 로그인 전(역할 없음)에는 모두 거절한다', () => {
    asDesktop(null);
    expect(currentRole()).toBeNull();
    expect(allowed('report:summary')).toBe(false);
    asDesktop('viewer');
    expect(currentRole()).toBe('viewer');
    expect(allowed('report:summary')).toBe(true);
    expect(() => assertAllowed('donation:write')).toThrow(NOT_ALLOWED);
  });
});

describe('쓰기 길목의 역할 확인', () => {
  it('열람자는 헌금·성도 쓰기가 저장되지 않는다(화면을 우회해도)', async () => {
    asDesktop('viewer');
    await expect(write()).rejects.toThrow(NOT_ALLOWED);
    await expect(transact(async () => ({ writes: [{ key: KEYS.members, value: [] }], result: null }))).rejects.toThrow(NOT_ALLOWED);
    expect(await db.donations.count()).toBe(0);
  });

  it('열람자도 설정(화면 테마)은 저장할 수 있다', async () => {
    asDesktop('viewer');
    await transact(async () => ({ writes: [{ key: KEYS.settings, value: { theme: 'DARK' } }], result: null }));
    expect(await db.kv.get(KEYS.settings)).toEqual({ theme: 'DARK' });
  });

  it('로그인 전(역할 없음)에는 어떤 데이터 쓰기도 거절한다', async () => {
    asDesktop(null);
    await expect(write()).rejects.toThrow(NOT_ALLOWED);
  });

  it.each<Role>(['admin', 'finance'])('%s는 헌금을 저장할 수 있다', async (role) => {
    asDesktop(role);
    await write();
    expect((await readMonth('2026-03')).map((d) => d.id)).toEqual(['a']);
  });
});

describe('복원·초기화·시연 데이터는 관리자만', () => {
  it.each<Role>(['finance', 'viewer'])('%s는 전체 초기화·전체 복원·연도 복원·시연 생성/제거가 모두 거절된다', async (role) => {
    asDesktop('admin');
    await write(); // 관리자가 넣어 둔 데이터가 지워지지 않는지 확인용
    asDesktop(role);
    await expect(resetAllData()).rejects.toThrow(NOT_ALLOWED);
    await expect(replaceAllData({ members: [], offeringTypes: [], donationsByYear: {}, auditLogsByYear: {} })).rejects.toThrow(NOT_ALLOWED);
    expect(() => restoreFromFile({} as never, {} as never, ['2026'])).toThrow(NOT_ALLOWED);
    await expect(createDemoData()).rejects.toThrow(NOT_ALLOWED);
    await expect(removeDemoData()).rejects.toThrow(NOT_ALLOWED);
    expect(await db.donations.count()).toBe(1);
  });

  it('관리자는 전체 초기화를 할 수 있다', async () => {
    asDesktop('admin');
    await write();
    await resetAllData();
    expect(await db.donations.count()).toBe(0);
  });
});
