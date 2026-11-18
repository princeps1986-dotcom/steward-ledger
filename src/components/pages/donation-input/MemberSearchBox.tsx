import type { DonationInputController } from '../../../hooks/useDonationInput';

export function MemberSearchBox({ c }: { c: DonationInputController }) {
  return (
    <div className="relative">
      <span className="label">{c.anonymous ? '무명/방문자 표기명' : '성도 검색 (이름·연락처 뒷자리)'}</span>
      <div className="flex gap-2">
        {c.anonymous ? (
          <input
            ref={(el) => {
              c.searchRef.current = el;
            }}
            id="member-search-input"
            aria-label="무명/방문자 표기명"
            className="input border-amber-400 bg-amber-50"
            value={c.anonName}
            onChange={(e) => c.setAnonName(e.target.value)}
            onKeyDown={c.onSearchKeyDown}
            placeholder="무명1 또는 방문자-홍길동"
          />
        ) : (
          <input
            ref={(el) => {
              c.searchRef.current = el;
            }}
            id="member-search-input"
            aria-label="성도 검색"
            className="input"
            value={c.query}
            onChange={(e) => c.onQueryChange(e.target.value)}
            onKeyDown={c.onSearchKeyDown}
            onBlur={() => setTimeout(c.closeDropdown, 150)}
            placeholder="예: 김철수, 1234"
            role="combobox"
            aria-expanded={c.dropdownOpen}
            aria-controls="member-search-list"
          />
        )}
        <button
          type="button"
          className={c.anonymous ? 'btn-primary whitespace-nowrap' : 'btn whitespace-nowrap'}
          onClick={c.toggleAnonymous}
          aria-pressed={c.anonymous}
        >
          무명/방문자 (F2)
        </button>
      </div>
      {c.selectedLabel ? <p className="mt-1 text-xs text-blue-700">선택됨: {c.selectedLabel}</p> : null}

      {c.dropdownOpen ? (
        <ul id="member-search-list" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {c.results.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === c.highlight}
              className={`cursor-pointer px-3 py-2 text-sm ${i === c.highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => c.setHighlight(i)}
              onClick={() => c.selectMember(m)}
            >
              {c.resultLabels[i]}
            </li>
          ))}
          {c.results.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">검색 결과가 없습니다.</li> : null}
          <li
            role="option"
            aria-selected={c.highlight === c.results.length}
            className={`cursor-pointer border-t px-3 py-2 text-sm font-medium text-blue-700 ${c.highlight === c.results.length ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => c.setHighlight(c.results.length)}
            onClick={c.openQuickRegister}
          >
            + 새 성도 즉시 등록
          </li>
        </ul>
      ) : null}
    </div>
  );
}
