import type { MemberFormController } from '../../hooks/useMemberForm';
import { DatePicker } from './DatePicker';
import { MemberPicker } from './MemberPicker';

/** 성도 등록/수정 입력 필드 (성도 화면·빠른 등록 공용) */
export function MemberFormFields({ draft, setField, headOptions, positionOptions, error, isEditing }: MemberFormController) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={isEditing ? '' : 'col-span-2'}>
        <span className="label">
          이름 <span className="font-semibold text-red-600">* 필수</span>
        </span>
        <input className="input" value={draft.name} onChange={(e) => setField('name')(e.target.value)} autoFocus />
      </label>
      {/* 새 등록은 오늘 날짜가 자동으로 들어가므로 수정할 때만 보여 줍니다. */}
      {isEditing ? (
        <div>
          <span className="label">등록일</span>
          <DatePicker value={draft.registeredAt} onChange={setField('registeredAt')} ariaLabel="등록일" />
        </div>
      ) : null}
      <label>
        <span className="label">직분</span>
        <select className="input" value={draft.position} onChange={(e) => setField('position')(e.target.value)}>
          <option value="">미선택</option>
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
      <div>
        <span className="label">대표자 여부</span>
        <label className="input flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={draft.isFamilyHead} onChange={(e) => setField('isFamilyHead')(e.target.checked)} />
          대표자로 지정
        </label>
      </div>
      <div>
        <span className={`label ${draft.isFamilyHead ? 'text-gray-400' : ''}`}>소속 대표자 연결</span>
        <MemberPicker
          options={headOptions}
          value={draft.headMemberId}
          onChange={setField('headMemberId')}
          disabled={draft.isFamilyHead}
          disabledText="대표자는 연결하지 않습니다"
          ariaLabel="소속 대표자 연결"
        />
      </div>
      <p className="col-span-2 -mt-1 text-xs text-gray-500">기존 묶음의 구성원을 지정하면 대표자가 변경되고 묶음은 유지됩니다</p>
      {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
