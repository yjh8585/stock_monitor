/**
 * Tool Use 루프 — Anthropic stop_reason='tool_use' 시 도구 실행 후 결과를 다음 메시지에 첨부.
 *
 * 무한 루프 방지: MAX_ITERATIONS = 5. 초과 시 마지막 어시스턴트 텍스트 + 경고 반환.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/reports/anthropic';
import { CHAT_TOOLS, runTool } from './tools';
import { buildSystemPrompt } from './system-prompt';
import type { ChatMessage, ChatResponse, ChatToolCallTrace, UserRole } from './types';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_ITERATIONS = 5;

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function previewResult(result: unknown): string {
  try {
    const json = JSON.stringify(result);
    return json.length > 500 ? json.slice(0, 500) + '…' : json;
  } catch {
    return String(result);
  }
}

export async function runChatLoop(history: ChatMessage[], role: UserRole): Promise<ChatResponse> {
  const client = getAnthropicClient();
  const msgs: Anthropic.Messages.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolCalls: ChatToolCallTrace[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.messages.create({
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

    msgs.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      return { text: extractText(res.content), toolCalls };
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    );

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        try {
          const result = await runTool(tu.name, tu.input, role);
          toolCalls.push({ name: tu.name, input: tu.input, resultPreview: previewResult(result) });
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolCalls.push({ name: tu.name, input: tu.input, resultPreview: `ERROR: ${msg}` });
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify({ error: msg }),
            is_error: true,
          };
        }
      })
    );

    msgs.push({ role: 'user', content: toolResults });
  }

  // MAX_ITERATIONS 초과 — 마지막 assistant 메시지의 텍스트 추출
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const lastText =
    lastAssistant && Array.isArray(lastAssistant.content)
      ? extractText(lastAssistant.content as Anthropic.Messages.ContentBlock[])
      : '';
  return {
    text: lastText || '답변을 생성하지 못했습니다.',
    toolCalls,
    warning: `MAX_ITERATIONS(${MAX_ITERATIONS}) 초과 — 답변이 잘렸을 수 있습니다.`,
  };
}
