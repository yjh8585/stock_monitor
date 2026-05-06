export interface CustomerLogoConfig {
  /** SimpleIcons CDN SVG URL — null이면 컬러 배지로 폴백 */
  iconUrl: string | null;
  abbr: string;
  color: string;
}

const SI = (slug: string, hex: string) => `https://cdn.simpleicons.org/${slug}/${hex}`;

/** 고객사명 → 브랜드 로고 설정 (SimpleIcons CDN 우선, 없으면 컬러 배지) */
export const CUSTOMER_LOGOS: Record<string, CustomerLogoConfig> = {
  현대차: { iconUrl: SI('hyundai', '002c5f'), abbr: '현대', color: '#002c5f' },
  기아: { iconUrl: SI('kia', '05141f'), abbr: '기아', color: '#05141f' },
  르노: { iconUrl: SI('renault', 'efb700'), abbr: 'RNO', color: '#c9a000' },
  GM: { iconUrl: SI('generalmotors', '0170CE'), abbr: 'GM', color: '#0170ce' },
  // 가독성을 위해 공식색(003478)보다 밝은 파란색 사용
  포드: { iconUrl: SI('ford', '1B73B3'), abbr: 'Ford', color: '#1B73B3' },
  // 텍스트형 로고라 작은 박스에서 가독성 낮아 배지 사용
  스텔란티스: { iconUrl: null, abbr: 'STL', color: '#6e44a0' },
  BMW: { iconUrl: SI('bmw', '0066b1'), abbr: 'BMW', color: '#0066b1' },
  // SimpleIcons CDN 미지원 → Wikimedia 삼각별 아이콘(512×512) 사용
  '메르세데스-벤츠': {
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/32/Mercedes-Benz_Star_2022.svg',
    abbr: 'MB',
    color: '#222222',
  },
  폭스바겐: { iconUrl: SI('volkswagen', '001e50'), abbr: 'VW', color: '#001e50' },
  도요타: { iconUrl: SI('toyota', 'EB0A1E'), abbr: '도요타', color: '#EB0A1E' },
  닛산: { iconUrl: SI('nissan', 'C3002F'), abbr: '닛산', color: '#C3002F' },
  현대모비스: { iconUrl: null, abbr: '모비스', color: '#005bac' },
  리비안: { iconUrl: SI('rivian', '009b4d'), abbr: 'RIV', color: '#009b4d' },
  빈패스트: { iconUrl: null, abbr: 'VF', color: '#003087' },
  폴라리스: { iconUrl: null, abbr: 'POL', color: '#1a2d5a' },
};
