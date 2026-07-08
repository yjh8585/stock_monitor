import OemDashboard from '@/components/oem/OemDashboard';
import { getOemData } from '@/lib/oem/source';

/**
 * OEM "전체" 탭 — 글로벌 MarkLines 대시보드.
 * 헤더·탭 네비는 app/oem/layout.tsx가 담당. 이 페이지는 본문만.
 */
export default async function OemPage() {
  const data = await getOemData();

  return (
    <>
      <div className="px-6 py-2 border-b border-border bg-muted/30">
        <p className="text-xs text-muted-foreground">
          MarkLines 글로벌 자동차 판매 데이터 · 2020.01~ · {data.oemGroupCount}개 OEM 그룹 · 판매
          매월 갱신 · AI 전망 주 1회(월)
        </p>
      </div>
      <OemDashboard
        groupMonth={data.groupMonth}
        groupPtMonth={data.groupPtMonth}
        typeSegMonth={data.typeSegMonth}
        countryTop15={data.countryTop15}
        oemCountryMatrix={data.oemCountryMatrix}
        usaOemSeries={data.usaOemSeries}
        naModelSeries={data.naModelSeries}
        otherModelSeries={data.otherModelSeries}
        naOutlooks={data.naOutlooks}
        otherOutlooks={data.otherOutlooks}
      />
    </>
  );
}
