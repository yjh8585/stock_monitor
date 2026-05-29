'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, encodeSession } from './session';
import { findUserByCredentials } from './users';

export type LoginState = {
  error?: string;
};

function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const id = String(formData.get('id') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = sanitizeNext(formData.get('next'));

  if (!id || !password) {
    return { error: '아이디와 비밀번호를 입력해 주세요.' };
  }

  const user = findUserByCredentials(id, password);
  if (!user) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  const token = await encodeSession({ sub: user.id, role: user.role });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
