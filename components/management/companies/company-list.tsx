'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
import { COMPANY_TYPES, COUNTRIES, DATA_SOURCES } from '@/lib/companies/schemas';
import type { CompanyListItem } from '@/lib/companies/source';

interface Props {
  companies: CompanyListItem[];
}

const SELECT_CLASS = cn(
  'border-input bg-background placeholder:text-muted-foreground',
  'flex h-8 rounded-md border px-2 text-xs shadow-xs',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
);

/** 회사 마스터 목록 — client filtering. ~558개 행을 useMemo로 가볍게 필터링. */
export function CompanyList({ companies }: Props) {
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');
  const [companyType, setCompanyType] = useState<string>('');
  const { highlighted, rowToggleProps } = useRowHighlight();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (country && c.country !== country) return false;
      if (dataSource && c.data_source !== dataSource) return false;
      if (companyType && c.company_type !== companyType) return false;
      if (!term) return true;
      const haystack = `${c.ticker} ${c.name ?? ''} ${c.name_kr ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [companies, search, country, dataSource, companyType]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="ticker · 이름 검색"
          className="h-8 max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={SELECT_CLASS}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="">국가 전체</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={dataSource}
          onChange={(e) => setDataSource(e.target.value)}
        >
          <option value="">data_source 전체</option>
          {DATA_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={companyType}
          onChange={(e) => setCompanyType(e.target.value)}
        >
          <option value="">company_type 전체</option>
          {COMPANY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">
          {filtered.length} / {companies.length}
        </span>
      </div>

      <div className="border-border overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">ticker</th>
              <th className="px-2 py-1.5 text-left font-medium">한국어명</th>
              <th className="px-2 py-1.5 text-left font-medium">영문명</th>
              <th className="px-2 py-1.5 text-left font-medium">국가</th>
              <th className="px-2 py-1.5 text-left font-medium">market</th>
              <th className="px-2 py-1.5 text-left font-medium">data_source</th>
              <th className="px-2 py-1.5 text-left font-medium">type</th>
              <th className="px-2 py-1.5 text-left font-medium">group</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className={cn(
                  'border-border cursor-pointer border-t',
                  highlighted.has(c.id) ? ROW_HIGHLIGHT_CLASS : 'hover:bg-muted/30'
                )}
                {...rowToggleProps(c.id, c.name_kr ?? c.ticker)}
              >
                <td className="px-2 py-1 font-mono">{c.ticker}</td>
                <td className="px-2 py-1">{c.name_kr}</td>
                <td className="text-muted-foreground px-2 py-1">{c.name}</td>
                <td className="px-2 py-1">{c.country}</td>
                <td className="px-2 py-1">{c.market ?? '—'}</td>
                <td className="px-2 py-1">{c.data_source}</td>
                <td className="px-2 py-1">{c.company_type ?? '—'}</td>
                <td className="text-muted-foreground px-2 py-1">{c.group_name ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-2 py-4 text-center">
                  결과 없음
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
