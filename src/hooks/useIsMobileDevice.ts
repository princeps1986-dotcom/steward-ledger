import { useEffect, useState } from 'react';

/** 휴대폰·태블릿 같은 모바일 기기로 접속했는지(사용자 에이전트, 또는 터치 위주의 좁은 화면) */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse && window.innerWidth < 900;
}

export function useIsMobileDevice(): boolean {
  const [mobile, setMobile] = useState(isMobileDevice);
  useEffect(() => {
    const on = () => setMobile(isMobileDevice());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return mobile;
}
