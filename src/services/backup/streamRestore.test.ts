import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { db } from '../storage/db';
import { listDonationMonths, monthWrite, readMonth, transact } from '../storage/storageService';
import { backupLines } from './backupService';
import { interruptedRestore, isNdjsonFile, restoreFromFile, scanBackupFile } from './streamRestore';
import { sha256Hex } from './validation';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;
const NL = String.fromCharCode(10);

async function makeBackup(name = 'b.json'): Promise<File> {
  let body = '';
  for await (const l of backupLines()) body += l;
  return new File([body + JSON.stringify({ t: 'end', sha256: await sha256Hex(body) }) + NL], name);
}
const gzip = async (f: File): Promise<File> => new File([await new Response(f.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()], `${f.name}.gz`);

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await transact(async () => ({ writes: [monthWrite('2025-03', [d('a', '2025-03-02')]), monthWrite('2026-01', [d('b', '2026-01-04'), d('c', '2026-01-11')])], result: 0 }));
});

describe('scanBackupFile', () => {
  it('verifies plain and gz files and counts donations per year', async () => {
    const f = await makeBackup();
    expect(await isNdjsonFile(f)).toBe(true);
    for (const file of [f, await gzip(f)]) {
      const r = await scanBackupFile(file);
      expect(r.ok && r.yearCounts).toEqual({ '2025': 1, '2026': 2 });
    }
  });

  it('rejects tampered and truncated files', async () => {
    const text = await (await makeBackup()).text();
    const tampered = await scanBackupFile(new File([text.replace('"amount":1000', '"amount":9999')], 'x.json'));
    expect(tampered).toMatchObject({ ok: false });
    expect(!tampered.ok && tampered.error).toContain('무결성');
    const cut = await scanBackupFile(new File([text.slice(0, text.lastIndexOf(NL + '{"t":"end"'))], 'x.json'));
    expect(cut).toMatchObject({ ok: false });
  });
});

describe('restoreFromFile', () => {
  it('replaces only the chosen year from the file, keeps other years, and clears the in-progress marker', async () => {
    const file = await gzip(await makeBackup());
    // 백업 뒤에 현재 데이터가 바뀜: 2026에 다른 내역, 2025에 추가 내역
    await transact(async () => ({ writes: [monthWrite('2026-01', [d('z', '2026-01-25')]), monthWrite('2025-03', [d('a', '2025-03-02'), d('y', '2025-03-09')])], result: 0 }));
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    await restoreFromFile(file, scan, ['2026']);
    expect((await readMonth('2026-01')).map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect((await readMonth('2025-03')).map((x) => x.id).sort()).toEqual(['a', 'y']); // 다른 연도는 그대로
    expect(await interruptedRestore()).toBeNull();
    expect(await listDonationMonths()).toEqual(['2025-03', '2026-01']);
  });

  it('leaves the marker when the restore stops halfway', async () => {
    const file = await makeBackup();
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    // 처음 읽기(복원할 id 모으기)는 성공하고, 본문을 쓰는 두 번째 읽기에서 멈춥니다.
    let reads = 0;
    const flaky = { stream: () => (reads++ === 0 ? file.stream() : new ReadableStream({ start: (c) => c.error(new Error('읽기 실패')) })) };
    await expect(restoreFromFile(flaky as unknown as Blob, scan, ['2026'])).rejects.toThrow('읽기 실패');
    expect(await interruptedRestore()).toMatchObject({ years: ['2026'] });
  });

  it('removes a donation that was moved to another year after the backup, so it is not counted twice', async () => {
    const file = await makeBackup();
    // 백업 뒤 b의 날짜를 2025년으로 옮김
    await transact(async () => ({ writes: [monthWrite('2026-01', [d('c', '2026-01-11')]), monthWrite('2025-03', [d('a', '2025-03-02'), d('b', '2025-03-30')])], result: 0 }));
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    await restoreFromFile(file, scan, ['2026']);
    expect((await readMonth('2026-01')).map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect((await readMonth('2025-03')).map((x) => x.id)).toEqual(['a']);
  });
});
