// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YearLockSection } from '../components/pages/settings/YearLockSection';
import { setCurrentUser } from '../services/auth/currentUser';
import type { Role } from '../services/auth/roles';
import { resetAllData } from '../services/backup/backupService';
import type { DesktopApi } from '../services/desktopBridge';
import { getItem, monthWrite, readMonth, transact } from '../services/storage/storageService';
import { DonationProvider, useDonationActions } from './DonationContext';
import { SettingsProvider, useSettingsActions } from './SettingsContext';
import type { AuditLog, Donation, DonationDraft } from './types';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>
    <DonationProvider>{children}</DonationProvider>
  </SettingsProvider>
);
const setup = () => renderHook(() => ({ d: useDonationActions(), s: useSettingsActions() }), { wrapper });

const don = (id: string, date: string): Donation => ({ id, date, memberId: 'm1', donorDisplayName: '홍길동', familyGroupIdSnapshot: null, offeringTypeId: 't1', amount: 1000, createdAt: '2025-01-01T00:00:00.000Z' });
const draft = (date: string): DonationDraft => ({ date, memberId: 'm1', donorDisplayName: '홍길동', familyGroupIdSnapshot: null, offeringTypeId: 't1', amount: 500 });
const login = (role: Role) => {
  window.desktop = new Proxy({}, { get: () => async () => null }) as DesktopApi;
  setCurrentUser({ email: 'me@b.c', role });
};
const audits = async (year: string) => (await getItem<AuditLog[]>(`audit_logs_${year}`)) ?? [];

beforeEach(async () => {
  await resetAllData();
  // 설정(잠긴 연도)은 초기화해도 남으므로 지우고, 시험 자료는 잠금 검사를 건너뛰어 넣습니다.
  await transact(async () => ({ writes: [{ key: 'settings', value: null }, monthWrite('2025-01', [don('a', '2025-01-05')]), monthWrite('2025-02', [don('b', '2025-02-02'), don('c', '2025-02-09')]), monthWrite('2026-01', [don('d', '2026-01-04')])], result: 0 }), { ignoreYearLocks: true });
});
afterEach(() => {
  delete window.desktop;
  setCurrentUser(null);
});

describe('연도 잠금', () => {
  it('잠긴 연도는 입력·수정·삭제가 막히고, 다른 연도는 그대로 된다', async () => {
    const { result } = setup();
    await act(() => result.current.s.update({ lockedYears: ['2025'] }));
    await expect(result.current.d.saveBatch([draft('2025-03-02')], 'MERGE')).rejects.toThrow('2025년은 잠겨');
    await expect(result.current.d.updateDonation(don('a', '2025-01-05'), { ...don('a', '2025-01-05'), amount: 9 }, '금액 정정')).rejects.toThrow('잠겨');
    await expect(result.current.d.deleteDonation(don('a', '2025-01-05'), '잘못 입력')).rejects.toThrow('잠겨');
    expect(await readMonth('2025-01')).toHaveLength(1);
    await act(() => result.current.d.saveBatch([draft('2026-03-01')], 'MERGE').then(() => undefined)); // 열린 연도
    expect(await readMonth('2026-03')).toHaveLength(1);
  });

  it('잠금을 풀면 다시 고칠 수 있다', async () => {
    const { result } = setup();
    await act(() => result.current.s.update({ lockedYears: ['2025'] }));
    await act(() => result.current.s.update({ lockedYears: [] }));
    await act(() => result.current.d.deleteDonation(don('a', '2025-01-05'), '잘못 입력').then(() => undefined));
    expect(await readMonth('2025-01')).toHaveLength(0);
  });

  it('재정담당은 잠글 수 있지만 풀 수는 없고, 열람자는 둘 다 못 한다', async () => {
    const { result } = setup();
    login('finance');
    await act(() => result.current.s.update({ lockedYears: ['2025'] }));
    await expect(result.current.s.update({ lockedYears: [] })).rejects.toThrow('권한');
    login('viewer');
    await expect(result.current.s.update({ lockedYears: ['2025', '2026'] })).rejects.toThrow('권한');
    login('admin');
    await act(() => result.current.s.update({ lockedYears: [] }));
  });

  it('테마 같은 다른 설정은 잠금 권한과 상관없이 바뀐다(열람자도)', async () => {
    const { result } = setup();
    login('viewer');
    await act(() => result.current.s.update({ theme: 'DARK' }));
  });

  it('[잠그기]를 연달아 눌러도 앞서 잠근 연도가 풀리지 않는다', async () => {
    render(<YearLockSection />, { wrapper });
    const buttons = await screen.findAllByRole('button', { name: '잠그기' });
    expect(buttons).toHaveLength(2); // 2026, 2025
    // 첫 저장이 끝나기 전에 두 번째를 누릅니다(화면의 잠금 목록은 아직 비어 있음).
    await act(async () => {
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
    });
    await waitFor(async () => expect((await getItem<{ lockedYears: string[] }>('settings'))?.lockedYears).toEqual(['2025', '2026']));
  });
});

describe('기간 헌금 삭제', () => {
  it('관리자는 달 범위의 헌금을 모두 지우고 건마다 사유·작업자 이력을 남긴다(다른 달은 그대로)', async () => {
    const { result } = setup();
    login('admin');
    let n = 0;
    await act(async () => {
      n = await result.current.d.deletePeriod('2025-01', '2025-02', '정리 목적 삭제');
    });
    expect(n).toBe(3);
    expect(await readMonth('2025-01')).toHaveLength(0);
    expect(await readMonth('2025-02')).toHaveLength(0);
    expect(await readMonth('2026-01')).toHaveLength(1);
    const logs = await audits('2025');
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.action === 'DELETE' && l.reason === '정리 목적 삭제' && l.actor === 'me@b.c' && l.afterSnapshot === null)).toBe(true);
  });

  it('재정담당·열람자는 지울 수 없다', async () => {
    const { result } = setup();
    for (const r of ['finance', 'viewer'] as const) {
      login(r);
      await expect(result.current.d.deletePeriod('2025-01', '2025-02', '정리 목적 삭제')).rejects.toThrow('권한');
    }
    expect(await readMonth('2025-02')).toHaveLength(2);
  });

  it('잠긴 연도가 범위에 있으면 아무것도 지우기 전에 거절한다', async () => {
    const { result } = setup();
    await act(() => result.current.s.update({ lockedYears: ['2026'] }));
    await expect(result.current.d.deletePeriod('2025-12', '2026-01', '정리 목적 삭제')).rejects.toThrow('2026년은 잠겨');
    expect(await readMonth('2026-01')).toHaveLength(1);
  });

  it('사유가 부족하거나 달 범위가 잘못되면 거절한다', async () => {
    const { result } = setup();
    await expect(result.current.d.deletePeriod('2025-01', '2025-02', 'ab')).rejects.toThrow('한글');
    await expect(result.current.d.deletePeriod('2025-02', '2025-01', '정리 목적 삭제')).rejects.toThrow('끝 달');
    await expect(result.current.d.deletePeriod('2025', '2025-01', '정리 목적 삭제')).rejects.toThrow('YYYY-MM');
    expect(await readMonth('2025-02')).toHaveLength(2);
  });
});

describe('잠금은 기본으로 켜져 있다', () => {
  it('옵션을 주지 않은 새 쓰기 길목도 잠긴 연도에는 쓰지 못하고, 건너뛰기를 명시해야만 쓴다', async () => {
    const { result } = setup();
    await act(() => result.current.s.update({ lockedYears: ['2025'] }));
    const put = (): Promise<unknown> => transact(async () => ({ writes: [monthWrite('2025-05', [don('z', '2025-05-01')])], result: 0 }));
    await expect(put()).rejects.toThrow('2025년은 잠겨');
    await transact(async () => ({ writes: [monthWrite('2025-05', [don('z', '2025-05-01')])], result: 0 }), { ignoreYearLocks: true });
    expect(await readMonth('2025-05')).toHaveLength(1);
  });
});
