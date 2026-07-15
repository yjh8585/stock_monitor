import DiagnosisCards from '@/components/management/stellantis/DiagnosisCards';
import StellantisDashboard from '@/components/management/stellantis/StellantisDashboard';
import { quarterLabel } from '@/lib/stellantis-forecast/aggregate';
import { getStellantisForecastData } from '@/lib/stellantis-forecast/source';
import type { StellantisForecastData } from '@/lib/stellantis-forecast/types';

/**
 * 스텔란티스 북미 매출 전망 (server).
 *
 * `getStellantisForecastData()` 한 번으로 4개 소스(출하·소매·딜러 재고·자사 매출)를 모아
 * 카드 4장 + 차트 4종에 분배한다. 자사 매출만 사외비이며 source.ts가 `confidentialDb`로 처리한다.
 */
export default async function StellantisPage() {
  const data = await getStellantisForecastData();

  if (data.gap.length === 0) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-4">
        <PageHeader />
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-lg font-semibold">데이터 수집 대기 중</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            출하와 소매가 모두 채워진 분기가 아직 없습니다. 출하는 스텔란티스 실적 발표(분기)를,
            소매는 MarkLines 월간 갱신을 기다립니다.
          </p>
        </section>
        <Footnotes data={data} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-4">
      <PageHeader />
      <DiagnosisCards
        diagnosis={data.diagnosis}
        gap={data.gap}
        lag={data.lag}
        forecast={data.forecast}
      />
      <StellantisDashboard data={data} />
      <Footnotes data={data} />
    </div>
  );
}

/** 제목 + 이 화면이 무엇을 말하는지 + 소스 4종 한 줄. */
function PageHeader() {
  return (
    <header className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h1 className="text-xl font-semibold">스텔란티스 북미 매출 전망</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        주거래처 스텔란티스 북미의 <b>출하(도매) · 소매 판매 · 딜러 재고</b>와 자사 Stellantis NA향
        매출을 대비해 향후 매출을 전망합니다. 출하가 늘어도 소매가 따라오지 않으면 딜러 재고가
        쌓이고, 스텔란티스는 결국 감산으로 되돌립니다 — 그때 자사 매출도 함께 줄어듭니다.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        출하 = Stellantis IR / SEC EDGAR (분기, 북미 지역) · 소매 = MarkLines (월,
        미국·캐나다·멕시코) · 딜러 재고 = Cox Automotive (월, 브랜드별 재고일수) · 자사 매출 = 자체
        손익 (월, 억원)
      </p>
    </header>
  );
}

/**
 * 각주 — 데이터 제약. 화면의 숫자를 어디까지 믿어도 되는지 밝힌다.
 *
 * 이 화면은 "재고가 쌓였다 → 감산 위험"이라는 **경고**를 내는 곳이라, 소매 과소집계·출하 차분
 * 도출 같은 제약을 숨기면 잘못된 경고가 사실처럼 읽힌다. 접지 않고 항상 펼쳐 둔다.
 */
function Footnotes({ data }: { data: StellantisForecastData }) {
  const cutoff = data.lastCompleteQuarter;
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">데이터 제약 — 숫자와 함께 읽어야 합니다</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {data.partialQuarterNote ? <li>{data.partialQuarterNote}</li> : null}
        <li>
          출하는 <b>북미(미국+캐나다+멕시코) 지역 단위</b>입니다. 브랜드·차종별 출하는 어떤 공개
          소스에도 없어, 이 화면에서 브랜드별 출하를 볼 수는 없습니다.
        </li>
        <li>
          2021~2025년 Q2·Q4 출하는 반기·연간 보도자료에서 <b>차분 도출</b>한 값입니다(Q2 = H1 − Q1,
          Q4 = FY − H1 − Q3). 천대 반올림이 누적돼 ±1,000대 오차가 있으며, 차트 1에서{' '}
          <b>빗금 막대</b>로 구분했습니다.
        </li>
        <li>
          MarkLines 소매는 <b>캐나다가 한 달 늦게</b> 들어옵니다. 3개국이 모두 채워진 분기
          {cutoff ? ` (${quarterLabel(cutoff)})` : ''}까지만 집계했습니다 — 부분 분기를 섞으면
          소매가 과소집계돼 재고 축적을 과대평가하게 됩니다.
        </li>
        <li>
          MarkLines는 스코프가 넓어(미분류 버킷 포함) 스텔란티스 공식 발표와 <b>±0~2% 편차</b>가
          있습니다. 절대값 정합이 아니라 <b>추세 비교</b>용으로 보십시오.
        </li>
      </ul>
    </section>
  );
}
