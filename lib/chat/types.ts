/**
 * 챗봇 메시지/도구 호출 타입.
 * Anthropic SDK의 ContentBlockParam을 그대로 활용해 tool_use·tool_result도 표현 가능.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ChatMessageRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | Anthropic.Messages.ContentBlockParam[];
}

export type UserRole = 'admin' | 'editor' | 'viewer' | 'mobility' | string;

export interface ChatToolCallTrace {
  name: string;
  input: unknown;
  /** JSON.stringify된 도구 결과 또는 에러 메시지 */
  resultPreview: string;
}

export interface ChatResponse {
  /** 어시스턴트의 최종 자연어 답변 */
  text: string;
  /** 호출된 도구 추적 (UI에서 디버깅용으로 펼쳐 볼 수 있도록) */
  toolCalls: ChatToolCallTrace[];
  /** MAX_ITERATIONS 도달 등 비정상 종료 시 표시 */
  warning?: string;
}
