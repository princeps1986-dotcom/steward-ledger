import { useState, type FormEvent } from 'react';
import { useSession } from '../../hooks/useSession';
import { ROLE_LABEL } from '../../services/auth/roles';
import { Modal } from '../shared/Modal';
import { Notice } from '../shared/Notice';

/** 머리글 오른쪽: 로그인한 사람, PIN 설정, 잠금, 로그아웃. 로그인이 없는 브라우저(시연) 모드에서는 나오지 않습니다. */
export function SessionBar() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!s) return null;

  const close = () => {
    setOpen(false);
    setPin('');
    setAgain('');
    setError(null);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (pin !== again) return setError('두 번 입력한 PIN이 다릅니다.');
    const err = await s.setPin(pin);
    if (err) setError(err);
    else close();
  };
  const digits = (v: string) => v.replace(/\D/g, '');
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-slate-300">
      <span>
        {s.email} · {ROLE_LABEL[s.role]}
      </span>
      <button type="button" className="hover:text-white" onClick={() => setOpen(true)}>
        {s.hasPin ? 'PIN 바꾸기' : 'PIN 만들기'}
      </button>
      <button type="button" className="hover:text-white" onClick={s.lock}>
        지금 잠그기
      </button>
      <button type="button" className="hover:text-white" onClick={s.logout}>
        로그아웃
      </button>
      <Modal
        open={open}
        onClose={close}
        title={s.hasPin ? 'PIN 바꾸기' : 'PIN 만들기'}
        description="한동안 쓰지 않아 화면이 잠겼을 때 풀 숫자 6자리입니다. PIN이 없으면 구글로 다시 로그인해야 합니다. 5번 틀리면 로그아웃됩니다."
        widthClass="max-w-sm"
      >
        <form onSubmit={(e) => void save(e)} className="space-y-3 text-sm text-gray-800">
          <Notice message={error ? { kind: 'error', text: error } : null} />
          <label className="block">
            새 PIN
            <input type="password" inputMode="numeric" maxLength={6} autoFocus className="input mt-1 w-full" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
          </label>
          <label className="block">
            새 PIN 확인
            <input type="password" inputMode="numeric" maxLength={6} className="input mt-1 w-full" value={again} onChange={(e) => setAgain(digits(e.target.value))} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={pin.length !== 6}>
              저장
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
