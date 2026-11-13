/**
 * 협력사 후보 점수 — 결정 8(2026-11-13). 지역은 점수에 넣지 않는다(결정 5 — 탭으로만).
 * 저장하지 않고 조회 때마다 계산한다(결정 9 — 배점을 바꿔도 재수집 불필요).
 */
import type { CompetitorRow, MatchLevel, PartGroupRow, ScoreBreakdown, SupplierRow } from './types';

export const SCORE_WEIGHTS = {
  perCompetitor: 15,
  competitorCap: 45,
  match: { named: 30, category: 20, process: 10, none: 0 } satisfies Record<MatchLevel, number>,
  cert: { iatf: 10, iso9001: 5 },
  // SHORTCUT: 종업원 구간은 초안 — 1단계 화면에서 실측 분포를 보고 조정(결정 8).
  size: [
    { min: 5000, points: 15 },
    { min: 1000, points: 10 },
    { min: 300, points: 6 },
    { min: 50, points: 3 },
  ],
} as const;

const LEVEL_ORDER: MatchLevel[] = ['named', 'category', 'process', 'none'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 영문 별칭·키워드 전용 — 단어 경계로 대소문자 무시(부분 문자열 오탐 방지).
 * 끝에 복수 어미(s·es)를 허용한다 — 품목 설명은 「Brass gizmos」처럼 복수로 적힌다.
 */
export function matchesAlias(text: string, alias: string): boolean {
  if (!alias.trim()) return false;
  return new RegExp(`\\b${escapeRegExp(alias.trim())}(?:e?s)?\\b`, 'i').test(text);
}

const anyMatch = (texts: string[], words: string[]) =>
  texts.some((t) => words.some((w) => matchesAlias(t, w)));

export function competitorHits(s: SupplierRow, comps: CompetitorRow[]): number[] {
  return comps.filter((c) => anyMatch(s.delivers_supplier, c.aliases)).map((c) => c.id);
}

export function matchLevel(s: SupplierRow, g: PartGroupRow): MatchLevel {
  if (anyMatch(s.parts_comments, g.keywords)) return 'named';
  const cats = new Set(s.product_categories.map((x) => x.toLowerCase()));
  if (g.ml_part_names.some((p) => cats.has(p.toLowerCase()))) return 'category';
  const procs = new Set(s.processes.map((x) => x.toLowerCase()));
  if (g.ml_processes.some((p) => procs.has(p.toLowerCase()))) return 'process';
  return 'none';
}

export function certPoints(certs: string[]): number {
  const up = certs.map((c) => c.toUpperCase().replace(/\s+/g, ''));
  if (up.some((c) => c.includes('IATF16949') || c.includes('TS16949')))
    return SCORE_WEIGHTS.cert.iatf;
  if (up.some((c) => c.includes('ISO9001'))) return SCORE_WEIGHTS.cert.iso9001;
  return 0;
}

export function sizePoints(employees: number | null): number {
  if (employees == null) return 0;
  return SCORE_WEIGHTS.size.find((b) => employees >= b.min)?.points ?? 0;
}

export function isCompetitorSelf(s: SupplierRow, comps: CompetitorRow[]): boolean {
  return comps.some((c) => c.aliases.some((a) => matchesAlias(s.name, a)));
}

export function affiliateHint(s: SupplierRow, comps: CompetitorRow[]): number[] {
  return comps.filter((c) => anyMatch(s.remarks, c.aliases)).map((c) => c.id);
}

export function scoreSupplier(
  s: SupplierRow,
  groups: PartGroupRow[],
  comps: CompetitorRow[]
): ScoreBreakdown {
  const competitorIds = competitorHits(s, comps);
  const competitorPoints = Math.min(
    SCORE_WEIGHTS.competitorCap,
    competitorIds.length * SCORE_WEIGHTS.perCompetitor
  );
  const groupLevels: Record<number, MatchLevel> = {};
  for (const g of groups) groupLevels[g.id] = matchLevel(s, g);
  const bestLevel = LEVEL_ORDER.find((l) => Object.values(groupLevels).includes(l)) ?? 'none';
  const matchPoints = SCORE_WEIGHTS.match[bestLevel];
  const cert = certPoints(s.certifications);
  const size = sizePoints(s.employees);
  return {
    competitorIds,
    competitorPoints,
    groupLevels,
    bestLevel,
    matchPoints,
    certPoints: cert,
    sizePoints: size,
    total: competitorPoints + matchPoints + cert + size,
  };
}
