import { GoogleGenAI } from '@google/genai';

import { serverEnv } from '@/lib/reports/env';

let _client: GoogleGenAI | null = null;

/** Gemini SDK 싱글턴 (유튜브 영상 분석용). */
export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: serverEnv.googleApiKey() });
  }
  return _client;
}

/** 유튜브 영상 분석에 사용할 기본 모델 */
export const GEMINI_VIDEO_MODEL = 'gemini-2.5-flash';
