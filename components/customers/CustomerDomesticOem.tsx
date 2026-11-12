// 국내 3사(현대차·기아·KGM)의 「지역·차종·점유율」 탭 내용 — OEM 탭 부품을 «그 탭 page.tsx 와 같은 인자»로 그린다(결정 C1).
// 🔴 인자 하나라도 빠뜨리면 그 기능이 조용히 죽는다(「반만 쓰는」 변형) — app/oem/{hyundai,kia,kg-mobility}/page.tsx 를 고치면
// 여기도 같이 고친다. 인자 빚기 함수는 공용(hyundaiPageProps · KgModelNameNote)이라 그쪽은 갈리지 않는다.
import type { ReactNode } from 'react';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import HyundaiIRRegionsChart from '@/components/oem-companies/hyundai/HyundaiIRRegionsChart';
import HyundaiMarketShareChart from '@/components/oem-companies/hyundai/HyundaiMarketShareChart';
import { factoryOptionsOf, irFooterOf } from '@/components/oem-companies/hyundai/hyundaiPageProps';
import KgDomesticExportSplit from '@/components/oem-companies/kg-mobility/KgDomesticExportSplit';
import KgModelNameNote from '@/components/oem-companies/kg-mobility/KgModelNameNote';
import KiaRetailRegionChart from '@/components/oem-companies/kia/KiaRetailRegionChart';
import KiaTopModelsCard from '@/components/oem-companies/kia/KiaTopModelsCard';
import type { BreakdownKind } from '@/lib/customers/breakdown';
import { getHyundaiData } from '@/lib/oem-companies/hyundai/source';
import { getKgMobilityData } from '@/lib/oem-companies/kg-mobility/source';
import { getKiaData } from '@/lib/oem-companies/kia/source';

type Nodes = Partial<Record<BreakdownKind, ReactNode>>;

const yearLabel = (s: string) => s.replace(/\s*실적\s*$/, '');

async function hyundai(): Promise<Nodes | undefined> {
  const data = await getHyundaiData();
  if (data.totalRows === 0) return undefined;
  return {
    region: (
      <HyundaiIRRegionsChart
        annual={data.irSummary}
        quarterly={data.quarterlyRegions}
        footer={irFooterOf(data)}
      />
    ),
    model: (
      <CompanyTopModelsTable
        dataAll={data.topModels.all}
        dataKoreaShip={data.topModels.domestic}
        koreaShipRegions={[
          { value: '내수', label: '내수', result: data.topModels.내수 },
          { value: '수출', label: '수출', result: data.topModels.수출 },
        ]}
        allRegions={data.topModelsAllRegions}
        factoryOptions={factoryOptionsOf(data)}
        title="차종 TOP10 (도매 출하 기준 · 전체=한국+해외 공장, 국내=한국 공장 ex-factory, 공장별 region 분기 가능)"
        latestPeriodLabel={yearLabel(data.kpi.latestYearLabel)}
        prevPeriodLabel={yearLabel(data.kpi.prevYearLabel)}
        ytdPeriodLabel={data.kpi.ytdLabel}
      />
    ),
    // 빈 배열이면 부품이 null 을 그린다 — 노드를 안 넘겨야 빈 탭이 안 열린다(결정 C4).
    ...(data.usMarketShare.length > 0 && {
      share: <HyundaiMarketShareChart data={data.usMarketShare} />,
    }),
  };
}

async function kia(): Promise<Nodes | undefined> {
  const data = await getKiaData();
  if (data.totalRows === 0) return undefined;
  return {
    region: (
      <KiaRetailRegionChart
        monthly={data.monthlyRetailRegions}
        annual={data.annualRetailRegions}
        title="지역별 판매량 (retail · 12 region, 현지판매실적)"
        extraNote="· 2021~2023 해외 전용(Korea·Mexico 미포함)"
        footer="현지판매실적.xlsx · 12 region(Korea/U.S.A/Canada/Mexico/Europe/Eastern Europe/Latin America/Middle East/Africa/Asia Pacific/India/China) × plant. 도매 출하(wholesale)와 달리 실제 소비자 인도 시점 기준."
        hideLabelsOnMonth
      />
    ),
    model: (
      <KiaTopModelsCard
        wholesaleByFactory={data.topModelsByFactory}
        retailByPlant={data.topRetailByPlant}
        factoryOptions={data.factoryOptions}
        retailPlants={data.retailPlants}
        latestPeriodLabel={yearLabel(data.kpi.latestYearLabel)}
        prevPeriodLabel={data.topModelsPrevLabel}
        ytdPeriodLabel={data.kpi.ytdLabel}
        prevPeriodPartialNote={
          data.topModelsPrevPartial
            ? `${data.topModelsPrevLabel.split('.')[0]}년은 11~12월 데이터 미게재로 차종 TOP10·직전연도 컬럼은 1~${data.topModelsPrevLastMonth}월까지만 집계 (출하량 추이 합계는 12월까지)`
            : undefined
        }
      />
    ),
  };
}

async function kgMobility(): Promise<Nodes | undefined> {
  const data = await getKgMobilityData();
  if (data.totalRows === 0) return undefined;
  return {
    region: (
      <KgDomesticExportSplit monthly={data.monthlyRegionSeries} annual={data.annualRegionSeries} />
    ),
    model: (
      <>
        <CompanyTopModelsTable
          dataAll={data.topModelsAll}
          flatRegions={[
            { value: '내수', label: '내수', result: data.topModelsDomestic },
            { value: '수출', label: '수출', result: data.topModelsExport },
          ]}
          title="차종 TOP10 (도매 출하 기준)"
          latestPeriodLabel={yearLabel(data.kpi.latestYearLabel)}
          prevPeriodLabel={yearLabel(data.kpi.prevYearLabel)}
          ytdPeriodLabel={data.kpi.ytdLabel}
          hideUnifiedNote
        />
        <KgModelNameNote />
      </>
    ),
  };
}

// 종목코드 → OEM 탭 데이터(공개 상장사 코드 — 사외비 아님).
const DOMESTIC: Record<string, () => Promise<Nodes | undefined>> = {
  '005380': hyundai,
  '000270': kia,
  '003620': kgMobility,
};

/** 국내 3사면 OEM 탭 부품 노드 · 아니면 undefined. */
export async function domesticOemNodes(ticker: string | null): Promise<Nodes | undefined> {
  const load = ticker ? DOMESTIC[ticker] : undefined;
  return load ? load() : undefined;
}
