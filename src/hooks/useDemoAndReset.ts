import { useCallback, useEffect, useState } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberActions } from '../contexts/MemberContext';
import { useOfferingActions } from '../contexts/OfferingTypeContext';
import { useSettingsActions } from '../contexts/SettingsContext';
import { resetAllData } from '../services/backup/backupService';
import { createDemoData, removeDemoData } from '../services/demo/demoService';
import { refreshDemoState, useDemoActive, useDemoCreating } from '../services/demo/demoState';

const RESET_WAIT_SECONDS = 10;

type Message = { kind: 'error' | 'info'; text: string } | null;
interface Deps {
  setBusy(v: boolean): void;
  setMessage(m: Message): void;
  /** 성도·헌금 내역이 있는지(시연 데이터는 없을 때만 만들 수 있음) */
  hasMembersOrDonations: boolean;
  /** 성도·내역이 있거나 헌금 종류를 바꿨는지(전체 초기화는 복구할 것이 있을 때만) */
  hasData: boolean;
}

/** 시연 데이터 생성·제거와 전체 초기화(설정 화면의 위험 영역). 진행 중 표시(busy)·안내(message)는 설정 화면이 쥐고 있어 받아 씁니다. */
export function useDemoAndReset({ setBusy, setMessage, hasMembersOrDonations, hasData }: Deps) {
  const { update } = useSettingsActions();
  const memberActions = useMemberActions();
  const offeringActions = useOfferingActions();
  const donationActions = useDonationActions();
  const [demoOpen, setDemoOpen] = useState(false);
  const [removeDemoOpen, setRemoveDemoOpen] = useState(false);
  const [demoProgress, setDemoProgress] = useState<{ done: number; total: number } | null>(null);
  // 시연 데이터가 한 건이라도 있으면 시연 중(전체 데이터를 훑지 않고 색인으로 판정). 설정 화면에 들어올 때 다시 확인합니다.
  const demoActive = useDemoActive();
  const demoCreating = useDemoCreating() !== null;
  useEffect(() => {
    void refreshDemoState();
  }, []);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetLeft, setResetLeft] = useState(RESET_WAIT_SECONDS);

  // 초기화 확인창이 열리면 10초 카운트다운 후에만 [초기화]를 누를 수 있습니다.
  useEffect(() => {
    if (!resetOpen) return;
    setResetLeft(RESET_WAIT_SECONDS);
    const id = window.setInterval(() => setResetLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [resetOpen]);

  const confirmDemo = useCallback(async () => {
    if (demoActive || hasMembersOrDonations) return; // 시연 중이거나 성도·헌금 데이터가 있으면 만들 수 없습니다.
    setDemoOpen(false); // 누르는 즉시 레이어를 닫고, 진행은 최상단 안내 띠에 보입니다.
    setBusy(true);
    try {
      const reloadAll = () => Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      // 최근 몇 달이 저장되면 바로 쓸 수 있게 화면을 열고, 나머지 과거 달은 뒤에서 이어서 만듭니다(진행은 최상단 띠에 표시).
      await createDemoData({
        onProgress: (done, total) => setDemoProgress({ done, total }),
        onReady: () => {
          setBusy(false);
          void reloadAll();
        },
      });
      await reloadAll();
      setMessage({ kind: 'info', text: '시연 데이터를 생성했습니다.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `시연 데이터 생성 실패: ${(err as Error).message}` });
    } finally {
      setDemoProgress(null);
      setBusy(false);
    }
  }, [demoActive, hasMembersOrDonations, memberActions, offeringActions, donationActions, setBusy, setMessage]);

  const confirmRemoveDemo = useCallback(async () => {
    if (!demoActive || demoCreating) return; // 시연 데이터가 없거나 만드는 중이면 작동하지 않습니다.
    setBusy(true);
    try {
      await removeDemoData();
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({ kind: 'info', text: '시연 데이터를 제거했습니다.(초기 데이터로 돌아갑니다)' });
      setRemoveDemoOpen(false);
    } catch (err) {
      setMessage({ kind: 'error', text: `시연 데이터 제거 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [demoActive, demoCreating, memberActions, offeringActions, donationActions, setBusy, setMessage]);

  const confirmReset = useCallback(async () => {
    if (resetLeft > 0 || demoActive || !hasData) return; // 시연 중에는 전체 초기화를 쓸 수 없습니다(시연 데이터 제거를 먼저).
    setBusy(true);
    try {
      await resetAllData();
      // 지운 데이터의 백업 기록도 비웁니다(남아 있으면 새로 입력한 데이터에 '아직 백업한 적이 없습니다' 권고가 뜨지 않음). 백업 파일은 그대로 둡니다.
      // 기록을 비우지 못해도 데이터는 이미 초기화됐으므로 '초기화 실패'로 알리지 않습니다.
      await update({ lastBackupAt: null, lastCloseBackupAt: null, manualBackupAt: {} }).catch(() => undefined);
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({ kind: 'info', text: '전체 데이터를 초기화했습니다.' });
      setResetOpen(false);
    } catch (err) {
      setMessage({ kind: 'error', text: `초기화 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [resetLeft, demoActive, hasData, update, memberActions, offeringActions, donationActions, setBusy, setMessage]);

  return {
    demoOpen,
    openDemo: () => setDemoOpen(true),
    cancelDemo: () => setDemoOpen(false),
    confirmDemo,
    demoActive,
    demoCreating,
    demoProgress,
    removeDemoOpen,
    openRemoveDemo: () => !demoCreating && setRemoveDemoOpen(true),
    cancelRemoveDemo: () => setRemoveDemoOpen(false),
    confirmRemoveDemo,
    resetOpen,
    resetLeft,
    openReset: () => {
      if (!demoActive && hasData) setResetOpen(true);
    },
    cancelReset: () => setResetOpen(false),
    confirmReset,
  };
}
