import { useEffect, useState } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberActions } from '../contexts/MemberContext';
import { useOfferingActions } from '../contexts/OfferingTypeContext';
import { hasAnyData } from '../services/backup/backupService';
import { interruptedRestore } from '../services/backup/streamRestore';
import { DEMO_SPEC_MOBILE } from '../services/demo/demoData';
import { createDemoData, removeDemoData } from '../services/demo/demoService';
import { hasDemoData } from '../services/demo/demoState';
import { isMobileDevice } from './useIsMobileDevice';

/** 이 브라우저에서 모바일 자동 시연 데이터를 이미 한 번 만들었는지(사용자가 지운 뒤 다시 만들지 않기 위한 표시) */
const DONE_KEY = 'steward-auto-demo-done';

const flagged = (): boolean => {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true; // 저장소를 쓸 수 없으면(사생활 보호 모드 등) 매번 만들지 않도록 건너뜁니다.
  }
};

/**
 * 휴대폰·태블릿으로 처음 열면 빈 화면 대신 시연 데이터(가벼운 1년치)로 바로 시작합니다. 모바일 브라우저의 저장소는 이 브라우저 안에만 있고
 * 실제 교회 데이터는 PC 앱에 있으므로 잃을 것이 없습니다. 조건: 모바일 + 아직 만든 적 없음 + 데이터 없음. 준비하는 동안 진행률을 돌려줍니다.
 */
export function useAutoDemo(): { done: number; total: number } | null {
  const memberActions = useMemberActions();
  const offeringActions = useOfferingActions();
  const donationActions = useDonationActions();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!isMobileDevice() || flagged()) return;
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
        await createDemoData({ spec: DEMO_SPEC_MOBILE, onProgress: (done, total) => !cancelled && setProgress({ done, total }) });
        localStorage.setItem(DONE_KEY, '1');
        await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
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
