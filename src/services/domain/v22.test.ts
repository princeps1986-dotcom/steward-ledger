import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';

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

