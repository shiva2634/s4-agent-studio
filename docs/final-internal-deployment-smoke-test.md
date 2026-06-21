# Final Internal Deployment Smoke Test

This smoke test verifies that the internal-only deployment readiness surface is wired correctly before any real deployment step is considered.

## What It Verifies

- Required root and workspace npm scripts exist.
- TypeScript, test, and DB init commands are available.
- Database init path handling stays local-first and safe by default.
- Internal auth routes exist.
- Protected Business Control Centre routes exist.
- Protected App Studio routes exist.
- Deployment hardening status route exists.
- `.env.example` contains required config names and keeps secret values empty or placeholder-only.
- Internal deployment docs exist.
- The smoke test itself does not execute deployment, rollback, or infrastructure actions.

## What It Does Not Do

- It does not deploy.
- It does not call cloud providers.
- It does not mutate infrastructure, DNS, storage, email, backups, or environments.
- It does not validate live production credentials.
- It does not replace the existing approval gates.

## Required Commands

- `npm run typecheck`
- `npm test`
- `npm run test -w @s4/db`
- `npm run test -w @s4/api`
- `npm run internal:smoke`

## Manual Operator Checklist

- Confirm the locked flow has reached Deployment Approval Screen and Cloud Deployment Config + Environment Hardening.
- Confirm Business Control Centre and App Studio remain internal-only.
- Confirm no customer-facing route exposes Business Control Centre or App Studio pages.
- Confirm auth, CORS, cookies, RBAC, and internal route protection remain unchanged.
- Confirm `.env` secrets are managed outside source control.
- Confirm rollback steps and ownership are documented before any real deployment activity.
- Confirm a human approver still signs off before any deployment execution step.

## Pass/Fail Criteria

- Pass: all required commands succeed and `npm run internal:smoke` exits successfully.
- Fail: any required command fails, protected routes are missing, required config names are missing, or unsafe secret placeholders are detected.

## Rollback Reminder

If a later deployment step fails, use the approved rollback plan and existing Git/database recovery procedures. This smoke test does not perform rollback for you.

## Approval Note

Passing the smoke test does not authorize deployment. Real deployment still requires explicit manual approval.
