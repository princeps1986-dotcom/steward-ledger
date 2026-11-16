import type { AppSettings } from '../../contexts/types';
import { desktop, type AutoBackupPayload } from '../desktopBridge';
import { isDirtySinceBackup } from '../storage/storageService';
import { backupLines } from './backupService';

export const AUTO_BACKUP_KEEP = 10;
export const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.json(\.gz)?$/;

/** 보관 개수를 넘는 오래된 자동 백업 파일 이름 목록 (main.cjs의 prune과 동일 규칙) */
export function selectFilesToPrune(names: string[], keep = AUTO_BACKUP_KEEP): string[] {
  const backups = names.filter((n) => AUTO_BACKUP_FILE_RE.test(n)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** 종료 시 백업 내용 생성: 비활성화했거나 변경이 없으면 null(생략) */
export async function buildAutoBackup(settings: AppSettings): Promise<AutoBackupPayload | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled) return null;
  if (!(await isDirtySinceBackup())) return null;
  const dir = settings.autoBackupDir || (await api.getDefaultBackupDir());
  await api.autoBackupBegin(dir);
  for await (const line of backupLines()) await api.autoBackupWrite(line);
  return { file: await api.autoBackupEnd() };
}
