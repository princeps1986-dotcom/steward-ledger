import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Donation } from '../../contexts/types';
import { db } from '../storage/db';
import { countYearDonations, listDonationMonths, monthWrite, readMonth, transact } from '../storage/storageService';
import { backupLines } from './backupService';
import { decryptedBackup, interruptedRestore, isNdjsonFile, readFileLines, restoreFromFile, scanBackupFile } from './streamRestore';
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

describe('readFileLines', () => {
  it('rebuilds lines split across tiny chunks, including multi-byte characters', async () => {
    const lines = ['{"a":"헌금"}' + NL, NL, '{"b":"무명1 가나다라마바사"}' + NL, 'tail-no-newline'];
    const bytes = new TextEncoder().encode(lines.join(''));
    const tiny = {
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
            c.close();
          },
        }),
    };
    const out: string[] = [];
    for await (const l of readFileLines(tiny)) out.push(l);
    expect(out).toEqual(lines);
  });
});

describe('scanBackupFile', () => {
  it('verifies plain and gz files and counts donations per year', async () => {
    const f = await makeBackup();
    expect(await isNdjsonFile(f)).toBe(true);
    expect(await isNdjsonFile(await gzip(f))).toBe(true);
    // 예전 형식(한 덩어리 JSON)과 프리픽스보다 짧은 파일은 줄 단위가 아님
    expect(await isNdjsonFile(new File([JSON.stringify({ schemaVersion: 2, payload: {} })], 'old.json'))).toBe(false);
    expect(await isNdjsonFile(new File(['{"nd'], 'short.json'))).toBe(false);
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

  it('full restore wipes the current data (including years not in the backup) and replaces it with the backup', async () => {
    const file = await makeBackup();
    // 백업 뒤에 현재 데이터가 바뀜: 2026 내역 교체, 백업에 없는 2027 추가
    await transact(async () => ({ writes: [monthWrite('2026-01', [d('z', '2026-01-25')]), monthWrite('2027-05', [d('w', '2027-05-01')])], result: 0 }));
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    await restoreFromFile(file, scan, Object.keys(scan.yearCounts), undefined, true);
    expect((await readMonth('2026-01')).map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect((await readMonth('2025-03')).map((x) => x.id)).toEqual(['a']);
    expect(await listDonationMonths()).toEqual(['2025-03', '2026-01']); // 2027은 삭제
    expect(await interruptedRestore()).toBeNull();
  });

  it('does not parse months of years that were not chosen, and reports added members/types', async () => {
    const file = await makeBackup();
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    expect(await countYearDonations('2025')).toBe(1);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const r = await restoreFromFile(file, scan, ['2026']);
      expect(r).toEqual({ addedMembers: 0, addedTypes: 0, updatedMembers: 0, updatedTypes: 0 });
      const parsed = parse.mock.calls.map(([t]) => String(t));
      expect(parsed.some((t) => t.startsWith('{"t":"donations","ym":"2026'))).toBe(true);
      expect(parsed.some((t) => t.startsWith('{"t":"donations","ym":"2025'))).toBe(false);
    } finally {
      parse.mockRestore();
    }
  });

  it('leaves the marker when the restore stops halfway', async () => {
    const file = await makeBackup();
    const scan = await scanBackupFile(file);
    if (!scan.ok) throw new Error(scan.error);
    // 시작 트랜잭션('복원 중' 표시)은 커밋되고, 본문을 쓰려고 파일을 읽다가 멈춥니다.
    const flaky = { stream: () => new ReadableStream({ start: (c) => c.error(new Error('읽기 실패')) }) };
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

describe('decryptedBackup (암호화한 백업을 main이 풀어 주는 래퍼)', () => {
  it('읽을 때마다 새로 열어 조각을 줄로 이어 주고, 중간에 멈추면 닫는다', async () => {
    const enc = new TextEncoder();
    const log: string[] = [];
    let next = 0;
    const api = {
      openBackupReader: async (_f: File, pw?: string) => (log.push(`open:${pw}`), ++next),
      readBackup: async (id: number) => {
        const left = (reads[id] ??= id === 1 ? ['{"a":', '1}\n{"b":2}\n'] : Array.from({ length: 50 }, (_, i) => `{"n":${i}}\n`));
        return left.length ? enc.encode(left.shift()!) : null;
      },
      closeBackupReader: async (id: number) => (log.push(`close:${id}`), true),
    };
    const reads: Record<number, string[]> = {};
    const src = decryptedBackup(api, new File([], 'x.slbk'), '암호');
    const lines: string[] = [];
    for await (const l of readFileLines(src)) lines.push(l);
    expect(lines).toEqual(['{"a":1}\n', '{"b":2}\n']);
    for await (const l of readFileLines(src)) {
      void l;
      break; // 첫 줄만 읽고 멈춤 → 닫기
    }
    await new Promise((r) => setTimeout(r, 0)); // 취소가 파이프를 거쳐 원본까지 전달될 때까지
    expect(log).toEqual(['open:암호', 'open:암호', 'close:2']);
  });
});
