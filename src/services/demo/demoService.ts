import type { Donation } from '../../contexts/types';
import { hasAnyData, resetAllData } from '../backup/backupService';
import type { RestoreMarker } from '../backup/streamRestore';
import { desktop } from '../desktopBridge';
import { auditKey, KEYS, listAuditKeys, monthWrite, transact, wipeDonationsWrites, type Write } from '../storage/storageService';
import { buildDemoAudits, DEMO_SPEC_APP, DEMO_SPEC_BROWSER, planDemo, type DemoSpec } from './demoData';
import { hasDemoData, refreshDemoState, setDemoCreating } from './demoState';

/** 데스크톱 앱이면 앱 규격(20만 건), 브라우저면 더 작은 규격(약 13만 건)을 씁니다. */
const demoSpecForDevice = (): DemoSpec => (desktop() ? DEMO_SPEC_APP : DEMO_SPEC_BROWSER);

/** 최근 이 달 수만큼 저장하면 바로 쓸 수 있다고 알립니다(나머지 과거 달은 이어서 만듭니다). */
const READY_MONTHS = 3;
/** 시연 데이터를 만드는 중인지(만드는 동안에는 제거할 수 없습니다) */
let running = false;

/**
 * 시연 데이터 생성: 성도·헌금 데이터가 하나라도 있으면 만들지 않고(원래 데이터가 지워지지 않도록), 빈 상태에서 시연 데이터를 만듭니다.
 * 데이터가 커서(PC 40만 건) 한 번에 만들지 않고 헌금을 한 달씩 만들어 한 달씩 저장합니다(메모리는 한 달치). 시작할 때 '진행 중' 표시를 남기고
 * 끝나면 지우므로, 중간에 꺼지면 다음 실행 때 알려 주며 [시연 데이터 제거]로 정리할 수 있습니다.
 * onProgress(끝낸 달 수, 전체 달 수)로 진행률을 알립니다.
 * 달은 최근 것부터 만들며, 처음 READY_MONTHS개를 저장하면 onReady를 불러 화면을 쓸 수 있게 하고 나머지 과거 달은 이어서 만듭니다.
 * 만드는 동안에는 [시연 데이터 제거]를 쓸 수 없습니다(removeDemoData가 오류).
 */
export async function createDemoData(opts: { spec?: DemoSpec; today?: Date; onProgress?: (done: number, total: number) => void; onReady?: () => void } = {}): Promise<void> {
  if (running) throw new Error('시연 데이터를 만드는 중입니다.');
  running = true;
  setDemoCreating({ done: 0, total: 0 }); // 누르는 즉시 최상단 안내가 뜨도록
  try {
    await createDemoDataNow(opts);
  } finally {
    running = false;
    setDemoCreating(null);
  }
}

async function createDemoDataNow(opts: { spec?: DemoSpec; today?: Date; onProgress?: (done: number, total: number) => void; onReady?: () => void }): Promise<void> {
  if (await hasDemoData()) throw new Error('이미 시연 데이터가 있습니다. 먼저 시연 데이터를 제거하세요.');
  // 시연 데이터는 지금의 모든 데이터를 대신하므로, 백업 없이 지워지지 않게 데이터가 있으면 거절합니다.
  if (await hasAnyData()) throw new Error('이미 성도·헌금 데이터가 있어 시연 데이터를 만들 수 없습니다. 시연 데이터는 데이터가 없는 상태에서만 만들 수 있습니다.');
  const startedAt = new Date().toISOString();
  const plan = planDemo(opts.spec ?? demoSpecForDevice(), opts.today);
  // 시작: 표시를 남기고, 기존 데이터를 모두 지우며, 성도·헌금 종류와 복구 정보를 씁니다(한 트랜잭션).
  await transact(async () => {
    const writes: Write[] = [{ key: KEYS.restoreMarker, value: { startedAt, years: [], kind: 'demo' } satisfies RestoreMarker }];
    writes.push(...(await wipeDonationsWrites()));
    for (const k of await listAuditKeys()) writes.push({ key: k, value: null });
    writes.push({ key: KEYS.members, value: plan.members }, { key: KEYS.offeringTypes, value: plan.offeringTypes });
    return { writes, result: undefined };
  });
  let done = 0;
  const total = plan.months.length;
  const audits = async (recent: Donation[]) => {
    const logs = buildDemoAudits(recent);
    await transact(async () => ({ writes: Object.entries(logs).map(([y, list]) => ({ key: auditKey(y), value: list })), result: undefined }));
  };
  setDemoCreating({ done: 0, total });
  opts.onProgress?.(0, total);
  for (const { ym, donations } of plan.generate()) {
    await transact(async () => ({ writes: [monthWrite(ym, donations)], result: undefined }));
    done++;
    opts.onProgress?.(done, total);
    if (done === 1) await audits(donations); // 이력은 가장 최근 달에서 선택합니다.
    if (done === Math.min(READY_MONTHS, total)) {
      await refreshDemoState();
      opts.onReady?.();
    }
    setDemoCreating({ done, total });
    await new Promise((r) => setTimeout(r)); // 화면이 끊기지 않게 달 사이에 양보
  }
  await transact(async () => ({ writes: [{ key: KEYS.restoreMarker, value: null }], result: undefined }));
  await refreshDemoState();
}

/**
 * 시연 데이터 제거: 시연 중 수정·추가한 데이터까지 모두 지우고 빈 상태(기본 헌금 종류)로 되돌립니다.
 * (이전 버전이 남긴 시연 복구 정보 키도 함께 지웁니다.)
 */
export async function removeDemoData(): Promise<void> {
  if (running) throw new Error('시연 데이터를 만드는 중에는 제거할 수 없습니다. 만들기가 끝난 뒤 다시 시도하세요.');
  if (!(await hasDemoData())) throw new Error('제거할 시연 데이터가 없습니다.');
  await resetAllData([{ key: KEYS.demoRestore, value: null }]);
  await refreshDemoState();
}
