# Secret Leakage Gate

Scan every file in the diff for secrets, credentials, and tokens that should
never appear in source code. Report each as CRITICAL — secrets in code are
always blocking.

## Patterns to detect

| Category | Examples |
|----------|----------|
| API keys | `sk_live_`, `pk_live_`, `AKIA`, `AIza`, `ghp_`, `gho_`, `glpat-` |
| Tokens | `Bearer <base64>`, `token: "..."`, JWT literals (`eyJ`) |
| Passwords | `password = "`, `secret = "`, `passwd`, `DB_PASSWORD` in a non-env file |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----` |
| Connection strings | `postgres://user:pass@`, `mongodb+srv://`, `redis://` with inline credentials |
| Cloud credentials | AWS access key + secret, GCP service account JSON, Azure connection strings |

## Exclusions (do NOT flag)

- Placeholder / example values: `sk_test_`, `your-api-key-here`, `<REDACTED>`
- Environment variable references: `process.env.API_KEY`, `${SECRET}`
- Test fixtures with obviously fake values (e.g. `"test-token-123"`)
- Hash digests (SHA-256, MD5) — these are not secrets

## Severity

- Real secret in code → CRITICAL (always blocking)
- Suspicious but ambiguous (e.g. a 40-char hex string with no context) → WARNING