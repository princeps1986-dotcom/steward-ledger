import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { runPeriodicBackup, buildAutoBackup } from './autoBackupService';
import { assertNotRestoring, isBackupBusy, isRestoring, withBackupBusy, withRestoring } from './backupBusy';

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

  it('makes automatic backups (periodic and on close) stand aside without touching main', async () => {
    const begin = vi.fn(async () => 1);
    vi.stubGlobal('window', { desktop: { getDefaultBackupDir: async () => 'C:/x', backupBegin: begin } as unknown as DesktopApi });
    const settings = { ...DEFAULT_SETTINGS, autoBackupEnabled: true };
    await withBackupBusy(async () => {
      expect(await runPeriodicBackup(settings)).toBeNull();
      expect(await buildAutoBackup(settings)).toBeNull();
    });
    expect(begin).not.toHaveBeenCalled();
  });
});
