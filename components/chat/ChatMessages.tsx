'use client';

import { useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';

export interface DisplayMessage {
  role: 'user' | 'assistant';
  /** 표시용 텍스트 (사용자 입력 그대로 또는 어시스턴트 최종 답변) */
  text: string;
  /** 어시스턴트 응답에 동반된 도구 호출 추적 (디버깅용 접기/펼치기) */
  toolCalls?: { name: string; input: unknown; resultPreview: string }[];
  warning?: string;
}

interface Props {
  messages: DisplayMessage[];
  loading: boolean;
}

export default function ChatMessages({ messages, loading }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">한세모빌리티 BI 어시스턴트</p>
          <p className="mt-2 text-xs leading-relaxed">
            회사·재무·주가·뉴스·OEM 판매·매크로 데이터에 대해 질문해 보세요.
          </p>
          <ul className="mt-3 inline-block text-left text-xs text-muted-foreground space-y-1">
            <li>• 현대모비스 작년 매출은?</li>
            <li>• 지난주 한세실업 뉴스 5개</li>
            <li>• 기아 OEM 모델별 판매 TOP3</li>
            <li>• 삼성SDI 최근 1개월 주가 추세</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            답변 생성 중…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ' +
          (isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')
        }
      >
        {message.text || (isUser ? '' : '(빈 답변)')}
        {message.warning && (
          <div className="mt-1 text-[11px] text-amber-700">⚠ {message.warning}</div>
        )}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <details className="mt-1.5 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer flex items-center gap-1 hover:text-foreground">
              <Wrench size={11} />
              <span>도구 호출 {message.toolCalls.length}회</span>
            </summary>
            <ul className="mt-1 ml-3 space-y-1">
              {message.toolCalls.map((t, i) => (
                <li key={i}>
                  <span className="font-mono">{t.name}</span>
                  <span className="ml-1 opacity-70">({JSON.stringify(t.input).slice(0, 80)})</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
