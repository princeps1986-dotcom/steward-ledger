// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { File as NodeFile } from 'node:buffer';
import type { ChangeEvent } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Donation } from '../contexts/types';
import { AppProviders } from '../contexts/AppProviders';
import { backupLines } from '../services/backup/backupService';
import { isRestoring } from '../services/backup/backupBusy';
import { sha256Hex } from '../services/backup/validation';
import { monthWrite, transact } from '../services/storage/storageService';
import { useSettings, useSettingsActions } from '../contexts/SettingsContext';
import { useSettingsPage } from './useSettingsPage';

// jsdom의 File에는 stream()이 없어 줄 단위로 읽는 복원 경로를 탈 수 없으므로 Node의 File을 씁니다.
const pick = (file: File | NodeFile) => ({ target: { files: [file], value: 'x' } }) as unknown as ChangeEvent<HTMLInputElement>;

async function backupFile(): Promise<NodeFile> {
  const d = { id: 'a', date: '2025-03-02', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c', updatedAt: 'x' } as Donation;
  await transact(async () => ({ writes: [monthWrite('2025-03', [d])], result: 0 }));
  let body = '';
  for await (const l of backupLines()) body += l;
  return new NodeFile([`${body}${JSON.stringify({ t: 'end', sha256: await sha256Hex(body) })}\n`], 'b.json');
}

describe('useSettingsPage 복원 파일 검사', () => {
  it('손상된 .gz 파일이면 "확인 중" 문구를 남기지 않고 복원 불가를 알립니다', async () => {
    const { result } = renderHook(() => useSettingsPage(), { wrapper: AppProviders });
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'old.json.gz');
    await act(() => result.current.onRestoreFile(pick(file)));
    await waitFor(() => expect(result.current.message?.kind).toBe('error'));
    expect(result.current.message?.text).toMatch(/^복원 불가/);
  });
});

describe('useSettingsPage 연도별 수동 백업 기록', () => {
  it('연도를 차례로 백업하면 두 연도의 기록이 모두 남고, 성도·헌금이 있으면 시연 생성을 막습니다', async () => {
    // 브라우저 경로는 파일을 내려받으므로 jsdom에 없는 URL 함수만 대신합니다.
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    const d = (id: string, date: string) => ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c', updatedAt: 'x' }) as Donation;
    await transact(async () => ({ writes: [monthWrite('2024-03', [d('y24', '2024-03-03')]), monthWrite('2023-03', [d('y23', '2023-03-05')])], result: 0 }));
    const { result } = renderHook(() => useSettingsPage(), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.backupYearOptions.length).toBeGreaterThanOrEqual(2));
    expect(result.current.hasMembersOrDonations).toBe(true);
    for (const y of ['2023', '2024']) {
      act(() => result.current.setBackupYear(y));
      await act(() => result.current.backupNow());
      expect(result.current.message?.kind).toBe('info');
    }
    expect(result.current.manualBackupLabels.map((l) => l.slice(0, 5))).toEqual(['2024년', '2023년']);
    vi.unstubAllGlobals();
  });
});

describe('useSettingsPage 복원 실행', () => {
  it('확인 창을 먼저 닫고, 복원·다시 불러오기를 잠금 안에서 하며, 빨리 끝나도 5초 뒤에 결과를 알립니다', async () => {
    const file = await backupFile();
    const { result } = renderHook(() => useSettingsPage(), { wrapper: AppProviders });
    await act(() => result.current.onRestoreFile(pick(file)));
    await waitFor(() => expect(result.current.restoreYear).toBe('2025'));
    const t0 = Date.now();
    let done!: Promise<void>;
    act(() => {
      done = result.current.confirmRestore() as Promise<void>;
    });
    expect(result.current.restore).toBeNull();
    expect(isRestoring()).toBe(true);
    await act(() => done);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4900);
    expect(isRestoring()).toBe(false);
    expect(result.current.message).toMatchObject({ kind: 'info' });
    expect(result.current.message?.text).toContain('2025년 헌금 1건');
  }, 15000);

  it('복원이 실패하면 5초를 기다리지 않고 바로 알리고 잠금을 풉니다', async () => {
    const good = await backupFile();
    // 형식 확인·검사(1·2번째 읽기)는 통과하고, 복원하며 다시 읽을 때(3번째) 실패하는 파일
    class FlakyFile extends NodeFile {
      reads = 0;
      stream() {
        if (++this.reads >= 3) return new ReadableStream({ start: (c) => c.error(new Error('읽기 실패')) }) as ReturnType<NodeFile['stream']>;
        return super.stream();
      }
    }
    const file = new FlakyFile([await good.arrayBuffer()], 'b.json');
    const { result } = renderHook(() => useSettingsPage(), { wrapper: AppProviders });
    await act(() => result.current.onRestoreFile(pick(file)));
    await waitFor(() => expect(result.current.restoreYear).toBe('2025'));
    const t0 = Date.now();
    await act(() => result.current.confirmRestore() as Promise<void>);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(isRestoring()).toBe(false);
    expect(result.current.message).toMatchObject({ kind: 'error' });
    expect(result.current.message?.text).toContain('읽기 실패');
  });
});

describe('useSettingsPage 전체 초기화', () => {
  it('초기화하면 지운 데이터의 백업 기록(전체·종료·연도별 수동)도 비운다', async () => {
    const d = { id: 'r1', date: '2025-03-02', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c', updatedAt: 'x' } as Donation;
    await transact(async () => ({ writes: [monthWrite('2025-03', [d])], result: 0 }));
    const { result } = renderHook(() => ({ page: useSettingsPage(), settings: useSettings(), actions: useSettingsActions() }), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.page.hasMembersOrDonations).toBe(true));
    await act(() => result.current.actions.update({ lastBackupAt: '2025-03-02T01:00:00.000Z', lastCloseBackupAt: '2025-03-02T01:00:00.000Z', manualBackupAt: { '2025': '2025-03-02T01:00:00.000Z' } }));
    act(() => result.current.page.openReset());
    await waitFor(() => expect(result.current.page.resetLeft).toBe(0), { timeout: 12000 }); // 10초 기다린 뒤에만 초기화할 수 있음
    await act(() => result.current.page.confirmReset());
    expect(result.current.page.message?.kind).toBe('info');
    expect(result.current.settings.lastBackupAt).toBeNull();
    expect(result.current.settings.lastCloseBackupAt).toBeNull();
    expect(result.current.settings.manualBackupAt).toEqual({});
  }, 20000);
});
