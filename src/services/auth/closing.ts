// 앱을 닫는 중(종료 전 백업)인지 알리는 작은 저장소. 화면이 잠겨 있으면 종료 안내 덮개가 잠금 화면 아래로 가려지므로,
// 잠금 화면이 이 값을 읽어 [백업 없이 종료]를 직접 보여 줍니다(App의 useAutoBackupBridge가 켜고 끕니다).
import { useSyncExternalStore } from 'react';

let closing = false;
const subs = new Set<() => void>();

export function setClosingNotice(v: boolean): void {
  if (closing === v) return;
  closing = v;
  subs.forEach((f) => f());
}

export const useClosingNotice = (): boolean =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => closing,
  );
