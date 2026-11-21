import type { AppSettings } from '../../contexts/types';
import { isDemoBusy } from '../demo/demoState';
import { isBackupBusy } from './backupBusy';
import { desktop, type AutoBackupPayload } from '../desktopBridge';
import { clearDirty, dirtyYearsSinceFullBackup, isDirtySinceBackup, listDonationYears, markDirty } from '../storage/storageService';
import { backupLines, desktopSink, hasAnyData, streamBackup } from './backupService';

/** 주기 백업이 진행 중인지(종료 직전에 겹치면 종료 때 백업이 '바뀐 것 없음'으로 건너뛰지 않도록) */
let periodicRunning = false;

/**
 * 종료 시 백업 내용 생성: 마지막 전체 백업 이후 성도·헌금이 하나라도 바뀌었으면 항상 전체를 백업합니다.
 * 시연 중이거나, 바뀐 것이 없거나, 성도·헌금이 하나도 없으면 null(생략). 종료 중에는 저장이 없으므로 다시 읽을 필요 없이 한 번에 씁니다.
 */
export async function buildAutoBackup(): Promise<AutoBackupPayload | null> {
  const api = desktop();
  // 종료 때 백업은 체크박스(autoBackupEnabled)와 상관없이 항상 합니다. 체크박스는 사용 중 10분 백업만 켜고 끕니다.
  if (!api || (await isDemoBusy())) return null; // 시연 데이터는 백업하지 않습니다.
  // 직접 백업·복원 중이면 끼어들지 않되, 그냥 닫히면 진행 중인 작업이 끊기므로 오류로 알려 main이 종료 여부를 묻게 합니다.
  if (isBackupBusy()) throw new Error('백업 또는 복원이 진행 중입니다. 끝난 뒤 닫아 주세요.');
  // 10분 백업이 일부 연도만 담았으면 '변경 있음' 표시는 꺼져도 바뀐 연도 목록이 남아 있으므로 전체 백업합니다(두 값만 읽어 빠름).
  if (!periodicRunning && !(await isDirtySinceBackup()) && !(await dirtyYearsSinceFullBackup())?.length) return null;
  if (!(await hasAnyData())) return null; // 성도·헌금이 하나도 없으면 빈 백업 파일을 만들지 않습니다.
  const id = await api.backupBegin({ kind: 'close' });
  if (id === null) return null;
  for await (const line of backupLines()) await api.backupWrite(id, line);
  const file = await api.backupEnd(id);
  await clearDirty(); // 종료 중에는 저장이 없으므로 다 쓴 뒤에 내려도 빠지는 변경이 없습니다.
  return { file };
}

/** 주기 백업이 지금 진행 중인지(설정 화면에서 체크 해제를 막을 때 씀) */
export const isPeriodicBackupRunning = (): boolean => periodicRunning;

/** 앱을 쓰는 동안의 주기 백업 간격 */
export const PERIODIC_BACKUP_INTERVAL_MS = 10 * 60 * 1000;

/** main이 다른 백업(직접·종료)이 시작되며 진행 중이던 자동 백업 세션을 취소했을 때의 오류 문구(일부) */
const BACKUP_CANCELLED_TEXT = '백업이 취소되었거나 시작되지 않았습니다';

/**
 * 주기 백업(autosave_*, 최근 3개 보관): 변경이 있을 때만, 마지막 전체 백업(종료·직접 백업) 이후 바뀐 연도만 달마다 나누어 읽으며 파일로 저장하고
 * (메모리는 한 달치, 저장을 막지 않음. 성도·헌금 종류만 바뀌었으면 헌금 내역이 있는 가장 최근 연도 하나를 함께 담고, 바뀐 연도를 모르거나 헌금 내역이 없으면 전체) 종료 때 백업은 항상 전체이므로 그 파일과 최신 주기 백업으로 모두 복구할 수 있습니다.
 * main이 다시 읽어 검증한 경로를 돌려줍니다. 변경 표시는 읽기 전에 먼저 내리므로 백업하는 동안 생긴 변경은 표시가 다시 올라가 다음 백업에 담깁니다.
 * 실패하면 표시를 복구합니다. 반환: 저장된 파일 경로와 전체를 담았는지(full), 할 일이 없으면 null. 실패하면 오류를 던집니다.
 */
export async function runPeriodicBackup(settings: AppSettings): Promise<{ file: string; full: boolean } | null> {
  const api = desktop();
  if (!api || !settings.autoBackupEnabled || periodicRunning || isBackupBusy() || (await isDemoBusy())) return null;
  if (!(await isDirtySinceBackup())) return null;
  periodicRunning = true;
  try {
    let years = await dirtyYearsSinceFullBackup();
    if (years?.length === 0) {
      // 성도·헌금 종류만 바뀜(백업 파일엔 항상 전부 담김): 모든 연도 대신 가장 최근 연도 하나만 함께 담습니다.
      const latest = (await listDonationYears()).at(-1);
      years = latest ? [latest] : null;
    }
    // 일부 연도만 담으면 담은 연도를 목록에 남겨 둡니다(다음 주기 백업도 담고, 종료 때 전체 백업하도록).
    await clearDirty(years === null, years ?? []);
    const file = await streamBackup(desktopSink(api, { kind: 'periodic' }), years ? { years } : {});
    return file ? { file, full: years === null } : null;
  } catch (e) {
    await markDirty();
    // 다른 백업이 끼어들어 취소된 것은 실패가 아닙니다(변경 표시를 복구했으니 다음 주기에 다시 백업).
    if (e instanceof Error && e.message.includes(BACKUP_CANCELLED_TEXT)) return null;
    throw e;
  } finally {
    periodicRunning = false;
  }
}
