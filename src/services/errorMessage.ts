import { StorageError } from './storage/storageErrors';

/**
 * 처리되지 않은 오류를 사용자에게 보여 줄 한 줄 문구로 바꿉니다(무시할 오류는 null).
 * 저장소 오류(StorageError)는 이미 한글 안내이므로 그대로 쓰고, 그 밖의 오류는 일반 안내에 원인을 붙입니다.
 */
export function describeUnhandled(reason: unknown): string | null {
  const msg = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (/ResizeObserver loop/i.test(msg)) return null; // 브라우저가 내는 무해한 경고
  if (reason instanceof StorageError) return reason.message;
  return `예기치 못한 오류가 발생했습니다. 방금 한 작업이 저장되지 않았을 수 있으니 확인해 주세요.${msg ? ` (${msg})` : ''}`;
}
