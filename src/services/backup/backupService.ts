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
  transact,
  type Write,
} from '../storage/storageService';
import { computeChecksum } from './validation';

/** 전역 로컬 데이터베이스를 백업 payload로 마샬링합니다. */
export async function collectPayload(): Promise<BackupPayload> {
  const keys = await listKeys();
  const donationsByYear: Record<string, Donation[]> = {};
  const auditLogsByYear: Record<string, AuditLog[]> = {};
  for (const k of keys.sort()) {
    const dy = DONATION_KEY_RE.exec(k)?.[1];
    if (dy) donationsByYear[dy] = (await getItem<Donation[]>(k)) ?? [];
    const ay = AUDIT_KEY_RE.exec(k)?.[1];
    if (ay) auditLogsByYear[ay] = (await getItem<AuditLog[]>(k)) ?? [];
  }
  return {
    members: (await getItem<Member[]>(KEYS.members)) ?? [],
    offeringTypes: (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [],
    donationsByYear,
    auditLogsByYear,
  };
}

export async function createBackupJson(): Promise<string> {
  const payload = await collectPayload();
  const envelope: BackupEnvelope = {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    checksum: await computeChecksum(payload),
    payload,
  };
  return JSON.stringify(envelope);
}

export const backupFileName = (prefix = 'backup'): string => `${prefix}_${nowStamp()}.json`;

export async function downloadBackup(prefix = 'backup'): Promise<string> {
  const name = backupFileName(prefix);
  downloadText(await createBackupJson(), name);
  return name;
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
    for (const [y, list] of Object.entries(payload.donationsByYear)) writes.push({ key: donationKey(y), value: list });
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

