import { describe, it, expect } from 'vitest';
import {
  buildOverallPoints,
  buildDomesticPoints,
  buildOverseasPoints,
  buildMixPoints,
  buildTableData,
} from '../aggregate';
import type { PersonnelRow } from '../types';

function row(p: Partial<PersonnelRow>): PersonnelRow {
  return {
    region: '국내',
    detail: 'PM',
    kind: '임원',
    period_date: '2025-12-31',
    headcount: 1,
    ...p,
  };
}

describe('buildOverallPoints', () => {
  it('all 모드: 국내+외주 / 미국 / 중국 / 우즈벡 / 이인텔리전스 합산', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '임원', headcount: 5 }),
      row({ region: '국내', kind: '사무', headcount: 10 }),
      row({ region: '국내', kind: '생산', headcount: 20 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 8 }),
      row({ region: '미국', detail: '', kind: '사무', headcount: 3 }),
      row({ region: '중국', detail: '', kind: '생산', headcount: 4 }),
      row({ region: '우즈벡', detail: '', kind: '생산', headcount: 6 }),
      row({ region: '이인텔리전스', detail: '', kind: '사무', headcount: 2 }),
    ];
    const pts = buildOverallPoints(rows, 'all');
    expect(pts).toHaveLength(1);
    expect(pts[0].domestic).toBe(43); // 5+10+20+8
    expect(pts[0].us).toBe(3);
    expect(pts[0].cn).toBe(4);
    expect(pts[0].uz).toBe(6);
    expect(pts[0].intel).toBe(2);
    expect(pts[0].total).toBe(58);
  });

  it('office 모드: 임원+사무만 합산', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '임원', headcount: 5 }),
      row({ region: '국내', kind: '사무', headcount: 10 }),
      row({ region: '국내', kind: '생산', headcount: 20 }),
    ];
    const pts = buildOverallPoints(rows, 'office');
    expect(pts[0].domestic).toBe(15);
    expect(pts[0].total).toBe(15);
  });

  it('production 모드: 생산만', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '임원', headcount: 5 }),
      row({ region: '국내', kind: '생산', headcount: 20 }),
    ];
    const pts = buildOverallPoints(rows, 'production');
    expect(pts[0].domestic).toBe(20);
  });

  it('periodLabel = YYYY.MM 형식', () => {
    const rows: PersonnelRow[] = [row({ period_date: '2026-05-21', headcount: 1 })];
    expect(buildOverallPoints(rows, 'all')[0].periodLabel).toBe('2026.05');
  });

  it('시점 오름차순 정렬', () => {
    const rows: PersonnelRow[] = [
      row({ period_date: '2026-05-21', headcount: 1 }),
      row({ period_date: '2023-12-31', headcount: 2 }),
      row({ period_date: '2025-12-31', headcount: 3 }),
    ];
    const labels = buildOverallPoints(rows, 'all').map((p) => p.periodLabel);
    expect(labels).toEqual(['2023.12', '2025.12', '2026.05']);
  });
});

describe('buildDomesticPoints', () => {
  it('국내(11 detail 합) / 사내외주 / 협력사원', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', detail: 'PM', kind: '사무', headcount: 5 }),
      row({ region: '국내', detail: '구매', kind: '사무', headcount: 7 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 10 }),
      row({ region: '외주', detail: '협력사원', kind: '생산', headcount: 4 }),
      row({ region: '미국', detail: '', kind: '사무', headcount: 100 }),
    ];
    const pts = buildDomesticPoints(rows, 'all');
    expect(pts[0].domestic).toBe(12);
    expect(pts[0].internal).toBe(10);
    expect(pts[0].partner).toBe(4);
    expect(pts[0].total).toBe(26);
  });
});

describe('buildOverseasPoints', () => {
  it('us → 미국 합산', () => {
    const rows: PersonnelRow[] = [
      row({ region: '미국', detail: '', kind: '임원', headcount: 2 }),
      row({ region: '미국', detail: '', kind: '사무', headcount: 5 }),
      row({ region: '미국', detail: '', kind: '생산', headcount: 8 }),
      row({ region: '중국', detail: '', kind: '생산', headcount: 999 }),
    ];
    const pts = buildOverseasPoints(rows, 'us');
    expect(pts[0].headcount).toBe(15);
  });

  it('intel → 이인텔리전스', () => {
    const rows: PersonnelRow[] = [
      row({ region: '이인텔리전스', detail: '', kind: '사무', headcount: 7 }),
    ];
    expect(buildOverseasPoints(rows, 'intel')[0].headcount).toBe(7);
  });
});

describe('buildMixPoints', () => {
  it('all 옵션: 사무(임원+사무) vs 생산', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '임원', headcount: 5 }),
      row({ region: '국내', kind: '사무', headcount: 15 }),
      row({ region: '국내', kind: '생산', headcount: 30 }),
      row({ region: '미국', detail: '', kind: '생산', headcount: 50 }),
    ];
    const pts = buildMixPoints(rows, 'all');
    expect(pts[0].office).toBe(20);
    expect(pts[0].production).toBe(80);
    expect(pts[0].total).toBe(100);
    expect(pts[0].officePct).toBeCloseTo(20, 1);
    expect(pts[0].productionPct).toBeCloseTo(80, 1);
  });

  it('domestic 옵션: 국내만', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '사무', headcount: 10 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 999 }),
    ];
    const pts = buildMixPoints(rows, 'domestic');
    expect(pts[0].office).toBe(10);
    expect(pts[0].production).toBeNull();
  });

  it('domestic-outsource 옵션: 국내+외주', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', kind: '사무', headcount: 10 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 20 }),
      row({ region: '미국', detail: '', kind: '생산', headcount: 999 }),
    ];
    const pts = buildMixPoints(rows, 'domestic-outsource');
    expect(pts[0].office).toBe(10);
    expect(pts[0].production).toBe(20);
  });
});

describe('buildTableData', () => {
  it('국내 detail 11 + 국내 소계 + 외주 2 + 국내+외주 소계 + 해외 4 + 해외 소계 + 전체 = 21 rows', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', detail: 'PM', kind: '임원', headcount: 1 }),
      row({ region: '국내', detail: '구매', kind: '사무', headcount: 2 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 10 }),
      row({ region: '미국', detail: '', kind: '생산', headcount: 5 }),
    ];
    const data = buildTableData(rows);
    expect(data.rows).toHaveLength(11 + 1 + 2 + 1 + 4 + 1 + 1);
    expect(data.periods).toEqual([{ date: '2025-12-31', label: '2025.12' }]);
  });

  it('국내 소계는 모든 국내 detail 합', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', detail: 'PM', kind: '임원', headcount: 3 }),
      row({ region: '국내', detail: '구매', kind: '임원', headcount: 5 }),
    ];
    const data = buildTableData(rows);
    const subtotal = data.rows.find((r) => r.label === '국내 소계')!;
    expect(subtotal.type).toBe('subtotal');
    expect(subtotal.values['2025-12-31'].임원).toBe(8);
  });

  it('전체 합계는 모든 행 합', () => {
    const rows: PersonnelRow[] = [
      row({ region: '국내', detail: 'PM', kind: '임원', headcount: 1 }),
      row({ region: '외주', detail: '사내외주', kind: '생산', headcount: 10 }),
      row({ region: '미국', detail: '', kind: '사무', headcount: 5 }),
    ];
    const data = buildTableData(rows);
    const total = data.rows.find((r) => r.type === 'total')!;
    expect(total.values['2025-12-31'].total).toBe(16);
  });
});
