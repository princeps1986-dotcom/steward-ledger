import Dexie from 'dexie';
import type { AppSettings, AuditLog, Donation } from '../../contexts/types';
import { allowed, NOT_ALLOWED } from '../auth/access';
import { decryptJson, encryptJson, hasDataKey } from './cipher';
import { db, type AuditRow, type Sealable } from './db';
import { auditKey, donationKey, DONATION_KEY_RE, AUDIT_KEY_RE, KEYS } from './keys';
import { toStorageError } from './storageErrors';
import { broadcastChanged } from './tabSyncChannel';

/**
 * 헌금 내역은 행 단위 테이블(db.donations, 기본키 [날짜, id])에, 수정/삭제 이력은 행 단위 테이블(db.audits, 연도 색인)에 한 건씩 저장합니다.
 * 이력 키(audit_logs_YYYY)는 헌금 키처럼 '그 해의 이력'을 가리키는 이름으로만 쓰이며 kv에는 저장되지 않습니다.
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
  /** 이력 키(audit_logs_YYYY)에만: 있으면 그 해 이력에 이 행들만 덧붙입니다(value는 무시). 없으면 value로 그 해 전체를 교체합니다. */
  auditPuts?: AuditLog[];
}

/** 그 해 이력에 몇 건만 덧붙입니다(저장·수정·삭제·복구하기). 그 해 전체를 다시 쓰지 않습니다. */
export const auditAppend = (year: string, logs: AuditLog[]): Write => ({ key: auditKey(year), value: null, auditPuts: logs });

/** 그 달 전체를 이 목록으로 교체합니다(비면 그 달의 내역을 모두 지움). 복원처럼 달 전체를 바꿀 때만 쓰세요. */
export const monthWrite = (ym: string, list: Donation[]): Write => ({ key: donationKey(ym), value: list.length ? list : null });

const CLEAR_DONATIONS_KEY = '__clear_donations__';

/**
 * 모든 헌금 내역을 지우는 쓰기 목록(트랜잭션 안에서 부릅니다): 저장소를 통째로 비우고(clear), 다른 창 알림·변경 표시를 위한
 * 달별 빈 쓰기를 덧붙입니다. 이어지는 달 쓰기는 이미 빈 달의 범위 삭제를 건너뜁니다.
 */
export async function wipeDonationsWrites(): Promise<Write[]> {
  return [{ key: CLEAR_DONATIONS_KEY, value: null }, ...(await listDonationMonths()).map((ym) => monthWrite(ym, []))];
}

/** 그 달의 행만 바꿉니다(저장·수정·삭제). */
export const rowWrite = (ym: string, ops: RowOps): Write => ({ key: donationKey(ym), value: null, rowOps: ops });

type Reader = <T>(key: string) => Promise<T | null>;

const stripRow = ({ year: _y, seq: _s, ...log }: AuditRow): AuditLog => log;

// ── 건별 암호화(cipher.ts). 열쇠가 있을 때만 잠그고, 읽을 때는 enc가 있는 행만 풉니다(평문 행은 그대로).
// 트랜잭션 안에서 부를 수 있도록 WebCrypto 대기는 Dexie.waitFor로 감쌉니다(그냥 기다리면 IndexedDB 트랜잭션이 먼저 끝남).
const wait = <T>(p: Promise<T>): Promise<T> => Dexie.waitFor(p);
type Secret = Pick<Donation, 'amount' | 'donorDisplayName' | 'memo'>;
type AuditSecret = Pick<AuditLog, 'reason' | 'beforeSnapshot' | 'afterSnapshot' | 'actor'>;

async function sealDonations(list: Donation[]): Promise<Donation[]> {
  if (!hasDataKey() || list.length === 0) return list;
  return wait(
    Promise.all(
      list.map(async ({ amount, donorDisplayName, memo, ...open }) => ({ ...open, enc: await encryptJson({ amount, donorDisplayName, memo } satisfies Secret, `d:${open.id}`) }) as unknown as Donation),
    ),
  );
}

async function openDonations<T extends Donation & Sealable>(rows: T[]): Promise<Donation[]> {
  if (!rows.some((r) => r.enc)) return rows;
  return wait(
    Promise.all(
      rows.map(async ({ enc, ...open }) => (enc ? ({ ...open, ...(await decryptJson<Secret>(enc, `d:${open.id}`)) } as Donation) : (open as unknown as Donation))),
    ),
  );
}

async function sealAudits(rows: AuditRow[]): Promise<AuditRow[]> {
  if (!hasDataKey() || rows.length === 0) return rows;
  return wait(
    Promise.all(
      rows.map(async ({ reason, beforeSnapshot, afterSnapshot, actor, ...open }) => ({ ...open, enc: await encryptJson({ reason, beforeSnapshot, afterSnapshot, actor } satisfies AuditSecret, `a:${open.id}`) }) as unknown as AuditRow),
    ),
  );
}

async function openAudits(rows: AuditRow[]): Promise<AuditRow[]> {
  if (!rows.some((r) => r.enc)) return rows;
  return wait(Promise.all(rows.map(async ({ enc, ...open }) => (enc ? ({ ...open, ...(await decryptJson<AuditSecret>(enc, `a:${open.id}`)) } as AuditRow) : (open as AuditRow)))));
}

/** 성도 목록은 kv에 통째로 한 값으로 들어 있어 { enc }로 감쌉니다(다른 kv 값은 설정·종류라 평문). */
const sealMembers = async (list: unknown): Promise<unknown> => (hasDataKey() && Array.isArray(list) ? { enc: await wait(encryptJson(list, 'members')) } : list);
const openKv = async (key: string, v: unknown): Promise<unknown> =>
  key === KEYS.members && v && !Array.isArray(v) && (v as Sealable).enc ? wait(decryptJson((v as { enc: Uint8Array }).enc, 'members')) : v;

/** 한 해의 이력을 기록한 순서대로 읽습니다(없으면 null). */
async function readAuditYear(year: string): Promise<AuditLog[] | null> {
  const rows = await openAudits(await db.audits.where('year').equals(year).sortBy('seq'));
  return rows.length ? rows.map(stripRow) : null;
}

/**
 * 키 하나 읽기(없으면 null). 트랜잭션 안에서 부르면 그 트랜잭션에 참여합니다.
 * 이력 키(audit_logs_YYYY)는 이력 테이블에서 그 해의 행을 모아 배열로 돌려줍니다(v1의 연도별 배열과 같은 모양).
 */
export const getItem = async <T>(key: string): Promise<T | null> => {
  const ay = AUDIT_KEY_RE.exec(key)?.[1];
  if (ay) return (await readAuditYear(ay)) as T | null;
  return ((await openKv(key, await db.kv.get(key))) as T | undefined) ?? null;
};

/** 여러 키를 한 번에 읽습니다(결과는 keys와 같은 순서, 없으면 null). 키마다 따로 부르는 것보다 빠릅니다. */
export const getMany = async <T>(keys: string[]): Promise<(T | null)[]> => {
  const plain = keys.filter((k) => !AUDIT_KEY_RE.test(k));
  const kv = await Promise.all((await db.kv.bulkGet(plain)).map((v, j) => openKv(plain[j], v))) as (T | undefined)[];
  let i = 0;
  return Promise.all(keys.map((k) => (AUDIT_KEY_RE.test(k) ? getItem<T>(k) : (kv[i++] ?? null))));
};

/**
 * 읽기 전용 트랜잭션 하나 안에서 fn을 실행합니다. fn 안에서 getItem·getMany로 읽은 값은 모두 같은 시점의 값입니다
 * (읽는 도중 다른 저장이 커밋돼도 섞이지 않음). fn 안에서는 이 파일의 읽기 함수만 기다려야 합니다.
 */
export const snapshot = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('r', db.kv, db.donations, db.audits, fn).catch((e) => Promise.reject(toStorageError(e)));

const isDataKey = (k: string): boolean =>
  k === KEYS.members || k === KEYS.offeringTypes || DONATION_KEY_RE.test(k) || AUDIT_KEY_RE.test(k);

const monthRange = (ym: string) => db.donations.where('[date+id]').between([`${ym}-`, Dexie.minKey], [`${ym}-\uffff`, Dexie.maxKey], true, true);

async function applyDonationWrite(w: Write, written: Set<string> | null): Promise<void> {
  if (w.rowOps) {
    if (w.rowOps.deletes.length) await db.donations.bulkDelete(w.rowOps.deletes);
    if (w.rowOps.puts.length) await db.donations.bulkPut(await sealDonations(w.rowOps.puts));
    return;
  }
  const ym = DONATION_KEY_RE.exec(w.key)![1];
  // 방금 저장소를 비웠고 이 달을 아직 쓰지 않았다면 지울 것이 없습니다.
  if (!written || written.has(ym)) await monthRange(ym).delete();
  written?.add(ym);
  const list = w.value as Donation[] | null;
  if (list?.length) await db.donations.bulkPut(await sealDonations(list));
}

/**
 * 쓰기 목록을 적용합니다. 반드시 열려 있는 쓰기 트랜잭션 안에서 부릅니다.
 * 헌금·이력 키는 주어진 순서대로 적용하고(삭제→쓰기 순서 유지), 나머지 키는 같은 키의 마지막 쓰기만 적용합니다.
 */
async function applyAuditWrite(w: Write): Promise<void> {
  const year = AUDIT_KEY_RE.exec(w.key)![1];
  if (!w.auditPuts) await db.audits.where('year').equals(year).delete();
  const list = w.auditPuts ?? (w.value as AuditLog[] | null) ?? [];
  if (list.length) await db.audits.bulkAdd(await sealAudits(list.map((l) => ({ ...l, year }))));
}

async function applyWrites(writes: Write[]): Promise<void> {
  const last = new Map<string, Write>();
  let written: Set<string> | null = null; // 비운 뒤 이 묶음에서 이미 쓴 달
  for (const w of writes) {
    if (w.key === CLEAR_DONATIONS_KEY) {
      await db.donations.clear();
      written = new Set();
    } else if (DONATION_KEY_RE.test(w.key)) await applyDonationWrite(w, written);
    else if (AUDIT_KEY_RE.test(w.key)) await applyAuditWrite(w); // 이력도 주어진 순서대로(교체 → 덧붙이기)
    else last.set(w.key, w);
  }
  const puts: Write[] = [];
  const removes: string[] = [];
  for (const w of last.values()) {
    if (w.value === null) removes.push(w.key);
    else puts.push(w);
  }
  if (removes.length) await db.kv.bulkDelete(removes);
  if (puts.length) await db.kv.bulkPut(await Promise.all(puts.map((w) => (w.key === KEYS.members ? sealMembers(w.value) : w.value))), puts.map((w) => w.key));
}

/**
 * 내역이 달을 넘어 옮겨졌거나(날짜 수정·복구하기) 달 전체가 교체된(복원) 커밋의 누적 횟수.
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
 * 이 파일의 읽기 함수(getItem·getMany·readMonth·readRow 등)만 기다려야 합니다(다른 비동기 작업을 기다리면 트랜잭션이 먼저 끝납니다).
 * 데이터 키가 바뀌면 '마지막 백업 이후 변경' 플래그를 세웁니다.
 * 저장 공간 부족 같은 저장소 오류는 한글 안내(StorageError)로 바뀌고, build가 던진 업무 규칙 오류는 그대로 전달됩니다.
 */
export function transact<R>(
  build: (read: Reader) => Promise<{ writes: Write[]; result: R }>,
  opts: { markDirty?: boolean; ignoreYearLocks?: boolean } = {},
): Promise<{ writes: Write[]; result: R }> {
  return serialize(async () => {
    try {
      const out = await db.transaction('rw', db.kv, db.donations, db.audits, async () => {
        const { writes, result } = await build(getItem);
        // 연도 잠금: 잠긴 연도의 헌금 쓰기는 기본으로 모두 거절합니다(새 쓰기 길목도 자동으로 막힘).
        // 복원·초기화·시연만 관리자 전용 진입 함수가 확인하므로 ignoreYearLocks를 명시합니다.
        if (!opts.ignoreYearLocks) {
          const years = new Set(writes.flatMap((w) => DONATION_KEY_RE.exec(w.key)?.[1].slice(0, 4) ?? []));
          if (years.size) {
            const locked = (await getItem<Partial<AppSettings>>(KEYS.settings))?.lockedYears ?? [];
            const hit = [...years].find((y) => locked.includes(y));
            if (hit) throw new Error(`${hit}년은 잠겨 있어 입력·수정·삭제할 수 없습니다. 관리자가 [설정 정보]에서 잠금을 풀 수 있습니다.`);
          }
        }
        // 쓰기 길목의 역할 확인: 헌금·성도·이력을 바꾸는 쓰기는 입력/편집 권한이 있는 역할만(열람자는 화면을 우회해도 저장되지 않음). 복원·초기화·일괄 삭제는 각 진입 함수가 더 엄격히 확인합니다.
        if (writes.some((w) => isDataKey(w.key)) && !allowed('donation:write') && !allowed('catalog:edit')) throw new Error(NOT_ALLOWED);
        const all = [...writes];
        // '마지막 백업 이후 변경' 표시는 아직 꺼져 있을 때만 씁니다(저장마다 같은 값을 다시 쓰지 않음).
        if (all.length > 0 && (opts.markDirty ?? true) && writes.some((w) => isDataKey(w.key))) {
          if ((await getItem<boolean>(KEYS.dirty)) !== true) all.push({ key: KEYS.dirty, value: true });
          // 마지막 전체 백업 이후 바뀐 연도(주기 백업이 그 연도만 담음). 새 연도가 생길 때만 씁니다.
          const touched = new Set(writes.flatMap((w) => DONATION_KEY_RE.exec(w.key)?.[1].slice(0, 4) ?? AUDIT_KEY_RE.exec(w.key)?.[1] ?? []));
          if (touched.size) {
            const cur = (await getItem<string[]>(KEYS.dirtyYears)) ?? [];
            if ([...touched].some((y) => !cur.includes(y))) all.push({ key: KEYS.dirtyYears, value: [...new Set([...cur, ...touched])].sort() });
          }
        }
        if (all.length > 0) await applyWrites(all);
        return { writes, result, keys: all.map((w) => w.key).filter((k) => k !== CLEAR_DONATIONS_KEY), moved: movesAcrossMonths(writes) };
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

const byEntryOrder = (a: Donation, b: Donation): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * 한 달치를 읽을 때 같은 값의 문자열(성도 번호·헌금 종류·날짜·표기명)을 한 개로 합쳐 메모리를 줄입니다.
 * IndexedDB는 행마다 문자열을 새로 만들어 주므로, 합치지 않으면 같은 값이 수만 번 따로 메모리를 차지합니다.
 */
export function internDonations(rows: Donation[]): Donation[] {
  const pool = new Map<string, string>();
  const one = (v: string): string => {
    const hit = pool.get(v);
    if (hit !== undefined) return hit;
    pool.set(v, v);
    return v;
  };
  for (const r of rows) {
    r.date = one(r.date);
    r.offeringTypeId = one(r.offeringTypeId);
    r.donorDisplayName = one(r.donorDisplayName);
    if (r.memberId) r.memberId = one(r.memberId);
  }
  return rows;
}

/** 한 달('YYYY-MM')의 헌금을 입력한 순서(만든 시각)대로 읽습니다. 날짜 범위만 읽습니다. */
export async function readMonth(ym: string): Promise<Donation[]> {
  return internDonations(await openDonations(await monthRange(ym).toArray())).sort(byEntryOrder);
}

/** 하루('YYYY-MM-DD')의 헌금만 기본키 범위로 읽습니다(달 전체를 읽지 않음). 트랜잭션 안에서 부르면 그 시점의 값입니다. */
export const readDay = async (date: string): Promise<Donation[]> =>
  openDonations(await db.donations.where('[date+id]').between([date, Dexie.minKey], [date, Dexie.maxKey], true, true).toArray());

/** 기본키([날짜, id])로 한 건 읽기(없으면 null) */
export const readRow = async (date: string, id: string): Promise<Donation | null> => {
  const row = await db.donations.get([date, id]);
  return row ? (await openDonations([row]))[0] : null;
};

/**
 * id만 아는 한 건 찾기(날짜가 바뀌었을 수 있을 때). 기본키([날짜, id])만 묶음으로 훑어(내역 본문은 읽지 않음) 찾으면 그 한 건만 읽습니다.
 * 데이터가 많으면 여전히 전체 키를 훑을 수 있으니 드문 경우에만 쓰세요.
 */
export async function findDonationById(id: string, chunk = 50_000): Promise<Donation | null> {
  for (let after: [string, string] | null = null; ; ) {
    const coll = after ? db.donations.where('[date+id]').above(after) : db.donations.toCollection();
    const keys = (await coll.limit(chunk).primaryKeys()) as unknown as [string, string][];
    const hit = keys.find((k) => k[1] === id);
    if (hit) return readRow(hit[0], hit[1]);
    if (keys.length < chunk) return null;
    after = keys[keys.length - 1];
  }
}

/** 성도들의 헌금 전체(모든 연도)를 memberId 색인으로 읽습니다(전체를 훑지 않음). 기간은 부르는 쪽에서 거릅니다. */
export const readMemberDonations = async (memberIds: readonly string[]): Promise<Donation[]> =>
  memberIds.length ? openDonations(await db.donations.where('memberId').anyOf([...memberIds]).toArray()) : [];

/**
 * 연도 복원용: ids 중 years 밖(다른 연도)에 남아 있는 행을 지우는 쓰기 목록. 백업 뒤 날짜를 다른 연도로 옮긴 내역이
 * 복원으로 원래 연도에 다시 생겨 두 번 집계되지 않게 합니다. 기본키만 훑으므로 내역을 메모리에 올리지 않습니다.
 */
export async function strayRowWrites(ids: ReadonlySet<string>, years: ReadonlySet<string>): Promise<Write[]> {
  if (ids.size === 0) return [];
  const byMonth = new Map<string, [string, string][]>();
  await db.donations.toCollection().eachPrimaryKey(([date, id]) => {
    if (years.has(date.slice(0, 4)) || !ids.has(id)) return;
    const ym = date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push([date, id]);
  });
  return [...byMonth].map(([ym, deletes]) => rowWrite(ym, { puts: [], deletes }));
}

/** 그 연도의 헌금 건수(기본키 색인 범위로 세므로 내역을 읽지 않음) */
export const countYearDonations = (year: string): Promise<number> =>
  db.donations.where('[date+id]').between([`${year}-`, Dexie.minKey], [`${year}-￿`, Dexie.maxKey], true, true).count();

/** 달 범위('YYYY-MM' ~ 'YYYY-MM', 양 끝 포함)의 헌금 건수(색인 사용) */
export const countDonationsBetween = (fromYm: string, toYm: string): Promise<number> =>
  db.donations.where('[date+id]').between([`${fromYm}-`, Dexie.minKey], [`${toYm}-￿`, Dexie.maxKey], true, true).count();

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

/**
 * id가 prefix로 시작하는 성도·헌금 종류로 만든 헌금이 한 건이라도 있는지(색인 범위 조회라 데이터가 많아도 즉시).
 * 시연 데이터 판정용: 시연 헌금은 시연 종류(offeringTypeId)를 쓰고, 성도 헌금은 시연 성도(memberId)를 씁니다.
 */
export async function hasDonationWithPrefix(prefix: string): Promise<boolean> {
  const end = `${prefix}\uffff`;
  const byType = await db.donations.where('offeringTypeId').between(prefix, end, true, true).limit(1).count();
  if (byType > 0) return true;
  return (await db.donations.where('memberId').between(prefix, end, true, true).limit(1).count()) > 0;
}

export async function listDonationYears(): Promise<string[]> {
  return [...new Set((await listDonationMonths()).map((m) => m.slice(0, 4)))].sort();
}

/** 수정/삭제 이력이 있는 연도 키 전체(audit_logs_YYYY) */
export async function listAuditKeys(): Promise<string[]> {
  return ((await db.audits.orderBy('year').uniqueKeys()) as string[]).map(auditKey);
}

export async function isDirtySinceBackup(): Promise<boolean> {
  return (await getItem<boolean>(KEYS.dirty)) === true;
}

/** 마지막 전체 백업 이후 헌금·이력이 바뀐 연도(오름차순). []는 연도 변경 없음, null은 알 수 없음(전체 백업 기록 전). */
export async function dirtyYearsSinceFullBackup(): Promise<string[] | null> {
  return getItem<string[]>(KEYS.dirtyYears);
}

/**
 * '마지막 백업 이후 변경' 표시를 내립니다. full이면(모든 연도를 담은 백업) 바뀐 연도 목록을 []로 비웁니다.
 * 일부 연도만 담는 주기 백업은 목록을 남겨(담은 연도 keepYears를 더해), 다음 주기 백업과 종료 백업이 마지막 전체 백업 이후 변경을 놓치지 않게 합니다.
 */
export async function clearDirty(full = true, keepYears: readonly string[] = []): Promise<void> {
  await serialize(() =>
    db.transaction('rw', db.kv, async () => {
      await db.kv.put(false, KEYS.dirty);
      if (full) await db.kv.put([], KEYS.dirtyYears);
      else if (keepYears.length) {
        const cur = ((await db.kv.get(KEYS.dirtyYears)) as string[] | undefined) ?? [];
        await db.kv.put([...new Set([...cur, ...keepYears])].sort(), KEYS.dirtyYears);
      }
    }),
  );
}

/** 백업에 실패했을 때 '마지막 백업 이후 변경됨' 표시를 복구합니다. */
export async function markDirty(): Promise<void> {
  await serialize(() => db.kv.put(true, KEYS.dirty).then(() => undefined));
}

/**
 * 실패한 전체 백업이 내린 표시를 되돌립니다: flag면 '변경 있음'을 켜고, years를 바뀐 연도 목록에 더합니다.
 * 표시를 내리지는 않으므로 백업하는 동안 생긴 변경 표시는 그대로 남습니다.
 */
export async function restoreDirty(flag: boolean, years: readonly string[]): Promise<void> {
  await serialize(() =>
    db.transaction('rw', db.kv, async () => {
      if (flag) await db.kv.put(true, KEYS.dirty);
      if (years.length) {
        const cur = ((await db.kv.get(KEYS.dirtyYears)) as string[] | undefined) ?? [];
        await db.kv.put([...new Set([...cur, ...years])].sort(), KEYS.dirtyYears);
      }
    }),
  );
}

/** [날짜+성도+헌금 종류]가 같은 기존 내역을 색인으로 찾습니다(무명은 중복 없음). 트랜잭션 안에서 부르면 그 시점의 값입니다. */
export const findDuplicateRow = async (d: Pick<Donation, 'date' | 'memberId' | 'offeringTypeId'>): Promise<Donation | undefined> => {
  if (d.memberId === null) return undefined;
  const row = await db.donations.where('[date+memberId+offeringTypeId]').equals([d.date, d.memberId, d.offeringTypeId]).first();
  return row ? (await openDonations([row]))[0] : undefined;
};

/** 열쇠 없이도 확인할 수 있는 '저장소에 데이터 행이 있는가'(성도 목록·헌금·이력 중 하나라도). 열쇠를 잃었을 때 새로 시작해도 되는지 판단하는 데 씁니다. */
export async function storageHasRows(): Promise<boolean> {
  const members = await db.kv.get(KEYS.members);
  const hasMembers = Array.isArray(members) ? members.length > 0 : !!members;
  return hasMembers || (await db.donations.count()) > 0 || (await db.audits.count()) > 0;
}

/** 저장된 모든 데이터를 지웁니다(열쇠를 잃어 풀 수 없을 때 새로 시작하는 용도. 수동 백업이 있어야 되살릴 수 있음). */
export const wipeAllStorage = (): Promise<void> =>
  serialize(() => db.transaction('rw', db.kv, db.donations, db.audits, async () => void (await Promise.all([db.kv.clear(), db.donations.clear(), db.audits.clear()]))));

/**
 * 지금 열쇠로 저장된 암호문이 풀리는지(성도 목록과 맨 앞 헌금 한 건으로 확인). 평문이면 확인할 것이 없어 true.
 * 열쇠 파일이 지워져 main이 새 열쇠를 만든 경우처럼, 열쇠는 멀쩡히 읽히지만 데이터와 맞지 않는 상태를 잡습니다.
 * 암호화 이전은 달 오름차순이므로 이전이 조금이라도 됐다면 맨 앞 행이 암호문입니다.
 */
export async function dataKeyOpensStorage(): Promise<boolean> {
  try {
    await getItem(KEYS.members);
    const row = await db.donations.toCollection().first();
    if (row?.enc) await openDonations([row]);
    return true;
  } catch {
    return false;
  }
}

/** 건별 암호화 이전이 끝났는지(열쇠가 있는데 표식이 없으면 이전이 필요하거나 중간에 멈춘 것) */
export const encryptionPending = async (): Promise<boolean> => hasDataKey() && (await getItem<boolean>(KEYS.encrypted)) !== true;

/**
 * 평문으로 남은 행을 모두 건별 암호화로 바꿉니다. 달·해 단위로 트랜잭션 하나씩 처리하므로 도중에 꺼져도 그 단위는 전부 반영되거나 전부 안 되고,
 * 다시 실행하면 enc가 없는 행만 이어서 처리합니다. 다 끝나면 표식(KEYS.encrypted)을 남깁니다. 내용이 바뀌는 것이 아니므로 '백업 이후 변경' 표시는 건드리지 않습니다.
 */
export async function encryptAllPlaintext(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!hasDataKey()) throw new Error('데이터 열쇠가 없어 암호화할 수 없습니다.');
  const months = await listDonationMonths();
  const years = (await db.audits.orderBy('year').uniqueKeys()) as string[];
  const total = months.length + years.length + 1;
  let done = 0;
  const step = () => onProgress?.(++done, total);
  onProgress?.(0, total);
  for (const ym of months) {
    await serialize(() =>
      db.transaction('rw', db.donations, async () => {
        const plain = (await monthRange(ym).toArray()).filter((r) => !r.enc);
        if (plain.length) await db.donations.bulkPut(await sealDonations(plain));
      }),
    );
    step();
  }
  for (const y of years) {
    await serialize(() =>
      db.transaction('rw', db.audits, async () => {
        const plain = (await db.audits.where('year').equals(y).toArray()).filter((r) => !r.enc);
        if (plain.length) await db.audits.bulkPut(await sealAudits(plain));
      }),
    );
    step();
  }
  await serialize(() =>
    db.transaction('rw', db.kv, async () => {
      const members = await db.kv.get(KEYS.members);
      if (Array.isArray(members)) await db.kv.put(await sealMembers(members), KEYS.members);
      await db.kv.put(true, KEYS.encrypted);
    }),
  );
  step();
}
