import { lazy, startTransition, Suspense, useEffect, useRef } from 'react';
import { SessionBar } from './components/auth/SessionBar';
import { BrowserNotice } from './components/shared/BrowserNotice';
import { ClosingOverlay } from './components/shared/ClosingOverlay';
import { RestoringOverlay } from './components/shared/RestoringOverlay';
import { useRestoring } from './services/backup/backupBusy';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { AutoSaveToast } from './components/shared/AutoSaveToast';
import { BackupReminderBanner } from './components/shared/BackupReminderBanner';
import { DemoBanner } from './components/shared/DemoBanner';
import { DemoPreparing } from './components/shared/DemoPreparing';
import { GlobalErrorBanner } from './components/shared/GlobalErrorBanner';
import { NewVersionBanner } from './components/shared/NewVersionBanner';
import { WhatsNewModal } from './components/shared/WhatsNewModal';
import { DonationInputPage } from './components/pages/donation-input/DonationInputPage';
import { useAutoDemo } from './hooks/useAutoDemo';
import { refreshDemoState } from './services/demo/demoState';
import { pageAllowed, useAppNav, visiblePages, useAutoBackupBridge, useBackupReminder } from './hooks/useAppShell';

// 첫 화면(헌금 입력) 외의 화면은 따로 불러와 시작이 가벼워집니다. 첫 화면이 뜬 직후 나머지를 미리 불러와 메뉴를 옮길 때 기다리지 않게 합니다.
const loadHelp = () => import('./components/pages/help/HelpPage').then((m) => ({ default: m.HelpPage }));
const loadMembers = () => import('./components/pages/members/MembersPage').then((m) => ({ default: m.MembersPage }));
const loadOfferings = () => import('./components/pages/offerings/OfferingsPage').then((m) => ({ default: m.OfferingsPage }));
const loadReports = () => import('./components/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }));
const loadSettings = () => import('./components/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }));
const HelpPage = lazy(loadHelp);
const MembersPage = lazy(loadMembers);
const OfferingsPage = lazy(loadOfferings);
const ReportsPage = lazy(loadReports);
const loadAdmin = () => import('./components/pages/admin/AdminPage').then((m) => ({ default: m.AdminPage }));
const AdminPage = lazy(loadAdmin);
const SettingsPage = lazy(loadSettings);

export function App() {
  const nav = useAppNav();
  // 메뉴(페이지)를 옮기면 본문 스크롤을 맨 위로 복구합니다.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [nav.page]);
  const preparing = useAutoDemo();
  // 메뉴 이동은 transition으로 처리해, 아직 불러오지 못한 화면이 있어도 '불러오는 중' 문구로 바꾸지 않고 이전 화면을 유지하다가 바로 전환합니다.
  const goPage: typeof nav.setPage = (k) => startTransition(() => nav.setPage(k));
  useEffect(() => {
    void refreshDemoState(); // 시작할 때 시연 중인지 확인해 최상단 안내를 보여 줍니다.
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => [loadReports, loadMembers, loadOfferings, loadSettings, loadHelp, ...(pageAllowed('admin') ? [loadAdmin] : [])].forEach((load) => void load().catch(() => undefined)), 300);
    return () => window.clearTimeout(id);
  }, []);
  const backup = useAutoBackupBridge();
  const restoring = useRestoring();
  const reminder = useBackupReminder(backup.failure, () => goPage('settings'));
  return (
    <>
      {restoring ? <RestoringOverlay /> : null}
      {/* 종료 백업 중에는 앱이 저장하지 않는다고 보고 백업이 끝나면 변경 표시를 내리므로, 덮개는 inert 밖에 두어 [백업 없이 종료]는 누를 수 있게 합니다. */}
      {backup.closing ? <ClosingOverlay onSkip={backup.skipBackup} /> : null}
      {/* 확인·복원·종료 백업 중에는 덮개 뒤의 앱 전체를 inert로 막아 클릭뿐 아니라 Tab·Enter로도 조작할 수 없게 합니다. */}
    <div className="flex h-full flex-col" inert={restoring || backup.closing}>
      <AutoSaveToast status={backup.autoSave} />
      <BrowserNotice />
      <DemoBanner />
      {preparing ? <DemoPreparing done={preparing.done} total={preparing.total} /> : null}
      <header className="no-print flex items-center gap-6 bg-slate-800 px-4 text-white">
        <h1 className="py-3 text-base font-bold">청지기 장부</h1>
        <nav className="flex gap-1" aria-label="주 메뉴">
          {visiblePages().map((p) => (
            <button
              key={p.key}
              className={`px-4 py-3 text-sm ${nav.page === p.key ? 'bg-slate-900 font-semibold' : 'text-slate-300 hover:text-white'}`}
              aria-current={nav.page === p.key ? 'page' : undefined}
              onClick={() => goPage(p.key)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <SessionBar />
      </header>
      <GlobalErrorBanner />
      <NewVersionBanner />
      <WhatsNewModal />
      <BackupReminderBanner {...reminder} />
      <main ref={mainRef} className="flex-1 overflow-y-auto p-4 print:overflow-visible print:px-[8mm] print:py-[5mm]">
        {/* 한 화면에서 오류가 나도 앱 전체가 멈추지 않도록 화면마다 경계를 둡니다. 메뉴를 옮기면 새로 시작합니다. */}
        <Suspense fallback={<p className="p-4 text-sm text-slate-500">화면을 불러오는 중…</p>}>
          <ErrorBoundary key={nav.page}>
            {nav.page === 'input' ? <DonationInputPage onNavigate={goPage} /> : null}
            {nav.page === 'members' ? <MembersPage /> : null}
            {nav.page === 'offerings' ? <OfferingsPage /> : null}
            {nav.page === 'reports' ? <ReportsPage /> : null}
            {nav.page === 'settings' ? <SettingsPage /> : null}
            {nav.page === 'admin' ? <AdminPage /> : null}
            {nav.page === 'help' ? <HelpPage /> : null}
          </ErrorBoundary>
        </Suspense>
      </main>
    </div>
    </>
  );
}
