import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { useDonationInput } from '../../../hooks/useDonationInput';
import { useIsMobileDevice } from '../../../hooks/useIsMobileDevice';
import { DatePicker } from '../../shared/DatePicker';
import { Notice } from '../../shared/Notice';
import { DonationEditModal } from '../reports/DonationEditModal';
import { AmountRow, KoreanAmount } from './AmountRow';
import { DailyTotalsBar } from './DailyTotalsBar';
import { DuplicateModal } from './DuplicateModal';
import { HistoryPanel } from './HistoryPanel';
import { LargeAmountModal } from './LargeAmountModal';
import { MemberSearchBox } from './MemberSearchBox';
import { QuickRegisterModal } from './QuickRegisterModal';

export function DonationInputPage() {
  const c = useDonationInput();
  const editor = useDonationEditor();
  const isMobile = useIsMobileDevice();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <DailyTotalsBar date={c.date} />
        {/* 저장 결과는 화면 아래로 밀려 가려지지 않도록 위쪽에 두고, 나타나도 입력 칸이 밀리지 않게 높이를 확보합니다. */}
        <div className="min-h-[2.75rem]" aria-live="polite">
          <Notice message={c.message} action={c.message?.undoable && c.canUndo ? { label: '되돌리기', onClick: () => void c.undo() } : undefined} />
        </div>
        {isMobile ? (
          <p role="note" className="no-print rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-relaxed text-red-600">
            안내: 이 프로그램은 PC 전용입니다. 모바일에서는 화면 구성과 기능을 보는 시연용으로 봐주세요. 모바일에서는 화면이 잘려보이거나 깨져 보일 수 있습니다.
          </p>
        ) : null}
        <section className="card space-y-4">
          <div className="grid grid-cols-[220px_minmax(0,26rem)] gap-3">
            <div>
              <span className="label">헌금 날짜</span>
              <DatePicker value={c.date} onChange={c.setDate} ariaLabel="헌금 날짜" pickOnly />
              <div className="mt-1 flex flex-wrap gap-1">
                <button type="button" tabIndex={-1} className="btn whitespace-nowrap px-2 py-0.5 text-xs" onClick={c.prevWeek} aria-label="한 주 전">
                  ‹ 이전 주
                </button>
                <button type="button" tabIndex={-1} className="btn whitespace-nowrap px-2 py-0.5 text-xs" onClick={c.goLastSunday}>
                  지난 주일
                </button>
                <button type="button" tabIndex={-1} className="btn whitespace-nowrap px-2 py-0.5 text-xs" onClick={c.nextWeek} aria-label="한 주 후">
                  다음 주 ›
                </button>
              </div>
            </div>
            <MemberSearchBox c={c} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">헌금 금액</h3>
            {c.primaryTypes.map((t) => (
              <AmountRow
                key={t.id}
                label={t.name}
                value={c.amounts[t.id] ?? ''}
                quickAmounts={t.quickAmounts}
                inputRef={c.bindField(t.id)}
                onChange={(v) => c.onAmountChange(t.id, v)}
                onQuick={(n) => c.onQuickAmount(t.id, n)}
                onClear={() => c.onClearAmount(t.id)}
                onKeyDown={c.onFieldKeyDown(t.id)}
                keepFocus={c.keepFocus}
              />
            ))}
            {c.dropdownTypes.length > 0 ? (
              <div className="grid grid-cols-[140px_200px] items-start gap-2">
                <select className="input w-28" value={c.extraTypeId} onChange={(e) => c.setExtraTypeId(e.target.value)} aria-label="기타 헌금 종류">
                  <option value="">기타 선택</option>
                  {c.dropdownTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <div>
                  <input
                    ref={c.bindField(c.extraFieldId)}
                    className="input text-right"
                    inputMode="numeric"
                    placeholder="0"
                    value={c.extraAmount}
                    onChange={(e) => c.onExtraAmountChange(e.target.value)}
                    onKeyDown={c.onFieldKeyDown(c.extraFieldId)}
                    aria-label="기타 헌금 금액"
                  />
                  <KoreanAmount value={c.extraAmount} />
                </div>
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="label">메모</span>
            <input
              ref={c.bindField(c.memoFieldId)}
              className="input max-w-md"
              value={c.memo}
              onChange={(e) => c.setMemo(e.target.value)}
              onKeyDown={c.onFieldKeyDown(c.memoFieldId)}
              placeholder="특이사항 (Enter = 저장)"
            />
          </label>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={() => void c.requestSave()} disabled={c.saving}>
              저장 (Enter)
            </button>
            <span className="text-xs text-gray-500">
              Enter: 다음 칸 · F2: 무명/방문자 전환 · F4: 현금 계수 입력 · Ctrl+Enter: 어느 칸에서든 바로 저장 · 입력 칸이 비었을 때 Ctrl+Z: 직전 입력 되돌리기
            </span>
          </div>
        </section>
      </div>

      <HistoryPanel canUndo={c.canUndo} onUndo={() => void c.undo()} onEdit={(d) => editor.open(d, 'EDIT')} />
      <DonationEditModal editor={editor} />

      <QuickRegisterModal c={c} />
      <LargeAmountModal c={c} />
      <DuplicateModal c={c} />
    </div>
  );
}
