import { describe, expect, it } from 'vitest';
import { compareForDisplay, mapOutlookRow, pickLatestPerModel } from './source';

describe('mapOutlookRow', () => {
  it('JSONB 컬럼이 null 이어도 빈 배열로 안전하게 매핑된다', () => {
    const row = {
      model_key: 'grand_cherokee',
      model_name: 'Jeep Grand Cherokee',
      oem_group: 'Stellantis',
      region: 'North America',
      note_date: '2026-08-17',
      label: 'RED',
      sales_trend: null,
      competitive_view: null,
      consumer_view: 'c',
      outlook: 'o',
      rationale: 'r',
      market_breakdown: null,
      sources: null,
    };
    const out = mapOutlookRow(row);
    expect(out.markets).toEqual([]);
    expect(out.sources).toEqual([]);
    expect(out.modelKey).toBe('grand_cherokee');
  });
});

describe('pickLatestPerModel', () => {
  it('차종별로 note_date 가 가장 최근인 행만 남긴다', () => {
    const rows = [
      { model_key: 'a', note_date: '2026-08-10' },
      { model_key: 'a', note_date: '2026-08-17' },
      { model_key: 'b', note_date: '2026-08-17' },
    ];
    const out = pickLatestPerModel(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.model_key === 'a')?.note_date).toBe('2026-08-17');
  });
});

describe('compareForDisplay', () => {
  it('북미 차종이 글로벌 차종보다 앞서고, 같은 region 안에서는 model_key 사전순', () => {
    const rows = [
      { region: 'Global', model_key: 'seltos' },
      { region: 'North America', model_key: 'ram_truck' },
      { region: 'Global', model_key: 'niro' },
      { region: 'North America', model_key: 'grand_cherokee' },
    ];
    expect([...rows].sort(compareForDisplay).map((r) => r.model_key)).toEqual([
      'grand_cherokee',
      'ram_truck',
      'niro',
      'seltos',
    ]);
  });

  it('입력 순서가 달라도 같은 결과를 낸다(카드 순서가 실행마다 바뀌지 않는다)', () => {
    const a = { region: 'North America', model_key: 'atlas' };
    const b = { region: 'Global', model_key: 'porsche_911' };
    expect([a, b].sort(compareForDisplay)).toEqual([b, a].sort(compareForDisplay));
  });
});
