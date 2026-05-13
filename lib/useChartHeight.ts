'use client';
import { useEffect, useState } from 'react';

/** 화면 폭에 따라 차트 높이를 반환하는 훅 (sm < 640px, md < 1024px, lg 이상) */
export function useChartHeight(sm: number, md: number, lg: number): number {
  const [h, setH] = useState(lg); // SSR hydration: lg 기본값
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setH(w < 640 ? sm : w < 1024 ? md : lg);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [sm, md, lg]);
  return h;
}
