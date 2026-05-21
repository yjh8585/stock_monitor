'use client';

/**
 * 모든 페이지 우하단 floating 챗봇.
 * - useState로 메시지 보존 (세션 메모리, DB 저장 X)
 * - AppLayout 루트에 마운트되므로 페이지 이동 시 유지, 새로고침/탭 닫기 시 소실
 */
import { useState } from 'react';
import { MessageCircle, X, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import ChatMessages, { type DisplayMessage } from './ChatMessages';
import ChatInput from './ChatInput';
import type { ChatMessage } from '@/lib/chat/types';

interface ChatResponseBody {
  ok: boolean;
  text?: string;
  toolCalls?: { name: string; input: unknown; resultPreview: string }[];
  warning?: string;
  error?: string;
  detail?: string | unknown;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  /** API에 보낼 형식 (assistant content는 ContentBlock 배열도 가능) */
  const [history, setHistory] = useState<ChatMessage[]>([]);
  /** UI 표시용 (text만 추출) */
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function sendMessage(text: string) {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setDisplay((prev) => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory }),
      });
      const body: ChatResponseBody = await res.json();
      if (!res.ok || !body.ok) {
        const errText =
          body.error === 'rate_limited'
            ? '요청이 너무 많습니다. 1분 후 다시 시도해 주세요.'
            : body.error === 'llm_unavailable'
              ? `LLM 응답 실패: ${typeof body.detail === 'string' ? body.detail : '잠시 후 다시 시도해 주세요.'}`
              : body.error === 'unauthorized'
                ? '로그인 후 이용해 주세요.'
                : `오류: ${body.error ?? '알 수 없음'}`;
        setDisplay((prev) => [...prev, { role: 'assistant', text: errText }]);
        return;
      }
      const assistantText = body.text ?? '';
      const assistantMsg: ChatMessage = { role: 'assistant', content: assistantText };
      setHistory((prev) => [...prev, assistantMsg]);
      setDisplay((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: assistantText,
          toolCalls: body.toolCalls,
          warning: body.warning,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '네트워크 오류';
      setDisplay((prev) => [...prev, { role: 'assistant', text: `오류: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setHistory([]);
    setDisplay([]);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            aria-label="AI 어시스턴트 열기"
            className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          >
            <MessageCircle size={22} />
          </button>
        }
      />
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col p-0 sm:max-w-md"
      >
        <SheetTitle className="sr-only">AI 어시스턴트</SheetTitle>
        <SheetDescription className="sr-only">
          한세모빌리티 BI 데이터에 대한 질문에 답변합니다.
        </SheetDescription>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">AI 어시스턴트</h2>
            <p className="text-[11px] text-muted-foreground">세션 메모리만 · 새로고침 시 초기화</p>
          </div>
          <div className="flex items-center gap-1">
            {display.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                aria-label="대화 초기화"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <ChatMessages messages={display} loading={loading} />
        <ChatInput onSubmit={sendMessage} disabled={loading} />
      </SheetContent>
    </Sheet>
  );
}
