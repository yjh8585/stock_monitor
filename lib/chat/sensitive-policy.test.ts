/**
 * 챗봇 사외비 차단 정책 SSOT 테스트 — pure 함수, mocking 없음.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCKED_TOPICS,
  buildBlockedTopicsInstruction,
  type BlockedTopic,
} from './sensitive-policy';
import { buildSystemPrompt } from './system-prompt';

describe('BLOCKED_TOPICS', () => {
  it('최소 1개 토픽 — PnL 포함', () => {
    expect(BLOCKED_TOPICS.length).toBeGreaterThan(0);
    expect(BLOCKED_TOPICS.some((t) => t.key === 'pnl')).toBe(true);
  });

  it('모든 토픽은 필수 필드 가짐', () => {
    for (const t of BLOCKED_TOPICS) {
      expect(t.key).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.examples).toBeTruthy();
      expect(t.redirect).toBeTruthy();
    }
  });
});

describe('buildBlockedTopicsInstruction', () => {
  it('빈 배열 → 빈 문자열', () => {
    expect(buildBlockedTopicsInstruction(undefined, [])).toBe('');
  });

  it('단일 토픽 → label·examples·redirect 모두 포함', () => {
    const out = buildBlockedTopicsInstruction(undefined, [
      { key: 'pnl', label: '손익', examples: '매출·영업이익', redirect: '/management' },
    ]);
    expect(out).toContain('손익');
    expect(out).toContain('매출·영업이익');
    expect(out).toContain('/management');
    expect(out).toContain('외부 LLM 전송 보안상');
  });

  it('다중 토픽 — 한 줄에 합쳐서 노출', () => {
    const out = buildBlockedTopicsInstruction(undefined, [
      { key: 'pnl', label: '손익', examples: '매출', redirect: '/management' },
      { key: 'plan', label: '계획', examples: '판매계획', redirect: '/management' },
    ]);
    expect(out).toContain('손익');
    expect(out).toContain('계획');
    // 같은 redirect는 중복 제거
    expect(out.match(/\/management/g)?.length).toBe(1);
  });

  it('다중 토픽 + 다른 redirect → 둘 다 표시', () => {
    const out = buildBlockedTopicsInstruction(undefined, [
      { key: 'pnl', label: '손익', examples: '매출', redirect: '/management' },
      { key: 'hr', label: '인사', examples: '연봉', redirect: '/hr' },
    ]);
    expect(out).toContain('/management');
    expect(out).toContain('/hr');
  });

  it('appliesToRoles 필터 — 해당 역할 외 토픽은 제외', () => {
    const topics: BlockedTopic[] = [
      { key: 'pnl', label: '손익', examples: '매출', redirect: '/management' },
      {
        key: 'hansae',
        label: '한세그룹',
        examples: '주가·재무',
        redirect: '/hansae',
        appliesToRoles: ['mobility'],
      },
    ];
    const mobilityOut = buildBlockedTopicsInstruction('mobility', topics);
    expect(mobilityOut).toContain('한세그룹');
    const adminOut = buildBlockedTopicsInstruction('admin', topics);
    expect(adminOut).not.toContain('한세그룹');
    // appliesToRoles undefined인 PnL은 모든 역할에 적용
    expect(mobilityOut).toContain('손익');
    expect(adminOut).toContain('손익');
  });

  it('모든 토픽이 역할 필터로 제외 → 빈 문자열', () => {
    const out = buildBlockedTopicsInstruction('admin', [
      {
        key: 'hansae',
        label: '한세',
        examples: 'x',
        redirect: '/x',
        appliesToRoles: ['mobility'],
      },
    ]);
    expect(out).toBe('');
  });
});

describe('buildSystemPrompt — sensitive-policy 통합', () => {
  it('admin 역할 — 사외비 거절 문구 포함', () => {
    const prompt = buildSystemPrompt('admin');
    expect(prompt).toContain('회사 내부 손익');
    expect(prompt).toContain('/management');
  });

  it('mobility 역할 — 사외비 거절 + 한세 제한 모두 포함', () => {
    const prompt = buildSystemPrompt('mobility');
    expect(prompt).toContain('회사 내부 손익');
    expect(prompt).toContain('한세그룹');
  });
});
