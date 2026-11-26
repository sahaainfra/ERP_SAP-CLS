-- Code review fix (iam, FR-04): a solved CAPTCHA is accepted once. Each accepted token's hash is kept until the token expires, so the same
-- token and answer cannot be sent with every sign-in guess for the five minutes it is valid. A technical table: no company, no audit columns.
CREATE TABLE IF NOT EXISTS iam_captcha_uses (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_iam_captcha_uses_expires ON iam_captcha_uses (expires_at);
