import type { AuditLog, BackupEnvelope, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { APP_VERSION, SCHEMA_VERSION } from '../../contexts/types';
import { nowStamp } from '../domain/dates';
import { newId } from '../domain/ids';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
import { desktop } from '../desktopBridge';
import { downloadText } from '../excel/downloadBridge';
import {
  AUDIT_KEY_RE,
  DONATION_KEY_RE,
  KEYS,
  auditKey,
  donationKey,
  getItem,
  listKeys,
  monthOfDate,
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
  const keys = await listKeys();
  const want = years ? new Set(years) : null;
  const donationsByYear: Record<string, Donation[]> = {};
  const auditLogsByYear: Record<string, AuditLog[]> = {};
  for (const k of keys.sort()) {
    const dm = DONATION_KEY_RE.exec(k)?.[1];
    if (dm && (!want || want.has(dm.slice(0, 4)))) (donationsByYear[dm.slice(0, 4)] ??= []).push(...((await getItem<Donation[]>(k)) ?? []));
    const ay = AUDIT_KEY_RE.exec(k)?.[1];
    if (ay && (!want || want.has(ay))) auditLogsByYear[ay] = (await getItem<AuditLog[]>(k)) ?? [];
  }
  return {
    members: (await getItem<Member[]>(KEYS.members)) ?? [],
    offeringTypes: (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [],
    donationsByYear,
    auditLogsByYear,
  };
}

export async function createBackupJson(years?: readonly string[]): Promise<string> {
  // payload는 한 번만 문자열로 만들어 체크섬을 구하고 그대로 봉투에 끼웁니다(큰 데이터에서 메모리·시간 절약).
  // 결과는 JSON.stringify(envelope)와 같은 글자이므로 형식·호환성은 그대로입니다.
  const payloadJson = JSON.stringify(await collectPayload(years));
  const head: Omit<BackupEnvelope, 'checksum' | 'payload'> = { appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
  return `${JSON.stringify(head).slice(0, -1)},"checksum":"${await sha256Hex(payloadJson)}","payload":${payloadJson}}`;
}

/**
 * 자동 백업(v3, 줄 단위 JSON)의 줄을 하나씩 만듭니다. 한 줄은 한 달치 헌금 등 한 덩어리라 메모리에는 한 번에 한 줄만 올라갑니다.
 * 머리글 → 성도 → 헌금 종류 → 월별 헌금/연도별 이력 순이며, 마지막 SHA-256 줄은 main이 붙입니다.
 */
export async function* backupLines(): AsyncGenerator<string> {
  const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
  yield line({ ndjson: NDJSON_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString() });
  yield line({ t: 'members', data: (await getItem<Member[]>(KEYS.members)) ?? [] });
  yield line({ t: 'offeringTypes', data: (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [] });
  for (const k of (await listKeys()).sort()) {
    const ym = DONATION_KEY_RE.exec(k)?.[1];
    if (ym) yield line({ t: 'donations', ym, data: (await getItem<Donation[]>(k)) ?? [] });
    const year = AUDIT_KEY_RE.exec(k)?.[1];
    if (year) yield line({ t: 'audit', year, data: (await getItem<AuditLog[]>(k)) ?? [] });
  }
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
 * 초기화·복원 직전 긴급 백업. 데스크톱 앱은 백업 폴더에 대화상자 없이 저장하고 실패하면 오류를 던지므로,
 * 이 함수가 끝났다면 백업이 실제로 저장된 것입니다(사용자가 취소할 수 없음). 저장된 위치(또는 파일 이름)를 돌려줍니다.
 */
export async function saveEmergencyBackup(prefix: string): Promise<string> {
  const name = backupFileName(prefix);
  const json = await createBackupJson();
  const api = desktop();
  if (api) return api.saveEmergencyBackup(name, json);
  downloadText(json, name);
  return name;
}

/** 직접 하는 백업: 데스크톱 앱은 저장 위치를 고르게 하며, 취소하면 오류를 던집니다(저장되지 않은 것을 '백업함'으로 기록하지 않도록). */
export async function saveBackupFile(prefix: string, years?: readonly string[]): Promise<string> {
  const name = backupFileName(prefix, years);
  const api = desktop();
  if (!api) {
    downloadText(await createBackupJson(years), name);
    return name;
  }
  const saved = await api.saveBackupAs(name, await createBackupJson(years));
  if (!saved) throw new Error('저장을 취소했습니다.');
  return saved;
}

/** 선택한 연도 하나만 백업해도 저장소의 모든 헌금·이력이 담기는지(다른 연도의 헌금 또는 이력이 없는지) */
export async function isCompleteYearBackup(year: string): Promise<boolean> {
  const years = new Set<string>();
  for (const k of await listKeys()) {
    const dm = DONATION_KEY_RE.exec(k)?.[1];
    if (dm) years.add(dm.slice(0, 4));
    const ay = AUDIT_KEY_RE.exec(k)?.[1];
    if (ay) years.add(ay);
  }
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
    for (const k of await listKeys()) {
      const dm = DONATION_KEY_RE.exec(k)?.[1];
      if (dm && years.has(dm.slice(0, 4))) writes.push({ key: k, value: null });
      const ay = AUDIT_KEY_RE.exec(k)?.[1];
      if (ay && years.has(ay)) writes.push({ key: k, value: null });
    }
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
    for (const [ym, list] of byMonth) writes.push({ key: donationKey(ym), value: list });
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

/** 저널 한 건이 너무 커지지 않도록 한 번에 커밋하는 쓰기의 추정 크기 상한(IndexedDB 값 크기 한도 약 128MB보다 한참 작게) */
const MAX_BATCH_BYTES = 20_000_000;
const estimateBytes = (w: Write): number => (Array.isArray(w.value) ? w.value.length * 500 : 1000);

/** 쓰기 목록을 추정 크기 기준으로 나눕니다. 삭제(value=null)는 마지막 묶음으로 보내 새 데이터가 먼저 자리 잡게 합니다. */
export function splitWrites(writes: Write[], maxBytes = MAX_BATCH_BYTES): Write[][] {
  const ordered = [...writes.filter((w) => w.value !== null), ...writes.filter((w) => w.value === null)];
  const batches: Write[][] = [];
  let cur: Write[] = [];
  let size = 0;
  for (const w of ordered) {
    const n = estimateBytes(w);
    if (cur.length > 0 && size + n > maxBytes) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(w);
    size += n;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/**
 * 백업으로 전체 데이터를 교체합니다. 호출 전에 반드시 긴급 백업을 저장해야 합니다(useSettingsPage).
 * 기존 연도 샤드 중 백업에 없는 연도는 삭제합니다. 보통 크기에서는 하나의 원자적 트랜잭션으로 수행합니다.
 * 데이터가 매우 커서 저널 값이 한도에 가까워지면 여러 번에 나눠 커밋합니다(이 경우 도중에 앱이 꺼지면 일부만 바뀔 수 있으므로 긴급 백업으로 되돌립니다).
 */
export async function replaceAllData(payload: BackupPayload): Promise<void> {
  const rest: Write[][] = [];
  await transact(async () => {
    const existing = await listKeys();
    const writes: Write[] = [];
    for (const k of existing) {
      if (DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k)) writes.push({ key: k, value: null });
    }
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
    for (const [ym, list] of byMonth) writes.push({ key: donationKey(ym), value: list });
    for (const [y, list] of Object.entries(payload.auditLogsByYear)) writes.push({ key: auditKey(y), value: list });
    // 같은 키에 대한 삭제→쓰기 순서가 보장되도록 마지막 쓰기만 남깁니다.
    const last = new Map<string, Write>();
    for (const w of writes) last.set(w.key, w);
    const [first = [], ...others] = splitWrites([...last.values()]);
    rest.push(...others);
    return { writes: first, result: undefined };
  });
  for (const batch of rest) await transact(async () => ({ writes: batch, result: undefined }));
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

