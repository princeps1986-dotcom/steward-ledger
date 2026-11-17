import { lazy, Suspense } from 'react';
import { ClosingOverlay } from './components/shared/ClosingOverlay';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { BackupReminderBanner } from './components/shared/BackupReminderBanner';
import { GlobalErrorBanner } from './components/shared/GlobalErrorBanner';
import { DonationInputPage } from './components/pages/donation-input/DonationInputPage';
import { PAGES, useAppNav, useAutoBackupBridge, useBackupReminder } from './hooks/useAppShell';

// 첫 화면(헌금 입력) 외의 화면은 처음 열 때 불러와 시작이 가벼워집니다.
const HelpPage = lazy(() => import('./components/pages/help/HelpPage').then((m) => ({ default: m.HelpPage })));
const MembersPage = lazy(() => import('./components/pages/members/MembersPage').then((m) => ({ default: m.MembersPage })));
const OfferingsPage = lazy(() => import('./components/pages/offerings/OfferingsPage').then((m) => ({ default: m.OfferingsPage })));
const ReportsPage = lazy(() => import('./components/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./components/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

export function App() {
  const nav = useAppNav();
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
              onClick={() => nav.setPage(p.key)}
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
        <ErrorBoundary key={nav.page}>
          <Suspense fallback={<p className="p-4 text-sm text-slate-500">화면을 불러오는 중…</p>}>
            {nav.page === 'input' ? <DonationInputPage onNavigate={nav.setPage} /> : null}
            {nav.page === 'members' ? <MembersPage /> : null}
            {nav.page === 'offerings' ? <OfferingsPage /> : null}
            {nav.page === 'reports' ? <ReportsPage /> : null}
            {nav.page === 'settings' ? <SettingsPage /> : null}
            {nav.page === 'help' ? <HelpPage /> : null}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
