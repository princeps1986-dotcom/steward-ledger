import localforage from 'localforage';
import type { Donation } from '../../contexts/types';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 헌금 내역은 월별(donations_YYYY-MM), 수정/삭제 이력은 연도별(audit_logs_YYYY)로 샤딩합니다. 저장소 + 저널(redo log) 기반 다중 키 원자적 커밋.
 * localForage는 다중 키 트랜잭션을 제공하지 않으므로, 쓰기 목록을 먼저 저널 키에 기록한 뒤 적용하고,
 * 적용 도중 앱이 종료되면 다음 실행 시 recoverJournal()이 남은 쓰기를 재적용합니다.
 */
const store = localforage.createInstance({ name: 'church-offering-ledger', storeName: 'kv' });

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

let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

async function applyWrites(writes: Write[]): Promise<void> {
  for (const w of writes) {
    if (w.value === null) await store.removeItem(w.key);
    else await store.setItem(w.key, w.value);
  }
}

const isDataKey = (k: string): boolean =>
  k === KEYS.members || k === KEYS.offeringTypes || DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k);

/** 끝나지 못한 트랜잭션(저널)이 남아 있으면 마저 적용합니다. 값은 절대값이라 여러 번 적용해도 결과가 같습니다. */
async function replayPending(): Promise<boolean> {
  const pending = await store.getItem<Write[]>(KEYS.journal);
  if (!pending) return false;
  await applyWrites(pending);
  await store.removeItem(KEYS.journal);
  return true;
}

export async function recoverJournal(): Promise<boolean> {
  return serialize(replayPending);
}

/**
 * 최신 저장 값을 읽어 쓰기 목록을 만들고 원자적으로 커밋합니다. 모든 트랜잭션은 직렬화됩니다.
 * 데이터 키가 바뀌면 '마지막 백업 이후 변경' 플래그를 세웁니다.
 */
export function transact<R>(
  build: (read: Reader) => Promise<{ writes: Write[]; result: R }>,
  opts: { markDirty?: boolean } = {},
): Promise<{ writes: Write[]; result: R }> {
  return serialize(async () => {
    // 앞선 쓰기가 디스크 부족 등으로 도중에 실패해 저널이 남아 있으면, 새 저널이 그것을 덮어쓰기 전에 먼저 마저 적용합니다.
    await replayPending();
    const read: Reader = (key) => store.getItem(key);
    const { writes, result } = await build(read);
    if (writes.length === 0) return { writes, result };
    const all = [...writes];
    if ((opts.markDirty ?? true) && writes.some((w) => isDataKey(w.key))) all.push({ key: KEYS.dirty, value: true });
    await store.setItem(KEYS.journal, all);
    await applyWrites(all);
    await store.removeItem(KEYS.journal);
    broadcastChanged(all.map((w) => w.key));
    return { writes, result };
  });
}

export const getItem = <T>(key: string): Promise<T | null> => store.getItem<T>(key);

export async function listKeys(): Promise<string[]> {
  return store.keys();
}

/** 저장된 월별 헌금 키 전체(시간 순) */
export async function listDonationKeys(): Promise<string[]> {
  return (await store.keys()).filter((k) => DONATION_KEY_RE.test(k)).sort();
}

export async function listDonationYears(): Promise<string[]> {
  const years = new Set((await listDonationKeys()).map((k) => DONATION_KEY_RE.exec(k)![1].slice(0, 4)));
  return [...years].sort();
}

/** 한 해의 헌금 내역(월별 키 12개를 읽어 합침) */
export async function readDonationYear(read: Reader, year: string): Promise<Donation[]> {
  const out: Donation[] = [];
  for (const ym of monthsOfYear(year)) out.push(...((await read<Donation[]>(donationKey(ym))) ?? []));
  return out;
}

/**
 * 이전 버전의 연도별 헌금 키(donations_YYYY)를 월별 키로 한 번만 옮깁니다(앱 시작 시, 화면이 뜨기 전).
 * 월별 쓰기와 연도 키 삭제를 저널로 묶어, 도중에 종료돼도 다음 실행에서 마저 적용됩니다.
 */
export async function migrateDonationsToMonthly(): Promise<boolean> {
  return serialize(async () => {
    if ((await store.getItem<boolean>(KEYS.migrationDonationsMonthly)) === true) return false;
    let moved = false;
    // 연도 키 하나씩 따로 커밋합니다: 저널은 한 값으로 저장되는데 IndexedDB 값 크기 한도(약 128MB)가 있어
    // 여러 해를 한 저널에 담으면 데이터가 많은 교회에서 실패할 수 있습니다.
    for (const k of (await store.keys()).filter((x) => LEGACY_DONATION_KEY_RE.test(x))) {
      const byMonth = new Map<string, Donation[]>();
      for (const d of (await store.getItem<Donation[]>(k)) ?? []) {
        const ym = monthOfDate(d.date);
        const list = byMonth.get(ym) ?? (await store.getItem<Donation[]>(donationKey(ym))) ?? [];
        list.push(d);
        byMonth.set(ym, list);
      }
      const writes: Write[] = [...byMonth].map(([ym, list]) => ({ key: donationKey(ym), value: list }));
      writes.push({ key: k, value: null });
      await store.setItem(KEYS.journal, writes);
      await applyWrites(writes);
      await store.removeItem(KEYS.journal);
      moved = moved || byMonth.size > 0;
    }
    await store.setItem(KEYS.migrationDonationsMonthly, true);
    return moved;
  });
}

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await store.getItem<boolean>(KEYS.dirty)) === true;
}

export async function clearDirty(): Promise<void> {
  await serialize(() => store.setItem(KEYS.dirty, false));
}
