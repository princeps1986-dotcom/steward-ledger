import { useCallback, useState } from 'react';
import { desktop, type UpdateCheck } from '../services/desktopBridge';

export type AppUpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest'; current: string }
  | { state: 'available'; current: string; latest: string }
  | { state: 'downloading'; latest: string; percent: number }
  | { state: 'ready'; latest: string }
  | { state: 'error'; text: string };

/** 프로그램 업데이트: 단추를 누를 때만 인터넷에 접속합니다(데스크톱 앱 전용). */
export function useAppUpdate() {
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>({ state: 'idle' });
  const checkUpdate = useCallback(async () => {
    const api = desktop();
    if (!api) return;
    setAppUpdate({ state: 'checking' });
    const r: UpdateCheck = await api.checkForUpdate().catch(() => ({ current: '', error: '업데이트를 확인하지 못했습니다.' }));
    if (r.error) setAppUpdate({ state: 'error', text: r.error });
    else if (r.available && r.latest) setAppUpdate({ state: 'available', current: r.current, latest: r.latest });
    else setAppUpdate({ state: 'latest', current: r.current });
  }, []);
  const downloadUpdate = useCallback(async () => {
    const api = desktop();
    if (!api || appUpdate.state !== 'available') return;
    const latest = appUpdate.latest;
    setAppUpdate({ state: 'downloading', latest, percent: 0 });
    const off = api.onUpdateProgress((percent) => setAppUpdate({ state: 'downloading', latest, percent }));
    const r = await api.downloadUpdate().catch(() => ({ error: '업데이트를 내려받지 못했습니다.' }));
    off();
    setAppUpdate(r.error ? { state: 'error', text: r.error } : { state: 'ready', latest });
  }, [appUpdate]);
  return { appUpdate, checkUpdate, downloadUpdate };
}
