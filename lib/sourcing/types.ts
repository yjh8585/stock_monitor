export const REGIONS = ['한국', '중국', '일본', '북미', '인도', '동남아', '유럽', '기타'] as const;
export type Region = (typeof REGIONS)[number];
export type MatchLevel = 'named' | 'category' | 'process' | 'none';

export interface PartGroupRow {
  id: number;
  product_id: number;
  slug: string;
  name_ko: string;
  display_order: number;
  bom_parts: string[];
  ml_part_names: string[];
  ml_processes: string[];
  keywords: string[];
}
export interface CompetitorRow {
  id: number;
  product_id: number;
  name: string;
  aliases: string[];
}
export interface SupplierRow {
  id: number;
  source: 'marklines' | 'web';
  name: string;
  country: string | null;
  region: Region;
  address: string | null;
  homepage: string | null;
  established: string | null;
  sales_text: string | null;
  employees: number | null;
  certifications: string[];
  product_categories: string[];
  processes: string[];
  parts_comments: string[];
  delivers_oem: string[];
  delivers_supplier: string[];
  remarks: string[];
  source_url: string | null;
  fetched_at: string;
}
export interface ScoreBreakdown {
  competitorIds: number[];
  competitorPoints: number;
  groupLevels: Record<number, MatchLevel>; // part_group_id → 단계
  bestLevel: MatchLevel;
  matchPoints: number;
  certPoints: number;
  sizePoints: number;
  total: number;
}
