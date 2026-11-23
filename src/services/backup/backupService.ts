import type { AuditLog, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { assertNoDemo } from '../demo/demoState';
import { withBackupBusy } from './backupBusy';
import { APP_VERSION } from '../../contexts/types';
import { nowStamp } from '../domain/dates';
import { newId } from '../domain/ids';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
import { desktop, type BackupSessionSpec, type DesktopApi } from '../desktopBridge';
import { downloadBlob } from '../downloadBridge';
import {
  AUDIT_KEY_RE,
  KEYS,
  auditKey,
  clearDirty,
  dirtyYearsSinceFullBackup,
  getItem,
  isDirtySinceBackup,
  restoreDirty,
  getMany,
  listAuditKeys,
  listDonationMonths,
  wipeDonationsWrites,
  listDonationYears,
  monthOfDate,
  monthWrite,
  readMonth,
  structuralCommitCount,
  transact,
  type Write,
} from '../storage/storageService';
import { NDJSON_VERSION } from './validation';
import { Sha256 } from './sha256';

/** 줄 단위 백업에서 한 번에 읽는 키 수(이력 키를 묶어 읽어 읽기 횟수를 줄임) */
const BACKUP_READ_BATCH = 6;

const ndjsonLine = (o: unknown): string => `${JSON.stringify(o)}\n`;

/**
 * 백업의 줄을 하나씩 만듭니다(줄 단위 JSON, NDJSON). 머리글 → 성도 → 헌금 종류 → 연도별 이력 → 월별 헌금 순이며, 한 번에 한 달치만
 * 메모리에 올라갑니다. 마지막 SHA-256 줄은 main이 붙입니다. years를 주면 그 연도의 헌금·이력만 담습니다(성도·헌금 종류는 항상 전부).
 */
export async function* backupLines(opts: { years?: readonly string[]; onMonthRead?: (ym: string) => Promise<void> } = {}): AsyncGenerator<string> {
  const want = opts.years ? new Set(opts.years) : null;
  yield ndjsonLine({ ndjson: NDJSON_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString() });
  yield ndjsonLine({ t: 'members', data: (await getItem<Member[]>(KEYS.members)) ?? [] });
  yield ndjsonLine({ t: 'offeringTypes', data: (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [] });
  const auditKeys = (await listAuditKeys()).filter((k) => !want || want.has(AUDIT_KEY_RE.exec(k)![1]));
  for (let i = 0; i < auditKeys.length; i += BACKUP_READ_BATCH) {
    const chunk = auditKeys.slice(i, i + BACKUP_READ_BATCH);
    const values = await getMany<AuditLog[]>(chunk);
    for (const [j, k] of chunk.entries()) yield ndjsonLine({ t: 'audit', year: AUDIT_KEY_RE.exec(k)![1], data: values[j] ?? [] });
  }
  for (const ym of (await listDonationMonths()).filter((m) => !want || want.has(m.slice(0, 4)))) {
    const data = await readMonth(ym);
    await opts.onMonthRead?.(ym);
    yield ndjsonLine({ t: 'donations', ym, data });
  }
}

/** 백업을 받아 파일로 쓰는 쪽(데스크톱 앱의 main). 세션 번호로 서로 다른 백업이 섞이지 않게 합니다. */
export interface BackupSink {
  /** 시작. 사용자가 저장 위치 선택을 취소하면 null */
  begin(): Promise<number | null>;
  write(id: number, line: string): Promise<unknown>;
  /** 같은 대상으로 처음부터 다시 씁니다 */
  restart(id: number): Promise<number>;
  abort(id: number): Promise<unknown>;
  /** 검증 후 확정하고 저장된 경로를 돌려줍니다 */
  end(id: number): Promise<string>;
}

/**
 * 백업을 달마다 나누어 읽으며 바로 sink로 보냅니다(한 달치만 메모리에 둠). 읽는 도중 저장을 막지 않는 대신,
 * 내역이 달을 넘어 옮겨졌거나 복원이 있었다면(structuralCommitCount가 바뀜) 한 내역이 두 번 담기거나 빠질 수 있으니 버리고 처음부터 다시 씁니다
 * (최대 maxAttempts번). 같은 달 안의 추가·수정·삭제는 어느 시점에 읽어도 일관되므로 그대로 둡니다(그 변경은 '변경 표시'로 다음 백업에 담김).
 * 이력·성도·헌금 종류는 내역과 같은 시점이 아닐 수 있습니다. 반환: 저장된 경로, 사용자가 취소하면 null. 실패하면 세션을 정리하고 오류를 던집니다.
 */
export async function streamBackup(
  sink: BackupSink,
  opts: { years?: readonly string[]; maxAttempts?: number; onMonthRead?: (ym: string) => Promise<void> } = {},
): Promise<string | null> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let id = await sink.begin();
  if (id === null) return null;
  try {
    for (let attempt = 1; ; attempt++) {
      const seq = structuralCommitCount();
      for await (const line of backupLines({ years: opts.years, onMonthRead: opts.onMonthRead })) await sink.write(id, line);
      if (structuralCommitCount() === seq) return await sink.end(id);
      if (attempt >= maxAttempts) throw new Error('백업하는 동안 내역이 다른 달로 옮겨지는 변경이 계속되어 백업하지 못했습니다. 잠시 뒤 다시 시도하세요.');
      id = await sink.restart(id);
    }
  } catch (e) {
    await sink.abort(id).catch(() => undefined);
    throw e;
  }
}

/** 데스크톱 앱의 main에 백업을 쓰는 sink */
export function desktopSink(api: DesktopApi, spec: BackupSessionSpec): BackupSink {
  return {
    begin: () => api.backupBegin(spec),
    write: (id, line) => api.backupWrite(id, line),
    restart: (id) => api.backupRestart(id),
    abort: (id) => api.backupAbort(id),
    end: (id) => api.backupEnd(id),
  };
}

/** 연도를 선택해 만든 백업은 파일 이름에 연도를 넣습니다: backup_2025_…, backup_2024-2026_… */
function backupYearsLabel(years?: readonly string[]): string {
  if (!years || years.length === 0) return '';
  const s = [...years].sort();
  return s.length === 1 ? s[0] : `${s[0]}-${s[s.length - 1]}`;
}

/** 데스크톱 앱의 백업 파일 이름(암호화한 .slbk) */
const slbkName = (jsonName: string): string => jsonName.replace(/\.json$/, '.slbk');

const backupFileName = (prefix = 'backup', years?: readonly string[]): string => {
  const label = backupYearsLabel(years);
  return `${prefix}${label ? `_${label}` : ''}_${nowStamp()}.json`;
};

/**
 * 웹 브라우저용 백업 파일(줄 단위 JSON). 달마다 만든 줄을 작은 Blob으로 이어 붙여 큰 문자열 하나를 만들지 않고,
 * 체크섬은 데스크톱 앱과 같은 끝 줄({"t":"end","sha256"})로 붙입니다. 읽는 도중의 저장은 막지 않습니다(데스크톱 주기 백업과 같은 기준).
 */
export async function createBackupBlob(years?: readonly string[]): Promise<Blob> {
  const enc = new TextEncoder();
  let hash = new Sha256();
  let parts: Blob[] = [];
  // 메모리에 모으는 sink: 처음부터 다시 쓰기(재시도)와 오류 문구는 streamBackup 한 곳에서 처리합니다.
  const reset = async () => {
    hash = new Sha256();
    parts = [];
    return 1;
  };
  await streamBackup(
    {
      begin: reset,
      write: async (_id, line) => {
        hash.update(enc.encode(line));
        parts.push(new Blob([line]));
      },
      restart: reset,
      abort: reset,
      end: async () => {
        parts.push(new Blob([ndjsonLine({ t: 'end', sha256: hash.digestHex() })]));
        return '';
      },
    },
    { years },
  );
  return new Blob(parts, { type: 'application/x-ndjson' });
}

/** onProgress(저장한 달, 전체 달): 데스크톱 앱에서 달마다 부릅니다(웹 브라우저는 한 번에 만들어 부르지 않음). */
type BackupProgress = (done: number, total: number) => void;

/**
 * 직접 하는 백업: 데스크톱 앱은 저장 위치를 선택하게 하며, 취소하면 오류를 던집니다(저장되지 않은 것을 '백업함'으로 기록하지 않도록).
 * 데스크톱 앱은 password(사용자가 정한 암호)로 잠근 파일만 만듭니다. 웹 브라우저는 지금처럼 일반 파일입니다.
 */
export const saveBackupFile = (prefix: string, years?: readonly string[], onProgress?: BackupProgress, password?: string): Promise<string> =>
  withBackupBusy(() => saveBackupFileNow(prefix, years, onProgress, password));
async function saveBackupFileNow(prefix: string, years?: readonly string[], onProgress?: BackupProgress, password?: string): Promise<string> {
  await assertNoDemo();
  // 전체가 담기는 백업이면 변경 표시를 읽기 전에 내립니다: 백업하는 동안 생긴 변경은 표시가 다시 올라가 다음 자동 백업에 담깁니다.
  const full = !years || (years.length === 1 && (await isCompleteYearBackup(years[0])));
  // 10분 백업이 일부 연도만 담으면 '변경 있음'은 꺼져도 바뀐 연도 목록이 남으므로, 그것도 비워 종료 때 같은 전체 백업을 다시 하지 않게 합니다.
  const flag = full && (await isDirtySinceBackup());
  const prevYears = (full && (await dirtyYearsSinceFullBackup())) || [];
  const cleared = flag || prevYears.length > 0;
  if (cleared) await clearDirty();
  try {
    return await saveBackupFileTo(prefix, years, onProgress, password);
  } catch (e) {
    // 지우기 전 상태로만 되돌립니다(꺼져 있던 '변경 있음'을 켜면 바뀐 것이 없는데 10분 백업이 돎).
    if (cleared) await restoreDirty(flag, prevYears);
    throw e;
  }
}
async function saveBackupFileTo(prefix: string, years?: readonly string[], onProgress?: BackupProgress, password?: string): Promise<string> {
  const api = desktop();
  if (!api) {
    const name = backupFileName(prefix, years);
    downloadBlob(await createBackupBlob(years), name);
    return name;
  }
  // 진행은 그 달의 순번으로 알립니다(백업을 처음부터 다시 써도 숫자가 맞음).
  const want = years ? new Set(years) : null;
  const months = onProgress ? (await listDonationMonths()).filter((m) => !want || want.has(m.slice(0, 4))) : [];
  const onMonthRead = onProgress ? async (ym: string) => onProgress(months.indexOf(ym) + 1, months.length) : undefined;
  const saved = await streamBackup(desktopSink(api, { kind: 'manual', name: slbkName(backupFileName(prefix, years)), password }), { years, onMonthRead });
  if (!saved) throw new Error('저장을 취소했습니다.');
  return saved;
}

/** 성도나 헌금 내역이 하나라도 있는지(전체를 읽지 않고 확인) */
export async function hasAnyData(): Promise<boolean> {
  return ((await getItem<Member[]>(KEYS.members)) ?? []).length > 0 || (await listDonationMonths()).length > 0;
}

/** 선택한 연도 하나만 백업해도 저장소의 모든 헌금·이력이 담기는지(다른 연도의 헌금 또는 이력이 없는지) */
export async function isCompleteYearBackup(year: string): Promise<boolean> {
  const years = new Set<string>(await listDonationYears());
  for (const k of await listAuditKeys()) years.add(AUDIT_KEY_RE.exec(k)![1]);
  return years.size === 0 || (years.size === 1 && years.has(year));
}

/**
 * 백업으로 전체 데이터를 교체합니다. 교체 전에 현재 데이터를 자동으로 백업하지 않습니다.
 * 기존 연도 샤드 중 백업에 없는 연도는 삭제합니다. 하나의 원자적 트랜잭션으로 수행되어, 데이터가 아무리 커도
 * 도중에 실패하면 아무것도 바뀌지 않습니다(월별 키마다 값이 따로라 한 값의 크기 한도에 걸리지도 않습니다).
 */
export async function replaceAllData(payload: BackupPayload, extraWrites: Write[] = []): Promise<void> {
  await transact(async () => {
    const writes: Write[] = [];
    writes.push(...(await wipeDonationsWrites()));
    for (const k of await listAuditKeys()) writes.push({ key: k, value: null });
    writes.push({ key: KEYS.restoreMarker, value: null }); // 전체 교체가 끝났으므로 중단된 복원 표시도 지웁니다.
    writes.push({ key: KEYS.members, value: payload.members });
    writes.push({ key: KEYS.offeringTypes, value: payload.offeringTypes });
    // 헌금 내역은 월별 키로 나누어 기록합니다.
    const byMonth = new Map<string, Donation[]>();
    for (const list of Object.values(payload.donationsByYear)) {
      for (const d of list) {
        const ym = monthOfDate(d.date);
        if (!byMonth.has(ym)) byMonth.set(ym, []);
        byMonth.get(ym)!.push(d);
      }
    }
    for (const [ym, list] of byMonth) writes.push(monthWrite(ym, list));
    for (const [y, list] of Object.entries(payload.auditLogsByYear)) writes.push({ key: auditKey(y), value: list });
    writes.push(...extraWrites);
    return { writes, result: undefined };
  });
}

/**
 * 전체 데이터 초기화(v2.15): 성도·헌금 내역·수정/삭제 이력을 모두 지우고 헌금 종류는 기본값으로 복구합니다.
 * 환경 설정(테마·백업 주기 등)은 유지합니다.
 */
export async function resetAllData(extraWrites: Write[] = []): Promise<void> {
  await replaceAllData({
    members: [],
    offeringTypes: DEFAULT_OFFERING_TYPES.map((t) => ({ ...t, id: newId() })),
    donationsByYear: {},
    auditLogsByYear: {},
  }, extraWrites);
}

