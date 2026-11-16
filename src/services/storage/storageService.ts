import localforage from 'localforage';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 연도별 샤딩 저장소 + 저널(redo log) 기반 다중 키 원자적 커밋.
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
  dirty: 'meta_dirty_since_backup',
  journal: 'meta_journal',
} as const;

export const donationKey = (year: string): string => `donations_${year}`;
export const auditKey = (year: string): string => `audit_logs_${year}`;
export const DONATION_KEY_RE = /^donations_(\d{4})$/;
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

export async function recoverJournal(): Promise<boolean> {
  return serialize(async () => {
    const pending = await store.getItem<Write[]>(KEYS.journal);
    if (!pending) return false;
    await applyWrites(pending);
    await store.removeItem(KEYS.journal);
    return true;
  });
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

export async function listDonationYears(): Promise<string[]> {
  const keys = await store.keys();
  return keys
    .map((k) => DONATION_KEY_RE.exec(k)?.[1])
    .filter((y): y is string => !!y)
    .sort();
}

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await store.getItem<boolean>(KEYS.dirty)) === true;
}

export async function clearDirty(): Promise<void> {
  await serialize(() => store.setItem(KEYS.dirty, false));
}
