// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { db } from '../storage/db';
import { monthWrite, transact } from '../storage/storageService';
import { useRestoreProgress } from './backupBusy';
import { createBackupBlob, saveBackupFile } from './backupService';
import { restoreFromFile, scanBackupFile } from './streamRestore';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await transact(async () => ({ writes: [monthWrite('2026-01', [d('a', '2026-01-04')]), monthWrite('2026-02', [d('b', '2026-02-01')]), monthWrite('2025-05', [d('c', '2025-05-04')])], result: 0 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.desktop = undefined;
});

describe('restore progress', () => {
  it('counts restored months of the chosen year and clears when done', async () => {
    // jsdom의 Blob에는 stream()이 없어 Node의 Blob으로 감쌉니다.
    const node = new NodeBlob([await (await createBackupBlob()).text()]);
    const file = { stream: () => node.stream() as unknown as ReadableStream<Uint8Array> };
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const p = useRestoreProgress();
      seen.push(p ? `${p.done}/${p.total}` : 'null');
      return p;
    });
    await restoreFromFile(file, scan, ['2026']);
    await waitFor(() => expect(result.current).toBeNull());
    expect(seen).toContain('0/2');
    expect(seen).toContain('2/2');
  });
});

describe('manual backup progress', () => {
  it('reports month order out of the backed-up months', async () => {
    const calls: [number, number][] = [];
    const api = {
      getDefaultBackupDir: async () => 'C:/x',
      backupBegin: async () => 1,
      backupWrite: async () => undefined,
      backupRestart: async () => 1,
      backupAbort: async () => undefined,
      backupEnd: async () => 'C:/x/backup.json.gz',
    } as unknown as DesktopApi;
    window.desktop = api;
    await saveBackupFile('backup', ['2026'], (done, total) => calls.push([done, total]));
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
