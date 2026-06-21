# Internal Deployment Hardening

Business Control Centre and App Studio are internal-only. Deployment approval screens and hardening checks must not execute deployments, call cloud providers, expose secrets, or create customer access.

## Required Production Config Names

Set these names in production without committing values:

- `S4_DB_PATH`
- `S4_WEB_ORIGINS`
- `S4_INTERNAL_APP_ORIGIN`
- `S4_API_PUBLIC_ORIGIN`
- `S4_BACKUP_LOCATION`
- `S4_LOG_RETENTION_DAYS`

The hardening API reports missing names only. It must never return environment values, cookies, API keys, password hashes, session tokens, or provider secrets.

## Release Checklist

- Confirm `NODE_ENV=production` so internal session cookies use the `Secure` flag.
- Configure `S4_WEB_ORIGINS` as an explicit allowlist. Do not use wildcards.
- Keep Business Control Centre and App Studio APIs behind internal auth/session and RBAC guards.
- Keep customer routes separate from internal Business Control Centre and App Studio routes.
- Confirm baseline security headers are returned by the API.
- Confirm production DB path points to the approved database location.
- Confirm backups are configured and restore steps are documented.
- Confirm rollback steps are documented before any production deployment.
- Confirm monitoring, logging, and retention expectations are documented.
- Run smoke tests against internal login, current-user, protected Business Control Centre APIs, and App Studio internal APIs.
- Verify deployment approval is a record-only gate until a separate deployment execution step is approved.

## Out of Scope

- No real deployment execution.
- No cloud provider calls.
- No DNS, domain, email, storage, or infrastructure mutation.
- No secret storage in source control.
- No customer access to internal systems.
