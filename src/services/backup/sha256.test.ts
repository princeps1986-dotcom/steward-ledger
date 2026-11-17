import { describe, expect, it } from 'vitest';
import { Sha256 } from './sha256';
import { sha256Hex } from './validation';

describe('Sha256 (incremental)', () => {
  it('matches crypto.subtle for empty, short, block-boundary and multi-chunk Korean text', async () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), '헌금 내역 '.repeat(5000)]) {
      const bytes = new TextEncoder().encode(text);
      const h = new Sha256();
      for (let i = 0; i < bytes.length; i += 37) h.update(bytes.subarray(i, i + 37));
      expect(h.digestHex()).toBe(await sha256Hex(text));
    }
  });
});
