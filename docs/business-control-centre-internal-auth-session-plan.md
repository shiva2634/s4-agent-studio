# Business Control Centre Internal Auth/Session Foundation Plan

## 1. Purpose

This document plans the internal authentication and session foundation for the Shrinika Technologies Business Control Centre before any real middleware, API routes, login screens, or database changes are implemented.

The Business Control Centre UI is currently an internal, static operations dashboard. Step 13 added the first database identity and access foundation. Step 14 defines the safe auth/session design needed before Step 15 can implement real internal access control.

This is a planning document only.

## 2. Current Foundation Summary

Step 13 added the base identity/access tables using the existing SQLite and `better-sqlite3` pattern:

- `business_users`: base user identity table for internal users and future external client users.
- `internal_user_profiles`: internal-only Business Control Centre and App Studio staff profile details.
- `business_roles`: seeded role catalog.
- `business_permissions`: seeded module/action permission catalog.
- `business_role_permissions`: role-to-permission mappings.
- `business_user_roles`: user-to-role mappings with revocation support.
- `denied_access_events`: lightweight precursor table for denied access auditing.

Seeded internal users:

- Shrinika is seeded as the Main Admin / Owner Admin with the `main_admin_owner` role.
- Shiva is seeded as Founder-builder / System Guardian with the `system_guardian` role and `internal_user_profiles.is_system_guardian = 1`.

External isolation foundation:

- `EXTERNAL_CLIENT` users are separated by `business_users.user_type`.
- The `external_client_user` role is seeded separately.
- External client users receive only the `client_portal.view` placeholder permission.
- External users must not receive internal roles or Business Control Centre/App Studio permissions.

Current API state:

- The API has existing route groups, including App Studio, audit, approvals, chat, bootstrap, and media routes.
- There is no real internal auth/session middleware yet.
- Auth rollout must be staged so existing App Studio and Media Studio behavior and tests are not broken.

## 3. Auth Goals

The auth foundation must enforce these goals:

- Business Control Centre is internal-only.
- App Studio is internal-only.
- Customers must never access Business Control Centre or App Studio.
- Future Client Portal access must be separate from internal access.
- All auth and permission checks must be deny-by-default.
- Security must rely on server-side session and permission checks, not frontend-only route hiding.
- Denied access attempts must be recorded.
- Suspended, archived, missing, or external users must not access internal apps.
- Internal APIs must reject customer/client identities even if a customer has future Client Portal access.

## 4. Recommended MVP Auth Model

The recommended MVP is local internal login with email and password hash.

Reasoning:

- It works for a local-first product without requiring email provider setup.
- It avoids adding OAuth complexity before RBAC and audit enforcement are ready.
- It avoids magic-link dependency on real email delivery.
- It can be implemented with strong password hashing, session cookies, and local audit events.

Magic-link login should remain a future option after email provider, rate limiting, and audit persistence are approved.

MVP flow:

1. Internal user visits `/business-control-centre`, `/admin`, or `/app-studio`.
2. Server checks for a valid internal session cookie.
3. If missing or invalid, the user is directed to an internal login screen.
4. User submits email and password.
5. API validates input and finds an active `INTERNAL` user.
6. API verifies the password hash.
7. API creates a server-side session row.
8. API sets an httpOnly session cookie.
9. Protected routes and APIs read the session server-side.
10. Permission middleware checks the requested module/action.
11. Logout revokes the session and clears the cookie.

Required behavior:

- Login succeeds only for active internal users.
- `EXTERNAL_CLIENT` users cannot log into internal apps.
- Suspended or archived users are blocked.
- Revoked roles stop granting permissions immediately.
- Expired sessions are rejected.
- Denied attempts are recorded in `denied_access_events` now and full `audit_events` later.
- OAuth is out of scope until explicitly approved.

## 5. Proposed Auth/Session Tables For Future Implementation

These tables are proposed for a future implementation step. They must not be added in Step 14.

### business_auth_credentials

Purpose:

- Stores internal login credentials for users who are allowed to authenticate with local password auth.

Key fields:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `credential_type TEXT NOT NULL`
- `password_hash TEXT NULL`
- `password_hash_version TEXT NOT NULL`
- `force_password_change INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `revoked_at TEXT NULL`

Relationships:

- `user_id` references `business_users.id`.
- Only active internal users should receive active password credentials for internal apps.

Indexes:

- Unique active credential by `user_id` and `credential_type`.
- Index on `user_id`.

Data sensitivity:

- Critical. Store only password hashes. Never store plain passwords.

Retention:

- Revoke credentials by setting `revoked_at`; do not delete immediately unless retention rules later require cleanup.

Rollback notes:

- Additive table. Rollback should disable use of the table before dropping in non-production only.

### business_auth_sessions

Purpose:

- Stores server-side internal sessions.

Key fields:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `session_token_hash TEXT NOT NULL`
- `csrf_token_hash TEXT NULL`
- `status TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `last_seen_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `absolute_expires_at TEXT NOT NULL`
- `revoked_at TEXT NULL`
- `user_agent_hash TEXT NULL`
- `ip_hash TEXT NULL`
- `metadata_json TEXT NULL`

Relationships:

- `user_id` references `business_users.id`.

Indexes:

- Unique index on `session_token_hash`.
- Index on `user_id`, `status`, and `expires_at`.
- Index on `revoked_at` for active session lookup.

Data sensitivity:

- Critical. Store only token hashes, never raw session tokens.

Retention:

- Keep short-term session history for security review, then purge by retention policy.

Rollback notes:

- Additive table. Existing UI remains static until middleware uses it.

### business_login_events

Purpose:

- Records login attempts and outcomes.

Key fields:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NULL`
- `email_normalized TEXT NULL`
- `user_type TEXT NULL`
- `result TEXT NOT NULL`
- `reason TEXT NOT NULL`
- `ip_hash TEXT NULL`
- `user_agent_hash TEXT NULL`
- `session_id TEXT NULL`
- `created_at TEXT NOT NULL`
- `metadata_json TEXT NULL`

Relationships:

- `user_id` optionally references `business_users.id`.
- `session_id` optionally references `business_auth_sessions.id`.

Indexes:

- Index on `email_normalized` and `created_at`.
- Index on `user_id` and `created_at`.
- Index on `result` and `created_at`.

Data sensitivity:

- Sensitive. Do not store passwords, tokens, API keys, or raw secrets in metadata.

Retention:

- Keep long enough for security review and rate-limit investigation.

Rollback notes:

- Additive table. Can remain unused if auth implementation is delayed.

### password_reset_tokens

Purpose:

- Placeholder for future password reset and recovery flows.

Key fields:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `token_hash TEXT NOT NULL`
- `status TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `used_at TEXT NULL`
- `created_at TEXT NOT NULL`
- `requested_by_user_id TEXT NULL`
- `approved_by_user_id TEXT NULL`

Relationships:

- `user_id` references `business_users.id`.
- `requested_by_user_id` and `approved_by_user_id` optionally reference `business_users.id`.

Indexes:

- Unique index on `token_hash`.
- Index on `user_id`, `status`, and `expires_at`.

Data sensitivity:

- Critical. Store only token hashes.

Retention:

- Short retention. Expired and used reset tokens should be purged after audit-safe retention.

Rollback notes:

- Additive placeholder. Owner/admin recovery must not be enabled until approval rules are implemented.

### auth_security_events

Purpose:

- Placeholder for richer auth security events beyond basic denied access.

Key fields:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NULL`
- `event_type TEXT NOT NULL`
- `severity TEXT NOT NULL`
- `reason TEXT NOT NULL`
- `route_or_action TEXT NULL`
- `ip_hash TEXT NULL`
- `user_agent_hash TEXT NULL`
- `created_at TEXT NOT NULL`
- `metadata_json TEXT NULL`

Relationships:

- `user_id` optionally references `business_users.id`.

Indexes:

- Index on `event_type` and `created_at`.
- Index on `user_id` and `created_at`.
- Index on `severity` and `created_at`.

Data sensitivity:

- Sensitive. Metadata must be redacted and minimal.

Retention:

- Retain according to security audit policy.

Rollback notes:

- Additive placeholder. Can be introduced after `denied_access_events` is proven.

## 6. Route Protection Plan

### `/business-control-centre`

- Requires active internal business session.
- Requires `INTERNAL` user type.
- Requires at minimum `company.view` or another approved Business Control Centre module permission.
- Deny external client sessions.
- Record denied access for missing, expired, suspended, archived, or external identities.

### `/admin`

- Preserve as alias for Business Control Centre.
- Apply the same guard as `/business-control-centre`.

### `/app-studio`

- Requires active internal business session.
- Requires `INTERNAL` user type.
- Requires `app_studio.view`.
- Deny customer/client identities.

### Future `/api/business-control/*`

- Requires active internal business session.
- Requires route-specific permission checks.
- Must not trust frontend navigation state.
- Must reject `EXTERNAL_CLIENT` users before module permission checks.

### Future `/api/app-studio/*`

- Requires active internal business session.
- Requires `app_studio.view` for read access and more specific permissions for write, approval, or execution actions.
- Agent, deployment, file, and provider-related actions must require additional approval gates later.

### Future `/client-portal`

- Must use a separate client auth model.
- Must not reuse internal route guards.
- Must not grant Business Control Centre, App Studio, HRMS, Finance Admin, Agent Operations, Audit/Compliance, or Deployment/Cloud Operations permissions.

## 7. Permission Middleware Plan

Future implementation should keep routes thin and put auth logic in shared services/helpers.

### requireBusinessSession

- Reads the session cookie.
- Hashes the raw token and looks up an active session.
- Rejects missing, expired, revoked, or unknown sessions.
- Updates `last_seen_at` only after validation.
- Returns the current session context.

### requireInternalUser

- Loads the session user from `business_users`.
- Requires `user_type = INTERNAL`.
- Rejects suspended, archived, missing, or external users.
- Records denied access for blocked attempts.

### requireBusinessPermission

- Accepts a permission key such as `projects.assign` or `app_studio.view`.
- Uses `userHasBusinessPermission`.
- Rejects unknown permissions.
- Rejects external users for internal-only permissions.
- Records denied access when permission is missing.

### requireBusinessRole

- Checks for specific active role assignment where needed.
- Should be used sparingly; permissions are preferred for most checks.
- Useful for owner/admin recovery, deployment authority, or break-glass flows later.

### recordDeniedInternalAccess

- Writes to `denied_access_events`.
- Captures attempted module/action and reason.
- Stores sanitized metadata only.
- Never stores passwords, tokens, API keys, cookies, headers, or secrets.

### getCurrentBusinessUser

- Returns the current authenticated business user context.
- Should include normalized fields only: id, display name, user type, status, role keys, and permission keys as needed.

### getCurrentBusinessSession

- Returns current session metadata needed by route handlers.
- Must not expose raw session tokens.

## 8. Session Security Plan

Session requirements:

- Use httpOnly cookies for session tokens.
- Use secure cookies in production.
- Use SameSite `Lax` for normal internal navigation unless stricter behavior is confirmed safe; prefer `Strict` where workflows allow.
- Store only hashed session tokens in the database.
- Rotate session tokens after login and high-risk changes.
- Support inactivity timeout.
- Support absolute session expiry.
- Store user-agent and IP metadata only as hashed or privacy-safe placeholders.
- Logout must revoke the server-side session and clear the cookie.
- Suspended or archived users must have sessions rejected.
- Role revocation must affect permission checks immediately.
- No cookies, tokens, passwords, API keys, or secrets may be written to logs.

CSRF planning:

- For cookie-authenticated unsafe methods, add CSRF protection before enabling write APIs.
- Consider synchronizer token or double-submit cookie pattern.
- Store only CSRF token hashes where server-side storage is used.
- Read-only GET requests must still require a valid session for internal resources.

## 9. Password/Security Plan

If password auth is implemented:

- Store only password hashes.
- Use a strong password hashing library such as Argon2id or bcrypt with approved cost settings.
- Never store plain passwords.
- Never log submitted passwords.
- Validate password length and complexity according to internal policy.
- Rate limit login attempts by email and IP/session metadata.
- Record failed login attempts in `business_login_events`.
- Add lockout or escalation policy for repeated failures.
- Store only hashed password reset tokens.
- Owner/admin recovery must require extra approval or documented recovery safeguards.
- Seed/test credentials must not use real personal secrets.

## 10. Denied Access And Audit Plan

Use `denied_access_events` in the near term. Move sensitive actions to full immutable `audit_events` once that table is implemented.

Denied access should be recorded for:

- Unauthenticated access to internal routes.
- Customer/client attempts to access internal routes.
- Missing permission.
- Suspended or archived user access.
- Revoked role access.
- Expired session.
- Unknown or tampered session.
- Suspicious repeated attempts.

Required event fields:

- `user_id` when known.
- `user_type` when known.
- `attempted_module`.
- `attempted_action`.
- `reason`.
- `created_at`.
- Sanitized `metadata_json`.

Never include secrets, raw cookies, auth headers, password input, API keys, or full request bodies.

## 11. Internal/Customer Separation

Internal and client access must remain separate:

- Internal auth is for `INTERNAL` users only.
- Client auth is a future separate model for `EXTERNAL_CLIENT` users.
- `external_client_user` cannot access Business Control Centre or App Studio.
- `client_portal.*` permissions cannot grant access to internal modules.
- Internal APIs must reject `EXTERNAL_CLIENT` users before permission checks.
- Client records are company-managed business records, not internal admin accounts.
- Customer website, email, support, payment pages, and the future Client Portal are the only customer-facing surfaces.

## 12. Implementation Phases

### Phase 14A: Planning document only

- Create this plan.
- Do not modify schema, APIs, middleware, or UI.

### Phase 14B: Auth/session DB tables

- Add `business_auth_credentials`, `business_auth_sessions`, and `business_login_events`.
- Add password reset and auth security placeholder tables only if approved.
- Add idempotent migrations/tests.

### Phase 14C: Auth helper functions

- Add credential verification helpers.
- Add session creation, lookup, rotation, expiry, and revocation helpers.
- Add login event helpers.

### Phase 14D: API login/logout/current-user endpoints

- Add internal login endpoint.
- Add logout endpoint.
- Add current business user endpoint.
- Validate all input.

### Phase 14E: Route/API middleware

- Add session and permission guards.
- Apply them first to internal-only API route groups.
- Preserve existing route behavior until migration is intentionally enabled.

### Phase 14F: Frontend login screen/internal gate

- Add an internal login screen.
- Gate Business Control Centre, `/admin`, and App Studio.
- Keep customer-facing routes separate.

### Phase 14G: Denied access audit integration

- Record denied route/API attempts.
- Ensure metadata redaction.
- Add tests for blocked customer/internal boundary cases.

### Phase 14H: Tests and security review

- Add unit and integration tests.
- Run typecheck and all relevant tests.
- Review for secrets, route bypasses, and customer/internal separation before production use.

## 13. Test Plan

Future implementation tests should cover:

- Login succeeds only for an active internal user.
- External client user cannot log into internal app.
- Suspended user is blocked.
- Archived user is blocked.
- Missing user is blocked.
- Session expiry blocks access.
- Logout revokes session.
- Revoked sessions are rejected.
- Permission middleware blocks missing permission.
- Revoked role assignment removes access.
- Denied access event is recorded for internal route failures.
- Denied access metadata does not include secrets.
- `/business-control-centre` and `/admin` use the same internal guard.
- `/app-studio` requires `app_studio.view`.
- Future Client Portal auth does not grant internal access.
- Route protection does not break Media Studio tests.

## 14. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Customer accidentally accesses internal systems | Separate `INTERNAL` and `EXTERNAL_CLIENT` user types; reject external users before permission checks. |
| Weak session storage | Store only hashed tokens; use httpOnly cookies; expire and revoke sessions server-side. |
| Missing permission checks | Add route/API middleware and deny-by-default helpers. |
| Owner lockout | Require documented owner/admin recovery flow before production auth is enforced. |
| Test fixture secrets | Use placeholder local emails and non-secret test passwords only. |
| Auth bypass in API | Enforce permissions server-side on APIs, not only in frontend routing. |
| UI route protection without API protection | Gate APIs first or at the same time as UI route guards. |
| Breaking App Studio or Media Studio flows | Stage rollout, preserve existing tests, and explicitly test unaffected Media Studio routes. |
| Sensitive data in denied access metadata | Redact metadata and never log headers, cookies, tokens, passwords, or secrets. |

## 15. Acceptance Criteria For Future Implementation

Before Step 15 code implementation starts:

- This plan is reviewed and accepted.
- MVP auth model is approved.
- Password hashing library choice is approved.
- Session table shape is approved.
- Cookie and CSRF strategy is approved.
- Internal/customer separation rules are approved.
- Route protection plan for `/business-control-centre`, `/admin`, and `/app-studio` is approved.
- API middleware names and responsibilities are approved.
- Denied access logging behavior is approved.
- Owner/admin recovery policy is defined or explicitly deferred with safeguards.
- Test plan is accepted.
- Media Studio preservation requirements are confirmed.

## 16. Out Of Scope

This step does not include:

- Code changes.
- Database schema changes.
- Login implementation.
- API routes.
- Middleware.
- UI changes.
- OAuth.
- Production deployment.
- Real customer portal authentication.
- Real email integration.
- Production secrets.
- Media Studio changes.
