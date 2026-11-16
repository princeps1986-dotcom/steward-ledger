import type { ReactNode } from 'react';
import { DonationProvider } from './DonationContext';
import { MemberProvider } from './MemberContext';
import { OfferingTypeProvider } from './OfferingTypeContext';
import { SettingsProvider } from './SettingsContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <MemberProvider>
        <OfferingTypeProvider>
          <DonationProvider>{children}</DonationProvider>
        </OfferingTypeProvider>
      </MemberProvider>
    </SettingsProvider>
  );
}
