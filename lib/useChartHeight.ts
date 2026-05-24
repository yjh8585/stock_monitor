'use client';

import { useSyncExternalStore } from 'react';

/**
 * 화면 폭 외부 store — 모든 차트 컴포넌트가 공유.
 *
 * 컴포넌트가 N개여도 window.resize 리스너는 **단일**이며
 * cachedWidth가 갱신될 때만 subscribers 일괄 통지한다.
 * (기존 useState+useEffect 패턴은 차트마다 리스너+setState를 별도로 만들어
 *  N=8 일 때 resize 한 번에 8회 setState 발생.)
 */

const DEFAULT_LG_WIDTH = 1280;

let cachedWidth: number = typeof window === 'undefined' ? DEFAULT_LG_WIDTH : window.innerWidth;
const subscribers = new Set<() => void>();
let listenerAttached = false;

function ensureListener(): void {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('resize', () => {
    const next = window.innerWidth;
    if (next === cachedWidth) return;
    cachedWidth = next;
    for (const cb of subscribers) cb();
  });
}

function subscribe(cb: () => void): () => void {
  ensureListener();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): number {
  return cachedWidth;
}

function getServerSnapshot(): number {
  return DEFAULT_LG_WIDTH;
}

/** 화면 폭에 따라 차트 높이를 반환하는 훅 (sm < 640px, md < 1024px, lg 이상) */
export function useChartHeight(sm: number, md: number, lg: number): number {
  const w = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return w < 640 ? sm : w < 1024 ? md : lg;
}
