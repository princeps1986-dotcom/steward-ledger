import { BackupReminderBanner } from './components/shared/BackupReminderBanner';
import { DonationInputPage } from './components/pages/donation-input/DonationInputPage';
import { HelpPage } from './components/pages/help/HelpPage';
import { MembersPage } from './components/pages/members/MembersPage';
import { OfferingsPage } from './components/pages/offerings/OfferingsPage';
import { ReportsPage } from './components/pages/reports/ReportsPage';
import { SettingsPage } from './components/pages/settings/SettingsPage';
import { PAGES, useAppNav, useAutoBackupBridge, useBackupReminder } from './hooks/useAppShell';

export function App() {
  const nav = useAppNav();
  const failure = useAutoBackupBridge();
  const reminder = useBackupReminder(failure);
  return (
    <div className="flex h-full flex-col">
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
      <BackupReminderBanner {...reminder} />
      <main className="flex-1 overflow-y-auto p-4 print:overflow-visible print:px-[8mm] print:py-[5mm]">
        {nav.page === 'input' ? <DonationInputPage /> : null}
        {nav.page === 'members' ? <MembersPage /> : null}
        {nav.page === 'offerings' ? <OfferingsPage /> : null}
        {nav.page === 'reports' ? <ReportsPage /> : null}
        {nav.page === 'settings' ? <SettingsPage /> : null}
        {nav.page === 'help' ? <HelpPage /> : null}
      </main>
    </div>
  );
}
