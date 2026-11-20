import Anthropic from '@anthropic-ai/sdk';

import logger from '@/lib/logger';
import { serverEnv } from '@/lib/reports/env';

let _client: Anthropic | null = null;

/** Anthropic SDK 싱글턴 (보고서 분석용). */
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: serverEnv.anthropicApiKey() });
  }
  return _client;
}

/** Models API 조회가 실패했을 때 쓰는 하이쿠(지금 알려진 최신). */
export const HAIKU_FALLBACK = 'claude-haiku-5-5';

let _latestHaiku: Promise<string> | null = null;

/**
 * 가장 최근 하이쿠 모델 ID(사용자 지시 2026-11-20 — 「최신 하이쿠를 알아서」).
 * `GET /v1/models` 에서 `claude-haiku-` 로 시작하는 것 중 `created_at` 이 가장 늦은 것.
 * 인스턴스당 한 번 조회하고, 실패하면 폴백을 쓰되 캐시하지 않아 다음 호출에서 다시 묻는다.
 * 파이썬 쪽 같은 규칙 = `scripts/lib/anthropic_models.py`.
 */
export function latestHaikuModel(): Promise<string> {
  if (!_latestHaiku) {
    _latestHaiku = (async () => {
      let best: { id: string; at: number } | null = null;
      // 10초·재시도 1회 — SDK 기본(10분 × 3회)이면 크론 한도(290초)를 통째로 잡아먹는다
      const pages = getAnthropicClient().models.list(
        { limit: 1000 },
        { timeout: 10_000, maxRetries: 1 }
      );
      for await (const m of pages) {
        const at = Date.parse(m.created_at);
        if (m.id.startsWith('claude-haiku-') && (!best || at > best.at)) {
          best = { id: m.id, at };
        }
      }
      if (!best) throw new Error('모델 목록에 claude-haiku-* 없음');
      return best.id;
    })().catch((err) => {
      _latestHaiku = null;
      logger.warn({ err }, `최신 하이쿠 조회 실패 — ${HAIKU_FALLBACK} 사용`);
      return HAIKU_FALLBACK;
    });
  }
  return _latestHaiku;
}

/**
 * 보고서 본문 요약/정리에 사용할 기본 모델.
 * 비용 절감을 위해 Haiku 사용 (~1/3 가격).
 * 요약 품질이 부족하면 'claude-sonnet-4-6'로 환원.
 */
export const CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5';
