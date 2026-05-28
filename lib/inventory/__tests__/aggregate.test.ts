import { describe, it, expect } from 'vitest';
import {
  convertToKrwEok,
  buildStatusPoints,
  buildAchievementPoints,
  buildTransportPoints,
  buildKpis,
} from '../aggregate';
import type { InventoryRow } from '../types';

function row(partial: Partial<InventoryRow>): InventoryRow {
  return {
    category: '운영',
    item: '운영 재고',
    kind: 'actual',
    period_year: 2025,
    period_month: 1,
    unit: '억원',
    fx_rate: 1400,
    value: 100,
    ...partial,
  };
}

describe('convertToKrwEok', () => {
  it('억원 단위는 그대로 반환', () => {
    expect(convertToKrwEok(row({ unit: '억원', value: 123.45 }))).toBe(123.45);
  });
  it('백만USD × fx_rate / 100 = 억원', () => {
    expect(convertToKrwEok(row({ unit: '백만USD', value: 10, fx_rate: 1400 }))).toBe(140);
  });
  it('value null → null', () => {
    expect(convertToKrwEok(row({ value: null }))).toBeNull();
  });
  it('unit null (회전율) → null', () => {
    expect(convertToKrwEok(row({ unit: null, value: 4.1 }))).toBeNull();
  });
  it('fx_rate null + 백만USD → null (안전 fallback)', () => {
    expect(convertToKrwEok(row({ unit: '백만USD', fx_rate: null, value: 10 }))).toBeNull();
  });
});

describe('buildStatusPoints', () => {
  it('실적 행만 모아 누적막대 + 회전율 데이터 생성', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 100,
      }),
      row({
        category: '관리',
        item: '관리 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 50,
      }),
      row({
        category: '보상',
        item: '보상 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 30,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 20,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '회전율',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: null,
        fx_rate: null,
        value: 4.1,
      }),
    ];
    const pts = buildStatusPoints(rows);
    expect(pts).toHaveLength(1);
    expect(pts[0].monthLabel).toBe('2025.01');
    expect(pts[0].operating).toBe(100);
    expect(pts[0].management).toBe(50);
    expect(pts[0].compensation).toBe(30);
    expect(pts[0].transport).toBe(160);
    expect(pts[0].total).toBe(340);
    expect(pts[0].turnover).toBe(4.1);
  });

  it('계획 행은 무시 (차트 1은 실적만)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 999,
      }),
    ];
    expect(buildStatusPoints(rows)).toHaveLength(0);
  });

  it('월 오름차순 정렬', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        value: 1,
      }),
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        value: 1,
      }),
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 1,
      }),
    ];
    const labels = buildStatusPoints(rows).map((p) => p.monthLabel);
    expect(labels).toEqual(['2025.12', '2026.01', '2026.03']);
  });
});

describe('buildAchievementPoints', () => {
  it('total 카테고리: 전체-전체재고 행 사용', () => {
    const rows: InventoryRow[] = [
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 100,
      }),
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 95,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'total');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(100);
    expect(pts[0].actual).toBe(95);
    expect(pts[0].rate).toBe(95);
  });

  it('transport 카테고리: 영업 + 미국환산 + 우즈벡환산 합산', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        value: 20,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '우즈벡 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 5,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        value: 18,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 8,
        fx_rate: 1400,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'transport');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(230);
    expect(pts[0].actual).toBe(130);
    expect(pts[0].rate).toBeCloseTo(56.52, 1);
  });

  it('plan만 있고 actual null → rate null', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 12,
        value: 100,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'operating');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(100);
    expect(pts[0].actual).toBeNull();
    expect(pts[0].rate).toBeNull();
  });
});

describe('buildTransportPoints', () => {
  it('us → 미국 운송 (환산)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 9,
        fx_rate: 1400,
      }),
    ];
    const pts = buildTransportPoints(rows, 'us');
    expect(pts[0].plan).toBe(140);
    expect(pts[0].actual).toBe(126);
  });
  it('uz → 우즈벡 운송', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '우즈벡 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 4,
        unit: '백만USD',
        value: 5,
        fx_rate: 1400,
      }),
    ];
    const pts = buildTransportPoints(rows, 'uz');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(70);
  });
  it('sales → 영업 재고', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 6,
        value: 50,
      }),
    ];
    const pts = buildTransportPoints(rows, 'sales');
    expect(pts[0].plan).toBe(50);
  });
});

describe('buildKpis', () => {
  it('최신 실적 월 기준 KPI 5종 계산 (전체/회전율 + 관리·보상·운송 비중)', () => {
    const rows: InventoryRow[] = [
      // 2025.12 실적 — MoM 계산용 prev
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        value: 1000,
      }),
      // 2026.01 실적 — latest 기준
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 1100,
      }),
      row({
        category: '관리',
        item: '관리 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 200,
      }),
      row({
        category: '보상',
        item: '보상 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 80,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 110,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        unit: '백만USD',
        value: 12,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '회전율',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        unit: null,
        fx_rate: null,
        value: 5.0,
      }),
    ];
    const kpis = buildKpis(rows);
    expect(kpis.latestLabel).toBe('2026.01');
    expect(kpis.totalEok).toBe(1100);
    expect(kpis.totalMomPct).toBeCloseTo(10, 1);
    expect(kpis.turnover).toBe(5.0);
    expect(kpis.turnoverDays).toBe(73);
    // 관리 = 200 / 1100 × 100 = 18.18%
    expect(kpis.managementSharePct).toBeCloseTo(18.18, 1);
    // 보상 = 80 / 1100 × 100 = 7.27%
    expect(kpis.compensationSharePct).toBeCloseTo(7.27, 1);
    // 운송 = (110 + 12*14) / 1100 × 100 = 278 / 1100 × 100 = 25.27%
    expect(kpis.transportSharePct).toBeCloseTo(25.27, 1);
  });

  it('실적 없으면 모두 null', () => {
    const rows: InventoryRow[] = [
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 1,
        value: 100,
      }),
    ];
    const kpis = buildKpis(rows);
    expect(kpis.totalEok).toBeNull();
    expect(kpis.turnover).toBeNull();
    expect(kpis.managementSharePct).toBeNull();
    expect(kpis.compensationSharePct).toBeNull();
    expect(kpis.transportSharePct).toBeNull();
  });
});
