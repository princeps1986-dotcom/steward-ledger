import { memo } from 'react';
import type { MemberSearchController } from '../../../hooks/useDonationInput';

export const MemberSearchBox = memo(function MemberSearchBox({ s }: { s: MemberSearchController }) {
  return (
    <div className="relative">
      <span className="label">{s.anonymous ? '무명/방문자 표기명' : '성도 검색 (이름·연락처 뒷자리)'}</span>
      <div className="flex gap-2">
        {s.anonymous ? (
          <input
            ref={(el) => {
              s.searchRef.current = el;
            }}
            id="member-search-input"
            aria-label="무명/방문자 표기명"
            className="input border-amber-400 bg-amber-50"
            value={s.anonName}
            onChange={(e) => s.setAnonName(e.target.value)}
            onKeyDown={s.onSearchKeyDown}
            placeholder="무명1 또는 방문자-홍길동"
          />
        ) : (
          <input
            ref={(el) => {
              s.searchRef.current = el;
            }}
            id="member-search-input"
            aria-label="성도 검색"
            className="input"
            value={s.query}
            onChange={(e) => s.onQueryChange(e.target.value)}
            onKeyDown={s.onSearchKeyDown}
            onBlur={() => setTimeout(s.closeDropdown, 150)}
            placeholder="예: 김철수, 1234"
            role="combobox"
            aria-expanded={s.dropdownOpen}
            aria-controls="member-search-list"
          />
        )}
        <button
          type="button"
          className={s.anonymous ? 'btn-primary whitespace-nowrap' : 'btn whitespace-nowrap'}
          onClick={s.toggleAnonymous}
          aria-pressed={s.anonymous}
        >
          무명/방문자 (F2)
        </button>
      </div>
      {s.selectedLabel ? <p className="mt-1 text-xs text-blue-700">선택됨: {s.selectedLabel}</p> : null}

      {s.dropdownOpen ? (
        <ul id="member-search-list" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {s.results.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === s.highlight}
              className={`cursor-pointer px-3 py-2 text-sm ${i === s.highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => s.setHighlight(i)}
              onClick={() => s.selectMember(m)}
            >
              {s.resultLabels[i]}
            </li>
          ))}
          {s.results.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">검색 결과가 없습니다.</li> : null}
          <li
            role="option"
            aria-selected={s.highlight === s.results.length}
            className={`cursor-pointer border-t px-3 py-2 text-sm font-medium text-blue-700 ${s.highlight === s.results.length ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => s.setHighlight(s.results.length)}
            onClick={s.openQuickRegister}
          >
            + 새 성도 즉시 등록
          </li>
        </ul>
      ) : null}
    </div>
  );
});
