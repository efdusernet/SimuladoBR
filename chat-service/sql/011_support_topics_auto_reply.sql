-- Add auto-reply text for support topics (shown as Suporte in the widget)

ALTER TABLE support_topics
  ADD COLUMN IF NOT EXISTS auto_reply_text TEXT NULL;
