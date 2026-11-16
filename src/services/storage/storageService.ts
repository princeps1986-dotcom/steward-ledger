import type { Donation } from '../../contexts/types';
import { db } from './db';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 헌금 내역은 월별(donations_YYYY-MM), 수정/삭제 이력은 연도별(audit_logs_YYYY)로 샤딩합니다.
 * 저장소는 Dexie(IndexedDB)입니다. 여러 키를 읽고 쓰는 한 번의 작업(transact)은 IndexedDB 트랜잭션 하나로 처리되어,
 * 도중에 앱이 종료돼도 전부 반영되거나 전부 반영되지 않습니다(이전 localForage 시절의 저널 방식은 필요 없어졌습니다).
 */

export const KEYS = {
  members: 'members',
  offeringTypes: 'offering_types',
  settings: 'settings',
  /** v2.1 헌금 종류 기본값 보정을 이미 수행했는지 */
  migrationOfferingV21: 'meta_migration_offering_v21',
  /** v2.2 건축·선교헌금 금액 단추 추가를 이미 수행했는지 */
  migrationOfferingV22: 'meta_migration_offering_v22',
  migrationOfferingV23: 'meta_migration_offering_v23',
  /** v2.14 구제헌금·특별헌금 추가를 이미 수행했는지 */
  migrationOfferingV24: 'meta_migration_offering_v24',
  /** v2.15 직분 '성도'(이전 기본값) 정리를 이미 수행했는지 */
  migrationPositionV25: 'meta_migration_position_v25',
  /** v2.2 큰 금액 확인 기준 기본값(1천만 원) 보정을 이미 수행했는지 */
  migrationSettingsV22: 'meta_migration_settings_v22',
  /** v1.2 헌금 내역 저장 단위를 연도 → 월로 바꾸는 이전을 이미 수행했는지 */
  migrationDonationsMonthly: 'meta_migration_donations_monthly_v1',
  dirty: 'meta_dirty_since_backup',
  /** 이전(localForage) 버전이 커밋 도중 종료되어 남긴 저널. 시작할 때 recoverJournal()이 한 번 마저 적용하고 지웁니다. */
  journal: 'meta_journal',
} as const;

/** 헌금 내역 키: ym = 'YYYY-MM' */
export const donationKey = (ym: string): string => `donations_${ym}`;
export const auditKey = (year: string): string => `audit_logs_${year}`;
/** 월별 헌금 키. 첫 그룹 = 'YYYY-MM' */
export const DONATION_KEY_RE = /^donations_(\d{4}-\d{2})$/;
/** 이전 버전(연도별) 헌금 키 — 시작할 때 월별로 이전합니다. */
const LEGACY_DONATION_KEY_RE = /^donations_(\d{4})$/;
export const monthOfDate = (date: string): string => date.slice(0, 7);
/** 월별 목록을 쓰는 값: 비면 키를 지웁니다. */
export const monthWrite = (ym: string, list: Donation[]): Write => ({ key: donationKey(ym), value: list.length ? list : null });
export const monthsOfYear = (year: string): string[] => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
export const AUDIT_KEY_RE = /^audit_logs_(\d{4})$/;

/** value가 null이면 키 삭제 */
export interface Write {
  key: string;
  value: unknown;
}

export type Reader = <T>(key: string) => Promise<T | null>;

/** 키 하나 읽기(없으면 null). 트랜잭션 안에서 부르면 그 트랜잭션에 참여합니다. */
export const getItem = async <T>(key: string): Promise<T | null> => ((await db.kv.get(key)) as T | undefined) ?? null;

const isDataKey = (k: string): boolean =>
  k === KEYS.members || k === KEYS.offeringTypes || DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k);

/** 쓰기 목록을 적용합니다(같은 키는 마지막 쓰기만). 반드시 열려 있는 쓰기 트랜잭션 안에서 부릅니다. */
async function applyWrites(writes: Write[]): Promise<void> {
  const last = new Map<string, Write>();
  for (const w of writes) last.set(w.key, w);
  const puts: Write[] = [];
  const removes: string[] = [];
  for (const w of last.values()) {
    if (w.value === null) removes.push(w.key);
    else puts.push(w);
  }
  if (removes.length) await db.kv.bulkDelete(removes);
  if (puts.length) await db.kv.bulkPut(puts.map((w) => w.value), puts.map((w) => w.key));
}

// 한 번에 하나씩 커밋합니다(앞 작업이 끝난 뒤의 최신 값을 읽도록 하고, 다른 창 알림 순서를 유지).
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

/**
 * 최신 저장 값을 읽어 쓰기 목록을 만들고 하나의 IndexedDB 트랜잭션으로 커밋합니다. build 안에서는 read와
 * 이 파일의 읽기 함수(getItem·listKeys·listDonationKeys)만 기다려야 합니다(다른 비동기 작업을 기다리면 트랜잭션이 먼저 끝납니다).
 * 데이터 키가 바뀌면 '마지막 백업 이후 변경' 플래그를 세웁니다.
 */
export function transact<R>(
  build: (read: Reader) => Promise<{ writes: Write[]; result: R }>,
  opts: { markDirty?: boolean } = {},
): Promise<{ writes: Write[]; result: R }> {
  return serialize(async () => {
    const out = await db.transaction('rw', db.kv, async () => {
      const { writes, result } = await build(getItem);
      const all = [...writes];
      if (all.length > 0 && (opts.markDirty ?? true) && writes.some((w) => isDataKey(w.key))) all.push({ key: KEYS.dirty, value: true });
      if (all.length > 0) await applyWrites(all);
      return { writes, result, keys: all.map((w) => w.key) };
    });
    if (out.keys.length > 0) broadcastChanged(out.keys);
    return { writes: out.writes, result: out.result };
  });
}

/**
 * 이전(localForage) 버전이 커밋 도중 종료되어 남긴 저널이 있으면 한 번 마저 적용하고 지웁니다(앱 시작 시).
 * 값은 절대값이라 여러 번 적용해도 결과가 같습니다. 새 버전은 저널을 만들지 않습니다.
 */
export async function recoverJournal(): Promise<boolean> {
  return serialize(() =>
    db.transaction('rw', db.kv, async () => {
      const pending = await getItem<Write[]>(KEYS.journal);
      if (!pending) return false;
      await applyWrites(pending);
      await db.kv.delete(KEYS.journal);
      return true;
    }),
  );
}

export async function listKeys(): Promise<string[]> {
  return (await db.kv.toCollection().primaryKeys()).map(String);
}

/** 저장된 월별 헌금 키 전체(시간 순). 'donations_' 범위만 읽습니다. */
export async function listDonationKeys(): Promise<string[]> {
  const keys = await db.kv.where(':id').startsWith('donations_').primaryKeys();
  return keys.map(String).filter((k) => DONATION_KEY_RE.test(k)).sort();
}

export async function listDonationYears(): Promise<string[]> {
  const years = new Set((await listDonationKeys()).map((k) => DONATION_KEY_RE.exec(k)![1].slice(0, 4)));
  return [...years].sort();
}

/** 한 해의 헌금 내역(월별 키 12개를 읽어 합침) */
export async function readDonationYear(read: Reader, year: string): Promise<Donation[]> {
  const lists = await Promise.all(monthsOfYear(year).map((ym) => read<Donation[]>(donationKey(ym))));
  return lists.flatMap((l) => l ?? []);
}

/**
 * 이전 버전의 연도별 헌금 키(donations_YYYY)를 월별 키로 한 번만 옮깁니다(앱 시작 시, 화면이 뜨기 전).
 * 연도 키 하나를 옮기는 작업(월별 쓰기 + 연도 키 삭제)이 트랜잭션 하나라, 도중에 종료돼도 그 연도는 옮기기 전 상태로 남습니다.
 */
export async function migrateDonationsToMonthly(): Promise<boolean> {
  return serialize(async () => {
    if ((await getItem<boolean>(KEYS.migrationDonationsMonthly)) === true) return false;
    let moved = false;
    for (const k of (await listKeys()).filter((x) => LEGACY_DONATION_KEY_RE.test(x))) {
      const didMove = await db.transaction('rw', db.kv, async () => {
        const byMonth = new Map<string, Donation[]>();
        for (const d of (await getItem<Donation[]>(k)) ?? []) {
          const ym = monthOfDate(d.date);
          const list = byMonth.get(ym) ?? (await getItem<Donation[]>(donationKey(ym))) ?? [];
          list.push(d);
          byMonth.set(ym, list);
        }
        const writes: Write[] = [...byMonth].map(([ym, list]) => ({ key: donationKey(ym), value: list }));
        writes.push({ key: k, value: null });
        await applyWrites(writes);
        return byMonth.size > 0;
      });
      moved = moved || didMove;
    }
    await db.kv.put(true, KEYS.migrationDonationsMonthly);
    return moved;
  });
}

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await getItem<boolean>(KEYS.dirty)) === true;
}

export async function clearDirty(): Promise<void> {
  await serialize(() => db.kv.put(false, KEYS.dirty).then(() => undefined));
}
