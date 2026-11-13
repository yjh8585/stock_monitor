import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  firstWord,
  latestFetchedAt,
  narrowSupplier,
  rankSuppliers,
  type LinkRow,
  type RawSupplierRow,
} from './ranking';
import type { CompetitorRow, PartGroupRow, SupplierRow } from './types';

// 공개 레포 — 실제 경쟁사·품목 이름 대신 가짜 이름.
const comps: CompetitorRow[] = [
  { id: 1, product_id: 1, name: 'Globex', aliases: ['Globex'] },
  { id: 2, product_id: 1, name: 'Initech', aliases: ['Initech'] },
];
const groups: PartGroupRow[] = [
  {
    id: 10,
    product_id: 1,
    slug: 'g1',
    name_ko: '품목군1',
    display_order: 1,
    bom_parts: [],
    ml_part_names: ['Widget kit'],
    ml_processes: [],
    keywords: ['gizmo'],
  },
  {
    id: 11,
    product_id: 1,
    slug: 'g2',
    name_ko: '품목군2',
    display_order: 2,
    bom_parts: [],
    ml_part_names: [],
    ml_processes: ['Electroplating'],
    keywords: [],
  },
];
const base: SupplierRow = {
  id: 0,
  source: 'marklines',
  name: '',
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
const sup = (o: Partial<SupplierRow>): SupplierRow => ({ ...base, ...o });

describe('rankSuppliers', () => {
  const suppliers = [
    // 경쟁사 2곳 납품 + named → 30 + 30
    sup({
      id: 1,
      name: 'Acme Japan',
      region: '일본',
      delivers_supplier: ['Globex', 'Initech'],
      parts_comments: ['Brass gizmos'],
    }),
    // 본인(경쟁사 자신) — 빠져야 한다
    sup({ id: 2, name: 'Globex Widgets Thailand', parts_comments: ['gizmo'] }),
    // 동점(process 10) — 이름순: Hooli < Umbrella
    sup({ id: 3, name: 'Umbrella Plating', region: '유럽', processes: ['Electroplating'] }),
    sup({ id: 4, name: 'Hooli Metals', region: '유럽', processes: ['Electroplating'] }),
    // 계열 힌트(remarks) · 경쟁사 1곳
    sup({
      id: 5,
      name: 'Acme Korea',
      region: '한국',
      delivers_supplier: ['Initech'],
      remarks: ['Affiliate of Globex'],
    }),
  ];
  const links: LinkRow[] = [
    { supplier_id: 1, part_group_id: 11, competitor_id: 1 },
    { supplier_id: 1, part_group_id: 10, competitor_id: 1 },
    { supplier_id: 1, part_group_id: 10, competitor_id: 2 },
    { supplier_id: 2, part_group_id: 10, competitor_id: null },
    { supplier_id: 3, part_group_id: 11, competitor_id: null },
    { supplier_id: 4, part_group_id: 11, competitor_id: null },
    { supplier_id: 5, part_group_id: 10, competitor_id: 2 },
  ];
  const { rows, regionCounts } = rankSuppliers(suppliers, links, groups, comps);

  it('본인을 빼고 총점 내림차순 · 동점은 이름순', () => {
    expect(rows.map((r) => r.supplier.id)).toEqual([1, 5, 4, 3]);
    expect(rows.map((r) => r.score.total)).toEqual([60, 15, 10, 10]);
  });

  it('경쟁사·계열 이름과 품목군 id(중복 없이 오름차순)를 붙인다', () => {
    expect(rows[0].competitorNames).toEqual(['Globex', 'Initech']);
    expect(rows[0].groupIds).toEqual([10, 11]);
    expect(rows[1].competitorNames).toEqual(['Initech']);
    expect(rows[1].affiliateNames).toEqual(['Globex']);
  });

  it('regionCounts 는 본인을 뺀 뒤 기준이고 9탭 중 「전체」를 뺀 8지역이 다 있다', () => {
    expect(regionCounts).toEqual({
      한국: 1,
      중국: 0,
      일본: 1,
      북미: 0,
      인도: 0,
      동남아: 0, // 본인(동남아)은 빠졌다
      유럽: 2,
      기타: 0,
    });
  });

  it('supplier 칸은 화면에 필요한 8개만 싣는다(payload)', () => {
    expect(Object.keys(rows[0].supplier).sort()).toEqual(
      [
        'certifications',
        'country',
        'employees',
        'id',
        'name',
        'region',
        'sales_text',
        'source',
      ].sort()
    );
  });

  it('행이 없으면 빈 배열과 0 으로 찬 지역 수', () => {
    const empty = rankSuppliers([], [], groups, comps);
    expect(empty.rows).toEqual([]);
    expect(Object.values(empty.regionCounts).every((n) => n === 0)).toBe(true);
  });
});

describe('narrowSupplier', () => {
  const raw = (o: Partial<RawSupplierRow>): RawSupplierRow => ({ ...base, ...o });
  it('아는 source·region 은 그대로 통과', () => {
    expect(narrowSupplier(raw({ source: 'web', region: '북미' }))?.region).toBe('북미');
  });
  it('모르는 source 나 region 이면 null', () => {
    expect(narrowSupplier(raw({ source: 'scraped' }))).toBeNull();
    expect(narrowSupplier(raw({ region: '남미' }))).toBeNull();
  });
});

describe('latestFetchedAt', () => {
  it('가장 늦은 시각의 원문 문자열 · 시간대 표기가 달라도 시각으로 비교', () => {
    expect(
      latestFetchedAt([
        { fetched_at: '2026-11-13T09:00:00+09:00' }, // = 00:00Z
        { fetched_at: '2026-11-13T01:00:00+00:00' },
        { fetched_at: '2026-11-12T23:00:00Z' },
      ])
    ).toBe('2026-11-13T01:00:00+00:00');
  });
  it('행이 없으면 null', () => {
    expect(latestFetchedAt([])).toBeNull();
  });
});

describe('firstWord · escapeLike', () => {
  it('첫 단어 — 쉼표·마침표를 떼고 3자 미만이면 null', () => {
    expect(firstWord('  Acme, Inc.')).toBe('Acme');
    expect(firstWord('AB Widgets')).toBeNull();
    expect(firstWord('')).toBeNull();
  });
  it('LIKE 와일드카드와 백슬래시를 글자로 이스케이프', () => {
    expect(escapeLike('Ac%me_\\x')).toBe('Ac\\%me\\_\\\\x');
    expect(escapeLike('Acme')).toBe('Acme');
  });
});
