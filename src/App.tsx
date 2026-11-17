import { lazy, startTransition, Suspense, useEffect } from 'react';
import { ClosingOverlay } from './components/shared/ClosingOverlay';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { BackupReminderBanner } from './components/shared/BackupReminderBanner';
import { GlobalErrorBanner } from './components/shared/GlobalErrorBanner';
import { DonationInputPage } from './components/pages/donation-input/DonationInputPage';
import { PAGES, useAppNav, useAutoBackupBridge, useBackupReminder } from './hooks/useAppShell';

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
const SettingsPage = lazy(loadSettings);

export function App() {
  const nav = useAppNav();
  // 메뉴 이동은 transition으로 처리해, 아직 불러오지 못한 화면이 있어도 '불러오는 중' 문구로 바꾸지 않고 이전 화면을 유지하다가 바로 전환합니다.
  const goPage: typeof nav.setPage = (k) => startTransition(() => nav.setPage(k));
  useEffect(() => {
    const id = window.setTimeout(() => [loadReports, loadMembers, loadOfferings, loadSettings, loadHelp].forEach((load) => void load().catch(() => undefined)), 300);
    return () => window.clearTimeout(id);
  }, []);
  const backup = useAutoBackupBridge();
  const reminder = useBackupReminder(backup.failure);
  return (
    <div className="flex h-full flex-col">
      {backup.closing ? <ClosingOverlay onSkip={backup.skipBackup} /> : null}
      <header className="no-print flex items-center gap-6 bg-slate-800 px-4 text-white">
        <h1 className="py-3 text-base font-bold">청지기 장부</h1>
        <nav className="flex gap-1" aria-label="주 메뉴">
          {PAGES.map((p) => (
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
      </header>
      <GlobalErrorBanner />
      <BackupReminderBanner {...reminder} />
      <main className="flex-1 overflow-y-auto p-4 print:overflow-visible print:px-[8mm] print:py-[5mm]">
        {/* 한 화면에서 오류가 나도 앱 전체가 멈추지 않도록 화면마다 경계를 둡니다. 메뉴를 옮기면 새로 시작합니다. */}
        <Suspense fallback={<p className="p-4 text-sm text-slate-500">화면을 불러오는 중…</p>}>
          <ErrorBoundary key={nav.page}>
            {nav.page === 'input' ? <DonationInputPage onNavigate={goPage} /> : null}
            {nav.page === 'members' ? <MembersPage /> : null}
            {nav.page === 'offerings' ? <OfferingsPage /> : null}
            {nav.page === 'reports' ? <ReportsPage /> : null}
            {nav.page === 'settings' ? <SettingsPage /> : null}
            {nav.page === 'help' ? <HelpPage /> : null}
          </ErrorBoundary>
        </Suspense>
      </main>
    </div>
  );
}
