// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { File as NodeFile } from 'node:buffer';
import type { ChangeEvent } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Donation } from '../contexts/types';
import { AppProviders } from '../contexts/AppProviders';
import { backupLines } from '../services/backup/backupService';
import { isRestoring } from '../services/backup/backupBusy';
import { sha256Hex } from '../services/backup/validation';
import { monthWrite, transact } from '../services/storage/storageService';
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
