import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Member } from '../../contexts/types';
import { matchMember } from '../../services/domain/search';

export interface HeadOption {
  id: string;
  label: string;
  member: Member;
}

/** 한 번에 보여 주는 최대 개수(성도가 많아도 목록은 이 개수만 그립니다) */
const LIMIT = 20;

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

  const q = query.trim();
  const matches = useMemo(() => (q ? options.filter((o) => matchMember(o.member, q)) : options), [options, q]);
  const results = matches.slice(0, LIMIT);

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
      if (results.length) setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
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
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
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
          {matches.length > LIMIT ? <li className="border-t px-3 py-1.5 text-xs text-gray-500">{matches.length}명 중 {LIMIT}명만 표시합니다. 이름이나 연락처로 좁혀 보세요.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
