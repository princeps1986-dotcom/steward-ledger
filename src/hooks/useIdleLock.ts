import { useEffect } from 'react';

/** 아무 조작이 없으면 잠그는 시간(15분). 시험은 useIdleLock의 ms 인자로 줄여 씁니다. */
export const IDLE_LOCK_MS = 15 * 60 * 1000;

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
const CHECK_MS = 1000;

/**
 * active인 동안 마우스·키보드 조작이 ms 동안 없으면 onIdle을 한 번 부릅니다.
 * 타이머 하나로 세면 PC 절전 중에 타이머가 멈춰, 깨어난 뒤 첫 조작이 시간을 다시 시작해 버립니다.
 * 그래서 마지막 조작 시각을 시계(Date.now)로 기억해 1초마다, 그리고 조작이 들어올 때마다 지난 시간을 확인합니다.
 */
export function useIdleLock(active: boolean, onIdle: () => void, ms = IDLE_LOCK_MS): void {
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    let fired = false;
    const expired = () => {
      if (fired || Date.now() - last < ms) return false;
      fired = true;
      onIdle();
      return true;
    };
    const timer = window.setInterval(expired, CHECK_MS);
    const onActivity = () => {
      if (expired()) return; // 이미 시간이 지났으면(절전에서 깨어난 직후 등) 이 조작으로 연장하지 않고 잠급니다.
      const now = Date.now();
      if (now - last >= 1000) last = now; // 마우스를 움직이는 동안 매번 쓰지 않게 1초에 한 번만
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, true);
    return () => {
      window.clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, onActivity, true);
    };
  }, [active, onIdle, ms]);
}
