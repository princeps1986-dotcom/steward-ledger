import { useEffect, useState } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberActions } from '../contexts/MemberContext';
import { useOfferingActions } from '../contexts/OfferingTypeContext';
import { hasAnyData } from '../services/backup/backupService';
import { interruptedRestore } from '../services/backup/streamRestore';
import { DEMO_SPEC_BROWSER } from '../services/demo/demoData';
import { createDemoData, removeDemoData } from '../services/demo/demoService';
import { hasDemoData } from '../services/demo/demoState';
import { desktop } from '../services/desktopBridge';

/** 이 브라우저에서 자동 시연 데이터를 이미 한 번 만들었는지(사용자가 지운 뒤 다시 만들지 않기 위한 표시) */
const DONE_KEY = 'steward-auto-demo-done';

const flagged = (): boolean => {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true; // 저장소를 쓸 수 없으면(사생활 보호 모드 등) 매번 만들지 않도록 건너뜁니다.
  }
};

/**
 * 브라우저(데스크톱 앱이 아닌 접속, 휴대폰 포함)로 처음 열면 빈 화면 대신 시연 데이터(작은 규격)로 바로 시작합니다. 브라우저의 저장소는 이 브라우저 안에만 있고
 * 실제 교회 데이터는 데스크톱 앱에 있으므로 잃을 것이 없습니다. 조건: 브라우저 + 아직 만든 적 없음 + 데이터 없음. 준비하는 동안 진행률을 돌려줍니다.
 */
export function useAutoDemo(): { done: number; total: number } | null {
  const memberActions = useMemberActions();
  const offeringActions = useOfferingActions();
  const donationActions = useDonationActions();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (desktop() || flagged()) return; // 데스크톱 앱이 아니라 브라우저로 열었을 때만
    let cancelled = false;
    void (async () => {
      try {
        const half = await interruptedRestore();
        if (half?.kind === 'demo') await removeDemoData(); // 지난 번에 만들다 끊긴 시연 데이터는 지우고 처음부터
        if ((await hasAnyData()) || (await hasDemoData())) {
          localStorage.setItem(DONE_KEY, '1');
          return;
        }
        setProgress({ done: 0, total: 0 });
        let ready = false;
        const reloadAll = () => Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
        await createDemoData({
          spec: DEMO_SPEC_BROWSER,
          onProgress: (done, total) => !cancelled && !ready && setProgress({ done, total }),
          onReady: () => {
            ready = true;
            if (!cancelled) setProgress(null); // 최근 몇 달이 준비되면 바로 시작합니다(나머지는 뒤에서 이어 만듦).
            void reloadAll();
          },
        });
        localStorage.setItem(DONE_KEY, '1');
        await reloadAll();
      } catch {
        // 실패하면 빈 화면으로 둡니다(다음에 열 때 다시 시도). 설정에서 직접 만들 수도 있습니다.
      } finally {
        if (!cancelled) setProgress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberActions, offeringActions, donationActions]);

  return progress;
}
