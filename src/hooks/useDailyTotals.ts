import { useMemo, useState } from 'react';
import { useDonationActions, useDonationMonths, useMonthsLoadFailed } from '../contexts/DonationContext';
import { useOfferingTypeById } from '../contexts/OfferingTypeContext';
import { formatAmountInput, parseAmount } from '../services/domain/amount';

/** 선택일 합계 대조: 총액·건수·종류별 소계 + 현금 계수 차액 (계수 금액은 화면 임시 값) */
export function useDailyTotals(date: string) {
  const ym = date.slice(0, 7);
  const shard = useDonationMonths([ym]);
  const failed = useMonthsLoadFailed([ym]);
  const { ensureMonths } = useDonationActions();
  const typeById = useOfferingTypeById();
  const [cash, setCash] = useState({ date, value: '' });
  const cashInput = cash.date === date ? cash.value : ''; // 날짜를 바꾸면 초기화

  const totals = useMemo(() => {
    const byType = new Map<string, number>();
    let total = 0;
    let count = 0;
    for (const d of shard) {
      if (d.date !== date) continue;
      total += d.amount;
      count++;
      byType.set(d.offeringTypeId, (byType.get(d.offeringTypeId) ?? 0) + d.amount);
    }
    const rows = [...byType.entries()]
      .map(([id, amount]) => ({ id, name: typeById.get(id)?.name ?? '(삭제된 종류)', amount, sort: typeById.get(id)?.sortOrder ?? 999 }))
      .sort((a, b) => a.sort - b.sort);
    return { total, count, rows };
  }, [shard, date, typeById]);

  const parsed = parseAmount(cashInput);
  const cashValue = parsed.kind === 'ok' ? parsed.value : null;
  const diff = cashValue === null || failed ? null : cashValue - totals.total; // 읽지 못한 달은 차액을 계산하지 않음

  return {
    ...totals,
    /** 이 달을 읽지 못함(합계를 믿을 수 없음) */
    failed,
    retry: () => void ensureMonths([ym]),
    cashInput,
    onCashChange: (v: string) => setCash({ date, value: formatAmountInput(v) }),
    diff,
    matched: diff === 0,
  };
}
