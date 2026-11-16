export function ymd(d: Date): string;
export function parseYmd(s: string): Date;
export function addDays(d: Date, n: number): Date;
export function buildTestPayload(
  today: string,
  seed: number,
): {
  payload: {
    members: unknown[];
    offeringTypes: unknown[];
    donationsByYear: Record<string, unknown[]>;
    auditLogsByYear: Record<string, unknown[]>;
  };
  households: unknown[];
  yesterdayLines: unknown[];
  todayLines: unknown[];
  YESTERDAY: string;
};
