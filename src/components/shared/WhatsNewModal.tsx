import { useEffect } from 'react';
import { CHANGELOG } from '../../changelog';
import type { AppSettings } from '../../contexts/types';
import { useSettings, useSettingsActions, useSettingsSelector } from '../../contexts/SettingsContext';
import { desktop } from '../../services/desktopBridge';
import { Modal } from './Modal';

declare const __APP_VERSION__: string; // vite.config.ts의 define(package.json version)

/**
 * 업데이트 후 첫 실행인지 판단합니다. 'show' = 변경 내역 창, 'record' = 창 없이 이 버전을 본 것으로 기록, 'none' = 할 일 없음.
 * 새로 설치한 앱(이전 버전을 본 적도, 백업한 적도 없음)에는 띄우지 않습니다.
 */
export function whatsNewAction(s: AppSettings, version: string, notes: string[] | undefined): 'show' | 'record' | 'none' {
  if (s.seenVersion === version) return 'none';
  const existingUser = !!(s.seenVersion || s.lastBackupAt || s.lastCloseBackupAt);
  return notes?.length && existingUser ? 'show' : 'record';
}

export function WhatsNewModal() {
  const settings = useSettings();
  const loaded = useSettingsSelector((s) => s.loaded);
  const { update } = useSettingsActions();
  const notes = CHANGELOG[__APP_VERSION__];
  const action = loaded && desktop() ? whatsNewAction(settings, __APP_VERSION__, notes) : 'none';

  useEffect(() => {
    if (action === 'record') void update({ seenVersion: __APP_VERSION__ });
  }, [action, update]);

  const close = () => void update({ seenVersion: __APP_VERSION__ });
  return (
    <Modal
      open={action === 'show'}
      onClose={close}
      title={`새 버전 ${__APP_VERSION__}에서 바뀐 점`}
      footer={
        <button className="btn-primary" onClick={close} autoFocus>
          확인
        </button>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {notes?.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </Modal>
  );
}
