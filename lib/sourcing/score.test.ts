import { describe, expect, it } from 'vitest';
import {
  affiliateHint,
  certPoints,
  competitorHits,
  isCompetitorSelf,
  matchesAlias,
  matchLevel,
  scoreSupplier,
  sizePoints,
} from './score';
import type { CompetitorRow, PartGroupRow, SupplierRow } from './types';

// 공개 레포 — 실제 경쟁사·품목 이름 대신 가짜 이름.
const comps: CompetitorRow[] = [
  { id: 1, product_id: 1, name: 'Globex', aliases: ['Globex'] },
  { id: 2, product_id: 1, name: 'Initech', aliases: ['Initech'] },
  { id: 3, product_id: 1, name: 'Umbrella', aliases: ['Umbrella'] },
  { id: 4, product_id: 1, name: 'Hooli', aliases: ['Hooli'] },
];
const group: PartGroupRow = {
  id: 10,
  product_id: 1,
  slug: 'g',
  name_ko: '품목군',
  display_order: 1,
  bom_parts: [],
  ml_part_names: ['Widget kit'],
  ml_processes: ['Electroplating'],
  keywords: ['gizmo'],
};
const base: SupplierRow = {
  id: 7,
  source: 'marklines',
  name: 'Acme Widgets',
  country: 'Thailand',
  region: '동남아',
  address: null,
  homepage: null,
  established: null,
  sales_text: null,
  employees: null,
  certifications: [],
  product_categories: [],
  processes: [],
  parts_comments: [],
  delivers_oem: [],
  delivers_supplier: [],
  remarks: [],
  source_url: null,
  fetched_at: '2026-11-13T00:00:00Z',
};

describe('matchesAlias', () => {
  it('단어 경계로 대소문자 무시', () => {
    expect(matchesAlias('Globex Widgets Thailand', 'globex')).toBe(true);
    expect(matchesAlias('Globexx Ltd', 'Globex')).toBe(false);
  });
  it('복수형은 잡고 다른 단어로 이어지면 안 잡는다', () => {
    expect(matchesAlias('Brass gizmos', 'gizmo')).toBe(true);
    expect(matchesAlias('Gizmoway', 'gizmo')).toBe(false);
  });
});

describe('competitorHits', () => {
  it('서로 다른 경쟁사만 센다(같은 경쟁사 법인 둘은 1곳)', () => {
    const s = { ...base, delivers_supplier: ['Globex', 'Globex Widgets Japan', 'Initech'] };
    expect(competitorHits(s, comps)).toEqual([1, 2]);
  });
});

describe('matchLevel', () => {
  it('품목 설명에 키워드 → named', () => {
    expect(matchLevel({ ...base, parts_comments: ['Brass gizmos'] }, group)).toBe('named');
  });
  it('분류 일치 → category', () => {
    expect(matchLevel({ ...base, product_categories: ['Widget kit'] }, group)).toBe('category');
  });
  it('공정만 → process', () => {
    expect(matchLevel({ ...base, processes: ['Electroplating'] }, group)).toBe('process');
  });
  it('없으면 none', () => {
    expect(matchLevel(base, group)).toBe('none');
  });
});

describe('certPoints · sizePoints', () => {
  it('IATF 10 · TS16949 10 · ISO9001 만 5 · 없음 0', () => {
    expect(certPoints(['IATF16949', 'ISO9001'])).toBe(10);
    expect(certPoints(['ISO/TS16949'])).toBe(10);
    expect(certPoints(['ISO9001'])).toBe(5);
    expect(certPoints(['ISO14001'])).toBe(0);
  });
  it('종업원 구간', () => {
    expect(sizePoints(null)).toBe(0);
    expect(sizePoints(40)).toBe(0);
    expect(sizePoints(50)).toBe(3);
    expect(sizePoints(300)).toBe(6);
    expect(sizePoints(1000)).toBe(10);
    expect(sizePoints(5000)).toBe(15);
  });
});

describe('본인·계열', () => {
  it('이름에 별칭 → 본인', () => {
    expect(isCompetitorSelf({ ...base, name: 'Globex Widgets Thailand' }, comps)).toBe(true);
    expect(isCompetitorSelf(base, comps)).toBe(false);
  });
  it('비고에 별칭 → 계열 가능성', () => {
    expect(affiliateHint({ ...base, remarks: ['-Initech Holding company'] }, comps)).toEqual([2]);
  });
});

describe('scoreSupplier', () => {
  it('경쟁사 4곳은 45 상한 · 최고 일치 단계 하나만', () => {
    const s: SupplierRow = {
      ...base,
      delivers_supplier: ['Globex', 'Initech', 'Umbrella', 'Hooli'],
      parts_comments: ['gizmo'],
      processes: ['Electroplating'],
      certifications: ['IATF16949'],
      employees: 1200,
    };
    const r = scoreSupplier(s, [group], comps);
    expect(r.competitorPoints).toBe(45);
    expect(r.bestLevel).toBe('named');
    expect(r.matchPoints).toBe(30);
    expect(r.total).toBe(45 + 30 + 10 + 10);
    expect(r.groupLevels[10]).toBe('named');
  });
});
