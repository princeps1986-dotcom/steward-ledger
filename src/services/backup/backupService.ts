import type { AuditLog, BackupEnvelope, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { APP_VERSION, SCHEMA_VERSION } from '../../contexts/types';
import { nowStamp } from '../domain/dates';
import { newId } from '../domain/ids';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
import { desktop, type BackupSessionSpec, type DesktopApi } from '../desktopBridge';
import { downloadText } from '../excel/downloadBridge';
import {
  AUDIT_KEY_RE,
  KEYS,
  auditKey,
  getItem,
  getMany,
  listAuditKeys,
  listDonationMonths,
  listDonationYears,
  monthOfDate,
  monthWrite,
  readMonth,
  snapshot,
  structuralCommitCount,
  transact,
  type Write,
} from '../storage/storageService';
import { planMerge, remapAudits, remapDonations, type MergePlan } from './mergeRules';
import { NDJSON_VERSION, sha256Hex } from './validation';

/**
 * 전역 로컬 데이터베이스를 백업 payload로 마샬링합니다.
 * years를 주면 그 연도의 헌금 내역·수정/삭제 이력만 담습니다(성도·헌금 종류는 항상 전부 담음). 생략하면 전체.
 */
export async function collectPayload(years?: readonly string[]): Promise<BackupPayload> {
  // 읽기 전용 트랜잭션 하나 안에서 모두 읽으므로, 읽는 도중 다른 저장이 커밋돼도 한 시점의 데이터가 담깁니다.
  return snapshot(async () => {
    const want = years ? new Set(years) : null;
    const months = (await listDonationMonths()).filter((ym) => !want || want.has(ym.slice(0, 4)));
    const auditKeys = (await listAuditKeys()).filter((k) => !want || want.has(AUDIT_KEY_RE.exec(k)![1]));
    const [auditLists, meta] = await Promise.all([
      getMany<AuditLog[]>(auditKeys),
      getMany<Member[] | OfferingType[]>([KEYS.members, KEYS.offeringTypes]),
    ]);
    const donationsByYear: Record<string, Donation[]> = {};
    for (const ym of months) (donationsByYear[ym.slice(0, 4)] ??= []).push(...(await readMonth(ym)));
    const auditLogsByYear: Record<string, AuditLog[]> = {};
    auditKeys.forEach((k, i) => {
      auditLogsByYear[AUDIT_KEY_RE.exec(k)![1]] = auditLists[i] ?? [];
    });
    return {
      members: (meta[0] as Member[] | null) ?? [],
      offeringTypes: (meta[1] as OfferingType[] | null) ?? [],
      donationsByYear,
      auditLogsByYear,
    };
  });
}

export async function createBackupJson(years?: readonly string[]): Promise<string> {
  // payload는 한 번만 문자열로 만들어 체크섬을 구하고 그대로 봉투에 끼웁니다(큰 데이터에서 메모리·시간 절약).
  // 결과는 JSON.stringify(envelope)와 같은 글자이므로 형식·호환성은 그대로입니다.
  const payloadJson = JSON.stringify(await collectPayload(years));
  const head: Omit<BackupEnvelope, 'checksum' | 'payload'> = { appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
  return `${JSON.stringify(head).slice(0, -1)},"checksum":"${await sha256Hex(payloadJson)}","payload":${payloadJson}}`;
}

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

/** 연도를 골라 만든 백업은 파일 이름에 연도를 넣습니다: backup_2025_…, backup_2024-2026_… */
export function backupYearsLabel(years?: readonly string[]): string {
  if (!years || years.length === 0) return '';
  const s = [...years].sort();
  return s.length === 1 ? s[0] : `${s[0]}-${s[s.length - 1]}`;
}

export const backupFileName = (prefix = 'backup', years?: readonly string[]): string => {
  const label = backupYearsLabel(years);
  return `${prefix}${label ? `_${label}` : ''}_${nowStamp()}.json`;
};

export async function downloadBackup(prefix = 'backup', years?: readonly string[]): Promise<string> {
  const name = backupFileName(prefix, years);
  downloadText(await createBackupJson(years), name);
  return name;
}

/**
 * 초기화·복원 직전 긴급 백업. 데스크톱 앱은 백업 폴더에 대화상자 없이 줄 단위로 저장하고(메모리는 한 달치) 실패하면 오류를 던지므로,
 * 이 함수가 끝났다면 백업이 실제로 저장된 것입니다(사용자가 취소할 수 없음). 저장된 위치(또는 파일 이름)를 돌려줍니다.
 */
export async function saveEmergencyBackup(prefix: string): Promise<string> {
  const api = desktop();
  if (api) {
    const saved = await streamBackup(desktopSink(api, { kind: 'emergency', name: `${backupFileName(prefix)}.gz` }));
    if (!saved) throw new Error('긴급 백업을 저장하지 못했습니다.');
    return saved;
  }
  const name = backupFileName(prefix);
  downloadText(await createBackupJson(), name);
  return name;
}

/** 직접 하는 백업: 데스크톱 앱은 저장 위치를 고르게 하며, 취소하면 오류를 던집니다(저장되지 않은 것을 '백업함'으로 기록하지 않도록). */
export async function saveBackupFile(prefix: string, years?: readonly string[]): Promise<string> {
  const api = desktop();
  if (!api) {
    const name = backupFileName(prefix, years);
    downloadText(await createBackupJson(years), name);
    return name;
  }
  const saved = await streamBackup(desktopSink(api, { kind: 'manual', name: `${backupFileName(prefix, years)}.gz` }), { years });
  if (!saved) throw new Error('저장을 취소했습니다.');
  return saved;
}

/** 선택한 연도 하나만 백업해도 저장소의 모든 헌금·이력이 담기는지(다른 연도의 헌금 또는 이력이 없는지) */
export async function isCompleteYearBackup(year: string): Promise<boolean> {
  const years = new Set<string>(await listDonationYears());
  for (const k of await listAuditKeys()) years.add(AUDIT_KEY_RE.exec(k)![1]);
  return years.size === 0 || (years.size === 1 && years.has(year));
}

/** 백업 payload에 들어 있는 연도 목록(헌금 또는 이력이 있는 연도, 오름차순) */
export function yearsInPayload(p: BackupPayload): string[] {
  return [...new Set([...Object.keys(p.donationsByYear), ...Object.keys(p.auditLogsByYear)])].sort();
}

/** 복원 전에 보여 줄 합치기 미리보기: 현재 데이터와 대응되는 성도·종류 수와 새로 추가될 수 */
export async function previewMerge(payload: BackupPayload): Promise<MergePlan> {
  const members = (await getItem<Member[]>(KEYS.members)) ?? [];
  const offeringTypes = (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [];
  return planMerge({ members, offeringTypes }, payload);
}

export type RestoreMode = 'YEARS' | 'FULL';

const pickYears = <T,>(by: Record<string, T[]>, years: ReadonlySet<string>): Record<string, T[]> =>
  Object.fromEntries(Object.entries(by).filter(([y]) => years.has(y)));

/**
 * 백업에서 선택한 연도만 복원합니다. 호출 전에 반드시 긴급 백업을 저장아야 합니다.
 * - FULL: 현재 모든 데이터를 지우고 백업의 성도·헌금 종류와 선택한 연도 내역으로 교체합니다.
 * - YEARS: 선택한 연도의 헌금 내역·이력만 백업 내용으로 교체하고, 다른 연도는 그대로 둡니다.
 *   성도·헌금 종류는 현재 데이터를 지우지 않고 백업에만 있는 항목(id 기준)을 추가합니다.
 */
export async function restoreBackup(payload: BackupPayload, opts: { years: readonly string[]; mode: RestoreMode }): Promise<void> {
  const years = new Set(opts.years);
  const donationsByYear = pickYears(payload.donationsByYear, years);
  const auditLogsByYear = pickYears(payload.auditLogsByYear, years);
  if (opts.mode === 'FULL') {
    await replaceAllData({ members: payload.members, offeringTypes: payload.offeringTypes, donationsByYear, auditLogsByYear });
    return;
  }
  await transact(async (read) => {
    const writes: Write[] = [];
    // 선택한 연도의 기존 월별 헌금 키와 이력 키를 지우고, 백업 내용을 월별로 다시 씁니다.
    for (const ym of await listDonationMonths()) if (years.has(ym.slice(0, 4))) writes.push(monthWrite(ym, []));
    for (const k of await listAuditKeys()) if (years.has(AUDIT_KEY_RE.exec(k)![1])) writes.push({ key: k, value: null });
    // 성도·헌금 종류: 현재 데이터는 유지하고, 다른 PC의 백업이면 같은 성도·종류를 현재 id로 대응시켜 중복을 막습니다.
    const curMembers = (await read<Member[]>(KEYS.members)) ?? [];
    const curTypes = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
    const plan = planMerge({ members: curMembers, offeringTypes: curTypes }, payload);
    const byMonth = new Map<string, Donation[]>();
    for (const list of Object.values(donationsByYear)) {
      for (const d of remapDonations(list, plan)) {
        const ym = monthOfDate(d.date);
        if (!byMonth.has(ym)) byMonth.set(ym, []);
        byMonth.get(ym)!.push(d);
      }
    }
    for (const [ym, list] of byMonth) writes.push(monthWrite(ym, list));
    for (const [y, list] of Object.entries(auditLogsByYear)) {
      const mapped = remapAudits(list, plan);
      if (mapped.length) writes.push({ key: auditKey(y), value: mapped });
    }
    if (plan.addMembers.length) writes.push({ key: KEYS.members, value: [...curMembers, ...plan.addMembers] });
    if (plan.addTypes.length) writes.push({ key: KEYS.offeringTypes, value: [...curTypes, ...plan.addTypes] });
    // 같은 키에 대한 삭제→쓰기 순서가 보장되도록 마지막 쓰기만 남깁니다.
    const last = new Map<string, Write>();
    for (const w of writes) last.set(w.key, w);
    return { writes: [...last.values()], result: undefined };
  });
}

/**
 * 백업으로 전체 데이터를 교체합니다. 호출 전에 반드시 긴급 백업을 저장해야 합니다(useSettingsPage).
 * 기존 연도 샤드 중 백업에 없는 연도는 삭제합니다. 하나의 원자적 트랜잭션으로 수행되어, 데이터가 아무리 커도
 * 도중에 실패하면 아무것도 바뀌지 않습니다(월별 키마다 값이 따로라 한 값의 크기 한도에 걸리지도 않습니다).
 */
export async function replaceAllData(payload: BackupPayload): Promise<void> {
  await transact(async () => {
    const writes: Write[] = [];
    for (const ym of await listDonationMonths()) writes.push(monthWrite(ym, []));
    for (const k of await listAuditKeys()) writes.push({ key: k, value: null });
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
    return { writes, result: undefined };
  });
}

/**
 * 전체 데이터 초기화(v2.15): 성도·헌금 내역·수정/삭제 이력을 모두 지우고 헌금 종류는 기본값으로 되돌립니다.
 * 환경 설정(테마·백업 주기 등)은 유지합니다. 호출 전에 긴급 백업을 저장아야 합니다.
 */
export async function resetAllData(): Promise<void> {
  await replaceAllData({
    members: [],
    offeringTypes: DEFAULT_OFFERING_TYPES.map((t) => ({ ...t, id: newId() })),
    donationsByYear: {},
    auditLogsByYear: {},
  });
}

