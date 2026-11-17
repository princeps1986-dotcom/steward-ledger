import Dexie from 'dexie';
import type { Donation } from '../../contexts/types';
import { db } from './db';
import { donationKey, DONATION_KEY_RE, AUDIT_KEY_RE, KEYS } from './keys';
import { toStorageError } from './storageErrors';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 헌금 내역은 행 단위 테이블(db.donations, 기본키 [날짜, id])에 한 건씩 저장하고, 수정/삭제 이력은 연도별(audit_logs_YYYY)로 샤딩합니다.
 * 쓰기 목록(Write)의 헌금 키(donations_YYYY-MM)는 '그 달의 행이 바뀐다'는 표시로 쓰이며(다른 창 알림·백업 이후 변경 표시), 값은 저장되지 않습니다.
 * 저장소는 Dexie(IndexedDB)입니다. 여러 키를 읽고 쓰는 한 번의 작업(transact)은 IndexedDB 트랜잭션 하나로 처리되어,
 * 도중에 앱이 종료돼도 전부 반영되거나 전부 반영되지 않습니다.
 * 키 이름·키 규칙은 keys.ts, 데이터베이스 정의는 db.ts에 있습니다.
 */
export { KEYS, donationKey, auditKey, DONATION_KEY_RE, AUDIT_KEY_RE, monthOfDate, monthsOfYear } from './keys';

/** 행 단위 변경: 넣거나 바꿀 내역과 지울 행의 기본키([날짜, id]). 같은 id를 지우고 넣으면 날짜가 바뀐 것입니다. */
export interface RowOps {
  puts: Donation[];
  deletes: [string, string][];
}

/**
 * value가 null이면 키 삭제. 헌금 키(donations_YYYY-MM)는 rowOps가 있으면 그 행만 바꾸고,
 * 없으면 value(목록)로 그 달 전체를 교체합니다(비면 그 달 삭제 — 백업 복원용).
 */
export interface Write {
  key: string;
  value: unknown;
  rowOps?: RowOps;
}

/** 그 달 전체를 이 목록으로 교체합니다(비면 그 달의 내역을 모두 지움). 복원처럼 달 전체를 바꿀 때만 쓰세요. */
export const monthWrite = (ym: string, list: Donation[]): Write => ({ key: donationKey(ym), value: list.length ? list : null });

/** 그 달의 행만 바꿉니다(저장·수정·삭제). */
export const rowWrite = (ym: string, ops: RowOps): Write => ({ key: donationKey(ym), value: null, rowOps: ops });

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
export const snapshot = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('r', db.kv, db.donations, fn).catch((e) => Promise.reject(toStorageError(e)));

const isDataKey = (k: string): boolean =>
  k === KEYS.members || k === KEYS.offeringTypes || DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k);

const monthRange = (ym: string) => db.donations.where('[date+id]').between([`${ym}-`, Dexie.minKey], [`${ym}-\uffff`, Dexie.maxKey], true, true);

async function applyDonationWrite(w: Write): Promise<void> {
  if (w.rowOps) {
    if (w.rowOps.deletes.length) await db.donations.bulkDelete(w.rowOps.deletes);
    if (w.rowOps.puts.length) await db.donations.bulkPut(w.rowOps.puts);
    return;
  }
  await monthRange(DONATION_KEY_RE.exec(w.key)![1]).delete();
  const list = w.value as Donation[] | null;
  if (list?.length) await db.donations.bulkPut(list);
}

/**
 * 쓰기 목록을 적용합니다. 반드시 열려 있는 쓰기 트랜잭션 안에서 부릅니다.
 * 헌금 키는 주어진 순서대로 적용하고(삭제→쓰기 순서 유지), 나머지 키는 같은 키의 마지막 쓰기만 적용합니다.
 */
async function applyWrites(writes: Write[]): Promise<void> {
  const last = new Map<string, Write>();
  for (const w of writes) {
    if (DONATION_KEY_RE.test(w.key)) await applyDonationWrite(w);
    else last.set(w.key, w);
  }
  const puts: Write[] = [];
  const removes: string[] = [];
  for (const w of last.values()) {
    if (w.value === null) removes.push(w.key);
    else puts.push(w);
  }
  if (removes.length) await db.kv.bulkDelete(removes);
  if (puts.length) await db.kv.bulkPut(puts.map((w) => w.value), puts.map((w) => w.key));
}

/**
 * 내역이 달을 넘어 옮겨졌거나(날짜 수정·되돌리기) 달 전체가 교체된(복원) 커밋의 누적 횟수.
 * 달마다 따로 읽는 주기 백업이 읽는 도중 이런 커밋이 있었는지 알아내, 옮겨진 내역이 두 번 담기거나 빠지지 않게 다시 읽도록 합니다.
 * 같은 달 안의 추가·수정·삭제는 어느 시점에 읽어도 일관되므로 세지 않습니다.
 */
let structuralCommits = 0;
export const structuralCommitCount = (): number => structuralCommits;

function movesAcrossMonths(writes: Write[]): boolean {
  const deleted = new Map<string, string>(); // id → 지운 달
  const put = new Map<string, string>(); // id → 넣은 달
  for (const w of writes) {
    const ym = DONATION_KEY_RE.exec(w.key)?.[1];
    if (!ym) continue;
    if (!w.rowOps) return true; // 달 전체 교체
    for (const [, id] of w.rowOps.deletes) deleted.set(id, ym);
    for (const p of w.rowOps.puts) put.set(p.id, ym);
  }
  for (const [id, ym] of deleted) if (put.has(id) && put.get(id) !== ym) return true;
  return false;
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
        // '마지막 백업 이후 변경' 표시는 아직 꺼져 있을 때만 씁니다(저장마다 같은 값을 다시 쓰지 않음).
        if (all.length > 0 && (opts.markDirty ?? true) && writes.some((w) => isDataKey(w.key)) && (await getItem<boolean>(KEYS.dirty)) !== true) {
          all.push({ key: KEYS.dirty, value: true });
        }
        if (all.length > 0) await applyWrites(all);
        return { writes, result, keys: all.map((w) => w.key), moved: movesAcrossMonths(writes) };
      });
      if (out.moved) structuralCommits++;
      if (out.keys.length > 0) broadcastChanged(out.keys);
      return { writes: out.writes, result: out.result };
    } catch (e) {
      throw toStorageError(e);
    }
  });
}

/**
 * 데이터베이스를 엽니다(앱 시작 시). 열기에 실패하면(예: 더 새로운 버전의 데이터) 한글 안내 오류를 던집니다.
 */
export async function openStorage(): Promise<void> {
  try {
    await db.open();
  } catch (e) {
    throw toStorageError(e);
  }
}

export async function listKeys(): Promise<string[]> {
  return (await db.kv.toCollection().primaryKeys()).map(String);
}

const byEntryOrder = (a: Donation, b: Donation): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** 한 달('YYYY-MM')의 헌금을 입력한 순서(만든 시각)대로 읽습니다. 날짜 범위만 읽습니다. */
export async function readMonth(ym: string): Promise<Donation[]> {
  return (await monthRange(ym).toArray()).sort(byEntryOrder);
}

/** 기본키([날짜, id])로 한 건 읽기(없으면 null) */
export const readRow = async (date: string, id: string): Promise<Donation | null> => (await db.donations.get([date, id])) ?? null;

/** id만 아는 한 건 찾기(날짜가 바뀌었을 수 있을 때). 전체를 훑으므로 드문 경우에만 쓰세요. */
export const findDonationById = async (id: string): Promise<Donation | null> => (await db.donations.filter((d) => d.id === id).first()) ?? null;

/** 헌금 종류를 쓰는 내역 수(색인 사용) */
export const countDonationsOfType = (offeringTypeId: string): Promise<number> => db.donations.where('offeringTypeId').equals(offeringTypeId).count();

/** 헌금이 있는 달 전체('YYYY-MM', 오름차순). 달마다 한 건만 찾으며 건너뛰므로 내역 수에 상관없이 빠릅니다. */
export async function listDonationMonths(): Promise<string[]> {
  const out: string[] = [];
  let from: [string, unknown] = ['', Dexie.minKey];
  for (;;) {
    const row = await db.donations.where('[date+id]').aboveOrEqual(from as never).first();
    if (!row) break;
    const ym = row.date.slice(0, 7);
    out.push(ym);
    const next = `${ym}-\uffff`;
    from = [next > row.date ? next : `${row.date}\u0000`, Dexie.minKey]; // 어떤 날짜 문자열이어도 앞으로 나아가게
  }
  return out;
}

export async function listDonationYears(): Promise<string[]> {
  return [...new Set((await listDonationMonths()).map((m) => m.slice(0, 4)))].sort();
}

/** 수정/삭제 이력이 있는 연도 키 전체(audit_logs_YYYY) */
export async function listAuditKeys(): Promise<string[]> {
  return (await listKeys()).filter((k) => AUDIT_KEY_RE.test(k)).sort();
}

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await getItem<boolean>(KEYS.dirty)) === true;
}

export async function clearDirty(): Promise<void> {
  await serialize(() => db.kv.put(false, KEYS.dirty).then(() => undefined));
}

/** 백업에 실패했을 때 '마지막 백업 이후 변경됨' 표시를 되돌립니다. */
export async function markDirty(): Promise<void> {
  await serialize(() => db.kv.put(true, KEYS.dirty).then(() => undefined));
}

/** [날짜+성도+헌금 종류]가 같은 기존 내역을 색인으로 찾습니다(무명은 중복 없음). 트랜잭션 안에서 부르면 그 시점의 값입니다. */
export const findDuplicateRow = (d: Pick<Donation, 'date' | 'memberId' | 'offeringTypeId'>): Promise<Donation | undefined> =>
  d.memberId === null ? Promise.resolve(undefined) : db.donations.where('[date+memberId+offeringTypeId]').equals([d.date, d.memberId, d.offeringTypeId]).first();
