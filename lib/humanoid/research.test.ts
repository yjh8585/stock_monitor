import { describe, expect, it } from 'vitest';

import { listTargets, mapFigures, type ResearchReportRow } from './research';

/**
 * `/humanoid/research` 는 사내 로그인 뒤에 있어 자동 육안 검증을 못 한다.
 * 그래서 화면이 의존하는 **순수 로직만이라도** 여기서 못 박는다.
 *
 * 🔴 2026-09-11 에 목록이 (증권사, 대상) 묶음 카드에서 **평면 표**로 바뀌면서
 *    `groupReports` 가 사라졌다. 그 테스트를 지운 자리에 남은 순수 함수를 채운다 —
 *    묶기 로직이 없어졌다고 이 파일을 통째로 비우면 커버리지가 조용히 0이 된다.
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
    summaryExcerpt: null,
    isDelta: false,
    isPeriodic: false,
    targetPrice: null,
    opinion: null,
    ...over,
  };
}

describe('listTargets', () => {
  it('리포트가 많은 대상을 앞에 둔다', () => {
    const targets = listTargets([
      row({ id: 'a', targetName: '로보티즈' }),
      row({ id: 'b', targetName: '두산로보틱스' }),
      row({ id: 'c', targetName: '두산로보틱스' }),
    ]);
    expect(targets).toEqual(['두산로보틱스', '로보티즈']);
  });

  it('건수가 같으면 가나다순', () => {
    const targets = listTargets([
      row({ id: 'a', targetName: '레인보우로보틱스' }),
      row({ id: 'b', targetName: '고영테크놀러지' }),
    ]);
    expect(targets).toEqual(['고영테크놀러지', '레인보우로보틱스']);
  });

  it('빈 목록은 빈 배열', () => {
    expect(listTargets([])).toEqual([]);
  });
});

describe('mapFigures', () => {
  it('배열이 아니면 버린다', () => {
    expect(mapFigures(null)).toEqual([]);
    expect(mapFigures({ url: 'x' })).toEqual([]);
  });

  it('url 이 없는 항목은 버리고 나머지는 기본값으로 채운다', () => {
    expect(
      mapFigures([{ url: '' }, { name: 'fig1', url: 'https://x/a.png' }, { page: 3 }])
    ).toEqual([{ name: 'fig1', url: 'https://x/a.png', page: 0, caption: '' }]);
  });
});
