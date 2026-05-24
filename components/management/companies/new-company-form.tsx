'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  COMPANY_TYPES,
  COUNTRIES,
  CURRENCIES,
  DATA_SOURCES,
  createCompanyInputSchema,
} from '@/lib/companies/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type CompanyTypeOption = (typeof COMPANY_TYPES)[number];

const SELECT_CLASS = cn(
  'border-input bg-background file:text-foreground placeholder:text-muted-foreground',
  'flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
);

/**
 * 신규 회사 INSERT 폼.
 *  - 트리거 후처리: page 매핑, customers/products 정규화, company_type DEFAULT.
 *  - INSERT 성공 시 onboard_company.py 실행 안내 표시.
 */
export function NewCompanyForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [nameKr, setNameKr] = useState('');
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>('KR');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('KRW');
  const [dataSource, setDataSource] = useState<(typeof DATA_SOURCES)[number]>('fnguide');
  const [market, setMarket] = useState('');
  const [companyType, setCompanyType] = useState<CompanyTypeOption>('부품사');
  const [region, setRegion] = useState('');
  const [groupName, setGroupName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const payload = {
      ticker: ticker.trim(),
      name: name.trim(),
      name_kr: nameKr.trim(),
      country,
      currency,
      data_source: dataSource,
      market: market.trim() || null,
      company_type: companyType,
      region: region.trim() || undefined,
      group_name: groupName.trim() || undefined,
      status: 'active' as const,
    };

    const parsed = createCompanyInputSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '입력값 확인 필요');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '회사 등록 실패');
        return;
      }
      toast.success(
        `${json.data.name_kr} 추가됨. 이제 터미널에서: python scripts/onboard_company.py --ticker ${json.data.ticker}`,
        { duration: 12000 }
      );
      // 폼 리셋 — 연속 추가 편의
      setTicker('');
      setName('');
      setNameKr('');
      setMarket('');
      setRegion('');
      setGroupName('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류 발생');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ticker">
            ticker <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="005380 또는 비상장 식별자"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="market">market (비상장은 비워둠)</Label>
          <Input
            id="market"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="kospi, nasdaq, ..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">
            영문명 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hyundai Mobis"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name_kr">
            한국어명 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name_kr"
            value={nameKr}
            onChange={(e) => setNameKr(e.target.value)}
            placeholder="현대모비스"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="country">
            country <span className="text-destructive">*</span>
          </Label>
          <select
            id="country"
            className={SELECT_CLASS}
            value={country}
            onChange={(e) => setCountry(e.target.value as (typeof COUNTRIES)[number])}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">
            currency <span className="text-destructive">*</span>
          </Label>
          <select
            id="currency"
            className={SELECT_CLASS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="data_source">
            data_source <span className="text-destructive">*</span>
          </Label>
          <select
            id="data_source"
            className={SELECT_CLASS}
            value={dataSource}
            onChange={(e) => setDataSource(e.target.value as (typeof DATA_SOURCES)[number])}
          >
            {DATA_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="company_type">company_type</Label>
          <select
            id="company_type"
            className={SELECT_CLASS}
            value={companyType}
            onChange={(e) => setCompanyType(e.target.value as CompanyTypeOption)}
          >
            {COMPANY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region">region</Label>
          <Input
            id="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Asia / North America"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group_name">group_name</Label>
          <Input
            id="group_name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="현대차 / Toyota"
          />
        </div>
      </div>

      <div className="border-t border-border pt-4 text-xs text-muted-foreground space-y-1">
        <p>
          <strong>data_source → page 자동 매핑</strong> (트리거):
          yfinance·marklines → parts-top100 / fnguide·dart·pykrx+dart → domestic. 그 외 매핑 없음.
        </p>
        <p>products·customers·homepage_url은 추가 후 onboard_company.py가 자동 보강.</p>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? '추가 중…' : '회사 추가'}
      </Button>
    </form>
  );
}
