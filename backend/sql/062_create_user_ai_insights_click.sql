-- 062_create_user_ai_insights_click.sql
-- Tracks clicks on InsightsIA "Atualizar" that resulted in Gemini-generated output (Gemini · gemini-2.5-flash).

CREATE TABLE IF NOT EXISTS public.user_ai_insights_click (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.usuario("Id") ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NULL,
  used_llm BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_ai_insights_click_user_created_at
  ON public.user_ai_insights_click (user_id, created_at DESC);

-- Fast path for quota checks (count by user for a specific provider/model)
CREATE INDEX IF NOT EXISTS idx_user_ai_insights_click_gemini_25_flash
  ON public.user_ai_insights_click (user_id, created_at DESC)
  WHERE provider = 'gemini' AND model = 'gemini-2.5-flash' AND used_llm = true;
