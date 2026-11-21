// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation } from '../contexts/types';
import { AppProviders } from '../contexts/AppProviders';
import { useSettings, useSettingsActions, useSettingsSelector } from '../contexts/SettingsContext';
import type { DesktopApi } from '../services/desktopBridge';
import { db } from '../services/storage/db';
import { KEYS } from '../services/storage/keys';
import { monthWrite, transact } from '../services/storage/storageService';
import { useAutoBackupBridge } from './useAppShell';

type Status = { ok: boolean; at: string; error?: string } | null;

/** 화면 쪽에서 쓰는 main API만 흉내 냅니다. 지난 종료 백업 결과는 status로 정하고, 백업 세션은 줄을 버립니다. */
function stubDesktop(status: Promise<Status>) {
  const api = {
    onBackupRequest: () => () => undefined,
    onBackupCancelled: () => () => undefined,
    getAutoBackupStatus: () => status,
    ackAutoBackupStatus: async () => undefined,
    backupBegin: async () => 1,
    backupWrite: async () => true,
    backupRestart: async () => 1,
    backupAbort: async () => true,
    backupEnd: async () => 'C:/x/autosave.slbk',
  } as unknown as DesktopApi;
  Object.assign(window, { desktop: api });
}

/** 10분 주기 백업의 콜백을 잡아 두었다가 바로 부릅니다(실제로 10분을 기다리지 않음). */
function captureInterval(): () => void {
  let cb: (() => void) | null = null;
  vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void) => ((cb = fn), 1)) as typeof window.setInterval);
  return () => cb!();
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(ok()).toBe(true);
};

const render = () =>
  renderHook(() => ({ bridge: useAutoBackupBridge(), settings: useSettings(), loaded: useSettingsSelector((s) => s.loaded), actions: useSettingsActions() }), { wrapper: AppProviders });

const d = { id: 'a', date: '2026-03-01', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c', updatedAt: 'x' } as Donation;

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { desktop?: unknown }).desktop;
});

describe('useAutoBackupBridge 백업 시각 기록', () => {
  it('지난 종료 백업이 성공했으면 종료 백업 시각을 남기고, 전체 백업 시각은 더 새로울 때만 바꾼다', async () => {
    let resolve!: (s: Status) => void;
    stubDesktop(new Promise((r) => (resolve = r)));
    const { result } = render();
    await until(() => result.current.loaded);
    const newer = '2026-11-21T09:00:00.000Z';
    await act(() => result.current.actions.update({ lastBackupAt: newer }));
    await act(async () => resolve({ ok: true, at: '2026-11-20T09:00:00.000Z' }));
    await until(() => result.current.settings.lastCloseBackupAt === '2026-11-20T09:00:00.000Z');
    expect(result.current.settings.lastBackupAt).toBe(newer); // 더 오래된 종료 백업으로 되돌리지 않음
  });

  it('처음이면 종료 백업 시각이 전체 백업 시각도 되고, 실패한 종료 백업은 시각을 남기지 않는다', async () => {
    stubDesktop(Promise.resolve({ ok: true, at: '2026-11-20T09:00:00.000Z' }));
    const first = render();
    await until(() => first.result.current.settings.lastBackupAt === '2026-11-20T09:00:00.000Z');
    expect(first.result.current.settings.lastCloseBackupAt).toBe('2026-11-20T09:00:00.000Z');
    first.unmount();

    stubDesktop(Promise.resolve({ ok: false, at: '2026-11-22T09:00:00.000Z', error: '사용자가 백업 없이 종료함' }));
    const second = render();
    await until(() => !!second.result.current.bridge.failure);
    expect(second.result.current.settings.lastCloseBackupAt).toBe('2026-11-20T09:00:00.000Z');
    expect(second.result.current.settings.lastBackupAt).toBe('2026-11-20T09:00:00.000Z');
  });

  it('10분 백업이 바뀐 연도만 담으면 전체 백업 시각을 바꾸지 않고, 전체를 담으면 바꾼다', async () => {
    await transact(async () => ({ writes: [monthWrite('2026-03', [d])], result: 0 })); // 변경 있음, 바뀐 연도 2026
    stubDesktop(Promise.resolve(null));
    const tick = captureInterval();
    const { result } = render();
    await until(() => result.current.loaded);

    act(() => tick());
    await until(() => result.current.bridge.autoSave?.state === 'done');
    expect(result.current.settings.lastBackupAt).toBeNull();

    // 바뀐 연도를 모르는 변경(목록 없음)이면 전체를 담습니다.
    await db.kv.put(true, KEYS.dirty);
    await db.kv.delete(KEYS.dirtyYears);
    act(() => tick());
    await until(() => result.current.settings.lastBackupAt !== null);
  });
});
