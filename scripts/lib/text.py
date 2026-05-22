"""텍스트 정리 유틸. LLM 응답에서 자주 발견되는 잡음을 제거한다."""
import re

_TAG_RE = re.compile(r'<[^>]+>')
_WS_RE = re.compile(r'[ \t]+')

# LLM이 정보 부족·차단·접근 실패 시 생성하는 거부 응답 패턴.
# 이 중 하나라도 매치되면 description으로 저장할 가치 없음 → NULL 처리 권장.
_REJECTION_PATTERNS = (
  '죄송하지만', '죄송합니다', '확인할 수 없',
  '접근할 수 없', '응답하지 않', '제공된 자료',
  '검증된 정보 없', '검증된 구체적 정보', '검색 결과 없',
  '정보가 부족', '정보 부족', '유효한 홈페이지',
  '제공된 공개 자료',
  'I cannot', 'I am unable', "I'm sorry",
  'data not available', 'no information',
  '[정보 없음]', '[no data]', 'TODO', 'TBD', 'placeholder',
)


def strip_citation_tags(text: str | None) -> str | None:
  """Anthropic web_search 등이 본문에 자동 삽입하는 <cite index="...">…</cite>
  같은 HTML/XML 인용 태그를 제거하고 연속 공백을 정리한다.
  빈 값/None은 그대로 반환.
  """
  if not text:
    return text
  cleaned = _TAG_RE.sub('', text)
  cleaned = _WS_RE.sub(' ', cleaned).strip()
  return cleaned


def is_rejection_response(text: str | None) -> bool:
  """LLM이 정보 부족·접근 실패 시 만들어내는 거부 응답인지 판정.

  description으로 저장하기 전 quality gate 용도. 매치되면 폐기(NULL)하는 것이
  실패 메시지를 그대로 박아 넣는 것보다 정직하다.
  """
  if not text:
    return False
  lower = text.lower()
  for pat in _REJECTION_PATTERNS:
    if pat.lower() in lower:
      return True
  return False
