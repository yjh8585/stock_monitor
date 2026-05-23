/**
 * Tool Use 루프 + Streaming.
 *
 * Anthropic messages.stream으로 텍스트 청크를 받으면서 stop_reason='tool_use' 시
 * 도구 실행 → 다음 iteration. AsyncGenerator로 이벤트를 점진 yield하여 UI 실시간 갱신.
 *
 * 무한 루프 방지: MAX_ITERATIONS = 5.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/reports/anthropic';
import { CHAT_TOOLS, runTool } from './tools';
import { buildSystemPrompt } from './system-prompt';
import { logToolCall, extractRowCount } from './audit';
import type { ChatMessage, ChatStreamEvent, ChatToolCallTrace, UserRole } from './types';

// 비용 절감을 위해 Haiku 사용 (~1/3 가격). 답변 품질이 부족하면 'claude-sonnet-4-6'로 환원.
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 2048;
const MAX_ITERATIONS = 5;

function previewResult(result: unknown): string {
  try {
    const json = JSON.stringify(result);
    return json.length > 500 ? json.slice(0, 500) + '…' : json;
  } catch {
    return String(result);
  }
}

/**
 * 스트리밍 챗봇 루프.
 *
 * yield 이벤트 순서 예시:
 *   text_delta (이전 turn에 텍스트가 있으면)
 *   tool_start → tool_start → tool_done → tool_done
 *   text_delta (...최종 답변 청크들)
 *   done
 */
export async function* streamChatLoop(
  history: ChatMessage[],
  role: UserRole,
  userId: string
): AsyncGenerator<ChatStreamEvent, void, void> {
  const client = getAnthropicClient();
  const msgs: Anthropic.Messages.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolCalls: ChatToolCallTrace[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(role),
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: CHAT_TOOLS,
      messages: msgs,
    });

    // 스트림 이벤트 순회 — text_delta만 즉시 yield, 도구 정보는 finalMessage에서 정리
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', delta: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    msgs.push({ role: 'assistant', content: finalMessage.content });

    if (finalMessage.stop_reason !== 'tool_use') {
      yield { type: 'done', toolCalls };
      return;
    }

    const toolUses = finalMessage.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    );

    // 도구 호출 시작 알림
    for (const tu of toolUses) {
      yield { type: 'tool_start', name: tu.name, input: tu.input };
    }

    // 병렬 실행
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        try {
          const result = await runTool(tu.name, tu.input, role);
          toolCalls.push({
            name: tu.name,
            input: tu.input,
            resultPreview: previewResult(result),
          });
          // 감사 로그 (fire-and-forget)
          logToolCall({
            userId,
            userRole: role,
            toolName: tu.name,
            input: tu.input,
            rowCount: extractRowCount(result),
            isError: false,
          });
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolCalls.push({
            name: tu.name,
            input: tu.input,
            resultPreview: `ERROR: ${msg}`,
          });
          logToolCall({
            userId,
            userRole: role,
            toolName: tu.name,
            input: tu.input,
            rowCount: null,
            isError: true,
            errorMsg: msg,
          });
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify({ error: msg }),
            is_error: true,
          };
        }
      })
    );

    // 도구 완료 알림
    for (const tu of toolUses) {
      yield { type: 'tool_done', name: tu.name };
    }

    msgs.push({ role: 'user', content: toolResults });
  }

  // MAX_ITERATIONS 초과
  yield {
    type: 'done',
    toolCalls,
    warning: `MAX_ITERATIONS(${MAX_ITERATIONS}) 초과 — 답변이 잘렸을 수 있습니다.`,
  };
}
