import DomesticTable from '@/components/domestic/DomesticTable';
import { getMotorData } from '@/lib/motor/source';

/** 휴머노이드 「모터」 탭 (server) — fetch + cache + mapping 은 lib/motor/source.ts 에 격리. */
export default async function HumanoidMotorPage() {
  const { rows, rates } = await getMotorData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
        {rows.length}개사 · 유형 버튼으로 거른다 (겸업사는 여러 유형에 표시) · 공급 이력은 원문으로
        확인된 납품만
      </div>
      <div className="flex-1 overflow-auto">
        <DomesticTable rows={rows} rates={rates} groupLabel="그룹" variant="motor" />
      </div>
    </div>
  );
}
