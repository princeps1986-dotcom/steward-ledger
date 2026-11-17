import type { MemberFormController } from '../../hooks/useMemberForm';

/** 성도 등록/수정 입력 필드 (성도 화면·빠른 등록 공용) */
export function MemberFormFields({ draft, setField, headOptions, positionOptions, error }: MemberFormController) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2">
        <span className="label">
          이름 <span className="font-semibold text-red-600">* 필수</span>
        </span>
        <input className="input" value={draft.name} onChange={(e) => setField('name')(e.target.value)} autoFocus />
      </label>
      <label>
        <span className="label">직분</span>
        <select className="input" value={draft.position} onChange={(e) => setField('position')(e.target.value)}>
          <option value="">(없음)</option>
          {positionOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">연락처 뒷 4자리</span>
        <input className="input" inputMode="numeric" value={draft.phoneLast4} onChange={(e) => setField('phoneLast4')(e.target.value)} />
      </label>
      <p className="col-span-2 -mt-1 text-xs text-gray-500">직분과 연락처 뒷 4자리는 이름이 같은 성도를 구분하기 위한 용도입니다.</p>
      <label className="col-span-2 text-sm">
        <span className="flex items-center gap-2">
          <input type="checkbox" checked={draft.isFamilyHead} onChange={(e) => setField('isFamilyHead')(e.target.checked)} />
          세대주로 지정
        </span>
        <span className="mt-0.5 block text-xs text-gray-500">(기존 세대의 구성원을 지정하면 세대주가 변경되고 세대는 유지됩니다)</span>
      </label>
      <label className="col-span-2">
        <span className="label">소속 세대주 연결</span>
        <select
          className="input"
          value={draft.headMemberId}
          disabled={draft.isFamilyHead}
          onChange={(e) => setField('headMemberId')(e.target.value)}
        >
          <option value="">연결 안 함</option>
          {headOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
