// 지금 사용자의 역할로 작업이 허용되는지 판단합니다(표는 roles.ts). 로그인이 없는 브라우저(시연) 모드는 제한 없이 관리자와 같습니다.
// 역할은 로그인 때 정해져 앱이 열려 있는 동안 바뀌지 않으므로 화면은 그때그때 읽어 씁니다(로그아웃·잠금은 6단계).
// 역할 제한은 앱 안의 규칙입니다: 데이터는 이 PC의 저장소에 있으므로 화면·쓰기 길목에서 막을 뿐, 파일을 직접 여는 사람은 막지 못합니다.
import { desktop } from '../desktopBridge';
import { currentUser } from './currentUser';
import { can, type Action, type Role } from './roles';

export const NOT_ALLOWED = '이 작업을 할 권한이 없습니다.';

// window가 없는 환경(Node 시험)도 브라우저 모드와 같이 로그인 없음으로 봅니다.
const isDesktop = (): boolean => typeof window !== 'undefined' && !!desktop();

export const currentRole = (): Role | null => (isDesktop() ? (currentUser()?.role ?? null) : 'admin');

export const allowed = (action: Action): boolean => can(currentRole(), action);

export const isNotAllowed = (e: unknown): boolean => e instanceof Error && e.message === NOT_ALLOWED;

/** 허용되지 않으면 오류를 던집니다(쓰기·복원·초기화 같은 길목에서 화면을 우회한 호출도 막음). */
export function assertAllowed(action: Action): void {
  if (!allowed(action)) throw new Error(NOT_ALLOWED);
}
