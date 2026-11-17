import { describe, expect, it } from 'vitest';
import { clampPage, pageNumbers } from './paging';

describe('paging', () => {
  it('clamps the page into 1..pages', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(3, 0)).toBe(1);
  });
  it('shows first, last and neighbours with gaps', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 2000)).toEqual([1, 2, '…', 2000]);
    expect(pageNumbers(6, 2000)).toEqual([1, '…', 5, 6, 7, '…', 2000]);
    expect(pageNumbers(2000, 2000)).toEqual([1, '…', 1999, 2000]);
    expect(pageNumbers(3, 2000)).toEqual([1, 2, 3, 4, '…', 2000]); // 하나만 건너뛰면 번호를 보여 줌
  });
});
