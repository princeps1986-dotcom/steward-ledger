import { describe, expect, it, vi } from 'vitest';
import type { Donation } from '../../contexts/types';
import { ListPager } from './listPager';

const d = (id: string, date: string, name = '김철수', amount = 1000): Donation =>
  ({ id, date, memberId: null, donorDisplayName: name, offeringTypeId: 't', amount, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;

const data: Record<string, Donation[]> = {
  '2026-01': [d('a', '2026-01-04'), d('b', '2026-01-11', '무명1', 500)],
  '2026-02': [d('c', '2026-02-01'), d('e', '2026-02-08', '이영희', 300)],
};
const months = ['2026-02', '2026-01'];
const ver = (v = '1') => () => v;
const never = () => false;
const all = (p: ListPager, n: number) => Array.from({ length: n }, (_, i) => p.rowAt(months, i)?.id);

describe('ListPager', () => {
  it('counts and totals every month and lists newest first across months', async () => {
    const read = vi.fn(async (ym: string) => data[ym]);
    const p = new ListPager(read);
    await p.refresh(months, ver(), { query: '', range: null }, never);
    expect([p.count, p.total]).toEqual([4, 2800]);
    expect(all(p, 4)).toEqual(['e', 'c', 'b', 'a']);
    expect(p.rowAt(months, 4)).toBeNull();
  });

  it('filters by name and by date range', async () => {
    const p = new ListPager(async (ym) => data[ym]);
    await p.refresh(months, ver(), { query: '무명', range: null }, never);
    expect(all(p, 1)).toEqual(['b']);
    await p.refresh(months, ver(), { query: '', range: { start: '2026-01-10', end: '2026-02-01' } }, never);
    expect(all(p, 2)).toEqual(['c', 'b']);
  });

  it('re-reads only the months whose version changed', async () => {
    const read = vi.fn(async (ym: string) => data[ym]);
    const p = new ListPager(read);
    await p.refresh(months, ver(), { query: '', range: null }, never);
    read.mockClear();
    await p.refresh(months, (ym) => (ym === '2026-01' ? '2' : '1'), { query: '', range: null }, never);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['2026-01']);
  });

  it('over the row budget keeps only counts and reads the month when a row is needed', async () => {
    const onChange = vi.fn();
    const p = new ListPager(async (ym) => data[ym], 2, onChange);
    await p.refresh(months, ver(), { query: '', range: null }, never);
    expect(p.count).toBe(4); // 건수는 전부
    expect(p.rowAt(months, 0)?.id).toBe('e'); // 2월은 예산 안
    onChange.mockClear();
    expect(p.rowAt(months, 2)).toBeNull(); // 1월 행은 아직 없음 → 읽기 시작
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(p.rowAt(months, 2)?.id).toBe('b');
  });

  it('stops when cancelled and does not record the month it was reading', async () => {
    let stop = false;
    const p = new ListPager(async (ym) => {
      stop = true;
      return data[ym];
    });
    await p.refresh(months, ver(), { query: '', range: null }, () => stop);
    expect(p.count).toBe(0);
  });
});
