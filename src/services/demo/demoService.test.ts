import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation, Member } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { db } from '../storage/db';
import { getItem, KEYS, listDonationMonths, monthWrite, readMonth, transact, wipeDonationsWrites } from '../storage/storageService';
import { sha256Hex } from '../backup/validation';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import { buildAutoBackup, runPeriodicBackup } from '../backup/autoBackupService';
import { restoreBackup, saveBackupFile } from '../backup/backupService';
import { createDemoData, removeDemoData } from './demoService';
import { allocate, allocateCapped, buildDemoPayload, DEMO_PREFIX, DEMO_SPEC_APP, DEMO_SPEC_BROWSER, type DemoSpec } from './demoData';
import { hasDemoData, isDemoBusy, readDemoRestore } from './demoState';

const NOW = new Date(2026, 10, 17); // 2026-11-17(화)
/** 서비스 시험용 작은 규격(주 6개, 성도 30명) */
const SMALL: DemoSpec = { members: 30, weeks: 6, total: 600, weekMean: 100, weekMin: 50, weekMax: 200, spikeCount: 40 };

describe.each([
  ['app (3 years)', DEMO_SPEC_APP, 200_000, 750, 2000, 5000, 156, 6],
  ['browser (18 months)', DEMO_SPEC_BROWSER, 63_000, 500, 1333, 3333, 78, 2],
] as const)('demo data for %s: 800 members', (_name, spec, total, weekMin, weekMax, spike, weeks, spikeDays) => {
  const p = buildDemoPayload(spec, NOW);
  const all = Object.values(p.donationsByYear).flat();
  const byDate = new Map<string, number>();
  for (const x of all) byDate.set(x.date, (byDate.get(x.date) ?? 0) + 1);
  const spikeDates = [...byDate.keys()].filter((k) => k.endsWith('-12-25') || k.endsWith('-01-01'));

  it('has 800 members and exactly the planned donations, all with the demo prefix, no future dates', () => {
    expect(p.members).toHaveLength(800);
    expect(all).toHaveLength(total);
    expect(p.members.every((m) => m.id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(p.offeringTypes.every((t) => t.id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(all.every((x) => x.id.startsWith(DEMO_PREFIX) && x.date <= '2026-11-17')).toBe(true);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    const typeIds = new Set(p.offeringTypes.map((t) => t.id));
    expect(all.every((x) => typeIds.has(x.offeringTypeId))).toBe(true);
  });

  it('keeps every normal week within its range and adds the spike count on 12/25 and 1/1', () => {
    expect(spikeDates).toHaveLength(spikeDays);
    for (const k of spikeDates) expect(byDate.get(k)!).toBeGreaterThanOrEqual(spike);
    const weekSums = new Map<string, number>();
    for (const [k, n] of byDate) {
      const d = new Date(k + 'T00:00:00Z');
      const sun = new Date(d.getTime() - d.getUTCDay() * 864e5).toISOString().slice(0, 10);
      weekSums.set(sun, (weekSums.get(sun) ?? 0) + n - (spikeDates.includes(k) ? spike : 0));
    }
    expect(weekSums.size).toBe(weeks);
    const sums = [...weekSums.values()];
    expect(Math.min(...sums)).toBeGreaterThanOrEqual(weekMin);
    expect(Math.max(...sums)).toBeLessThanOrEqual(weekMax);
    expect(Math.max(...sums)).toBeGreaterThan(Math.min(...sums) + (weekMax - weekMin) / 5); // 편차가 있음
  });

  it('never repeats the same member and offering type on one date (the app merges those)', () => {
    const seen = new Set<string>();
    for (const x of all) {
      if (!x.memberId) continue;
      const key = `${x.date}|${x.memberId}|${x.offeringTypeId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('is the same for the same day and has six audit logs', () => {
    expect(buildDemoPayload(spec, NOW).donationsByYear['2026'][0]).toEqual(p.donationsByYear['2026'][0]);
    expect(Object.values(p.auditLogsByYear).flat()).toHaveLength(6);
  });
}, 120000);

describe('allocate', () => {
  it('sums exactly, and the capped version never exceeds the cap', () => {
    expect(allocate(10, [1, 1, 1]).reduce((s, n) => s + n, 0)).toBe(10);
    expect(allocate(7, [5, 1])).toEqual([6, 1]);
    const c = allocateCapped(100, [10, 1, 1, 1], 40);
    expect(c.reduce((s, n) => s + n, 0)).toBe(100);
    expect(Math.max(...c)).toBeLessThanOrEqual(40);
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
    const info = await createDemoData({ spec: SMALL, today: NOW });
    expect(info.backupName).toMatch(/^existing-data-backup_\d{8}_\d{6}\.json\.gz$/);
    expect([...files.keys()]).toEqual([info.backupName]);
    expect(await hasDemoData()).toBe(true);
    expect((await readDemoRestore())?.backupName).toBe(info.backupName);
    expect(await getItem<Member[]>(KEYS.members)).toHaveLength(SMALL.members);
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
    const info = await createDemoData({ spec: SMALL, today: NOW });
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
    const info = await createDemoData({ spec: SMALL, today: NOW });
    expect(info.backupName).toBeNull();
    expect(files.size).toBe(0);
    expect((await removeDemoData()).restored).toBe(false);
    expect(await hasDemoData()).toBe(false);
    expect(await listDonationMonths()).toEqual([]);
  }, 60000);
});

describe('newest-first creation', () => {
  it('wipes every month in one go, and a write after the wipe in the same transaction survives', async () => {
    await transact(async () => ({ writes: [monthWrite('2025-01', [don('a', '2025-01-05')]), monthWrite('2026-01', [don('b', '2026-01-04')])], result: 0 }));
    await transact(async () => ({ writes: [...(await wipeDonationsWrites()), monthWrite('2026-01', [don('c', '2026-01-11')])], result: 0 }));
    expect(await listDonationMonths()).toEqual(['2026-01']);
    expect((await readMonth('2026-01')).map((x) => x.id)).toEqual(['c']);
  });

  it('is usable after the newest months (onReady), then finishes the older months with exact totals', async () => {
    fakeDesktop();
    let readyMonths: string[] = [];
    const info = await createDemoData({ spec: SMALL, today: NOW, onReady: () => void listDonationMonths().then((m) => (readyMonths = m)) });
    expect(info.backupName).toBeNull();
    expect(readyMonths.length).toBeLessThanOrEqual(3);
    const months = await listDonationMonths();
    expect(months.length).toBeGreaterThanOrEqual(readyMonths.length);
    let n = 0;
    for (const ym of months) n += (await readMonth(ym)).length;
    expect(n).toBe(SMALL.total);
    expect(await getItem(KEYS.restoreMarker)).toBeNull();
  }, 60000);

  it('removing while the older months are still being made stops the creation and leaves nothing', async () => {
    fakeDesktop();
    let removal: Promise<unknown> | null = null;
    const created = createDemoData({ spec: SMALL, today: NOW, onReady: () => { removal = removeDemoData(); } });
    await created;
    await removal;
    expect(await hasDemoData()).toBe(false);
    expect(await listDonationMonths()).toEqual([]);
  }, 60000);
});

describe('backups are blocked while demo data exists', () => {
  it('blocks auto backups (close and periodic), manual backup and restore, and allows them again after removal', async () => {
    fakeDesktop();
    await transact(async () => ({ writes: [{ key: KEYS.members, value: [real] }, monthWrite('2026-01', [don('a', '2026-01-04', 'real-1')])], result: 0 }));
    const settings = { ...DEFAULT_SETTINGS, autoBackupEnabled: true };
    expect(await isDemoBusy()).toBe(false);
    await createDemoData({ spec: SMALL, today: NOW });
    expect(await isDemoBusy()).toBe(true);
    expect(await buildAutoBackup(settings)).toBeNull();
    expect(await runPeriodicBackup(settings)).toBeNull();
    await expect(saveBackupFile('backup')).rejects.toThrow('시연 데이터를 쓰는 동안');
    await expect(restoreBackup({ members: [], offeringTypes: [], donationsByYear: {}, auditLogsByYear: {} }, { years: [], mode: 'FULL' })).rejects.toThrow('시연 데이터를 쓰는 동안');
    await removeDemoData();
    expect(await isDemoBusy()).toBe(false);
    await expect(saveBackupFile('backup')).resolves.toBeTruthy();
  }, 60000);
});
