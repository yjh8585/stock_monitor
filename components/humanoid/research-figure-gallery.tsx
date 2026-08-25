'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ResearchFigure } from '@/lib/humanoid/research';

interface Props {
  figures: ResearchFigure[];
}

/**
 * 본문에 실리지 않은 나머지 그림 — 접어 두고 원할 때 편다.
 *
 * 왜 접어 두는가: 정리본에는 논지에 필요한 2~5장만 싣는다(요약 지시문 규칙). 그래도
 * 원문에서 뽑아 둔 나머지 차트가 궁금할 수 있어 남긴다. 펼친 상태로 두면 본문보다
 * 그림이 길어져 정리본을 읽는 흐름이 끊긴다.
 *
 * 🔴 기본 접힘이라 이미지는 펼치기 전까지 내려받지 않는다(`loading="lazy"` 와 별개로
 *    DOM 자체가 없다) — 리포트당 10장 넘게 붙는 경우가 있어 그냥 두면 무겁다.
 */
export function ResearchFigureGallery({ figures }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-border border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        원문의 다른 차트·도표 {figures.length}장
      </button>

      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {figures.map((f) => (
            <figure key={f.url} className="space-y-1">
              {/* next/image 를 쓰지 않는다 — 크기가 제각각이고 최적화 대상이 아니다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.url}
                alt={f.caption || `${f.page}쪽 그림`}
                loading="lazy"
                className="border-border w-full rounded border bg-white"
              />
              <figcaption className="text-muted-foreground text-xs">
                {f.page}쪽{f.caption ? ` · ${f.caption}` : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
