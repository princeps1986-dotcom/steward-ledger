import { useMemo } from 'react';
import { useDonationMonthsRecord, useSaveHistory } from '../contexts/DonationContext';
import { useOfferingTypeById } from '../contexts/OfferingTypeContext';
import type { Donation } from '../contexts/types';

interface HistoryLine {
  key: string;
  typeName: string;
  amount: number;
  merged: boolean;
  /** 현재 저장소의 내역. 이미 삭제됐거나 찾을 수 없으면 null(수정 불가) */
  donation: Donation | null;
}

interface HistoryItem {
  batchId: string;
  donorDisplayName: string;
  savedAt: string;
  lines: HistoryLine[];
}

/**
 * 입력 화면 "최근 입력" 목록. 저장 당시 금액이 아니라 현재 저장소의 내역을 기준으로 보여 주어,
 * 목록에서 수정한 결과가 바로 반영되고 해당 줄에서 곧바로 수정할 수 있습니다.
 */
export function useHistoryItems(): HistoryItem[] {
  const history = useSaveHistory();
  const months = useDonationMonthsRecord();
  const typeById = useOfferingTypeById();

  return useMemo(() => {
    const wanted = new Set(history.flatMap((b) => [...b.createdIds, ...b.mergedBefore.map((m) => m.id)]));
    const byId = new Map<string, Donation>();
    const scan = (list: readonly Donation[]): void => {
      for (const d of list) if (wanted.has(d.id)) byId.set(d.id, d);
    };
    // 저장한 날짜의 달만 먼저 찾고, 못 찾은 내역이 있을 때만(수정으로 다른 달로 옮겨진 경우) 불러온 나머지 달을 찾습니다.
    const home = new Set(history.map((b) => b.date.slice(0, 7)));
    for (const ym of home) scan(months[ym] ?? []);
    if (byId.size < wanted.size) for (const [ym, list] of Object.entries(months)) if (!home.has(ym)) scan(list);
    const name = (id: string): string => typeById.get(id)?.name ?? '?';

    return history.map((b): HistoryItem => {
      const lines: HistoryLine[] = [];
      const push = (id: string, merged: boolean): void => {
        const d = byId.get(id);
        if (d) lines.push({ key: id, typeName: name(d.offeringTypeId), amount: d.amount, merged, donation: d });
      };
      b.createdIds.forEach((id) => push(id, false));
      b.mergedBefore.forEach((m) => push(m.id, true));
      // 대응하는 내역을 찾지 못하면(다른 경로로 삭제) 저장 당시 기록을 그대로 표시
      const fallback: HistoryLine[] = b.lines.map((l, i) => ({ key: `${b.batchId}-${i}`, typeName: name(l.offeringTypeId), amount: l.amount, merged: l.merged, donation: null }));
      // 이름도 현재 내역 기준(무명 내역을 다른 날로 옮기면 번호가 바뀔 수 있음). 찾지 못하면 저장 당시 이름
      return { batchId: b.batchId, donorDisplayName: lines[0]?.donation?.donorDisplayName ?? b.donorDisplayName, savedAt: b.savedAt, lines: lines.length ? lines : fallback };
    });
  }, [history, months, typeById]);
}
