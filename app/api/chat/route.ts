/**
 * 챗봇 POST 엔드포인트.
 *
 * - 세션 인증 (proxy.ts가 PUBLIC_PATH_PREFIXES 외 자동 강제하지만 명시적으로 한 번 더 확인)
 * - Zod 입력 검증 (messages 배열)
 * - per-IP in-memory rate limit (분당 20회)
 * - runChatLoop 호출 → { ok, text, toolCalls, warning? } 응답
 *
 * 응답 형식: { ok: true, text, toolCalls, warning? } / { ok: false, error, detail? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { runChatLoop } from '@/lib/chat/loop';
import type { ChatMessage } from '@/lib/chat/types';

export const maxDuration = 60;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_HITS = 20;
const rateBuckets = new Map<string, { hits: number; resetAt: number }>();

function checkRateLimit(key: string): { ok: boolean; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { hits: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, resetAt: now + RATE_WINDOW_MS };
  }
  bucket.hits += 1;
  if (bucket.hits > RATE_MAX_HITS) return { ok: false, resetAt: bucket.resetAt };
  return { ok: true, resetAt: bucket.resetAt };
}

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string().min(1).max(4000),
    z.array(z.unknown()), // assistant 메시지의 ContentBlock 배열 (이전 턴 그대로 전달)
  ]),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  // 1) 세션 인증
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2) rate limit (사용자 id 기준 — 다중 탭에서도 합산)
  const rl = checkRateLimit(`u:${user.id}`);
  if (!rl.ok) {
    logger.warn({ uid: user.id, resetAt: rl.resetAt }, '/api/chat rate limit hit');
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  // 3) 입력 검증
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_params', detail: parsed.error.issues },
      { status: 400 }
    );
  }

  // 4) tool_use 루프 실행
  try {
    const response = await runChatLoop(parsed.data.messages as ChatMessage[], user.role);
    return NextResponse.json({
      ok: true,
      text: response.text,
      toolCalls: response.toolCalls,
      warning: response.warning,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, uid: user.id }, '/api/chat 실행 실패');
    return NextResponse.json({ ok: false, error: 'llm_unavailable', detail: msg }, { status: 503 });
  }
}
