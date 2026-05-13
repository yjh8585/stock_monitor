export interface CustomerLogoConfig {
  /** SimpleIcons CDN SVG URL — null이면 컬러 배지로 폴백 */
  iconUrl: string | null;
  abbr: string;
  color: string;
}

const SI = (slug: string, hex: string) => `https://cdn.simpleicons.org/${slug}/${hex}`;
/** Wikimedia Commons 영구 URL (Special:FilePath은 자동 redirect — 이미지 변경 시에도 작동) */
const WC = (filename: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}`;

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
  메르세데스: {
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/32/Mercedes-Benz_Star_2022.svg',
    abbr: 'MB',
    color: '#222222',
  },
  폭스바겐: { iconUrl: SI('volkswagen', '001e50'), abbr: 'VW', color: '#001e50' },
  도요타: { iconUrl: SI('toyota', 'EB0A1E'), abbr: '도요타', color: '#EB0A1E' },
  혼다: { iconUrl: SI('honda', 'E40521'), abbr: '혼다', color: '#E40521' },
  닛산: { iconUrl: SI('nissan', 'C3002F'), abbr: '닛산', color: '#C3002F' },
  현대모비스: { iconUrl: null, abbr: '모비스', color: '#005bac' },
  // 워드마크 대신 심볼 마크만 — 로컬 SVG 사용
  리비안: { iconUrl: '/logos/rivian.svg', abbr: 'RIV', color: '#151515' },
  // SimpleIcons 미지원 → Wikimedia "V" 심볼 SVG (481×481)
  빈패스트: {
    iconUrl:
      'https://upload.wikimedia.org/wikipedia/commons/4/43/VinFast_logo_%28simple_variant%29.svg',
    abbr: 'VF',
    color: '#003087',
  },
  // 워드마크 대신 심볼 엠블럼만 — 로컬 SVG 사용
  KGM: { iconUrl: '/logos/kg-mobility.svg', abbr: 'KGM', color: '#0a2240' },
  KG모빌리티: { iconUrl: '/logos/kg-mobility.svg', abbr: 'KGM', color: '#0a2240' },
  폴라리스: { iconUrl: null, abbr: 'POL', color: '#1a2d5a' },
  테슬라: { iconUrl: SI('tesla', 'CC0000'), abbr: 'Tesla', color: '#CC0000' },
  한국지엠: { iconUrl: SI('chevrolet', 'D1AD57'), abbr: '한국GM', color: '#D1AD57' },
  // 정규화 표준명 '한국GM' (정규화 스크립트 ALIAS_TO_STANDARD)
  한국GM: { iconUrl: SI('chevrolet', 'D1AD57'), abbr: '한국GM', color: '#D1AD57' },
  르노코리아: { iconUrl: SI('renault', 'efb700'), abbr: 'RKM', color: '#c9a000' },
  // 제네시스는 현대차 브랜드라 정규화 단계에서 '현대차'로 통합 (별도 매핑 불필요)
  아우디: { iconUrl: SI('audi', '000000'), abbr: 'Audi', color: '#000000' },
  포르쉐: { iconUrl: SI('porsche', 'D5001C'), abbr: 'PSC', color: '#D5001C' },
  푸조: { iconUrl: SI('peugeot', '1B232A'), abbr: 'Peu', color: '#1B232A' },
  시트로엥: { iconUrl: SI('citroen', 'A6021A'), abbr: 'Cit', color: '#A6021A' },
  '재규어 랜드로버': { iconUrl: SI('jaguar', '00529b'), abbr: 'JLR', color: '#00529b' },
  BYD: { iconUrl: WC('BYD_Auto_2022_logo.svg'), abbr: 'BYD', color: '#E2231A' },
  스즈키: { iconUrl: SI('suzuki', '12459C'), abbr: 'Suzuki', color: '#12459C' },
  페라리: { iconUrl: SI('ferrari', 'DC0000'), abbr: 'Ferrari', color: '#DC0000' },
  루시드: { iconUrl: null, abbr: 'Lucid', color: '#1c1c1c' },
  // '현대차/기아' 매핑 제거 — DB 정규화 v3에서 ['현대차','기아']로 분리되어 두 로고 표시
  볼보: { iconUrl: SI('volvo', '003057'), abbr: 'Volvo', color: '#003057' },
  다임러트럭: { iconUrl: null, abbr: 'DT', color: '#000000' },
  PACCAR: { iconUrl: null, abbr: 'PACCAR', color: '#1a1a1a' },
  Navistar: { iconUrl: null, abbr: 'Navi', color: '#0033a0' },
  에스케이온: { iconUrl: null, abbr: 'SK온', color: '#ee2737' },
  마쓰다: { iconUrl: SI('mazda', '101010'), abbr: 'Mazda', color: '#101010' },
  미쓰비시: { iconUrl: SI('mitsubishi', 'E60012'), abbr: 'Mits', color: '#E60012' },
  스바루: { iconUrl: SI('subaru', '004B85'), abbr: 'Subaru', color: '#004B85' },
  람보르기니: { iconUrl: SI('lamborghini', '000000'), abbr: 'Lambo', color: '#000000' },
  벤틀리: { iconUrl: SI('bentley', '333333'), abbr: 'Bent', color: '#333333' },
  // 중국 OEM — Wikimedia Commons SVG (Special:FilePath 영구 URL)
  지리: { iconUrl: WC('Geely_logo.svg'), abbr: 'Geely', color: '#0078C8' },
  창안: { iconUrl: WC('Changan_icon.svg'), abbr: 'Changan', color: '#1c1c1c' },
  그레이트월모터스: { iconUrl: WC('GWM_2025_logo.svg'), abbr: 'GWM', color: '#C8102E' },
  SAIC: { iconUrl: WC('SAIC_Motor.svg'), abbr: 'SAIC', color: '#E60012' },
  BAIC: { iconUrl: WC('BAIC_logo.png'), abbr: 'BAIC', color: '#0033A0' },
  체리: { iconUrl: WC('Chery_logo.svg'), abbr: 'Chery', color: '#E60012' },
  베이징현대: { iconUrl: SI('hyundai', '002c5f'), abbr: '베이징현대', color: '#002c5f' },
  리샹: { iconUrl: WC('Li_Auto_logo.svg'), abbr: 'Li', color: '#3a3a3a' },
  NIO: { iconUrl: WC('NIO_logo_emblem.svg'), abbr: 'NIO', color: '#000000' },
  XPeng: { iconUrl: WC('XPeng_logo.svg'), abbr: 'XPeng', color: '#0066cc' },
  JAC: { iconUrl: WC('JAC_logo_2011.svg'), abbr: 'JAC', color: '#003a70' },
  리프모터: { iconUrl: WC('Leapmotor_logo_en.svg'), abbr: 'Leap', color: '#EF1A2D' },
  세레스: { iconUrl: WC('AITO_logo.svg'), abbr: 'SERES', color: '#0E1E3A' },
  // 크라이슬러/Chevrolet/Lexus 등은 normalize_customer_name v4에서 통합되므로 별도 매핑 불필요

  // 추가 한글 표준명 (normalize v4에서 통합되는 브랜드들)
  동펑자동차: { iconUrl: WC('Dongfeng_Motor_logo.svg'), abbr: 'Dongfeng', color: '#005BAA' },
  광저우자동차: { iconUrl: WC('GAC_Family_logo.svg'), abbr: 'GAC', color: '#003E7E' },
  FAW: { iconUrl: '/logos/faw.webp', abbr: 'FAW', color: '#E60012' },
  화웨이: { iconUrl: WC('Huawei_wordmark.svg'), abbr: 'Huawei', color: '#FF0000' },
  샤오미: { iconUrl: SI('xiaomi', 'FF6900'), abbr: 'Xiaomi', color: '#FF6900' },
  마힌드라: { iconUrl: WC('Mahindra_logo.svg'), abbr: 'Mahindra', color: '#E2231A' },
  타타: { iconUrl: WC('Tata_Motors_Logo.svg'), abbr: 'Tata', color: '#486AAE' },
  이스즈: { iconUrl: WC('Isuzu.svg'), abbr: 'Isuzu', color: '#C20E1A' },
  히노: { iconUrl: WC('Hino_Motors_logo.svg'), abbr: 'Hino', color: '#E60012' },
  카마즈: { iconUrl: WC('Typeface_logo_of_KAMAZ.svg'), abbr: 'KAMAZ', color: '#0033A0' },
  아쇼크레이랜드: { iconUrl: null, abbr: 'Ashok', color: '#003F87' },
  시노트럭: { iconUrl: null, abbr: 'Sinotruk', color: '#E60012' },
  샨시중트럭: { iconUrl: null, abbr: 'Shaanxi', color: '#C8102E' },
  니콜라: { iconUrl: WC('Nikola_logo.svg'), abbr: 'Nikola', color: '#00B5E2' },
  스코다: { iconUrl: SI('skoda', '0E3A2F'), abbr: 'Skoda', color: '#0E3A2F' },
  // 추가 OEM (정규화 v3에서 등장)
  'Scout Motors': { iconUrl: null, abbr: 'Scout', color: '#1d3557' },
  'Jiyue Auto': { iconUrl: null, abbr: 'Jiyue', color: '#0066cc' },
  우링자동차: { iconUrl: WC('Wuling_Motors_logo.svg'), abbr: 'Wuling', color: '#005bac' },
  다이하쓰: { iconUrl: WC('Daihatsu_logo.svg'), abbr: 'Daihatsu', color: '#E60012' },
  에디슨모터스: { iconUrl: null, abbr: 'Edison', color: '#0a2240' },
  야마하: { iconUrl: SI('yamahamotorcorporation', '4169E1'), abbr: 'Yamaha', color: '#4169E1' },
  세아트: { iconUrl: SI('seat', 'C5A572'), abbr: 'SEAT', color: '#C5A572' },
  CUPRA: { iconUrl: '/logos/cupra.webp', abbr: 'CUPRA', color: '#A36F4F' },
  미쓰비시후소: { iconUrl: '/logos/fuso.svg', abbr: 'Fuso', color: '#E60012' },
  부가티: { iconUrl: WC('Bugatti_logo.svg'), abbr: 'Bugatti', color: '#082C58' },
  바자즈: { iconUrl: WC('Bajaj_Auto_Ltd_logo.svg'), abbr: 'Bajaj', color: '#003594' },
  히어로: { iconUrl: null, abbr: 'Hero', color: '#E2231A' },
  포톤: { iconUrl: null, abbr: 'Foton', color: '#E60012' },
  '르노-닛산': { iconUrl: SI('renault', 'efb700'), abbr: 'RN', color: '#c9a000' },
  볼보트럭: { iconUrl: SI('volvo', '003057'), abbr: 'VolvoT', color: '#003057' },
  MAN: { iconUrl: '/logos/man-truck.webp', abbr: 'MAN', color: '#e2231a' },
  스카니아: { iconUrl: '/logos/scania.svg', abbr: 'Scania', color: '#1c1f2a' },
  DAF: { iconUrl: null, abbr: 'DAF', color: '#0066b1' },
};
