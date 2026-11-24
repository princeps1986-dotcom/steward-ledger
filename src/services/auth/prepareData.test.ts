import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { hasDataKey, setDataKey } from '../storage/cipher';
import { db } from '../storage/db';
import { encryptionPending, KEYS, readMonth, rowWrite, transact } from '../storage/storageService';
import { KEY_MISMATCH, prepareData, startOver } from './prepareData';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const don = (id: string, date: string): Donation => ({ id, date, memberId: 'm1', donorDisplayName: '홍길동', offeringTypeId: 't1', amount: 5000, createdAt: `c${id}` });
const put = (ym: string, ...list: Donation[]) => transact(async () => ({ writes: [rowWrite(ym, { puts: list, deletes: [] })], result: null }));
const members = [{ id: 'm1', name: '홍길동', position: '집사', isFamilyHead: true, isActive: true, createdAt: 'x', updatedAt: 'x' }];

function fakeApi(o: { dataKey?: Awaited<ReturnType<DesktopApi['dataKey']>>; replace?: Awaited<ReturnType<DesktopApi['dataKeyReplace']>>; backupFails?: boolean } = {}) {
  const lines: string[] = [];
  const api = {
    dataKey: vi.fn(async () => o.dataKey ?? { key: KEY_B64 }),
    dataKeyReplace: vi.fn(async () => o.replace ?? { key: KEY_B64 }),
    backupBegin: vi.fn(async () => 7),
    backupWrite: vi.fn(async (_id: number, line: string) => {
      if (o.backupFails) throw new Error('디스크 가득');
      lines.push(line);
      return true;
    }),
    backupEnd: vi.fn(async () => 'C:/backup/backup_x.slbk'),
    backupAbort: vi.fn(async () => true),
  };
  return { api: api as unknown as DesktopApi, mock: api, lines };
}

beforeEach(async () => {
  await setDataKey(null);
  await db.kv.clear();
  await db.donations.clear();
  await db.audits.clear();
});
afterEach(() => setDataKey(null));

describe('prepareData', () => {
  it('열쇠를 받아 저장소에 넣고, 빈 저장소는 백업 없이 바로 이전 표식만 남긴다', async () => {
    const { api, mock } = fakeApi();
    expect(await prepareData(api)).toEqual({ ok: true });
    expect(hasDataKey()).toBe(true);
    expect(await encryptionPending()).toBe(false);
    expect(mock.backupBegin).not.toHaveBeenCalled();
  });

  it('평문 데이터가 있으면 먼저 백업하고 암호화로 옮기며 진행 상황을 알린다', async () => {
    await put('2026-03', don('a', '2026-03-01'));
    await db.kv.put(members, KEYS.members);
    const { api, mock, lines } = fakeApi();
    const progress: [number, number][] = [];
    expect(await prepareData(api, (d, t) => progress.push([d, t]))).toEqual({ ok: true });
    expect(mock.backupBegin).toHaveBeenCalledTimes(1);
    expect(mock.backupEnd).toHaveBeenCalledTimes(1);
    expect(lines.join('')).toContain('홍길동'); // 백업은 암호화 전(평문)에 떠야 함
    expect(progress.at(-1)).toEqual([2, 2]); // 달 1 + 이력 해 0 + 성도 1
    expect((await db.donations.toArray()).every((r) => r.enc)).toBe(true);
    expect((await readMonth('2026-03'))[0].amount).toBe(5000);
    expect(await encryptionPending()).toBe(false);
  });

  it('이전을 이미 마쳤으면 다시 백업·암호화하지 않는다', async () => {
    const first = fakeApi();
    await prepareData(first.api);
    await put('2026-03', don('a', '2026-03-01'));
    const { api, mock } = fakeApi();
    expect(await prepareData(api)).toEqual({ ok: true });
    expect(mock.backupBegin).not.toHaveBeenCalled();
  });

  it('백업이 실패하면 암호화하지 않고 오류로 알리며 열쇠를 버린다(데이터는 평문 그대로)', async () => {
    await put('2026-03', don('a', '2026-03-01'));
    const { api, mock } = fakeApi({ backupFails: true });
    const r = await prepareData(api);
    expect(r).toMatchObject({ ok: false, keyLost: false });
    expect((r as { error: string }).error).toContain('암호화하기 전 백업에 실패했습니다');
    expect(mock.backupAbort).toHaveBeenCalledWith(7);
    expect(hasDataKey()).toBe(false);
    expect((await db.donations.toArray())[0]).toMatchObject({ amount: 5000 });
    expect(await encryptionPending()).toBe(false); // 열쇠가 없어 이전 대상이 아님. 다음 로그인 때 다시 시도
  });

  it('열쇠를 풀 수 없고 저장소가 비어 있으면 새 열쇠를 만들어 이어 간다', async () => {
    const { api, mock } = fakeApi({ dataKey: { error: '풀 수 없음', code: 'DATA_KEY_UNREADABLE' } });
    expect(await prepareData(api)).toEqual({ ok: true });
    expect(mock.dataKeyReplace).toHaveBeenCalledTimes(1);
    expect(hasDataKey()).toBe(true);
  });

  it('열쇠를 풀 수 없는데 데이터가 있으면 새로 만들지 않고 keyLost로 알린다', async () => {
    await db.kv.put({ enc: new Uint8Array([1, 2, 3]) }, KEYS.members); // 암호화된 성도 목록이 있는 저장소
    const { api, mock } = fakeApi({ dataKey: { error: '풀 수 없음', code: 'DATA_KEY_UNREADABLE' } });
    expect(await prepareData(api)).toEqual({ ok: false, keyLost: true, error: '풀 수 없음' });
    expect(mock.dataKeyReplace).not.toHaveBeenCalled();
    expect(hasDataKey()).toBe(false);
    expect(await db.kv.get(KEYS.members)).toBeTruthy(); // 데이터는 그대로
  });

  it('열쇠 파일을 잃어 새 열쇠가 오면(데이터와 맞지 않음) 열지 않고 keyLost로 알린다', async () => {
    await setDataKey(Buffer.alloc(32, 1)); // 예전 열쇠로 암호화된 저장소
    await put('2026-03', don('a', '2026-03-01'));
    await setDataKey(null);
    const { api } = fakeApi(); // main이 새로 만든 다른 열쇠
    expect(await prepareData(api)).toEqual({ ok: false, keyLost: true, error: KEY_MISMATCH });
    expect(hasDataKey()).toBe(false);
    expect(await db.donations.count()).toBe(1); // 데이터는 그대로
  });

  it('열쇠를 받지 못하는 다른 오류는 keyLost가 아니다', async () => {
    const { api } = fakeApi({ dataKey: { error: '이 PC에서 데이터 암호화를 쓸 수 없습니다.', code: 'DATA_KEY_UNAVAILABLE' } });
    expect(await prepareData(api)).toEqual({ ok: false, keyLost: false, error: '이 PC에서 데이터 암호화를 쓸 수 없습니다.' });
  });
});

describe('startOver', () => {
  const lost = { error: '풀 수 없음', code: 'DATA_KEY_UNREADABLE' };
  const seedLost = async () => {
    await db.kv.put({ enc: new Uint8Array([1, 2, 3]) }, KEYS.members);
    await db.donations.put({ ...don('a', '2026-03-01'), amount: undefined as never, enc: new Uint8Array([9]) });
  };

  it('관리자가 열쇠를 잃은 데이터를 지우고 새 열쇠로 다시 시작한다(교체가 먼저, 삭제는 그 뒤)', async () => {
    await seedLost();
    const { api, mock } = fakeApi({ dataKey: lost });
    const order: string[] = [];
    mock.dataKeyReplace.mockImplementation(async () => (order.push('replace'), { key: KEY_B64 }));
    expect(await startOver(api, 'admin')).toEqual({ ok: true });
    expect(order[0]).toBe('replace');
    expect(await db.donations.count()).toBe(0);
    expect(await db.kv.get(KEYS.members)).toBeUndefined();
    expect(hasDataKey()).toBe(true);
  });

  it('관리자가 아니면 아무것도 지우지 않고 열쇠도 바꾸지 않는다', async () => {
    await seedLost();
    for (const role of ['finance', 'viewer', null] as const) {
      const { api, mock } = fakeApi({ dataKey: lost });
      expect(await startOver(api, role)).toMatchObject({ ok: false, keyLost: true });
      expect(mock.dataKeyReplace).not.toHaveBeenCalled();
    }
    expect(await db.donations.count()).toBe(1);
    expect(hasDataKey()).toBe(false);
  });

  it('열쇠가 정상으로 풀리고 데이터와 맞으면 지우지 않는다', async () => {
    await setDataKey(Buffer.from(KEY_B64, 'base64')); // main이 주는 열쇠와 같은 열쇠로 암호화된 저장소
    await put('2026-03', don('a', '2026-03-01'));
    await setDataKey(null);
    const { api, mock } = fakeApi(); // dataKey가 정상
    expect(await startOver(api, 'admin')).toMatchObject({ ok: false, keyLost: true });
    expect(mock.dataKeyReplace).not.toHaveBeenCalled();
    expect(await db.donations.count()).toBe(1);
  });

  it('열쇠는 읽히지만 데이터와 맞지 않으면 열쇠를 바꾸지 않고 지운 뒤 그 열쇠로 다시 시작한다', async () => {
    await setDataKey(Buffer.alloc(32, 1));
    await put('2026-03', don('a', '2026-03-01'));
    await setDataKey(null);
    const { api, mock } = fakeApi();
    expect(await startOver(api, 'admin')).toEqual({ ok: true });
    expect(mock.dataKeyReplace).not.toHaveBeenCalled();
    expect(await db.donations.count()).toBe(0);
    expect(hasDataKey()).toBe(true);
  });

  it('main이 열쇠 교체를 거절하면(관리자가 아님 등) 지우지 않는다', async () => {
    await seedLost();
    const { api } = fakeApi({ dataKey: lost, replace: { error: '관리자만 할 수 있습니다.' } });
    expect(await startOver(api, 'admin')).toEqual({ ok: false, keyLost: true, error: '관리자만 할 수 있습니다.' });
    expect(await db.donations.count()).toBe(1);
  });
});
