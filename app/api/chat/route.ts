/**
 * 챗봇 POST 엔드포인트 — Server-Sent Events (SSE) 스트리밍.
 *
 * 응답 형식: `text/event-stream`로 각 이벤트를 `data: <JSON>\n\n` 줄 단위 전송.
 * 클라이언트는 fetch().body.getReader()로 점진 파싱.
 *
 * - 세션 인증
 * - Zod 입력 검증 (messages 배열)
 * - per-user in-memory rate limit (분당 20회)
 * - streamChatLoop AsyncGenerator → SSE
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { streamChatLoop } from '@/lib/chat/loop';
import type { ChatMessage, ChatStreamEvent } from '@/lib/chat/types';

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
  content: z.union([z.string().min(1).max(4000), z.array(z.unknown())]),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
});

function sseLine(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function jsonError(status: number, code: string, detail?: unknown): Response {
  return new Response(JSON.stringify({ ok: false, error: code, detail }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  // 1) 세션 인증
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');

  // 2) rate limit
  const rl = checkRateLimit(`u:${user.id}`);
  if (!rl.ok) {
    logger.warn({ uid: user.id, resetAt: rl.resetAt }, '/api/chat rate limit hit');
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
      },
    });
  }

  // 3) 입력 검증
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues);
  }

  // 4) SSE 스트림 생성
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamChatLoop(
          parsed.data.messages as ChatMessage[],
          user.role,
          user.id
        )) {
          controller.enqueue(encoder.encode(sseLine(event)));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, uid: user.id }, '/api/chat 스트림 실패');
        controller.enqueue(encoder.encode(sseLine({ type: 'error', message: msg })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
