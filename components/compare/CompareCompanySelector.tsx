'use client';

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { CompareCompany } from '@/lib/compareMetrics';

interface Props {
  candidates: readonly CompareCompany[];
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
}

const NONE = '__none__';

/** 비교 대상 회사 슬롯 2개. 같은 회사 중복 선택 차단. */
export default function CompareCompanySelector({ candidates, selectedIds, onChange }: Props) {
  const slot1 = selectedIds[0] ?? NONE;
  const slot2 = selectedIds[1] ?? NONE;

  const setSlot = (index: 0 | 1, value: string) => {
    const next = [...selectedIds];
    if (value === NONE) {
      next.splice(index, 1);
    } else {
      next[index] = value;
    }
    onChange(next.filter((v): v is string => !!v).slice(0, 2));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">비교 대상</span>
      <Slot
        value={slot1}
        excludeId={slot2}
        candidates={candidates}
        onChange={(v) => setSlot(0, v)}
      />
      <Slot
        value={slot2}
        excludeId={slot1}
        candidates={candidates}
        onChange={(v) => setSlot(1, v)}
      />
    </div>
  );
}

interface SlotProps {
  value: string;
  excludeId: string;
  candidates: readonly CompareCompany[];
  onChange: (v: string) => void;
}

function Slot({ value, excludeId, candidates, onChange }: SlotProps) {
  const displayName =
    value === NONE ? '(선택 안 함)' : (candidates.find((c) => c.id === value)?.name_kr ?? '선택');
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? NONE)}>
      <SelectTrigger size="sm" className="min-w-36">
        <SelectValue placeholder="선택">{displayName}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>(선택 안 함)</SelectItem>
        {candidates.map((c) => (
          <SelectItem key={c.id} value={c.id} disabled={c.id === excludeId}>
            {c.name_kr}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
