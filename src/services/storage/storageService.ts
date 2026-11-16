import type { Donation } from '../../contexts/types';
import { db } from './db';
import { donationKey, DONATION_KEY_RE, AUDIT_KEY_RE, KEYS, monthsOfYear } from './keys';
import { toStorageError } from './storageErrors';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 헌금 내역은 월별(donations_YYYY-MM), 수정/삭제 이력은 연도별(audit_logs_YYYY)로 샤딩합니다.
 * 저장소는 Dexie(IndexedDB)입니다. 여러 키를 읽고 쓰는 한 번의 작업(transact)은 IndexedDB 트랜잭션 하나로 처리되어,
 * 도중에 앱이 종료돼도 전부 반영되거나 전부 반영되지 않습니다(이전 localForage 시절의 저널 방식은 필요 없어졌습니다).
 * 키 이름·키 규칙은 keys.ts, 데이터베이스 정의와 버전 업그레이드는 db.ts·schemaUpgrades.ts에 있습니다.
 */
export { KEYS, donationKey, auditKey, DONATION_KEY_RE, AUDIT_KEY_RE, monthOfDate, monthsOfYear } from './keys';

/** 월별 목록을 쓰는 값: 비면 키를 지웁니다. */
export const monthWrite = (ym: string, list: Donation[]): Write => ({ key: donationKey(ym), value: list.length ? list : null });

/** value가 null이면 키 삭제 */
export interface Write {
  key: string;
  value: unknown;
}

export type Reader = <T>(key: string) => Promise<T | null>;

/** 키 하나 읽기(없으면 null). 트랜잭션 안에서 부르면 그 트랜잭션에 참여합니다. */
export const getItem = async <T>(key: string): Promise<T | null> => ((await db.kv.get(key)) as T | undefined) ?? null;

/** 여러 키를 한 번에 읽습니다(결과는 keys와 같은 순서, 없으면 null). 키마다 따로 부르는 것보다 빠릅니다. */
export const getMany = async <T>(keys: string[]): Promise<(T | null)[]> =>
  ((await db.kv.bulkGet(keys)) as (T | undefined)[]).map((v) => v ?? null);

/**
 * 읽기 전용 트랜잭션 하나 안에서 fn을 실행합니다. fn 안에서 getItem·getMany·listKeys로 읽은 값은 모두 같은 시점의 값입니다
 * (읽는 도중 다른 저장이 커밋돼도 섞이지 않음). fn 안에서는 이 파일의 읽기 함수만 기다려야 합니다.
 */
export const snapshot = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('r', db.kv, fn).catch((e) => Promise.reject(toStorageError(e)));

const isDataKey = (k: string): boolean =>
  k === KEYS.members || k === KEYS.offeringTypes || DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k);

/**
 * 월 배열(donations_YYYY-MM)이 바뀔 때 행 단위 테이블(db.donations)도 같은 트랜잭션에서 맞춥니다(이중 기록).
 * 이전 배열과 비교해 바뀐 행만 쓰고 사라진 행만 지웁니다. 읽기는 아직 월 배열만 씁니다.
 * shortcut: 비교 비용이 월 건수에 비례합니다. 쓰기를 행 단위로 전환하는 단계에서 이 함수는 없어집니다.
 */
async function mirrorMonth(key: string, next: Donation[]): Promise<void> {
  const prev = ((await db.kv.get(key)) as Donation[] | undefined) ?? [];
  const before = new Map(prev.map((d) => [d.id, { json: JSON.stringify(d), date: d.date }]));
  const puts: Donation[] = [];
  const removes: [string, string][] = [];
  for (const d of next) {
    const old = before.get(d.id);
    if (!old || old.json !== JSON.stringify(d)) {
      puts.push(d);
      if (old && old.date !== d.date) removes.push([old.date, d.id]); // 같은 달 안에서 날짜가 바뀌면 이전 키를 지웁니다
    }
    before.delete(d.id);
  }
  for (const [id, old] of before) removes.push([old.date, id]);
  if (removes.length) await db.donations.bulkDelete(removes);
  if (puts.length) await db.donations.bulkPut(puts);
}

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
  for (const k of removes) if (DONATION_KEY_RE.test(k)) await mirrorMonth(k, []);
  for (const w of puts) if (DONATION_KEY_RE.test(w.key)) await mirrorMonth(w.key, w.value as Donation[]);
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
 * 이 파일의 읽기 함수(getItem·getMany·listKeys·listDonationKeys)만 기다려야 합니다(다른 비동기 작업을 기다리면 트랜잭션이 먼저 끝납니다).
 * 데이터 키가 바뀌면 '마지막 백업 이후 변경' 플래그를 세웁니다.
 * 저장 공간 부족 같은 저장소 오류는 한글 안내(StorageError)로 바뀌고, build가 던진 업무 규칙 오류는 그대로 전달됩니다.
 */
export function transact<R>(
  build: (read: Reader) => Promise<{ writes: Write[]; result: R }>,
  opts: { markDirty?: boolean } = {},
): Promise<{ writes: Write[]; result: R }> {
  return serialize(async () => {
    try {
      const out = await db.transaction('rw', db.kv, db.donations, async () => {
        const { writes, result } = await build(getItem);
        const all = [...writes];
        if (all.length > 0 && (opts.markDirty ?? true) && writes.some((w) => isDataKey(w.key))) all.push({ key: KEYS.dirty, value: true });
        if (all.length > 0) await applyWrites(all);
        return { writes, result, keys: all.map((w) => w.key) };
      });
      if (out.keys.length > 0) broadcastChanged(out.keys);
      return { writes: out.writes, result: out.result };
    } catch (e) {
      throw toStorageError(e);
    }
  });
}

/**
 * 이전(localForage) 버전이 커밋 도중 종료되어 남긴 저널이 있으면 한 번 마저 적용하고 지웁니다(앱 시작 시).
 * 값은 절대값이라 여러 번 적용해도 결과가 같습니다. 새 버전은 저널을 만들지 않습니다.
 * 데이터베이스를 처음 여는 호출이라, 열기에 실패하면(예: 더 새로운 버전의 데이터) 한글 안내 오류를 던집니다.
 */
export async function recoverJournal(): Promise<boolean> {
  return serialize(async () => {
    try {
      return await db.transaction('rw', db.kv, db.donations, async () => {
        const pending = await getItem<Write[]>(KEYS.journal);
        if (!pending) return false;
        await applyWrites(pending);
        await db.kv.delete(KEYS.journal);
        return true;
      });
    } catch (e) {
      throw toStorageError(e);
    }
  });
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

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await getItem<boolean>(KEYS.dirty)) === true;
}

export async function clearDirty(): Promise<void> {
  await serialize(() => db.kv.put(false, KEYS.dirty).then(() => undefined));
}
