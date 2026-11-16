/**
 * 비동기 작업이 끝나기 전에 다시 호출되면 두 번째 호출을 무시하는 가드(연타·Enter 반복 방지).
 * React 상태는 다음 렌더 뒤에야 바뀌므로, 바로 막으려면 이런 즉시 값(ref 등)이 필요합니다.
 */
export function createExclusive(flag: { current: boolean }) {
  return async (fn: () => Promise<void>): Promise<void> => {
    if (flag.current) return;
    flag.current = true;
    try {
      await fn();
    } finally {
      flag.current = false;
    }
  };
}
