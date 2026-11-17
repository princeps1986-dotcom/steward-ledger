import type { Donation } from '../../contexts/types';
import { backupBeforeDemo, resetAllData } from '../backup/backupService';
import { desktopBackupFile, restoreAllFromFile, scanBackupFile, type RestoreMarker } from '../backup/streamRestore';
import { desktop } from '../desktopBridge';
import { auditKey, KEYS, listAuditKeys, listDonationMonths, monthWrite, transact, type Write } from '../storage/storageService';
import { buildDemoAudits, DEMO_SPEC_APP, DEMO_SPEC_BROWSER, planDemo, type DemoSpec } from './demoData';
import { hasDemoData, readDemoRestore, refreshDemoState, setDemoCreating, type DemoRestoreInfo } from './demoState';

/** 데스크톱 앱이면 앱 규격(20만 건), 브라우저면 더 작은 규격(약 13만 건)을 씁니다. */
export const demoSpecForDevice = (): DemoSpec => (desktop() ? DEMO_SPEC_APP : DEMO_SPEC_BROWSER);

/** 최근 이 달 수만큼 저장하면 바로 쓸 수 있다고 알립니다(나머지 과거 달은 이어서 만듭니다). */
const READY_MONTHS = 3;
/** 만드는 중인 작업(제거가 먼저 중단시키고 끝나기를 기다립니다) */
let running: { abort: AbortController; done: Promise<unknown> } | null = null;

/**
 * 시연 데이터 생성: 원래 데이터를 먼저 백업하고(실패하면 중단), 모든 데이터를 시연 데이터로 바꿉니다.
 * 데이터가 커서(PC 40만 건) 한 번에 만들지 않고 헌금을 한 달씩 만들어 한 달씩 저장합니다(메모리는 한 달치). 시작할 때 '진행 중' 표시를 남기고
 * 끝나면 지우므로, 중간에 꺼지면 다음 실행 때 알려 주며 [시연 데이터 제거]로 원래 데이터를 복구할 수 있습니다.
 * onProgress(끝낸 달 수, 전체 달 수)로 진행률을 알립니다.
 * 달은 최근 것부터 만들며, 처음 READY_MONTHS개를 저장하면 onReady를 불러 화면을 쓸 수 있게 하고 나머지 과거 달은 이어서 만듭니다.
 * [시연 데이터 제거]는 만드는 작업을 중단시킨 뒤 지웁니다.
 */
export async function createDemoData(opts: { spec?: DemoSpec; today?: Date; onProgress?: (done: number, total: number) => void; onReady?: () => void } = {}): Promise<DemoRestoreInfo> {
  if (running) throw new Error('시연 데이터를 만드는 중입니다.');
  const abort = new AbortController();
  const job = createDemoDataNow(opts, abort.signal);
  running = { abort, done: job.catch(() => undefined) };
  try {
    return await job;
  } finally {
    running = null;
    setDemoCreating(null);
  }
}

async function createDemoDataNow(opts: { spec?: DemoSpec; today?: Date; onProgress?: (done: number, total: number) => void; onReady?: () => void }, signal: AbortSignal): Promise<DemoRestoreInfo> {
  if (await hasDemoData()) throw new Error('이미 시연 데이터가 있습니다. 먼저 시연 데이터를 제거하세요.');
  const info: DemoRestoreInfo = { ...(await backupBeforeDemo()), createdAt: new Date().toISOString() };
  const plan = planDemo(opts.spec ?? demoSpecForDevice(), opts.today);
  // 시작: 표시를 남기고, 기존 데이터를 모두 지우며, 성도·헌금 종류와 복구 정보를 씁니다(한 트랜잭션).
  await transact(async () => {
    const writes: Write[] = [{ key: KEYS.restoreMarker, value: { startedAt: info.createdAt, years: [], kind: 'demo' } satisfies RestoreMarker }];
    for (const ym of await listDonationMonths()) writes.push(monthWrite(ym, []));
    for (const k of await listAuditKeys()) writes.push({ key: k, value: null });
    writes.push({ key: KEYS.members, value: plan.members }, { key: KEYS.offeringTypes, value: plan.offeringTypes }, { key: KEYS.demoRestore, value: info });
    return { writes, result: undefined };
  });
  let done = 0;
  const total = plan.months.length;
  const audits = async (recent: Donation[]) => {
    const logs = buildDemoAudits(recent);
    await transact(async () => ({ writes: Object.entries(logs).map(([y, list]) => ({ key: auditKey(y), value: list })), result: undefined }));
  };
  opts.onProgress?.(0, total);
  for (const { ym, donations } of plan.generate()) {
    if (signal.aborted) return info; // 제거가 이어받아 지웁니다(진행 표시는 남겨 둠).
    await transact(async () => ({ writes: [monthWrite(ym, donations)], result: undefined }));
    done++;
    opts.onProgress?.(done, total);
    if (done === 1) await audits(donations); // 이력은 가장 최근 달에서 고릅니다.
    if (done === Math.min(READY_MONTHS, total)) {
      await refreshDemoState();
      opts.onReady?.();
    }
    if (done >= READY_MONTHS) setDemoCreating({ done, total });
    await new Promise((r) => setTimeout(r)); // 화면이 끊기지 않게 달 사이에 양보
  }
  if (signal.aborted) return info;
  await transact(async () => ({ writes: [{ key: KEYS.restoreMarker, value: null }], result: undefined }));
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
  if (running) {
    running.abort.abort();
    await running.done;
  }
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
