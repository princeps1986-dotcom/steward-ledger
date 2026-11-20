import type { PageKey } from '../../../hooks/useAppShell';
import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { useDonationInput } from '../../../hooks/useDonationInput';
import { DatePicker } from '../../shared/DatePicker';
import { Notice } from '../../shared/Notice';
import { DonationEditModal } from '../reports/DonationEditModal';
import { AmountRow, KoreanAmount } from './AmountRow';
import { DailyTotalsBar } from './DailyTotalsBar';
import { FirstRunGuide } from './FirstRunGuide';
import { DuplicateModal } from './DuplicateModal';
import { HistoryPanel } from './HistoryPanel';
import { LargeAmountModal } from './LargeAmountModal';
import { MemberSearchBox } from './MemberSearchBox';
import { QuickRegisterModal } from './QuickRegisterModal';

export function DonationInputPage({ onNavigate }: { onNavigate(page: PageKey): void }) {
  const c = useDonationInput();
  const editor = useDonationEditor();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {c.isFirstRun ? <FirstRunGuide onNavigate={onNavigate} /> : null}
        <DailyTotalsBar date={c.date} flashKey={c.savedSeq} />
        {/* 저장 결과는 화면 아래로 밀려 가려지지 않도록 위쪽에 두고, 나타나도 입력 칸이 밀리지 않게 높이를 확보합니다. */}
        <div className="min-h-[2.75rem]" aria-live="polite">
          <Notice key={c.message?.undoable ? `saved-${c.savedSeq}` : 'msg'} success={c.message?.undoable} message={c.message} action={c.message?.undoable && c.canUndo ? { label: '되돌리기', onClick: () => void c.undo() } : undefined} />
        </div>
        <section className="card space-y-4">
          <div className="grid grid-cols-[220px_minmax(0,26rem)] gap-3">
            <div>
              <span className="label">헌금 날짜</span>
              <DatePicker value={c.date} onChange={c.setDate} ariaLabel="헌금 날짜" />
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
            <MemberSearchBox s={c.search} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">헌금 금액</h3>
            {c.primaryTypes.map((t) => (
              <AmountRow
                key={t.id}
                typeId={t.id}
                label={t.name}
                value={c.amounts[t.id] ?? ''}
                quickAmounts={t.quickAmounts}
                bindField={c.bindField}
                onFieldKeyDown={c.onFieldKeyDown}
                onAmountChange={c.onAmountChange}
                onQuickAmount={c.onQuickAmount}
                onClearAmount={c.onClearAmount}
                keepFocus={c.keepFocus}
              />
            ))}
            {c.dropdownTypes.length > 0 ? (
              <div className="grid grid-cols-[140px_140px] items-start gap-x-5 gap-y-2">
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

      <QuickRegisterModal qr={c.quickRegister} />
      <LargeAmountModal large={c.largeAmount} />
      <DuplicateModal dup={c.duplicate} />
    </div>
  );
}
