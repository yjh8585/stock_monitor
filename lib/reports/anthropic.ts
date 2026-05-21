import Anthropic from '@anthropic-ai/sdk';

import { serverEnv } from '@/lib/reports/env';

let _client: Anthropic | null = null;

/** Anthropic SDK 싱글턴 (보고서 분석용). */
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: serverEnv.anthropicApiKey() });
  }
  return _client;
}

/**
 * 보고서 본문 요약/정리에 사용할 기본 모델.
 * 비용 절감을 위해 Haiku 사용 (~1/3 가격).
 * 요약 품질이 부족하면 'claude-sonnet-4-6'로 환원.
 */
export const CLAUDE_SUMMARY_MODEL = 'claude-haiku-4-5';
