import { backupBeforeDemo, replaceAllData, resetAllData } from '../backup/backupService';
import { desktopBackupFile, restoreAllFromFile, scanBackupFile } from '../backup/streamRestore';
import { desktop } from '../desktopBridge';
import { KEYS } from '../storage/storageService';
import { buildDemoPayload } from './demoData';
import { hasDemoData, readDemoRestore, refreshDemoState, type DemoRestoreInfo } from './demoState';

/** 시연 데이터 생성: 원래 데이터를 먼저 백업하고(실패하면 중단), 모든 데이터를 시연 데이터로 바꾸며 복구 정보를 같은 트랜잭션에 남깁니다. */
export async function createDemoData(): Promise<DemoRestoreInfo> {
  if (await hasDemoData()) throw new Error('이미 시연 데이터가 있습니다. 먼저 시연 데이터를 제거하세요.');
  const info: DemoRestoreInfo = { ...(await backupBeforeDemo()), createdAt: new Date().toISOString() };
  await replaceAllData(buildDemoPayload(), [{ key: KEYS.demoRestore, value: info }]);
  await refreshDemoState();
  return info;
}

export interface RemoveDemoResult {
  /** 원래 데이터를 백업 파일에서 자동 복구했는지 */
  restored: boolean;
  /** 브라우저에서 만든 시연이면 내려받았던 파일 이름(수동 복원 안내용) */
  downloadedName?: string;
}

/**
 * 시연 데이터 제거: 시연 중 수정·추가한 데이터까지 모두 지우고, 생성 직전 백업(before-demo 폴더)으로 원래 데이터를 되돌립니다.
 * 백업 파일을 먼저 열어 SHA-256까지 검증하고, 통과해야만 지우기 시작합니다(파일이 없거나 손상됐으면 아무것도 지우지 않고 오류).
 * 원래 데이터가 없었다면 빈 상태(기본 헌금 종류)로 되돌립니다. 브라우저는 자동 복구가 안 되므로 시연만 지우고 안내합니다.
 */
export async function removeDemoData(): Promise<RemoveDemoResult> {
  if (!(await hasDemoData())) throw new Error('제거할 시연 데이터가 없습니다.');
  const info = await readDemoRestore();
  const clear = [{ key: KEYS.demoRestore, value: null }];
  const api = desktop();
  if (info?.backupName && api) {
    const file = desktopBackupFile(api, info.backupName);
    const scan = await scanBackupFile(file).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (!scan.ok) throw new Error(`원래 데이터 백업 파일(before-demo\${info.backupName})을 확인하지 못해 시연 데이터를 제거하지 않았습니다: ${scan.error}`);
    await restoreAllFromFile(file, scan, clear);
    await refreshDemoState();
    return { restored: true };
  }
  await resetAllData(clear);
  await refreshDemoState();
  return { restored: false, downloadedName: info?.downloadedName };
}
