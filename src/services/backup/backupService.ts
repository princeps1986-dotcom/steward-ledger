import type { AuditLog, BackupEnvelope, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { APP_VERSION, SCHEMA_VERSION } from '../../contexts/types';
import { nowStamp } from '../domain/dates';
import { newId } from '../domain/ids';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
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
import { computeChecksum } from './validation';

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
  const payload = await collectPayload(years);
  const envelope: BackupEnvelope = {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    checksum: await computeChecksum(payload),
    payload,
  };
  return JSON.stringify(envelope);
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
 * 백업에서 선택한 연도만 복원합니다. 호출 전에 반드시 긴급 백업을 내려받아야 합니다.
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

/**
 * 백업으로 전체 데이터를 교체합니다. 호출 전에 반드시 긴급 백업을 내려받아야 합니다(useBackupRestore).
 * 기존 연도 샤드 중 백업에 없는 연도는 삭제합니다. 하나의 원자적 트랜잭션으로 수행됩니다.
 */
export async function replaceAllData(payload: BackupPayload): Promise<void> {
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
    return { writes: [...last.values()], result: undefined };
  });
}

/**
 * 전체 데이터 초기화(v2.15): 성도·헌금 내역·수정/삭제 이력을 모두 지우고 헌금 종류는 기본값으로 되돌립니다.
 * 환경 설정(테마·메일 주소·백업 주기 등)은 유지합니다. 호출 전에 긴급 백업을 내려받아야 합니다.
 */
export async function resetAllData(): Promise<void> {
  await replaceAllData({
    members: [],
    offeringTypes: DEFAULT_OFFERING_TYPES.map((t) => ({ ...t, id: newId() })),
    donationsByYear: {},
    auditLogsByYear: {},
  });
}

