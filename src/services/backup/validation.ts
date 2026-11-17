import type { AuditLog, BackupEnvelope, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { APP_VERSION, SCHEMA_VERSION } from '../../contexts/types';

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 자동 백업(줄 단위 JSON, v3)의 머리글에 들어가는 형식 번호 */
export const NDJSON_VERSION = 3;
export const NDJSON_PREFIX = `{"ndjson":${NDJSON_VERSION}`;

/**
 * 줄 단위 백업을 기존 백업과 같은 모양({schemaVersion, payload})으로 되돌립니다. 마지막 줄의 SHA-256으로 온전한지 먼저 확인합니다.
 * 실패하면 오류 문구(string)를 돌려줍니다.
 */
async function parseNdjson(text: string): Promise<{ appVersion?: string; exportedAt?: string; schemaVersion: number; payload: unknown } | string> {
  const cut = text.lastIndexOf('\n{"t":"end"');
  if (cut < 0) return '백업 파일이 끝까지 저장되지 않았습니다(끝 표시가 없음).';
  let end: unknown;
  try {
    end = JSON.parse(text.slice(cut + 1));
  } catch {
    return '백업 파일이 끝까지 저장되지 않았습니다.';
  }
  if (!isObj(end) || (await sha256Hex(text.slice(0, cut + 1))) !== end.sha256) return '무결성 검증 실패: 파일이 손상되었거나 변조되었습니다.';
  let head: Record<string, unknown> | null = null;
  let members: unknown = [];
  let offeringTypes: unknown = [];
  const donationsByYear: Record<string, unknown[]> = {};
  const auditLogsByYear: Record<string, unknown> = {};
  try {
    for (const l of text.slice(0, cut).split('\n')) {
      if (!l) continue;
      const o = JSON.parse(l) as Record<string, unknown>;
      if (head === null) head = o;
      else if (o.t === 'members') members = o.data;
      else if (o.t === 'offeringTypes') offeringTypes = o.data;
      else if (o.t === 'donations' && isStr(o.ym) && Array.isArray(o.data)) (donationsByYear[o.ym.slice(0, 4)] ??= []).push(...o.data);
      else if (o.t === 'audit' && isStr(o.year)) auditLogsByYear[o.year] = o.data;
    }
  } catch {
    return 'JSON 파일을 읽을 수 없습니다.';
  }
  return {
    appVersion: isStr(head?.appVersion) ? head.appVersion : undefined,
    exportedAt: isStr(head?.exportedAt) ? head.exportedAt : undefined,
    schemaVersion: SCHEMA_VERSION,
    payload: { members, offeringTypes, donationsByYear, auditLogsByYear },
  };
}

/** payload의 JSON 직렬화 문자열에 대한 SHA-256 */
export const computeChecksum = (payload: unknown): Promise<string> => sha256Hex(JSON.stringify(payload));

export type BackupParseResult =
  | { ok: true; envelope: BackupEnvelope; migratedFrom: number | null }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const YEAR_RE = /^\d{4}$/;

export function isMember(v: unknown): v is Member {
  return isObj(v) && isStr(v.id) && isStr(v.name) && typeof v.isActive === 'boolean';
}
export function isOfferingType(v: unknown): v is OfferingType {
  return isObj(v) && isStr(v.id) && isStr(v.name) && Array.isArray(v.quickAmounts);
}
export function isDonation(v: unknown): v is Donation {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    (v.memberId === null || isStr(v.memberId)) &&
    isStr(v.offeringTypeId) &&
    Number.isSafeInteger(v.amount)
  );
}
export function isAuditLike(v: unknown): v is AuditLog {
  return isObj(v) && isStr(v.id) && isStr(v.targetId) && isDonation(v.beforeSnapshot);
}

/** 연도 샤드 키와 각 레코드의 날짜 연도가 일치하는지까지 확인합니다. */
function validateV2Payload(p: unknown): string | null {
  if (!isObj(p)) return 'payload 형식이 아닙니다.';
  if (!Array.isArray(p.members) || !p.members.every(isMember)) return '성도 명단 형식이 올바르지 않습니다.';
  if (!Array.isArray(p.offeringTypes) || !p.offeringTypes.every(isOfferingType)) return '헌금 종류 형식이 올바르지 않습니다.';
  if (!isObj(p.donationsByYear)) return '헌금 내역 형식이 올바르지 않습니다.';
  for (const [y, list] of Object.entries(p.donationsByYear)) {
    if (!YEAR_RE.test(y) || !Array.isArray(list) || !list.every(isDonation)) return `${y}년 헌금 내역 형식이 올바르지 않습니다.`;
    if (list.some((d) => d.date.slice(0, 4) !== y)) return `${y}년 샤드에 다른 연도 내역이 섞여 있습니다.`;
  }
  if (!isObj(p.auditLogsByYear)) return '감사 로그 형식이 올바르지 않습니다.';
  for (const [y, list] of Object.entries(p.auditLogsByYear)) {
    if (!YEAR_RE.test(y) || !Array.isArray(list) || !list.every(isAuditLike)) return `${y}년 감사 로그 형식이 올바르지 않습니다.`;
  }
  return null;
}

export const fillReason = (logs: AuditLog[]): AuditLog[] =>
  logs.map((l) => (isStr(l.reason) && l.reason.trim() ? l : { ...l, reason: '(사유 미기록)' }));

/**
 * v1 → v2 마이그레이션.
 * v1 가정: payload = { members, offeringTypes, donations: Donation[], auditLogs?: AuditLog[] } (연도 샤딩·세대 스냅샷 없음)
 * 세대 스냅샷은 복원 시점의 성도 familyGroupId로 채웁니다(과거 이력이 없으므로 최선의 근사치).
 */
function migrateV1(p: Record<string, unknown>): BackupPayload | string {
  const members = p.members;
  const offeringTypes = p.offeringTypes;
  const donations = p.donations;
  if (!Array.isArray(members) || !members.every(isMember)) return 'v1 성도 명단 형식이 올바르지 않습니다.';
  if (!Array.isArray(offeringTypes) || !offeringTypes.every(isOfferingType)) return 'v1 헌금 종류 형식이 올바르지 않습니다.';
  if (!Array.isArray(donations) || !donations.every(isDonation)) return 'v1 헌금 내역 형식이 올바르지 않습니다.';
  const groupOf = new Map(members.map((m) => [m.id, m.familyGroupId ?? null]));
  const donationsByYear: Record<string, Donation[]> = {};
  for (const d of donations) {
    const y = d.date.slice(0, 4);
    (donationsByYear[y] ??= []).push({
      ...d,
      familyGroupIdSnapshot: d.familyGroupIdSnapshot ?? (d.memberId ? groupOf.get(d.memberId) ?? null : null),
    });
  }
  const auditLogsByYear: Record<string, AuditLog[]> = {};
  const logs = Array.isArray(p.auditLogs) ? p.auditLogs.filter(isAuditLike) : [];
  for (const l of fillReason(logs)) {
    const y = (l.afterSnapshot?.date ?? l.beforeSnapshot.date).slice(0, 4);
    (auditLogsByYear[y] ??= []).push(l);
  }
  return {
    members: members.map((m) => ({ ...m, isFamilyHead: !!m.isFamilyHead })),
    offeringTypes,
    donationsByYear,
    auditLogsByYear,
  };
}

export async function parseAndValidateBackup(text: string): Promise<BackupParseResult> {
  let raw: unknown;
  let verified = false; // 줄 단위 백업은 parseNdjson에서 이미 체크섬을 확인했습니다.
  if (text.startsWith(NDJSON_PREFIX)) {
    raw = await parseNdjson(text);
    if (typeof raw === 'string') return { ok: false, error: raw };
    verified = true;
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: 'JSON 파일을 읽을 수 없습니다.' };
    }
  }
  if (!isObj(raw) || !isObj(raw.payload)) return { ok: false, error: '백업 파일 형식이 아닙니다.' };
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (version > SCHEMA_VERSION) return { ok: false, error: `더 새로운 버전(v${version})의 백업입니다. 앱을 업데이트하세요.` };

  if (!verified) {
    if (isStr(raw.checksum) && raw.checksum) {
      const actual = await computeChecksum(raw.payload);
      if (actual !== raw.checksum) return { ok: false, error: '무결성 검증 실패: 파일이 손상되었거나 변조되었습니다.' };
    } else if (version >= 2) {
      return { ok: false, error: '체크섬이 없는 백업 파일입니다.' };
    }
  }

  let payload: BackupPayload;
  if (version === 1) {
    const migrated = migrateV1(raw.payload);
    if (typeof migrated === 'string') return { ok: false, error: migrated };
    payload = migrated;
  } else {
    const err = validateV2Payload(raw.payload);
    if (err) return { ok: false, error: err };
    const p = raw.payload as unknown as BackupPayload;
    payload = {
      ...p,
      auditLogsByYear: Object.fromEntries(Object.entries(p.auditLogsByYear).map(([y, l]) => [y, fillReason(l)])),
    };
  }

  return {
    ok: true,
    migratedFrom: version === SCHEMA_VERSION ? null : version,
    envelope: {
      appVersion: isStr(raw.appVersion) ? raw.appVersion : APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : new Date().toISOString(),
      checksum: await computeChecksum(payload),
      payload,
    },
  };
}
