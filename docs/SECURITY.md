# Security Guidelines for SvalMap
## API Security
- Require `X-API-Key` for all requests except `/healthz`.
- Validate all inputs with Zod; clamp spatial queries to AOI.
- Return 401 Unauthorized for missing or invalid API key.

## Map & Web Security
- Use MapLibre with tiles loaded from a URL stored in environment variables.
- Content Security Policy (CSP) must allow only:
  - Self (`'self'`)
  - The API origin
  - The tile provider origin
- No inline scripts except where unavoidable for Next.js.

## Data Privacy
- Do not expose raw vessel positions in the UI or API.
- Firestore stores only summarized incident documents, not raw AIS.

## Secrets Management
- All sensitive values (BarentsWatch tokens, API keys, Firebase credentials) are stored in GCP Secret Manager.
- Never commit secrets to the repo or paste them into Cursor chat.
- Use `gcloud secrets versions access` or the Secret Manager SDK to fetch them at runtime.

## Infrastructure
- Use Cloud Run for API, Web, and background jobs.
- Lock down Cloud Run services with IAM when not public.
- Use HTTPS for all endpoints.
- Log access and errors to Cloud Logging with anonymized vessel IDs if needed.
