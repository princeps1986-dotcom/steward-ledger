// 지금 로그인한 사람(PC앱). 이력의 '고친 사람'(AuditLog.actor)을 적을 때 읽고, 로그인 화면(AuthGate)이 로그인·준비가 끝나면 넣습니다.
// 브라우저(시연) 모드는 로그인이 없어 계속 null입니다.
import type { Role } from './roles';

export interface CurrentUser {
  email: string;
  role: Role;
}

let user: CurrentUser | null = null;

export const setCurrentUser = (u: CurrentUser | null): void => {
  user = u;
};
export const currentUser = (): CurrentUser | null => user;
