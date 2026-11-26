import { useState, type FormEvent } from 'react';
import { useAdminPage } from '../../../hooks/useAdminPage';
import { ROLES, ROLE_LABEL, type Role } from '../../../services/auth/roles';
import { formatDateTime } from '../../../services/domain/dates';
import { ConfirmFooter } from '../../shared/ConfirmFooter';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';
import { PeriodDeleteSection } from '../settings/PeriodDeleteSection';

/** 관리자 전용 탭(PC앱): 계정·역할 관리와 로그인·변경 기록. */
export function AdminPage() {
  const a = useAdminPage();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('finance');
  const [myNewRole, setMyNewRole] = useState<Role | null>(null); // 본인 역할을 낮추기 전 확인(바꾸면 [관리자] 탭이 바로 사라짐)

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.add(email, role)) setEmail('');
  };
  const status = (u: (typeof a.users)[number]) => (u.disabled ? '사용 중지' : u.registered ? '사용 중' : '로그인 전(등록만 됨)');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">계정·역할</h2>
        <p className="text-sm text-gray-600">
          이 앱은 여기에 등록한 구글 계정만 쓸 수 있습니다. 새 사람은 이메일을 먼저 등록하면 처음 로그인할 때 연결됩니다. 계정은 최대 10명, 관리자는 1~2명이며 마지막 관리자는 내리거나 중지할 수 없습니다.
          백업 복원·전체 초기화는 [설정 정보]에서, 기간 헌금 삭제는 이 탭 아래에서 관리자만 할 수 있습니다.
        </p>
        <Notice message={a.error ? { kind: 'error', text: a.error } : null} />
        {a.rebuiltAt ? (
          <div role="alert" className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p>
              {formatDateTime(a.rebuiltAt)}에 계정 목록이 새로 만들어졌습니다. 그 전부터 이 PC에는 헌금 데이터가 있었습니다. 관리자가 계정 목록을 복구한 것이 아니라면, 누군가
              계정 목록 파일(users.json)을 바꿔 관리자가 되었을 수 있습니다. 아래 기록과 [보고서]의 수정·삭제 이력에서 그 뒤의 작업을 확인하세요.
            </p>
            <button type="button" className="btn" disabled={a.busy} onClick={() => void a.ackRebuilt()}>
              확인했습니다
            </button>
          </div>
        ) : null}
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">이메일</th>
              <th className="th">역할</th>
              <th className="th">상태</th>
              <th className="th">등록일</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {a.users.map((u) => (
              <tr key={u.email}>
                <td className="td">
                  {u.email}
                  {u.email === a.me ? <span className="ml-1 text-xs text-gray-500">(나)</span> : null}
                </td>
                <td className="td">
                  <select className="input" aria-label={`${u.email} 역할`} value={u.role} disabled={a.busy} onChange={(e) => {
                      const next = e.target.value as Role;
                      if (u.email === a.me && next !== 'admin') setMyNewRole(next);
                      else void a.setRole(u.email, next);
                    }}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`td ${u.disabled ? 'text-red-600' : ''}`}>{status(u)}</td>
                <td className="td whitespace-nowrap">{formatDateTime(u.addedAt)}</td>
                <td className="td text-right">
                  {u.email !== a.me ? (
                    <button type="button" className={u.disabled ? 'btn' : 'btn-danger-outline'} disabled={a.busy} onClick={() => void a.setDisabled(u.email, !u.disabled)}>
                      {u.disabled ? '다시 사용' : '사용 중지'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <label className="text-sm">
            등록할 이메일
            <input type="email" className="input mt-1 block w-72" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
          </label>
          <label className="text-sm">
            역할
            <select className="input mt-1 block" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary" disabled={a.busy || !email.trim()}>
            등록
          </button>
        </form>
      </section>

      <Modal
        open={myNewRole !== null}
        onClose={() => setMyNewRole(null)}
        title="내 역할을 바꿀까요?"
        footer={
          <ConfirmFooter
            onCancel={() => setMyNewRole(null)}
            onConfirm={async () => {
              if (myNewRole && a.me) await a.setRole(a.me, myNewRole);
              setMyNewRole(null);
            }}
            confirmLabel="바꾸기"
            tone="danger"
            busy={a.busy}
          />
        }
      >
        <p className="text-sm leading-relaxed text-gray-700">
          내 역할을 {myNewRole ? ROLE_LABEL[myNewRole] : ''}(으)로 바꾸면 바로 관리자 권한이 없어져 이 탭이 사라집니다. 다시 관리자가 되려면 다른 관리자가 바꿔 주어야 합니다.
        </p>
      </Modal>

      <PeriodDeleteSection />

      <section className="card space-y-2">
        <h2 className="text-base font-semibold">로그인·변경 기록</h2>
        <p className="text-xs text-gray-500">최근 100건입니다. 헌금을 고치고 지운 이력은 [보고서]의 수정·삭제 이력에 있습니다.</p>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">일시</th>
              <th className="th">사람</th>
              <th className="th">내용</th>
            </tr>
          </thead>
          <tbody>
            {a.log.map((l, i) => (
              <tr key={`${l.at}-${i}`}>
                <td className="td whitespace-nowrap">{formatDateTime(l.at)}</td>
                <td className="td">{l.who}</td>
                <td className="td">{l.text}</td>
              </tr>
            ))}
            {a.log.length === 0 ? (
              <tr>
                <td className="td text-center text-gray-500" colSpan={3}>
                  기록이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
