import { describe, expect, it } from 'vitest';
import type { Write } from '../storage/storageService';
import { splitWrites } from './backupService';

const arr = (n: number): unknown[] => Array.from({ length: n }, (_, i) => i);

describe('splitWrites', () => {
  it('작은 데이터는 한 묶음으로 둡니다', () => {
    const w: Write[] = [
      { key: 'a', value: arr(10) },
      { key: 'b', value: null },
    ];
    expect(splitWrites(w)).toHaveLength(1);
  });

  it('크기 상한을 넘으면 나누고, 삭제는 마지막 묶음에 둡니다', () => {
    const w: Write[] = [
      { key: 'del', value: null },
      { key: 'm1', value: arr(10) },
      { key: 'm2', value: arr(10) },
      { key: 'm3', value: arr(10) },
    ];
    const batches = splitWrites(w, 10 * 500 * 2); // 목록 2개까지만 한 묶음
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((x) => x.key)).toEqual(['m1', 'm2', 'm3', 'del']);
    expect(batches[batches.length - 1].some((x) => x.key === 'del')).toBe(true);
    expect(batches.slice(0, -1).flat().every((x) => x.value !== null)).toBe(true);
  });

  it('상한보다 큰 값 하나도 빠뜨리지 않고 단독 묶음으로 둡니다', () => {
    const batches = splitWrites([{ key: 'big', value: arr(100) }, { key: 'x', value: arr(1) }], 1000);
    expect(batches.flat().map((x) => x.key).sort()).toEqual(['big', 'x']);
  });

  it('쓸 것이 없으면 빈 목록입니다', () => {
    expect(splitWrites([])).toEqual([]);
  });
});
