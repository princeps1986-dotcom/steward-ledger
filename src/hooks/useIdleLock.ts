import { useEffect } from 'react';

/** 아무 조작이 없으면 잠그는 시간(15분). 시험은 useIdleLock의 ms 인자로 줄여 씁니다. */
export const IDLE_LOCK_MS = 15 * 60 * 1000;

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;

/** active인 동안 마우스·키보드 조작이 ms 동안 없으면 onIdle을 한 번 부릅니다. */
export function useIdleLock(active: boolean, onIdle: () => void, ms = IDLE_LOCK_MS): void {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(onIdle, ms);
    let last = Date.now();
    const reset = () => {
      const now = Date.now();
      if (now - last < 1000) return; // 마우스를 움직이는 동안 타이머를 매번 다시 걸지 않게 1초에 한 번만
      last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(onIdle, ms);
    };
    for (const e of EVENTS) window.addEventListener(e, reset, true);
    return () => {
      window.clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, reset, true);
    };
  }, [active, onIdle, ms]);
}
