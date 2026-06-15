import 'server-only';
import type { Role } from './roles';

export type { Role };

export type AuthUser = {
  id: string;
  password: string;
  role: Role;
  displayName: string;
};

let cachedUsers: AuthUser[] | null = null;

export function getUsersFromEnv(): AuthUser[] {
  if (cachedUsers) return cachedUsers;

  const mobilityId = process.env.MOBILITY_ID;
  const mobilityPw = process.env.MOBILITY_PW;
  const holdingId = process.env.HOLDING_ID;
  const holdingPw = process.env.HOLDING_PW;
  const adminId = process.env.ADMIN_ID;
  const adminPw = process.env.ADMIN_PW;

  const missing: string[] = [];
  if (!mobilityId) missing.push('MOBILITY_ID');
  if (!mobilityPw) missing.push('MOBILITY_PW');
  if (!holdingId) missing.push('HOLDING_ID');
  if (!holdingPw) missing.push('HOLDING_PW');
  if (!adminId) missing.push('ADMIN_ID');
  if (!adminPw) missing.push('ADMIN_PW');

  if (missing.length > 0) {
    throw new Error(`회원 자격증명 환경변수 누락: ${missing.join(', ')}`);
  }

  cachedUsers = [
    {
      id: mobilityId!,
      password: mobilityPw!,
      role: 'mobility',
      displayName: '한세모빌리티',
    },
    {
      id: holdingId!,
      password: holdingPw!,
      role: 'holdings',
      displayName: '홀딩스',
    },
    {
      id: adminId!,
      password: adminPw!,
      role: 'admin',
      displayName: '관리자',
    },
  ];

  // 신규 계정(hmobility·guest)은 선택적: 환경변수가 둘 다 있을 때만 추가한다.
  // 프로덕션(Vercel)에 해당 env가 아직 없어도 기존 3계정 로그인은 깨지지 않는다.
  const hmobilityId = process.env.HMOBILITY_ID;
  const hmobilityPw = process.env.HMOBILITY_PW;
  if (hmobilityId && hmobilityPw) {
    cachedUsers.push({
      id: hmobilityId,
      password: hmobilityPw,
      role: 'hmobility',
      displayName: '한세모빌리티(현장)',
    });
  }

  const guestId = process.env.GUEST_ID;
  const guestPw = process.env.GUEST_PW;
  if (guestId && guestPw) {
    cachedUsers.push({
      id: guestId,
      password: guestPw,
      role: 'guest',
      displayName: '게스트',
    });
  }

  return cachedUsers;
}

export function findUserByCredentials(id: string, password: string): AuthUser | null {
  const users = getUsersFromEnv();
  return users.find((u) => u.id === id && u.password === password) ?? null;
}

export function getDisplayNameByRole(role: Role): string {
  switch (role) {
    case 'mobility':
      return '한세모빌리티';
    case 'hmobility':
      return '한세모빌리티(현장)';
    case 'guest':
      return '게스트';
    case 'holdings':
      return '홀딩스';
    case 'admin':
      return '관리자';
  }
}
