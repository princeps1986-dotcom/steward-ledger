import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Member } from '../../contexts/types';
import { matchMember } from '../../services/domain/search';

export interface HeadOption {
  id: string;
  label: string;
  member: Member;
}

/** 항목 한 줄 높이(px). 가상 스크롤이 이 높이로 위치를 계산합니다. */
const ROW = 36;

interface Props {
  options: HeadOption[];
  /** 선택된 세대주 id ('' = 연결 없음) */
  value: string;
  onChange(id: string): void;
  /** 비활성일 때 칸 안에 보여 줄 문구 */
  disabledText?: string;
  disabled?: boolean;
  ariaLabel: string;
}

/**
 * 이름·연락처 뒷자리로 찾아 고르는 세대주 선택(성도 검색 칸과 같은 방식). 고른 뒤에는 [연결 해제]로 풉니다.
 * 결과가 많아도 보이는 줄만 그리는 가상 스크롤을 씁니다.
 */
export function HeadPicker({ options, value, onChange, disabledText = '', disabled = false, ariaLabel }: Props) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const matches = useMemo(() => (q ? options.filter((o) => matchMember(o.member, q)) : options), [options, q]);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 6,
    initialRect: { width: 0, height: 240 }, // 목록이 열리는 첫 그리기에도 줄이 나오도록(곧 실제 크기로 갱신됨)
  });

  // 키보드로 움직인 항목이 보이는 범위 안에 오도록 따라갑니다.
  useEffect(() => {
    if (open && matches.length) virtualizer.scrollToIndex(Math.min(highlight, matches.length - 1), { align: 'auto' });
  }, [highlight, open, matches.length, virtualizer]);

  if (disabled) return <input className="input" disabled value={disabledText} readOnly aria-label={ariaLabel} />;

  if (value) {
    const selected = options.find((o) => o.id === value);
    return (
      <div className="flex items-center gap-2">
        <div className="input flex-1 truncate" aria-label={ariaLabel}>
          {selected?.label ?? '연결됨(비활성 세대주)'}
        </div>
        <button type="button" className="btn whitespace-nowrap px-2 py-1.5 text-xs" onClick={() => onChange('')}>
          연결 해제
        </button>
      </div>
    );
  }

  const choose = (o: HeadOption): void => {
    onChange(o.id);
    setQuery('');
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (matches.length) setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === 'Enter' && open && matches[highlight]) {
      e.preventDefault(); // 저장(폼 제출)이 아니라 선택으로 처리
      choose(matches[highlight]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation(); // 창이 닫히지 않고 목록만 닫힘
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        className="input"
        value={query}
        placeholder="이름·연락처 뒷자리로 찾기"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg">
          <div ref={scrollRef} className="max-h-60 overflow-y-auto">
            <ul id={listId} role="listbox" className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const o = matches[vi.index];
                return (
                  <li
                    key={o.id}
                    role="option"
                    aria-selected={vi.index === highlight}
                    aria-setsize={matches.length}
                    aria-posinset={vi.index + 1}
                    className={`absolute left-0 top-0 w-full cursor-pointer truncate px-3 py-2 text-sm ${vi.index === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    style={{ height: ROW, transform: `translateY(${vi.start}px)` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(vi.index)}
                    onClick={() => choose(o)}
                  >
                    {o.label}
                  </li>
                );
              })}
            </ul>
            {matches.length === 0 ? <p className="px-3 py-2 text-sm text-gray-500">검색 결과가 없습니다.</p> : null}
          </div>
          {matches.length > 0 ? <p className="border-t px-3 py-1 text-right text-xs text-gray-500">{matches.length}명</p> : null}
        </div>
      ) : null}
    </div>
  );
}
