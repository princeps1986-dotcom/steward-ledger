import { createContext, useContext } from 'react';
import type { Role } from '../services/auth/roles';

/** 로그인한 사람과 잠금·로그아웃·PIN 동작(AuthGate가 제공). 브라우저(시연) 모드는 로그인이 없어 null. */
export interface Session {
  email: string;
  role: Role;
  hasPin: boolean;
  lock(): void;
  logout(): void;
  /** 오류 문구(성공이면 null) */
  setPin(pin: string): Promise<string | null>;
}

export const SessionContext = createContext<Session | null>(null);
export const useSession = (): Session | null => useContext(SessionContext);
