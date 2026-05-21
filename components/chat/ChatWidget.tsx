'use client';

/**
 * 모든 페이지 우하단 floating 챗봇 (SSE 스트리밍).
 * - useState로 메시지 보존 (세션 메모리, DB 저장 X)
 * - AppLayout 루트에 마운트되므로 페이지 이동 시 유지, 새로고침/탭 닫기 시 소실
 * - /api/chat의 text/event-stream을 fetch().body.getReader()로 점진 파싱 → 답변이 실시간으로 흘러나옴
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
import type { ChatMessage, ChatStreamEvent } from '@/lib/chat/types';

const TOOL_LABEL_KR: Record<string, string> = {
  query_companies: '회사 검색',
  query_financials: '재무 조회',
  query_stock_prices: '주가 조회',
  query_news: '뉴스 검색',
  query_oem_sales: 'OEM 판매 조회',
  query_macro_series: '매크로 시계열 조회',
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  /** API에 보낼 형식 (assistant content는 ContentBlock 배열도 가능) */
  const [history, setHistory] = useState<ChatMessage[]>([]);
  /** UI 표시용 */
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  /** 현재 진행 중인 도구 호출 라벨 (UI 로딩 상태) */
  const [activeStatus, setActiveStatus] = useState<string | null>(null);

  function appendDisplay(msg: DisplayMessage) {
    setDisplay((prev) => [...prev, msg]);
  }

  function updateLastAssistant(updater: (prev: DisplayMessage) => DisplayMessage) {
    setDisplay((prev) => {
      const idx = prev.length - 1;
      if (idx < 0 || prev[idx].role !== 'assistant') return prev;
      const next = [...prev];
      next[idx] = updater(next[idx]);
      return next;
    });
  }

  async function sendMessage(text: string) {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    appendDisplay({ role: 'user', text });
    // 어시스턴트 자리 미리 만들어두기 → 텍스트 청크 누적
    appendDisplay({ role: 'assistant', text: '' });
    setLoading(true);
    setActiveStatus('답변 준비 중…');

    let assistantText = '';
    const toolCalls: DisplayMessage['toolCalls'] = [];
    let warning: string | undefined;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory }),
      });

      // 비정상 응답 (text/event-stream 아닌 JSON 에러)
      if (!res.ok) {
        let errBody: { error?: string; detail?: unknown } = {};
        try {
          errBody = await res.json();
        } catch {
          /* ignore */
        }
        const errText =
          errBody.error === 'rate_limited'
            ? '요청이 너무 많습니다. 1분 후 다시 시도해 주세요.'
            : errBody.error === 'unauthorized'
              ? '로그인 후 이용해 주세요.'
              : `오류: ${errBody.error ?? `HTTP ${res.status}`}`;
        updateLastAssistant((p) => ({ ...p, text: errText }));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        updateLastAssistant((p) => ({ ...p, text: '오류: 스트림 응답 없음' }));
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as ChatStreamEvent;
          } catch {
            continue;
          }
          if (event.type === 'text_delta') {
            assistantText += event.delta;
            updateLastAssistant((p) => ({ ...p, text: assistantText }));
            // 텍스트가 나오기 시작하면 도구 상태 표시 제거
            setActiveStatus(null);
          } else if (event.type === 'tool_start') {
            const label = TOOL_LABEL_KR[event.name] ?? event.name;
            setActiveStatus(`${label} 중…`);
            toolCalls.push({
              name: event.name,
              input: event.input,
              resultPreview: '',
            });
          } else if (event.type === 'tool_done') {
            // 진행률만 갱신 (필요시)
          } else if (event.type === 'done') {
            warning = event.warning;
            // event.toolCalls가 정식 결과 — 누적된 toolCalls를 교체
            updateLastAssistant((p) => ({
              ...p,
              toolCalls: event.toolCalls,
              warning,
            }));
          } else if (event.type === 'error') {
            updateLastAssistant((p) => ({
              ...p,
              text: `오류: ${event.message}`,
            }));
          }
        }
      }

      // history는 텍스트만 누적 (도구 결과는 다음 turn에 안 보냄 — Claude가 새 컨텍스트로 처리)
      const assistantMsg: ChatMessage = { role: 'assistant', content: assistantText };
      setHistory((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '네트워크 오류';
      updateLastAssistant((p) => ({ ...p, text: `오류: ${msg}` }));
    } finally {
      setLoading(false);
      setActiveStatus(null);
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
        <ChatMessages messages={display} loading={loading} statusLabel={activeStatus} />
        <ChatInput onSubmit={sendMessage} disabled={loading} />
      </SheetContent>
    </Sheet>
  );
}
