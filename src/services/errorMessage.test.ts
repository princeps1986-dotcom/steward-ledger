import { describe, expect, it } from 'vitest';
import { describeUnhandled } from './errorMessage';
import { StorageError } from './storage/storageErrors';

describe('describeUnhandled', () => {
  it('uses the Korean guidance of storage errors as is', () => {
    expect(describeUnhandled(new StorageError('QUOTA', '저장 공간이 부족합니다.', null))).toBe('저장 공간이 부족합니다.');
  });
  it('wraps other errors with a general notice and the cause', () => {
    expect(describeUnhandled(new Error('boom'))).toContain('(boom)');
    expect(describeUnhandled(undefined)).toContain('예기치 못한 오류');
  });
  it('ignores the harmless ResizeObserver warning', () => {
    expect(describeUnhandled(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBeNull();
  });
});
