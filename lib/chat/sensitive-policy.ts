/**
 * 챗봇 외부 LLM 차단 정책 — 사외비 도메인 SSOT.
 *
 * 챗봇은 anon Supabase 클라이언트만 쓰므로 사외비 테이블(pnl_entries 등) 자체 접근은
 * 이미 confidentialDb로 차단됨. 본 모듈은 **사용자가 사외비 토픽을 질문했을 때 거절**
 * 안내를 system-prompt에 자동 inject하기 위한 것.
 *
 * 새 사외비 도메인(plan·inventory·production 등) 추가 시 BLOCKED_TOPICS 배열에 한 줄.
 * system-prompt가 자동으로 거절 문구를 생성한다.
 */
import type { UserRole } from './types';

export interface BlockedTopic {
  /** 내부 키 (감사·검색용) */
  key: string;
  /** prompt에 노출되는 도메인 이름 */
  label: string;
  /** 거절 사유 예시 — 괄호 안에 들어감 */
  examples: string;
  /** 사용자에게 안내할 직접 확인 경로 */
  redirect: string;
  /** 이 토픽을 차단할 역할 — undefined면 모든 역할에 적용 */
  appliesToRoles?: UserRole[];
}

/**
 * 현재 사외비 명단. 추가 시 한 줄 — system-prompt가 자동 반영.
 *
 * 향후 경영관리 하부 페이지(계획·재고·생산) 확장 시 같은 패턴으로 추가.
 * AGENTS.md "챗봇 외부 LLM 전송 정책" 참고.
 */
export const BLOCKED_TOPICS: BlockedTopic[] = [
  {
    key: 'pnl',
    label: '회사 내부 손익',
    examples: '매출·영업이익·원가·고객사별 실적',
    redirect: '/management',
  },
];

/**
 * 주어진 역할에 적용 가능한 차단 토픽으로 system-prompt 한 줄 생성.
 *
 * - 빈 배열 → 빈 문자열 반환 (system-prompt에서 안전하게 join 가능).
 * - 여러 토픽 → 한 줄로 합쳐 거절 문구 생성. redirect는 중복 제거.
 */
export function buildBlockedTopicsInstruction(
  role?: UserRole,
  topics: BlockedTopic[] = BLOCKED_TOPICS
): string {
  const applicable = topics.filter(
    (t) => !t.appliesToRoles || (role && t.appliesToRoles.includes(role))
  );
  if (applicable.length === 0) return '';

  const topicList = applicable.map((t) => `${t.label}(${t.examples} 등)`).join(', ');
  const redirects = Array.from(new Set(applicable.map((t) => t.redirect))).join('·');

  return (
    `- ${topicList}은 외부 LLM 전송 보안상 챗봇에서 다루지 않습니다. ` +
    `관련 질문이 오면 "사내 보안 정책상 해당 데이터는 챗봇으로 답변하지 않습니다. ` +
    `${redirects} 페이지를 직접 확인해 주세요."라고 답하세요.`
  );
}
