import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { runPeriodicBackup, buildAutoBackup } from './autoBackupService';
import { assertNotRestoring, getRestoreStage, isBackupBusy, isRestoring, withBackupBusy, withCheckingBackup, withRestoring } from './backupBusy';

afterEach(() => vi.unstubAllGlobals());

describe('backup/restore lock', () => {
  it('is set only while the work runs (also after a failure) and tells restore apart from backup', async () => {
    await withBackupBusy(async () => {
      expect(isBackupBusy()).toBe(true);
      expect(isRestoring()).toBe(false);
      expect(() => assertNotRestoring()).not.toThrow();
    });
    await expect(
      withRestoring(async () => {
        expect(isRestoring()).toBe(true);
        expect(() => assertNotRestoring()).toThrow('복원하는 중');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(isBackupBusy()).toBe(false);
    expect(isRestoring()).toBe(false);
  });

  it('locks like a restore while checking a file, and goes back to the restore stage even after a failure', async () => {
    await expect(
      withCheckingBackup(async () => {
        expect(isRestoring()).toBe(true);
        expect(getRestoreStage()).toBe('check');
        throw new Error('bad file');
      }),
    ).rejects.toThrow('bad file');
    expect(isRestoring()).toBe(false);
    expect(getRestoreStage()).toBe('restore');
  });

  it('makes automatic backups (periodic and on close) stand aside without touching main', async () => {
    const begin = vi.fn(async () => 1);
    vi.stubGlobal('window', { desktop: { backupBegin: begin } as unknown as DesktopApi });
    const settings = { ...DEFAULT_SETTINGS, autoBackupEnabled: true };
    await withBackupBusy(async () => {
      expect(await runPeriodicBackup(settings)).toBeNull();
      // 종료 때 백업은 건너뛰면 진행 중인 작업이 끊긴 채 닫히므로, 오류로 알려 main이 종료 여부를 묻게 합니다.
      await expect(buildAutoBackup()).rejects.toThrow('진행 중');
    });
    expect(begin).not.toHaveBeenCalled();
  });
});
