/** KGM 차종 TOP10 표 아래 「차종명 통일」 각주 — KGM 탭과 고객사 상세가 같이 쓴다(2026-11-12 page 에서 옮김). */
export default function KgModelNameNote() {
  return (
    <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
      ※ 차종명 통일:{' '}
      <span className="font-medium text-foreground">
        R/Sports = Rexton Sports / R/Sports KHAN = Rexton Sports Khan / Musso sports / Musso Khan
      </span>{' '}
      는 모두 <span className="font-medium text-foreground">Musso</span>로 합산 (2026년 IR 표기 통합
      기준). Musso EV는 별도.
    </p>
  );
}
