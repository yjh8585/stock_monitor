import { describe, it, expect } from 'vitest';
import type { SeriesPoint } from './seriesLive';
import {
  comexCopperToUsdPerMt,
  usHrcToUsdPerMt,
  krwVatToUsdPerMt,
  cnyVatToUsdPerMt,
  joinAsOf,
} from './commodityUnits';

const usdKrw: SeriesPoint[] = [
  { time: '2026-11-03', value: 1400 },
  { time: '2026-11-05', value: 1450 },
];

describe('joinAsOf — 환율은 같은 날 또는 그 이전 가장 가까운 날', () => {
  it('같은 날·사이 날·이전 날 없음을 가른다', () => {
    const prices: SeriesPoint[] = [
      { time: '2026-11-02', value: 1 }, // 환율보다 앞 → 버린다
      { time: '2026-11-03', value: 2 }, // 같은 날 → 1400
      { time: '2026-11-04', value: 3 }, // 사이 → 11-03 의 1400
      { time: '2026-11-06', value: 4 }, // 뒤 → 11-05 의 1450
    ];
    expect(joinAsOf(prices, usdKrw, (v, r) => v * r)).toEqual([
      { time: '2026-11-03', value: 2800 },
      { time: '2026-11-04', value: 4200 },
      { time: '2026-11-06', value: 5800 },
    ]);
  });
});

describe('단위·통화·부가세 환산 → USD/t', () => {
  it('COMEX 구리 USD/lb → USD/t (×2204.62262)', () => {
    expect(comexCopperToUsdPerMt([{ time: '2026-11-06', value: 5 }])).toEqual([
      { time: '2026-11-06', value: 11023.1 },
    ]);
  });

  it('미국 HRC USD/short ton → USD/t (×1.10231131)', () => {
    expect(usHrcToUsdPerMt([{ time: '2026-11-06', value: 900 }])).toEqual([
      { time: '2026-11-06', value: 992.1 },
    ]);
  });

  it('조달청 원/톤(부가세 10% 포함) → USD/t: ÷1.1 ÷USDKRW', () => {
    // 21,220,000 ÷ 1.1 ÷ 1450 = 13,304.08…
    expect(krwVatToUsdPerMt([{ time: '2026-11-06', value: 21_220_000 }], usdKrw)).toEqual([
      { time: '2026-11-06', value: 13304.1 },
    ]);
  });

  it('SHFE 위안/톤(증치세 13% 포함) → USD/t: ÷1.13 ×CNYKRW ÷USDKRW', () => {
    const cnyKrw: SeriesPoint[] = [{ time: '2026-11-05', value: 200 }];
    // 3,206 ÷ 1.13 × 200 ÷ 1450 = 391.33…
    expect(cnyVatToUsdPerMt([{ time: '2026-11-06', value: 3206 }], cnyKrw, usdKrw)).toEqual([
      { time: '2026-11-06', value: 391.3 },
    ]);
  });

  it('SHFE — 두 환율은 «각각» 가격 날짜에 붙인다(USD 만 새로 들어온 날도 최신 USD 를 쓴다)', () => {
    // CNYKRW 는 11-05 만, USDKRW 는 11-05·11-06 — 11-06 가격엔 CNY 11-05(200)·USD 11-06(1450)
    const cnyKrw: SeriesPoint[] = [{ time: '2026-11-05', value: 200 }];
    const usd: SeriesPoint[] = [
      { time: '2026-11-05', value: 1400 },
      { time: '2026-11-06', value: 1450 },
    ];
    expect(cnyVatToUsdPerMt([{ time: '2026-11-06', value: 3206 }], cnyKrw, usd)).toEqual([
      { time: '2026-11-06', value: 391.3 },
    ]);
  });

  it('환율이 비면 빈 시계열(가짜 값을 만들지 않는다)', () => {
    expect(krwVatToUsdPerMt([{ time: '2026-11-06', value: 1 }], [])).toEqual([]);
  });
});
