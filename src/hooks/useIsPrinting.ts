import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * 인쇄 중(beforeprint ~ afterprint)이면 true. 가상 스크롤 목록은 화면에 보이는 행만 그리므로,
 * 인쇄할 때는 이 값을 보고 모든 행을 그려야 목록이 잘리지 않습니다. 미리보기가 갱신된 값을 그리도록 동기 반영합니다.
 */
export function useIsPrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = (): void => flushSync(() => setPrinting(true));
    const off = (): void => flushSync(() => setPrinting(false));
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, []);
  return printing;
}
