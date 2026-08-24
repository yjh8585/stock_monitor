import { describe, expect, it } from 'vitest';

import { groupReports, type ResearchReportRow } from './research';

/**
 * `/humanoid/research` 는 사내 로그인 뒤에 있어 자동 육안 검증을 못 한다.
 * 그래서 화면이 의존하는 **묶음 로직만이라도** 여기서 못 박는다.
 */
function row(over: Partial<ResearchReportRow> & { id: string }): ResearchReportRow {
  return {
    kind: 'company',
    targetName: '로보티즈',
    ticker: '108490',
    companyId: null,
    title: '제목',
    broker: '미래에셋증권',
    publishedAt: '2026-08-01',
    pdfUrl: null,
    viewCount: null,
    summary: null,
    isDelta: false,
    isPeriodic: false,
    targetPrice: null,
    opinion: null,
    ...over,
  };
}

describe('groupReports', () => {
  it('같은 (증권사, 대상) 은 한 묶음이고 최신이 latest 가 된다', () => {
    const groups = groupReports([
      row({ id: 'a', publishedAt: '2026-07-01' }),
      row({ id: 'b', publishedAt: '2026-08-20' }),
      row({ id: 'c', publishedAt: '2026-08-01' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.latest.id).toBe('b');
    expect(groups[0]!.history.map((h) => h.id)).toEqual(['c', 'a']); // 최신순
  });

  it('증권사가 다르면 다른 묶음이다', () => {
    // 증권사가 다르면 논조 자체가 달라 "직전 대비 변화"가 성립하지 않는다.
    const groups = groupReports([
      row({ id: 'a', broker: '미래에셋증권' }),
      row({ id: 'b', broker: '한화투자증권' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('대상이 다르면 다른 묶음이다', () => {
    const groups = groupReports([
      row({ id: 'a', targetName: '로보티즈' }),
      row({ id: 'b', targetName: '레인보우로보틱스' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('묶음끼리도 최신순으로 정렬된다', () => {
    const groups = groupReports([
      row({ id: 'old', targetName: 'A', publishedAt: '2026-06-01' }),
      row({ id: 'new', targetName: 'B', publishedAt: '2026-08-24' }),
    ]);
    expect(groups.map((g) => g.latest.id)).toEqual(['new', 'old']);
  });

  it('한 건이라도 우리 종목이면 묶음이 tracked 로 표시된다', () => {
    // 옛 리포트에만 company_id 가 붙어 있어도 그 묶음은 추적 대상이다.
    const groups = groupReports([
      row({ id: 'a', publishedAt: '2026-07-01', companyId: 'uuid-1' }),
      row({ id: 'b', publishedAt: '2026-08-20', companyId: null }),
    ]);
    expect(groups[0]!.tracked).toBe(true);
  });

  it('증권사가 비어 있어도 묶이고 (미상) 으로 표시된다', () => {
    const groups = groupReports([row({ id: 'a', broker: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.broker).toBe('(미상)');
  });

  it('발행일이 없는 것은 뒤로 밀리고 버려지지 않는다', () => {
    const groups = groupReports([
      row({ id: 'nodate', publishedAt: null }),
      row({ id: 'dated', publishedAt: '2026-08-01' }),
    ]);
    expect(groups[0]!.latest.id).toBe('dated');
    expect(groups[0]!.history.map((h) => h.id)).toEqual(['nodate']);
  });

  it('빈 입력이면 빈 배열', () => {
    expect(groupReports([])).toEqual([]);
  });
});
