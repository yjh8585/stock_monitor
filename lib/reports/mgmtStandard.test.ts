import { describe, expect, it } from 'vitest';

import { compareChapterTitle } from './mgmtStandard';

describe('compareChapterTitle — 경영표준 장 순서', () => {
  it('장 번호 순(10 이 2 뒤) → 부록이 맨 뒤', () => {
    const titles = [
      '부록 B. 용어집',
      '10. 사고를 막는 장치',
      '02. 누가 결정하나',
      '부록 A. 문서 색인',
      '00. 한 장 요약',
      '11. ESG',
    ];
    expect([...titles].sort(compareChapterTitle)).toEqual([
      '00. 한 장 요약',
      '02. 누가 결정하나',
      '10. 사고를 막는 장치',
      '11. ESG',
      '부록 A. 문서 색인',
      '부록 B. 용어집',
    ]);
  });

  it('번호가 한 자리로 적혀도 숫자 순(2 가 10 앞) — 글자 순이면 10 이 먼저 온다', () => {
    expect(['10. 사고를 막는 장치', '2. 누가 결정하나'].sort(compareChapterTitle)).toEqual([
      '2. 누가 결정하나',
      '10. 사고를 막는 장치',
    ]);
  });
});
