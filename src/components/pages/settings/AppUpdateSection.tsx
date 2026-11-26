import { allowed } from '../../../services/auth/access';
import type { useSettingsPage } from '../../../hooks/useSettingsPage';

type Props = { s: ReturnType<typeof useSettingsPage> };

/** 프로그램 업데이트 영역(데스크톱 앱, 관리자·재정담당). 상태와 동작은 useAppUpdate.ts */
export function AppUpdateSection({ s }: Props) {
  return (
    <>
      {/* 데스크톱 앱에서만: 단추를 누를 때만 인터넷에 접속해 바뀐 부분을 받고, 앱을 닫을 때 설치합니다. */}
      {s.isDesktop && allowed('update:check') ? (
        <section className="card space-y-3" aria-labelledby="app-update-title">
          <h3 id="app-update-title" className="font-semibold">
            프로그램 업데이트
          </h3>
          <p className="text-sm text-gray-600">[업데이트 확인]을 누를 때만 인터넷에 접속합니다. 새 버전은 바뀐 부분만 내려받고, 앱을 닫을 때 설치되며 데이터는 그대로 유지됩니다.</p>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {s.appUpdate.state === 'available' ? (
              <button className="btn-primary" onClick={() => void s.downloadUpdate()}>
                {s.appUpdate.latest} 내려받기
              </button>
            ) : (
              <button className="btn" onClick={() => void s.checkUpdate()} disabled={s.appUpdate.state === 'checking' || s.appUpdate.state === 'downloading' || s.appUpdate.state === 'ready'}>
                {s.appUpdate.state === 'checking' ? '확인하는 중…' : '업데이트 확인'}
              </button>
            )}
            <span className="text-sm">
              {s.appUpdate.state === 'latest' && `최신 버전입니다 (${s.appUpdate.current}).`}
              {s.appUpdate.state === 'available' && `새 버전 ${s.appUpdate.latest}이 있습니다 (현재 ${s.appUpdate.current}).`}
              {s.appUpdate.state === 'downloading' && `${s.appUpdate.latest} 내려받는 중… ${s.appUpdate.percent}%`}
              {s.appUpdate.state === 'ready' && <b className="text-emerald-700">{s.appUpdate.latest} 준비 완료. 앱을 닫으면 백업 후 설치됩니다.</b>}
              {s.appUpdate.state === 'error' && <span className="text-red-700">{s.appUpdate.text}</span>}
            </span>
          </div>
        </section>
      ) : null}
    </>
  );
}
