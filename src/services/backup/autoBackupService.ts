import type { AppSettings } from '../../contexts/types';
import { desktop, type AutoBackupPayload } from '../desktopBridge';
import { clearDirty, isDirtySinceBackup, markDirty } from '../storage/storageService';
import { backupLines, snapshotBackupLines } from './backupService';

export const AUTO_BACKUP_KEEP = 10;
export const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.json(\.gz)?$/;

/** 보관 개수를 넘는 오래된 자동 백업 파일 이름 목록 (main.cjs의 prune과 동일 규칙) */
export function selectFilesToPrune(names: string[], keep = AUTO_BACKUP_KEEP): string[] {
  const backups = names.filter((n) => AUTO_BACKUP_FILE_RE.test(n)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** 주기 백업이 진행 중인지(종료 직전에 겹치면 종료 때 백업이 '변경 없음'으로 건너뛰지 않도록) */
let periodicRunning = false;

/** 종료 시 백업 내용 생성: 비활성화했거나 변경이 없으면 null(생략) */
export async function buildAutoBackup(settings: AppSettings): Promise<AutoBackupPayload | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled) return null;
  if (!periodicRunning && !(await isDirtySinceBackup())) return null;
  const dir = settings.autoBackupDir || (await api.getDefaultBackupDir());
  const id = await api.autoBackupBegin(dir);
  for await (const line of backupLines()) await api.autoBackupWrite(id, line);
  return { file: await api.autoBackupEnd(id) };
}

/** 앱을 쓰는 동안의 주기 백업 간격 */
export const PERIODIC_BACKUP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 주기 백업(autosave_*, 최근 3개 보관): 변경이 있을 때만 한 시점의 데이터를 파일로 저장하고 main이 다시 읽어 검증한 경로를 돌려줍니다.
 * 변경 표시는 읽기 전에 먼저 내리므로, 백업하는 동안 생긴 변경은 표시가 다시 올라가 다음 백업에 담깁니다. 실패하면 표시를 되돌립니다.
 * 반환: 저장된 파일 경로, 할 일이 없으면 null. 실패하면 오류를 던집니다.
 */
export async function runPeriodicBackup(settings: AppSettings): Promise<string | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled || periodicRunning) return null;
  if (!(await isDirtySinceBackup())) return null;
  periodicRunning = true;
  try {
    await clearDirty();
    const dir = settings.autoBackupDir || (await api.getDefaultBackupDir());
    const id = await api.autoBackupBegin(dir, 'periodic');
    for await (const line of snapshotBackupLines()) await api.autoBackupWrite(id, line);
    return await api.autoBackupEnd(id);
  } catch (e) {
    await markDirty();
    throw e;
  } finally {
    periodicRunning = false;
  }
}
