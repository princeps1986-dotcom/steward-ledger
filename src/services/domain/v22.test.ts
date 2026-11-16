import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type OfferingType } from '../../contexts/types';
import { migrateOfferingTypesV22, migrateSettingsV22 } from './migrations';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';

const type = (name: string, quickAmounts: number[]): OfferingType => ({
  id: name,
  name,
  displayArea: 'PRIMARY',
  quickAmounts,
  sortOrder: 1,
  isActive: true,
});

describe('defaults v2.2', () => {
  it('large amount threshold defaults to 10,000,000', () => {
    expect(DEFAULT_SETTINGS.largeAmountThreshold).toBe(10_000_000);
  });
  it('seeded 건축/선교 quick amounts include every required amount', () => {
    const amounts = (name: string) => DEFAULT_OFFERING_TYPES.find((t) => t.name === name)!.quickAmounts;
    for (const a of [1000, 5000, 10000, 50000, 100000, 500000]) expect(amounts('건축헌금')).toContain(a);
    for (const a of [1000, 5000, 10000, 50000, 100000]) expect(amounts('선교헌금')).toContain(a);
  });
});

describe('migrateOfferingTypesV22', () => {
  it('adds missing quick amounts while keeping existing ones, sorted and unique', () => {
    const out = migrateOfferingTypesV22([type('건축헌금', [10000, 50000, 100000, 500000, 1000000]), type('선교헌금', [10000, 30000, 50000, 100000])])!;
    expect(out[0].quickAmounts).toEqual([1000, 5000, 10000, 50000, 100000, 500000, 1000000]);
    expect(out[1].quickAmounts).toEqual([1000, 5000, 10000, 30000, 50000, 100000]);
  });
  it('fills empty amounts and keeps custom ones', () => {
    const out = migrateOfferingTypesV22([type('건축헌금', []), type('선교헌금', [20000])])!;
    expect(out[0].quickAmounts).toEqual([1000, 5000, 10000, 50000, 100000, 500000]);
    expect(out[1].quickAmounts).toEqual([1000, 5000, 10000, 20000, 50000, 100000]);
  });
  it('does not touch other types and returns null when nothing changes', () => {
    const other = type('십일조', [100000]);
    expect(migrateOfferingTypesV22([other])).toBeNull();
    const done = [type('건축헌금', [1000, 5000, 10000, 50000, 100000, 500000]), type('선교헌금', [1000, 5000, 10000, 50000, 100000]), other];
    expect(migrateOfferingTypesV22(done)).toBeNull();
  });
});

describe('migrateSettingsV22', () => {
  it('moves the old 100,000,000 default to 10,000,000 and keeps other fields', () => {
    expect(migrateSettingsV22({ largeAmountThreshold: 100_000_000, recipientEmail: 'a@b.kr' })).toEqual({
      largeAmountThreshold: 10_000_000,
      recipientEmail: 'a@b.kr',
    });
  });
  it('keeps custom thresholds and handles missing settings', () => {
    expect(migrateSettingsV22({ largeAmountThreshold: 5_000_000 })).toBeNull();
    expect(migrateSettingsV22({})).toBeNull();
    expect(migrateSettingsV22(null)).toBeNull();
  });
});
