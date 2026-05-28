import 'server-only';

export type Role = 'mobility' | 'holdings' | 'admin';

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
    case 'holdings':
      return '홀딩스';
    case 'admin':
      return '관리자';
  }
}
