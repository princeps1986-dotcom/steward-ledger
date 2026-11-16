import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAllAudits, useDonationActions, useDonationMonths, useDonationYears } from '../contexts/DonationContext';
import { useMemberById, useMembers } from '../contexts/MemberContext';
import { useMemberOrderKey, useNameTag } from './useNameTag';
import { useOfferingTypeById, useOfferingTypes } from '../contexts/OfferingTypeContext';
import { useSettings } from '../contexts/SettingsContext';
import type { AuditLog, Donation, Member } from '../contexts/types';
import { formatWon } from '../services/domain/amount';
import { auditLogsForPeriod } from '../services/domain/auditFilter';
import { filterByDonor, sortForList } from '../services/domain/donationList';
import { monthRangeOf, shiftWeek, weekRangeOf } from '../services/domain/calendar';
import { formatDateTime, isValidDateString, lastSunday, monthOf, monthsOfPeriod, periodLabel, type PeriodType } from '../services/domain/dates';
import { buildWeeklyMatrix } from '../services/domain/weekly';
import { familyKeyOf, familyKeyOfMember, type FamilyBasis } from '../services/domain/family';
import { memberLabel, searchMembers } from '../services/domain/search';
import { buildReportWorkbook, buildWeeklyWorkbook } from '../services/excel/excelService';
import { desktop, type SavedFileInfo } from '../services/desktopBridge';
import { downloadBlob } from '../services/excel/downloadBridge';
import { isValidEmail, openMailto } from '../services/excel/mailtoProtocol';

export type ReportTab = 'SUMMARY' | 'LIST' | 'PERSONAL' | 'AUDIT';

/** 선택이 바뀐 뒤 이 시간(ms) 동안 더 바뀌지 않아야 보고서를 새로 계산합니다. */
export const REPORT_DELAY_MS = 250;

/** 값이 바뀐 뒤 delay 동안 더 바뀌지 않으면 그 값을 돌려줍니다(그동안은 이전 값). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (v === value) return;
    const id = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(id);
  }, [value, v, delay]);
  return v;
}

/** 보고서 공통 필터: 연도 + 기간(연/분기/월/주) + 세대 집계 기준 */
export function useReportFilters() {
  const years = useDonationYears();
  const currentYear = String(new Date().getFullYear());
  const [selYear, setYear] = useState(currentYear);
  // 보고서 화면에 들어오면 가장 최근의 지난 주일(오늘이 주일이면 오늘)이 속한 주(일~토)의 주별 보고서를 기본으로 보여 줍니다.
  const [selPeriodType, setPeriodTypeState] = useState<PeriodType>('WEEK');
  const [selPeriodValue, setPeriodValue] = useState(1);
  const [basis, setBasis] = useState<FamilyBasis>('CURRENT');

  // 주별: 가장 최근의 지난 주일이 기본 선택. 마지막 유효 날짜를 기준으로 집계합니다.
  const [weekText, setWeekText] = useState(() => lastSunday());
  const [selWeekBase, setWeekBase] = useState(weekText);

  // 선택 칸(연도·기간·주)은 바로 바뀌지만, 보고서 계산·표시는 선택이 잠시(REPORT_DELAY_MS) 멈춘 뒤에 합니다.
  // 주 이동 등을 연타할 때 중간 보고서를 매번 계산하지 않기 위함입니다.
  const selection = useMemo(
    () => ({ year: selYear, periodType: selPeriodType, periodValue: selPeriodValue, weekBase: selWeekBase }),
    [selYear, selPeriodType, selPeriodValue, selWeekBase],
  );
  const applied = useDebouncedValue(selection, REPORT_DELAY_MS);
  const pending = applied !== selection;
  const { year, periodType, periodValue, weekBase } = applied;
  const isWeek = periodType === 'WEEK';
  const week = useMemo(() => weekRangeOf(weekBase), [weekBase]);
  const monthRange = useMemo(() => monthRangeOf(year, periodValue), [year, periodValue]);

  const months = useMemo(() => monthsOfPeriod(periodType, periodValue), [periodType, periodValue]);
  // 이 보고서가 쓰는 달('YYYY-MM')만 메모리로 불러옵니다: 주별은 시작·종료일이 속한 달(1~2개), 월·분기·연도는 그 기간의 달들.
  const neededMonths = useMemo(
    () => (isWeek ? [...new Set([week.start.slice(0, 7), week.end.slice(0, 7)])] : months.map((m) => `${year}-${String(m).padStart(2, '0')}`)),
    [isWeek, week, months, year],
  );
  const source = useDonationMonths(neededMonths);

  const yearOptions = useMemo(() => [...new Set([...years, currentYear])].sort().reverse(), [years, currentYear]);
  // 월·분기·연도는 불러온 달이 곧 그 기간이므로 그대로 쓰고(다른 달에 저장해도 배열이 바뀌지 않음), 주별만 날짜로 거릅니다.
  const donations = useMemo(() => (isWeek ? source.filter((d) => d.date >= week.start && d.date <= week.end) : source), [isWeek, week, source]);

  // 이전/다음 주를 빠르게 연타해도 매번 직전 선택에서 이어 가도록 최신 선택 주를 ref에도 즉시 기록합니다.
  const latestWeek = useRef(selWeekBase);
  const moveWeek = useCallback((d: string) => {
    latestWeek.current = d;
    setWeekText(d);
    setWeekBase(d);
  }, []);
  const setWeekDate = useCallback((v: string) => {
    setWeekText(v);
    if (isValidDateString(v)) {
      latestWeek.current = v;
      setWeekBase(v);
    }
  }, []);

  const setPeriodType = useCallback(
    (t: PeriodType) => {
      setPeriodTypeState(t);
      setPeriodValue(t === 'MONTH' ? new Date().getMonth() + 1 : t === 'QUARTER' ? Math.floor(new Date().getMonth() / 3) + 1 : 1);
      if (t === 'WEEK') moveWeek(lastSunday()); // 주별을 고를 때마다 가장 최근의 지난 주일을 기본 선택
    },
    [moveWeek],
  );

  const periodValueOptions =
    selPeriodType === 'MONTH'
      ? Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }))
      : selPeriodType === 'QUARTER'
        ? [1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` }))
        : [];

  return {
    // 보고서에 실제 적용된 값(계산·인쇄·엑셀 기준)
    year,
    periodType,
    periodValue,
    // 선택 칸에 보이는 값과 변경 함수(적용은 잠시 뒤). pending이면 아직 이전 선택의 보고서가 보이는 중입니다.
    sel: { year: selYear, periodType: selPeriodType, periodValue: selPeriodValue, isWeek: selPeriodType === 'WEEK' },
    pending,
    setYear,
    yearOptions,
    setPeriodType,
    setPeriodValue,
    periodValueOptions,
    months,
    donations,
    basis,
    setBasis,
    // 성도명 × 헌금 종류 표로 보여 주는 보고서(주별·월별)의 집계 기간. 연·분기는 null
    personKind: (isWeek ? 'WEEK' : periodType === 'MONTH' ? 'MONTH' : null) as 'WEEK' | 'MONTH' | null,
    personRange: isWeek ? week : periodType === 'MONTH' ? monthRange : null,
    // 주별 전용
    isWeek,
    week,
    weekDate: weekText,
    setWeekDate,
    prevWeek: () => moveWeek(shiftWeek(latestWeek.current, -1)),
    nextWeek: () => moveWeek(shiftWeek(latestWeek.current, 1)),
    goLastSunday: () => moveWeek(lastSunday()),
    label: isWeek ? `${week.start} ~ ${week.end} 주별` : periodLabel(year, periodType, periodValue),
  };
}

export type ReportFilters = ReturnType<typeof useReportFilters>;

const NO_HIDDEN: ReadonlySet<string> = new Set();

/** 보고서에서 숨기기로 한 헌금 종류의 내역을 뺍니다(화면·인쇄·엑셀·메일 저장 공통). */
export function withoutTypes<T extends { offeringTypeId: string }>(donations: readonly T[], hidden: ReadonlySet<string>): readonly T[] {
  return hidden.size === 0 ? donations : donations.filter((d) => !hidden.has(d.offeringTypeId));
}

const typesWithout = <T extends { id: string }>(types: readonly T[], hidden: ReadonlySet<string>): readonly T[] =>
  hidden.size === 0 ? types : types.filter((t) => !hidden.has(t.id));

/** 종합 보고서의 [헌금 종류 표시] 선택지: 이 보고서 기간에 쓰였거나 활성인 종류(정렬 순서대로) */
export function useTypeToggleOptions(f: ReportFilters): { id: string; name: string; isActive: boolean }[] {
  const types = useOfferingTypes();
  return useMemo(() => {
    const inPeriod = f.isWeek ? f.donations.filter((d) => d.date >= f.week.start && d.date <= f.week.end) : f.donations;
    const used = new Set(inPeriod.map((d) => d.offeringTypeId));
    return types
      .filter((t) => t.isActive || used.has(t.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }));
  }, [types, f.donations, f.isWeek, f.week]);
}

/** 종합 보고서: 헌금 종류 × 월 매트릭스 */
export function useSummaryReport(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN) {
  const types = useOfferingTypes();
  return useMemo(() => {
    const donations = withoutTypes(f.donations, hidden);
    const used = new Set(donations.map((d) => d.offeringTypeId));
    const list = types.filter((t) => !hidden.has(t.id) && (t.isActive || used.has(t.id))).sort((a, b) => a.sortOrder - b.sortOrder);
    const cell = new Map<string, number>();
    const byType = new Map<string, number>();
    const byMonth = new Map<number, number>();
    let total = 0;
    for (const d of donations) {
      const m = monthOf(d.date);
      cell.set(`${d.offeringTypeId}|${m}`, (cell.get(`${d.offeringTypeId}|${m}`) ?? 0) + d.amount);
      byType.set(d.offeringTypeId, (byType.get(d.offeringTypeId) ?? 0) + d.amount);
      byMonth.set(m, (byMonth.get(m) ?? 0) + d.amount);
      total += d.amount;
    }
    return {
      months: f.months,
      rows: list.map((t) => ({
        id: t.id,
        name: t.name,
        cells: f.months.map((m) => cell.get(`${t.id}|${m}`) ?? 0),
        total: byType.get(t.id) ?? 0,
      })),
      monthTotals: f.months.map((m) => byMonth.get(m) ?? 0),
      total,
      count: donations.length,
      anonymousTotal: donations.filter((d) => d.memberId === null).reduce((s, d) => s + d.amount, 0),
    };
  }, [types, f.donations, f.months, hidden]);
}

/** 주별 보고서(종합 보고서의 기간 '주별'): 선택 주(일~토)를 헌금 종류 × 성도명 교차표로 집계 */
export function useWeeklyMatrix(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN) {
  const types = useOfferingTypes();
  const orderKey = useMemberOrderKey();
  const range = f.personRange!;
  return useMemo(() => {
    const matrix = buildWeeklyMatrix(withoutTypes(f.donations, hidden), typesWithout(types, hidden), range, orderKey);
    // 주별은 "시작 ~ 종료", 월별은 "YYYY-MM"으로 표시
    const rangeLabel = f.personKind === 'MONTH' ? range.start.slice(0, 7) : `${range.start} ~ ${range.end}`;
    return { matrix, rangeLabel, hasData: matrix.count > 0 };
  }, [f.donations, types, range, orderKey, hidden, f.personKind]);
}

/** 전체 입력 내역 탭: 현재 보고서 기간의 모든 헌금 내역(무명/방문자 포함)을 최신순으로, 이름·초성으로 거를 수 있음 */
export function useDonationListReport(f: ReportFilters) {
  const typeById = useOfferingTypeById();
  const tagOf = useNameTag();
  const [query, setQuery] = useState('');
  // 정렬·거르기는 헌금 배열만 만들고, 종류 이름·금액 글자·구분 표기는 화면에 그려지는 행만 계산합니다(수십만 건에서도 빠르게).
  const { donations, total } = useMemo(() => {
    const sorted = sortForList(filterByDonor(f.donations, query));
    let sum = 0;
    for (const d of sorted) sum += d.amount;
    return { donations: sorted, total: sum };
  }, [f.donations, query]);
  const rowAt = useCallback(
    (i: number) => {
      const d = donations[i];
      return {
        donation: d,
        typeName: typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)',
        amountLabel: formatWon(d.amount),
        tag: tagOf(d.memberId),
      };
    },
    [donations, typeById, tagOf],
  );
  return { query, setQuery, count: donations.length, total, rowAt };
}

/** 개인별·세대별 조회 */
export function usePersonalReport(f: ReportFilters) {
  const members = useMembers();
  const memberById = useMemberById();
  const typeById = useOfferingTypeById();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'PERSON' | 'FAMILY'>('PERSON');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selected = selectedId ? memberById.get(selectedId) ?? null : null;

  // 비활성 성도도 과거 내역 조회를 위해 검색 대상에 포함
  const results = useMemo(
    () => (selected ? [] : searchMembers(members.map((m) => ({ ...m, isActive: true })), query, 15)),
    [members, query, selected],
  );

  const rows = useMemo(() => {
    if (!selected) return [];
    let list: Donation[];
    if (mode === 'PERSON') list = f.donations.filter((d) => d.memberId === selected.id);
    else {
      const key = familyKeyOfMember(selected);
      list = f.donations.filter((d) => familyKeyOf(d, f.basis, memberById) === key);
    }
    return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }, [selected, mode, f.donations, f.basis, memberById]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of rows) map.set(d.offeringTypeId, (map.get(d.offeringTypeId) ?? 0) + d.amount);
    return [...map.entries()]
      .map(([id, amount]) => ({ id, name: typeById.get(id)?.name ?? '(삭제된 종류)', amount, sort: typeById.get(id)?.sortOrder ?? 999 }))
      .sort((a, b) => a.sort - b.sort);
  }, [rows, typeById]);

  const select = useCallback((m: Member) => {
    setSelectedId(m.id);
    setQuery(m.name);
    setDropdownOpen(false);
  }, []);

  const isOpen = dropdownOpen && !selected && query.trim() !== '';

  /** ↑↓ 이동 · Enter 선택 · Esc 닫기 (헌금 입력 화면의 성도 검색과 같은 방식) */
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const count = results.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (count === 0) return;
      e.preventDefault();
      setDropdownOpen(true);
      setHighlight((h) => (e.key === 'ArrowDown' ? (h + 1) % count : (h - 1 + count) % count));
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    } else if (e.key === 'Enter' && isOpen && count > 0) {
      e.preventDefault();
      select(results[Math.min(highlight, count - 1)]);
    }
  };

  return {
    query,
    onQueryChange: (v: string) => {
      setQuery(v);
      setSelectedId(null);
      setDropdownOpen(true);
      setHighlight(0);
    },
    onSearchKeyDown,
    highlight,
    setHighlight,
    results: results.map((m) => ({ member: m, label: memberLabel(m) })),
    dropdownOpen: isOpen,
    select,
    selectedLabel: selected ? memberLabel(selected) : '',
    hasSelection: !!selected,
    mode,
    setMode,
    rows: rows.map((d) => ({
      donation: d,
      typeName: typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)',
      amountLabel: formatWon(d.amount),
    })),
    byType,
    total: rows.reduce((s, d) => s + d.amount, 0),
  };
}

/** 이력 한 줄에 보여 줄 헌금 내역(성도명 구분 표기를 작게 붙이기 위해 부분별로 나눔). null = 삭제됨 */
export interface AuditDonationView {
  date: string;
  name: string;
  tag: string | null;
  typeName: string;
  amount: string;
  memo: string | null;
}

/**
 * 수정·삭제 이력 탭: 지금 보고 있는 보고서(연/분기/월/주)의 기간에 해당하는 내역의 이력만 보여 줍니다.
 * 이력의 변경 전·후 내역 중 하나라도 보고서 기간에 속하면 포함합니다(날짜를 다른 기간으로 옮긴 수정도 양쪽 보고서에서 보임).
 * 연도를 옮긴 수정은 새 연도의 이력 장부에 기록되므로 모든 연도의 이력을 불러와 날짜로 거릅니다.
 */
export function useAuditLogTab(f: ReportFilters) {
  const { ensureAuditYear } = useDonationActions();
  const years = useDonationYears();
  const audits = useAllAudits();
  const typeById = useOfferingTypeById();
  const tagOf = useNameTag();
  useEffect(() => {
    for (const y of years) void ensureAuditYear(y);
  }, [ensureAuditYear, years]);

  const { isWeek, week, year, months } = f;
  return useMemo(() => {
    const describe = (d: Donation | null): AuditDonationView | null =>
      d
        ? {
            date: d.date,
            name: d.donorDisplayName,
            tag: tagOf(d.memberId),
            typeName: typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)',
            amount: formatWon(d.amount),
            memo: d.memo ?? null,
          }
        : null;
    return auditLogsForPeriod(Object.values(audits).flat(), { isWeek, week, year, months }).map((l: AuditLog) => ({
      id: l.id,
      time: formatDateTime(l.timestamp),
      actionLabel: l.action === 'UPDATE' ? '수정' : '삭제',
      reason: l.reason,
      before: describe(l.beforeSnapshot),
      after: describe(l.afterSnapshot),
    }));
  }, [audits, typeById, tagOf, isWeek, week, year, months]);
}

/** 인쇄·엑셀 저장·메일 저장 */
export function useReportExport(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN) {
  const members = useMembers();
  const types = useOfferingTypes();
  const settings = useSettings();
  const orderKey = useMemberOrderKey();
  const [busy, setBusy] = useState(false);
  const [message, setMessageState] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedFileInfo | null>(null);

  // 안내 문구를 바꿀 때 이전 저장 파일 버튼은 함께 지웁니다(다른 문구 옆에 남지 않도록).
  const say = useCallback((text: string | null) => {
    setMessageState(text);
    setSaved(null);
  }, []);

  // 데스크톱 앱: 엑셀 저장이 끝나면 저장 위치를 받아 [파일 열기] 버튼을 보여 줍니다.
  useEffect(() => desktop()?.onDownloadDone(setSaved), []);

  const openSaved = useCallback(async () => {
    if (!saved) return;
    const err = await desktop()?.openFile(saved.path);
    if (err) {
      setMessageState(`파일을 열지 못했습니다: ${err}`);
      setSaved(null);
    }
  }, [saved]);
  const showSaved = useCallback(async () => {
    if (saved) await desktop()?.showInFolder(saved.path);
  }, [saved]);

  // 주별은 세대 집계 기준과 무관하므로 파일명에 넣지 않습니다.
  const fileName = f.isWeek
    ? `주별헌금보고서_${f.week.start}_${f.week.end}.xlsx`
    : f.personKind === 'MONTH'
      ? `월별헌금보고서_${f.year}-${String(f.periodValue).padStart(2, '0')}.xlsx`
      : `헌금결산_${f.label}_${f.basis === 'CURRENT' ? '현재세대' : '납부당시세대'}.xlsx`;

  const build = useCallback(() => {
    const donations = withoutTypes(f.donations, hidden) as typeof f.donations;
    return f.personRange
        ? buildWeeklyWorkbook({
            range: f.personRange,
            matrix: buildWeeklyMatrix(donations, typesWithout(types, hidden), f.personRange, orderKey),
            donations,
            offeringTypes: typesWithout(types, hidden) as typeof types,
            // 월별은 개별 내역 시트 없이 성도명 × 헌금 종류 표만 저장합니다.
            kind: f.personKind === 'MONTH' ? 'MONTH' : 'WEEK',
          })
        : buildReportWorkbook({
            year: f.year,
            periodType: f.periodType,
            periodValue: f.periodValue,
            donations,
            members,
            offeringTypes: typesWithout(types, hidden) as typeof types,
            basis: f.basis,
          });
  }, [f.personRange, f.personKind, f.year, f.periodType, f.periodValue, f.donations, f.basis, members, types, orderKey, hidden]);

  const saveExcel = useCallback(async () => {
    setBusy(true);
    try {
      downloadBlob(await build(), fileName);
      say(`${fileName} 저장 완료`);
    } catch (err) {
      say(`엑셀 생성 실패: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [build, fileName, say]);

  const mailSave = useCallback(async () => {
    if (!isValidEmail(settings.recipientEmail)) {
      say('설정 정보 화면에서 기본 메일 주소를 먼저 등록하세요.');
      return;
    }
    setBusy(true);
    try {
      downloadBlob(await build(), fileName);
      openMailto(
        settings.recipientEmail,
        `[헌금 결산] ${f.label}`,
        `${f.label} 헌금 결산 파일(${fileName})이 다운로드 폴더에 저장되었습니다.\n이 메일에 파일을 첨부하여 보내 주세요.`,
      );
      say('메일 앱을 열고 엑셀 파일을 다운로드했습니다. 파일을 직접 첨부하세요.');
    } catch (err) {
      say(`메일 저장 실패: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [build, fileName, settings.recipientEmail, f.label, say]);

  const fileActions = saved
    ? [
        { label: '파일 열기', onClick: () => void openSaved() },
        { label: '폴더 열기', onClick: () => void showSaved() },
      ]
    : undefined;

  return { busy, message, fileActions, saveExcel, mailSave, print: () => window.print() };
}
