import type { AppSettings } from '../../contexts/types';
import { isDemoBusy } from '../demo/demoState';
import { desktop, type AutoBackupPayload } from '../desktopBridge';
import { clearDirty, isDirtySinceBackup, markDirty } from '../storage/storageService';
import { backupLines, desktopSink, streamBackup } from './backupService';

export const AUTO_BACKUP_KEEP = 10;
export const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.json(\.gz)?$/;

/** 보관 개수를 넘는 오래된 자동 백업 파일 이름 목록 (main.cjs의 prune과 동일 규칙) */
export function selectFilesToPrune(names: string[], keep = AUTO_BACKUP_KEEP): string[] {
  const backups = names.filter((n) => AUTO_BACKUP_FILE_RE.test(n)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** 주기 백업이 진행 중인지(종료 직전에 겹치면 종료 때 백업이 '변경 없음'으로 건너뛰지 않도록) */
let periodicRunning = false;

/** 종료 시 백업 내용 생성: 비활성화했거나 변경이 없으면 null(생략). 종료 중에는 저장이 없으므로 다시 읽을 필요 없이 한 번에 씁니다. */
export async function buildAutoBackup(settings: AppSettings): Promise<AutoBackupPayload | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled || (await isDemoBusy())) return null; // 시연 데이터는 백업하지 않습니다.
  if (!periodicRunning && !(await isDirtySinceBackup())) return null;
  const dir = settings.autoBackupDir || (await api.getDefaultBackupDir());
  const id = await api.backupBegin({ kind: 'close', dir });
  if (id === null) return null;
  for await (const line of backupLines()) await api.backupWrite(id, line);
  return { file: await api.backupEnd(id) };
}

/** 앱을 쓰는 동안의 주기 백업 간격 */
export const PERIODIC_BACKUP_INTERVAL_MS = 20 * 60 * 1000;

/** main이 다른 백업(직접·종료)이 시작되며 진행 중이던 자동 백업 세션을 취소했을 때의 오류 문구(일부) */
export const BACKUP_CANCELLED_TEXT = '백업이 취소되었거나 시작되지 않았습니다';

/**
 * 주기 백업(autosave_*, 최근 3개 보관): 변경이 있을 때만 데이터를 달마다 나누어 읽으며 파일로 저장하고(메모리는 한 달치, 저장을 막지 않음)
 * main이 다시 읽어 검증한 경로를 돌려줍니다. 변경 표시는 읽기 전에 먼저 내리므로 백업하는 동안 생긴 변경은 표시가 다시 올라가 다음 백업에 담깁니다.
 * 실패하면 표시를 되돌립니다. 반환: 저장된 파일 경로, 할 일이 없으면 null. 실패하면 오류를 던집니다.
 */
export async function runPeriodicBackup(settings: AppSettings): Promise<string | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled || periodicRunning || (await isDemoBusy())) return null;
  if (!(await isDirtySinceBackup())) return null;
  periodicRunning = true;
  try {
    await clearDirty();
    const dir = settings.autoBackupDir || (await api.getDefaultBackupDir());
    return await streamBackup(desktopSink(api, { kind: 'periodic', dir }));
  } catch (e) {
    await markDirty();
    // 다른 백업이 끼어들어 취소된 것은 실패가 아닙니다(변경 표시를 되돌렸으니 다음 주기에 다시 백업).
    if (e instanceof Error && e.message.includes(BACKUP_CANCELLED_TEXT)) return null;
    throw e;
  } finally {
    periodicRunning = false;
  }
}
