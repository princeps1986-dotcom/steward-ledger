import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation, Member } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { db } from '../storage/db';
import { getItem, KEYS, listDonationMonths, monthWrite, readMonth, transact } from '../storage/storageService';
import { sha256Hex } from '../backup/validation';
import { createDemoData, removeDemoData } from './demoService';
import { allocate, buildDemoPayload, DEMO_DONATION_COUNT, DEMO_MEMBER_COUNT, DEMO_PREFIX } from './demoData';
import { hasDemoData, readDemoRestore } from './demoState';

const NOW = new Date(2026, 10, 17); // 2026-11-17(화)

describe('buildDemoPayload', () => {
  const p = buildDemoPayload(NOW);
  const all = Object.values(p.donationsByYear).flat();
  it('has 500 members and exactly 80,000 donations, all with the demo prefix, no future dates', () => {
    expect(p.members).toHaveLength(DEMO_MEMBER_COUNT);
    expect(all).toHaveLength(DEMO_DONATION_COUNT);
    expect(p.members.every((m) => m.id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(p.offeringTypes.every((t) => t.id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(all.every((x) => x.id.startsWith(DEMO_PREFIX) && x.date <= '2026-11-17')).toBe(true);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    const typeIds = new Set(p.offeringTypes.map((t) => t.id));
    expect(all.every((x) => typeIds.has(x.offeringTypeId))).toBe(true);
  });

  it('spreads over three years by week, and 12/25 and 1/1 hold about five weeks worth on that single date', () => {
    const byDate = new Map<string, number>();
    for (const x of all) byDate.set(x.date, (byDate.get(x.date) ?? 0) + 1);
    const dates = [...byDate.keys()].sort();
    expect(dates[0] >= '2023-11-20' && dates[0] <= '2023-11-30').toBe(true);
    const weekEnd = (sun: string): string => new Date(new Date(sun).getTime() + 6 * 864e5).toISOString().slice(0, 10);
    const week = (sun: string): number => [...byDate].filter(([k]) => k >= sun && k <= weekEnd(sun)).reduce((s, [, n]) => s + n, 0);
    const normalWeek = week('2026-03-01'); // 12/25, 1/1이 없는 주
    for (const k of ['2025-12-25', '2025-01-01', '2024-12-25', '2024-01-01']) {
      expect(byDate.get(k)! / normalWeek).toBeGreaterThan(4);
      expect(byDate.get(k)! / normalWeek).toBeLessThan(7);
    }
  });

  it('is the same for the same day and has six audit logs', () => {
    expect(buildDemoPayload(NOW).donationsByYear['2026'][0]).toEqual(p.donationsByYear['2026'][0]);
    expect(Object.values(p.auditLogsByYear).flat()).toHaveLength(6);
  });

  it('allocate sums exactly', () => {
    expect(allocate(10, [1, 1, 1]).reduce((s, n) => s + n, 0)).toBe(10);
    expect(allocate(7, [5, 1])).toEqual([6, 1]);
  });
});

/** 메모리에 백업 파일을 보관하는 가짜 데스크톱 */
function fakeDesktop() {
  const files = new Map<string, Uint8Array>();
  let open: string | null = null;
  let session: { name: string; lines: string[] } | null = null;
  const api = {
    backupBegin: async (spec: { name: string; folder?: string }) => ((session = { name: `${spec.folder ?? ''}/${spec.name}`, lines: [] }), 1),
    backupWrite: async (_id: number, line: string) => void session!.lines.push(line),
    backupRestart: async () => 1,
    backupAbort: async () => true,
    backupEnd: async () => {
      const body = session!.lines.join('');
      const text = body + JSON.stringify({ t: 'end', sha256: await sha256Hex(body) }) + String.fromCharCode(10);
      const gz = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      files.set(session!.name.split('/').pop()!, gz);
      return `C:/x/${session!.name}`;
    },
    backupReadOpen: async (name: string) => {
      if (!files.has(name)) throw new Error('파일 없음');
      open = name;
      return { id: 1, size: files.get(name)!.length };
    },
    backupReadChunk: async (_id: number, offset: number) => files.get(open!)!.subarray(offset, offset + 1000),
    backupReadClose: async () => true,
  } as unknown as DesktopApi;
  vi.stubGlobal('window', { desktop: api });
  return files;
}

const don = (id: string, date: string, memberId: string | null = null): Donation =>
  ({ id, date, memberId, donorDisplayName: '무명1', offeringTypeId: 'real-type', amount: 1000, createdAt: `c${id}` }) as Donation;
const real: Member = { id: 'real-1', name: '김철수', position: '', isFamilyHead: true, isActive: true, createdAt: 'x', updatedAt: 'x' };

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('hasDemoData', () => {
  it('is false for real data and true as soon as one demo donation exists', async () => {
    await transact(async () => ({ writes: [{ key: KEYS.members, value: [real] }, monthWrite('2026-01', [don('a', '2026-01-04', 'real-1')])], result: 0 }));
    expect(await hasDemoData()).toBe(false);
    await transact(async () => ({ writes: [monthWrite('2026-02', [don('b', '2026-02-01', `${DEMO_PREFIX}m-1`)])], result: 0 }));
    expect(await hasDemoData()).toBe(true);
  });
});

describe('create and remove demo data', () => {
  it('backs up the original, replaces everything with demo data, then removal restores the original exactly', async () => {
    const files = fakeDesktop();
    await transact(async () => ({ writes: [{ key: KEYS.members, value: [real] }, monthWrite('2026-01', [don('a', '2026-01-04', 'real-1'), don('b', '2026-01-11')])], result: 0 }));
    const info = await createDemoData();
    expect(info.backupName).toMatch(/^existing-data-backup_\d{8}_\d{6}\.json\.gz$/);
    expect([...files.keys()]).toEqual([info.backupName]);
    expect(await hasDemoData()).toBe(true);
    expect((await readDemoRestore())?.backupName).toBe(info.backupName);
    expect(await getItem<Member[]>(KEYS.members)).toHaveLength(DEMO_MEMBER_COUNT);
    await expect(createDemoData()).rejects.toThrow('이미 시연');
    // 시연 중 추가한 데이터
    await transact(async () => ({ writes: [monthWrite('2026-11', [don('mine', '2026-11-15', 'real-1')])], result: 0 }));
    const r = await removeDemoData();
    expect(r.restored).toBe(true);
    expect(await hasDemoData()).toBe(false);
    expect(await readDemoRestore()).toBeNull();
    expect((await getItem<Member[]>(KEYS.members))?.map((m) => m.id)).toEqual(['real-1']);
    expect(await listDonationMonths()).toEqual(['2026-01']);
    expect((await readMonth('2026-01')).map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(await getItem(KEYS.restoreMarker)).toBeNull();
  }, 60000);

  it('does not delete the demo data when the backup file is missing or damaged', async () => {
    const files = fakeDesktop();
    await transact(async () => ({ writes: [monthWrite('2026-01', [don('a', '2026-01-04')])], result: 0 }));
    const info = await createDemoData();
    files.set(info.backupName!, new Uint8Array([1, 2, 3])); // 손상
    await expect(removeDemoData()).rejects.toThrow('제거하지 않았습니다');
    expect(await hasDemoData()).toBe(true);
    files.delete(info.backupName!); // 없음
    await expect(removeDemoData()).rejects.toThrow('제거하지 않았습니다');
    expect(await hasDemoData()).toBe(true);
  }, 60000);

  it('with no original data nothing is backed up and removal leaves an empty app; without demo data removal does nothing', async () => {
    const files = fakeDesktop();
    await expect(removeDemoData()).rejects.toThrow('제거할 시연 데이터가 없습니다');
    const info = await createDemoData();
    expect(info.backupName).toBeNull();
    expect(files.size).toBe(0);
    expect((await removeDemoData()).restored).toBe(false);
    expect(await hasDemoData()).toBe(false);
    expect(await listDonationMonths()).toEqual([]);
  }, 60000);
});
