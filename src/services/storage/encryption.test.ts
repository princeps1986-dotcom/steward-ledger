import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditLog, Donation, Member } from '../../contexts/types';
import { setDataKey } from './cipher';
import { db } from './db';
import {
  auditAppend,
  encryptAllPlaintext,
  encryptionPending,
  findDonationById,
  findDuplicateRow,
  getItem,
  getMany,
  KEYS,
  monthWrite,
  readDay,
  readMemberDonations,
  readMonth,
  readRow,
  rowWrite,
  snapshot,
  storageHasRows,
  transact,
  wipeAllStorage,
} from './storageService';

const rawKey = (n: number) => new Uint8Array(32).fill(n);
const don = (id: string, date: string, extra: Partial<Donation> = {}): Donation => ({
  id,
  date,
  memberId: 'm1',
  donorDisplayName: '홍길동',
  offeringTypeId: 't1',
  amount: 123456,
  memo: '감사헌금 메모',
  createdAt: `c${id}`,
  ...extra,
});
const member = (id: string, name: string): Member => ({ id, name, position: '집사', isFamilyHead: true, isActive: true, createdAt: 'x', updatedAt: 'x' });
const log = (id: string, target: Donation, over: Partial<AuditLog> = {}): AuditLog => ({
  id,
  targetId: target.id,
  action: 'UPDATE',
  beforeSnapshot: target,
  afterSnapshot: { ...target, amount: 777 },
  reason: '금액을 잘못 입력함',
  timestamp: `2026-03-0${id}T00:00:00Z`,
  ...over,
});
const put = (ym: string, ...list: Donation[]) => transact(async () => ({ writes: [rowWrite(ym, { puts: list, deletes: [] })], result: null }));
const bytesHave = (enc: Uint8Array | undefined, text: string) => !!enc && Buffer.from(enc).includes(Buffer.from(text));

beforeEach(async () => {
  await setDataKey(null);
  await db.kv.clear();
  await db.donations.clear();
  await db.audits.clear();
});
afterEach(() => setDataKey(null));

describe('건별 암호화 저장소', () => {
  it('열쇠가 있으면 금액·이름·메모는 암호문으로만 저장되고 색인 칸은 평문으로 남으며, 읽으면 원래 값이 나온다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'), don('b', '2026-03-08', { memberId: null, memo: undefined }));
    const raw = await db.donations.toArray();
    expect(raw).toHaveLength(2);
    for (const r of raw) {
      expect(r.enc).toBeInstanceOf(Uint8Array);
      expect(r).not.toHaveProperty('amount');
      expect(r).not.toHaveProperty('donorDisplayName');
      expect(r).not.toHaveProperty('memo');
      expect(bytesHave(r.enc, '홍길동')).toBe(false);
      expect(bytesHave(r.enc, '123456')).toBe(false);
    }
    expect(raw.find((r) => r.id === 'a')).toMatchObject({ date: '2026-03-01', memberId: 'm1', offeringTypeId: 't1', createdAt: 'ca' });

    expect(await readMonth('2026-03')).toEqual([don('a', '2026-03-01'), don('b', '2026-03-08', { memberId: null, memo: undefined })]);
    expect(await readRow('2026-03-01', 'a')).toEqual(don('a', '2026-03-01'));
    expect(await readDay('2026-03-08')).toHaveLength(1);
    expect((await readMemberDonations(['m1'])).map((d) => d.amount)).toEqual([123456]);
    expect((await findDonationById('b'))?.donorDisplayName).toBe('홍길동');
  });

  it('암호화해도 색인 조회(중복 검사)가 된다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'));
    expect((await findDuplicateRow({ date: '2026-03-01', memberId: 'm1', offeringTypeId: 't1' }))?.amount).toBe(123456);
    expect(await findDuplicateRow({ date: '2026-03-02', memberId: 'm1', offeringTypeId: 't1' })).toBeUndefined();
  });

  it('트랜잭션 안에서 읽고(풀고) 바꿔 쓰는 수정 흐름이 끝까지 커밋된다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'));
    await transact(async () => {
      const cur = (await readRow('2026-03-01', 'a'))!;
      return { writes: [rowWrite('2026-03', { puts: [{ ...cur, amount: cur.amount + 1 }], deletes: [] })], result: null };
    });
    expect((await readRow('2026-03-01', 'a'))?.amount).toBe(123457);
    expect(await snapshot(async () => (await readMonth('2026-03')).length)).toBe(1);
  });

  it('달 전체 교체(복원)도 암호화해서 저장한다', async () => {
    await setDataKey(rawKey(1));
    await transact(async () => ({ writes: [monthWrite('2026-04', [don('x', '2026-04-05'), don('y', '2026-04-06')])], result: null }));
    expect((await db.donations.toArray()).every((r) => r.enc && !('amount' in r))).toBe(true);
    expect(await readMonth('2026-04')).toHaveLength(2);
  });

  it('성도 목록은 통째로 암호화되고 설정은 평문이다', async () => {
    await setDataKey(rawKey(1));
    const list = [member('m1', '김철수'), member('m2', '이영희')];
    await transact(async () => ({ writes: [{ key: KEYS.members, value: list }, { key: KEYS.settings, value: { theme: 'DARK' } }], result: null }));
    const raw = (await db.kv.get(KEYS.members)) as { enc: Uint8Array };
    expect(Array.isArray(raw)).toBe(false);
    expect(bytesHave(raw.enc, '김철수')).toBe(false);
    expect(await db.kv.get(KEYS.settings)).toEqual({ theme: 'DARK' });
    expect(await getItem<Member[]>(KEYS.members)).toEqual(list);
    expect(await getMany<unknown>([KEYS.members, KEYS.settings, 'nope'])).toEqual([list, { theme: 'DARK' }, null]);
  });

  it('이력은 사유·스냅샷·고친 사람이 암호화되고, 읽으면 기록한 순서대로 원래 값이 나온다', async () => {
    await setDataKey(rawKey(1));
    const a = don('a', '2026-03-01');
    await transact(async () => ({ writes: [auditAppend('2026', [log('1', a, { actor: 'fin@church.org' }), log('2', a)])], result: null }));
    const raw = await db.audits.toArray();
    for (const r of raw) {
      expect(r.enc).toBeInstanceOf(Uint8Array);
      for (const k of ['reason', 'beforeSnapshot', 'afterSnapshot', 'actor']) expect(r).not.toHaveProperty(k);
      expect(r).toMatchObject({ year: '2026', action: 'UPDATE', targetId: 'a' });
      expect(bytesHave(r.enc, '잘못 입력')).toBe(false);
    }
    const back = (await getItem<AuditLog[]>('audit_logs_2026'))!;
    expect(back.map((l) => l.id)).toEqual(['1', '2']);
    expect(back[0]).toEqual(log('1', a, { actor: 'fin@church.org' }));
    expect(back[1].actor).toBeUndefined();
  });

  it('다른 행의 암호문을 옮겨 붙이면 풀리지 않는다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'), don('b', '2026-03-02', { amount: 5 }));
    const [ra, rb] = [(await db.donations.get(['2026-03-01', 'a']))!, (await db.donations.get(['2026-03-02', 'b']))!];
    await db.donations.put({ ...ra, enc: rb.enc });
    await expect(readRow('2026-03-01', 'a')).rejects.toThrow('풀 수 없습니다');
  });

  it('다른 열쇠로는 풀 수 없다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'));
    await setDataKey(rawKey(2));
    await expect(readMonth('2026-03')).rejects.toThrow('풀 수 없습니다');
  });

  it('열쇠 없이 암호화된 행을 읽으려 하면 알려 준다', async () => {
    await setDataKey(rawKey(1));
    await put('2026-03', don('a', '2026-03-01'));
    await setDataKey(null);
    await expect(readMonth('2026-03')).rejects.toThrow('열쇠가 없어');
  });

  it('열쇠가 없으면 예전처럼 평문으로 저장하고, 열쇠가 생긴 뒤에도 평문 행이 그대로 읽힌다', async () => {
    await put('2026-03', don('a', '2026-03-01'));
    expect((await db.donations.toArray())[0]).toMatchObject({ amount: 123456, donorDisplayName: '홍길동' });
    await setDataKey(rawKey(1));
    await put('2026-03', don('b', '2026-03-02'));
    expect((await readMonth('2026-03')).map((d) => d.id)).toEqual(['a', 'b']);
    expect((await db.donations.toArray()).filter((r) => r.enc)).toHaveLength(1);
  });
});

describe('첫 암호화 이전', () => {
  async function seedPlain() {
    await put('2026-03', don('a', '2026-03-01'), don('b', '2026-03-08'));
    await put('2026-04', don('c', '2026-04-05'));
    await transact(async () => ({ writes: [auditAppend('2026', [log('1', don('a', '2026-03-01'))]), { key: KEYS.members, value: [member('m1', '김철수')] }], result: null }));
  }

  it('평문 데이터를 모두 암호화하고 표식을 남기며, 읽은 값은 그대로다', async () => {
    await seedPlain();
    const before = { m: await readMonth('2026-03'), a: await getItem('audit_logs_2026'), mem: await getItem(KEYS.members) };
    await setDataKey(rawKey(3));
    expect(await encryptionPending()).toBe(true);
    const progress: [number, number][] = [];
    await encryptAllPlaintext((d, t) => progress.push([d, t]));
    expect(progress[0]).toEqual([0, 4]); // 달 2 + 해 1 + 성도 1
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(await encryptionPending()).toBe(false);
    expect((await db.donations.toArray()).every((r) => r.enc && !('amount' in r))).toBe(true);
    expect((await db.audits.toArray()).every((r) => r.enc && !('reason' in r))).toBe(true);
    expect(Array.isArray(await db.kv.get(KEYS.members))).toBe(false);
    expect({ m: await readMonth('2026-03'), a: await getItem('audit_logs_2026'), mem: await getItem(KEYS.members) }).toEqual(before);
  });

  it('도중에 멈춰도 다시 실행하면 남은 것만 이어서 처리하고 결과가 같다', async () => {
    await seedPlain();
    const before = await readMonth('2026-03');
    await setDataKey(rawKey(3));
    await expect(
      encryptAllPlaintext((done) => {
        if (done === 1) throw new Error('중단');
      }),
    ).rejects.toThrow('중단');
    expect(await encryptionPending()).toBe(true);
    const half = await db.donations.toArray();
    expect(half.filter((r) => r.enc).length).toBeGreaterThan(0);
    expect(half.filter((r) => !r.enc).length).toBeGreaterThan(0);
    expect((await readMonth('2026-03')).length + (await readMonth('2026-04')).length).toBe(3); // 중간 상태도 읽힘
    await encryptAllPlaintext();
    expect(await encryptionPending()).toBe(false);
    expect((await db.donations.toArray()).every((r) => r.enc)).toBe(true);
    expect(await readMonth('2026-03')).toEqual(before);
  });

  it('데이터가 없어도 바로 끝나고 표식이 남는다', async () => {
    await setDataKey(rawKey(3));
    await encryptAllPlaintext();
    expect(await encryptionPending()).toBe(false);
  });

  it('열쇠가 없으면 시작하지 않는다', async () => {
    await expect(encryptAllPlaintext()).rejects.toThrow('열쇠가 없어');
    expect(await encryptionPending()).toBe(false); // 열쇠가 없으면 이전 대상이 아님
  });
});

describe('열쇠를 잃었을 때', () => {
  it('저장소에 행이 있는지는 열쇠 없이 확인하고, 모두 지울 수 있다', async () => {
    expect(await storageHasRows()).toBe(false);
    await setDataKey(rawKey(1));
    await transact(async () => ({ writes: [{ key: KEYS.members, value: [member('m1', '김')] }], result: null }));
    await setDataKey(null);
    expect(await storageHasRows()).toBe(true); // 성도 목록이 암호문이어도 있는 것으로 봄
    await wipeAllStorage();
    expect(await storageHasRows()).toBe(false);
    expect(await db.kv.count()).toBe(0);
  });
});
