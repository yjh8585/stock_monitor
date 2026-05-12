-- 동일 ticker(source) + 동일 날짜 중복 적재 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_macro_outlook_source_date
  ON macro_outlook_notes (source, note_date);
