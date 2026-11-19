import { useSyncExternalStore } from 'react';

/**
 * 직접 백업·긴급 백업·복원이 진행 중인지. 자동 백업(주기·종료)은 이 동안 끼어들지 않고 건너뜁니다
 * (main은 백업 세션을 하나만 두므로 겹치면 진행 중이던 쪽이 취소되고, 복원 도중의 반쯤 복원된 데이터를 자동 백업이 담을 수 있음).
 */
let backups = 0;
let restores = 0;
/** 복원 진행(저장한 달 / 전체 달). 진행을 셀 수 없는 복원이면 null */
let restoreProgress: { done: number; total: number } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const isBackupBusy = (): boolean => backups + restores > 0;
export const isRestoring = (): boolean => restores > 0;

async function track<T>(kind: 'backups' | 'restores', fn: () => Promise<T>): Promise<T> {
  if (kind === 'backups') backups++;
  else restores++;
  notify();
  try {
    return await fn();
  } finally {
    if (kind === 'backups') backups--;
    else {
      restores--;
      if (restores === 0) restoreProgress = null;
    }
    notify();
  }
}
export const withBackupBusy = <T>(fn: () => Promise<T>): Promise<T> => track('backups', fn);
export const withRestoring = <T>(fn: () => Promise<T>): Promise<T> => track('restores', fn);

/** 복원 중에는 헌금 저장·수정·삭제를 막습니다(복원이 지우고 다시 쓰는 달과 섞이지 않도록). */
export function assertNotRestoring(): void {
  if (isRestoring()) throw new Error('복원하는 중에는 저장할 수 없습니다. 복원이 끝난 뒤 다시 시도하세요.');
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const useRestoring = (): boolean => useSyncExternalStore(subscribe, isRestoring);

export function setRestoreProgress(p: { done: number; total: number } | null): void {
  restoreProgress = p;
  notify();
}
export const useRestoreProgress = (): { done: number; total: number } | null => useSyncExternalStore(subscribe, () => restoreProgress);
