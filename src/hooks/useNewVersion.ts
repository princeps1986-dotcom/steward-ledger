import { useEffect, useState } from 'react';
import { desktop } from '../services/desktopBridge';

declare const __BUILD_ID__: string; // vite.config.ts의 define

const CHECK_MS = 10 * 60_000;

/**
 * 웹 배포본에서, 이 화면이 열린 뒤 새 버전이 배포되었는지 알려 줍니다(true = 새로고침하면 새 버전).
 * 열어 둔 화면은 옛 파일로 계속 돌고, 옛 파일은 배포 때 서버에서 사라지므로 나중에 불러오는 기능(엑셀 등)이 실패할 수 있습니다.
 * 데스크톱 앱은 설치 파일로 갱신하므로 확인하지 않습니다.
 */
export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV || desktop()) return;
    const check = async (): Promise<void> => {
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok && ((await res.json()) as { id?: string }).id !== __BUILD_ID__) setStale(true);
      } catch {
        // 오프라인 등은 다음 확인 때 다시 봅니다.
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    const onPreloadError = (e: Event): void => {
      e.preventDefault(); // 옛 파일을 못 불러온 것은 새 버전이 나왔다는 뜻
      setStale(true);
    };
    void check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }, []);
  return stale;
}
