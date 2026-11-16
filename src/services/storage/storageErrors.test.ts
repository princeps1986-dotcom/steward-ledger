import { describe, expect, it } from 'vitest';
import { StorageError, toStorageError } from './storageErrors';

describe('toStorageError', () => {
  it('maps quota, version and open failures to Korean guidance', () => {
    const quota = toStorageError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })) as StorageError;
    expect(quota).toBeInstanceOf(StorageError);
    expect(quota.kind).toBe('QUOTA');
    expect((toStorageError({ name: 'VersionError' }) as StorageError).kind).toBe('VERSION');
    expect((toStorageError({ name: 'DatabaseClosedError' }) as StorageError).kind).toBe('UNAVAILABLE');
  });

  it('reads the inner error name that Dexie wraps', () => {
    expect((toStorageError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } }) as StorageError).kind).toBe('QUOTA');
  });

  it('leaves business-rule errors untouched', () => {
    const e = new Error('수정할 내역을 찾을 수 없습니다');
    expect(toStorageError(e)).toBe(e);
  });
});
