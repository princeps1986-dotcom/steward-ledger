import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import { addQuickAmount, amountToKorean } from './amount';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';

describe('amountToKorean', () => {
  it('reads common offering amounts', () => {
    expect(amountToKorean(1000)).toBe('천 원');
    expect(amountToKorean(5000)).toBe('오천 원');
    expect(amountToKorean(10000)).toBe('만 원');
    expect(amountToKorean(100000)).toBe('십만 원');
    expect(amountToKorean(1250000)).toBe('백이십오만 원');
    expect(amountToKorean(10000000)).toBe('천만 원');
  });
  it('reads 억 and 조 units and skips empty groups', () => {
    expect(amountToKorean(100000000)).toBe('일억 원');
    expect(amountToKorean(123456789)).toBe('일억 이천삼백사십오만 육천칠백팔십구 원');
    expect(amountToKorean(100000001)).toBe('일억 일 원');
    expect(amountToKorean(1000000000000)).toBe('일조 원');
  });
  it('returns empty text for non-positive or unsafe values', () => {
    expect(amountToKorean(0)).toBe('');
    expect(amountToKorean(-5)).toBe('');
    expect(amountToKorean(1.5)).toBe('');
  });
});

describe('defaults v2.3', () => {
  it('font scale defaults to normal', () => {
    expect(DEFAULT_SETTINGS.fontScale).toBe('NORMAL');
  });
});

describe('addQuickAmount', () => {
  it('adds up repeated quick amounts', () => {
    expect(addQuickAmount('', 100000)).toBe('100,000');
    expect(addQuickAmount('100,000', 100000)).toBe('200,000');
    expect(addQuickAmount('200,000', 5000)).toBe('205,000');
  });
  it('treats invalid input as zero and refuses to overflow', () => {
    expect(addQuickAmount('abc', 1000)).toBe('1,000');
    expect(addQuickAmount('999,999,999,999,999', 1000)).toBe('999,999,999,999,999');
  });
});

describe('tithe quick amounts (v2.4)', () => {
  it('seed includes 300,000 and 400,000', () => {
    expect(DEFAULT_OFFERING_TYPES.find((t) => t.name === '십일조')!.quickAmounts).toEqual([100000, 200000, 300000, 400000, 500000]);
  });
});
