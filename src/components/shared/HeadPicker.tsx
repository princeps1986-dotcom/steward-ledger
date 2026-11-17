import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Member } from '../../contexts/types';
import { matchMember } from '../../services/domain/search';

export interface HeadOption {
  id: string;
  label: string;
  member: Member;
}

/** 한 번에 그리는 개수. 목록 끝까지 스크롤하면 이만큼씩 더 그립니다(성도가 많아도 화면에는 보이는 만큼만). */
const PAGE = 20;

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

/** 이름·연락처 뒷자리로 찾아 고르는 세대주 선택(성도 검색 칸과 같은 방식). 고른 뒤에는 [연결 해제]로 풉니다. */
export function HeadPicker({ options, value, onChange, disabledText = '', disabled = false, ariaLabel }: Props) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim();
  const matches = useMemo(() => (q ? options.filter((o) => matchMember(o.member, q)) : options), [options, q]);
  const results = matches.slice(0, shown);
  const hasMore = matches.length > shown;

  // 키보드로 움직인 항목이 목록 밖으로 나가지 않게 따라갑니다.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, open]);

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
      if (!results.length) return;
      if (e.key === 'ArrowDown' && highlight === results.length - 1 && hasMore) setShown((n) => n + PAGE); // 끝에서 더 내리면 다음 묶음을 불러옴
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter' && open && results[highlight]) {
      e.preventDefault(); // 저장(폼 제출)이 아니라 선택으로 처리
      choose(results[highlight]);
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
          setShown(PAGE);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setShown((n) => n + PAGE);
          }}
        >
          {results.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === highlight}
              className={`cursor-pointer px-3 py-2 text-sm ${i === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => choose(o)}
            >
              {o.label}
            </li>
          ))}
          {results.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">검색 결과가 없습니다.</li> : null}
          {hasMore ? <li className="px-3 py-1.5 text-center text-xs text-gray-500">{matches.length}명 중 {results.length}명 표시 · 아래로 스크롤하면 더 보입니다</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
