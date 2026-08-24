import DomesticTable from '@/components/domestic/DomesticTable';
import { getHumanoidData } from '@/lib/humanoid/source';

/** 휴머노이드 기업 페이지 (server) — fetch + cache + mapping 은 lib/humanoid/source.ts 에 격리. */
export default async function HumanoidPage() {
  const { rows, rates } = await getHumanoidData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
        {rows.length}개사 · 역할 버튼으로 완성품/부품을 가른다 (겸업사는 양쪽에 표시)
      </div>
      <div className="flex-1 overflow-auto">
        <DomesticTable rows={rows} rates={rates} groupLabel="국가" variant="humanoid" />
      </div>
    </div>
  );
}
