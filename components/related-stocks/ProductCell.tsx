import { memo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ProductItem } from '@/lib/types';

interface ProductCellProps {
  products: (ProductItem | string)[];
  expanded: boolean;
  onToggle: () => void;
}

/** string 또는 {name} 객체 둘 다 처리 — DB는 normalize 후 string array */
const itemName = (item: ProductItem | string): string =>
  typeof item === 'string' ? item : item.name;

/** 제품 셀: 주요 제품 목록 + ▼ 펼침 버튼 */
const ProductCell = memo(function ProductCell({ products, expanded, onToggle }: ProductCellProps) {
  const label = (products ?? []).map(itemName).filter(Boolean).join(', ');

  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="flex-1 truncate min-w-0" title={label}>
        {label || '—'}
      </span>
      <button
        onClick={onToggle}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title={expanded ? '닫기' : '회사 설명 보기'}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
    </div>
  );
});

export default ProductCell;
