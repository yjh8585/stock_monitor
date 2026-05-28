import { SignJWT, jwtVerify } from 'jose';
import type { Role } from './users';

export const SESSION_COOKIE = 'sm_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionPayload = {
  sub: string;
  role: Role;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 환경변수가 설정되어 있지 않거나 너무 짧습니다.');
  }
  return new TextEncoder().encode(secret);
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

export async function decodeSession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const role =
      payload.role === 'mobility' || payload.role === 'holdings' || payload.role === 'admin'
        ? payload.role
        : null;
    if (!sub || !role) return null;
    return { sub, role };
  } catch {
    return null;
  }
}
