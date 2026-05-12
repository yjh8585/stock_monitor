'use client';

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { StockCompany } from '@/lib/types';

interface Props {
  companies: readonly StockCompany[];
  primary: string;
  secondary: string;
  onPrimaryChange: (v: string) => void;
  onSecondaryChange: (v: string) => void;
}

/** 듀얼 Y축 차트용 회사 선택기 — 우축/좌축 각각 한 종목, 같은 종목 중복 선택 차단. */
export default function StockPairSelector({
  companies,
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SelectRow
        label="좌축"
        value={primary}
        excludeId={secondary}
        companies={companies}
        onChange={onPrimaryChange}
      />
      <SelectRow
        label="우축"
        value={secondary}
        excludeId={primary}
        companies={companies}
        onChange={onSecondaryChange}
      />
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  excludeId: string;
  companies: readonly StockCompany[];
  onChange: (v: string) => void;
}

function SelectRow({ label, value, excludeId, companies, onChange }: RowProps) {
  const displayName = companies.find((c) => c.id === value)?.name_kr ?? '종목 선택';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
        <SelectTrigger size="sm" className="min-w-32">
          <SelectValue placeholder="종목 선택">{displayName}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id} disabled={c.id === excludeId}>
              {c.name_kr}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
