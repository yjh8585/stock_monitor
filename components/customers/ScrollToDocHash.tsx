'use client';

import { useEffect } from 'react';
import { docHashId } from '@/lib/customers/format';

/**
 * 주소의 #doc-<id> 카드로 한 번 스크롤한다(요약 표 「최근 중요 문서」 링크의 도착점).
 *
 * 왜 필요한가(2026-11-12 실측): 상세에는 loading.tsx 가 있어 이동하는 순간 화면에 올라온 것은 「불러오는 중」 대체 화면이다.
 * Next 의 해시 스크롤(한 번의 scrollIntoView)은 그때 돌아 카드를 못 찾고, 카드는 그 뒤 스트리밍으로 도착해 아무도 다시
 * 스크롤하지 않는다(주소 직접 입력도 같다 — 브라우저의 첫 해시 스크롤 때 요소가 아직 없다). 카드와 함께 마운트되는
 * 이 부품이 그 자리를 메운다. 「더 보기」(<details>) 안에 접힌 카드면 먼저 편다.
 */
export default function ScrollToDocHash() {
  useEffect(() => {
    const id = docHashId(window.location.hash);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    const details = el.closest('details');
    if (details) details.open = true;
    el.scrollIntoView({ block: 'start' });
  }, []);
  return null;
}
