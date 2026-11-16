/**
 * 저장소(IndexedDB) 오류를 사용자가 이해할 수 있는 문구로 바꿉니다.
 * 화면은 오류의 message를 그대로 보여 주므로(예: "저장 실패: …"), 저장소 자체의 문제만 한글 안내로 바꾸고
 * 업무 규칙 오류(예: "수정할 내역을 찾을 수 없습니다")는 손대지 않고 그대로 돌려줍니다. 원래 오류는 cause에 남습니다.
 */

export type StorageErrorKind = 'QUOTA' | 'VERSION' | 'UNAVAILABLE';

export class StorageError extends Error {
  readonly kind: StorageErrorKind;
  constructor(kind: StorageErrorKind, message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'StorageError';
    this.kind = kind;
  }
}

const nameOf = (e: unknown): string => {
  if (typeof e !== 'object' || e === null) return '';
  const o = e as { name?: unknown; inner?: unknown };
  const inner = typeof o.inner === 'object' && o.inner !== null ? (o.inner as { name?: unknown }).name : undefined;
  return String(inner ?? o.name ?? '');
};

/** 저장소 문제면 StorageError를, 그 밖의 오류는 그대로 돌려줍니다. */
export function toStorageError(e: unknown): unknown {
  if (e instanceof StorageError) return e;
  const name = nameOf(e);
  if (name === 'QuotaExceededError') {
    return new StorageError('QUOTA', '저장 공간이 부족합니다. 디스크의 여유 공간을 확보한 뒤 다시 시도하세요. 이미 저장된 데이터는 그대로 있습니다.', e);
  }
  if (name === 'VersionError') {
    return new StorageError('VERSION', '이 데이터는 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 최신 버전으로 업데이트한 뒤 다시 실행하세요.', e);
  }
  if (['DatabaseClosedError', 'OpenFailedError', 'UnknownError', 'InvalidStateError', 'AbortError', 'MissingAPIError', 'SecurityError', 'UpgradeError'].includes(name)) {
    return new StorageError(
      'UNAVAILABLE',
      `저장소를 열거나 쓰지 못했습니다(${name}). 앱을 닫았다가 다시 실행해 보세요. 계속되면 최근 백업 파일로 복원하세요. 이미 저장된 데이터는 지워지지 않았습니다.`,
      e,
    );
  }
  return e;
}
