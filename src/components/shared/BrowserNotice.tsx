import { desktop } from '../../services/desktopBridge';

/** 데스크톱 앱이 아니라 브라우저(모바일 포함)로 열었을 때 모든 화면 최상단에 보이는 시연용 안내(인쇄에는 나오지 않음) */
export function BrowserNotice() {
  if (desktop()) return null;
  return (
    <p role="note" className="no-print border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm font-semibold leading-relaxed text-red-600">
      안내: PC 전용(데스크톱 앱)입니다. 모바일이나 브라우저에서는 화면 구성과 기능을 보는 시연용입니다.<br/>모바일에서는 화면이 잘려 보이거나 깨져 보일 수 있습니다.
    </p>
  );
}
