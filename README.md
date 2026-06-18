# S4 Agent Studio

Parent brand: Shrinika Automation Studio

S4 Agent Studio is a local-first conversational agent workspace. App Studio lets Shiva register or create governed project workspaces, plan work with the Developer Agent, review proposals before mutation, run approved checks, recover interrupted work, and keep a visible audit trail.

## Current App Studio capabilities

- Local project registration, pause, resume, archive, and de-registration
- Developer Agent chat with governed task rounds and correction rounds
- Specialist-agent orchestration coordinated by the Developer Agent
- Proposal review with ownership, conflicts, approval, rejection, diff preview, and apply controls
- Scaffold jobs for governed project creation and module additions
- Sandbox, permission, secrets, command, provider, and network policy visibility
- Governed Git branch, worktree, release-candidate, merge approval, rollback, cleanup, and recovery controls
- Self-build readiness gates and planning-only Build Mission drafts
- Execution checkpoints, package-script checks, rollback, recovery, task history, and audit events
- App Studio theme selector persisted locally in the browser

Media Studio remains a separate module at `/media-studio`. App Studio does not expose a Media Studio navigation button in its header.

## Setup

```powershell
cd C:\path\to\s4-agent-studio
Copy-Item .env.example .env
npm install
npm run db:init
npm run dev
```

Open App Studio at `http://localhost:5173`.

The local API runs at `http://127.0.0.1:4310`.

## Operator guide

Read [docs/app-studio-operator-guide.md](docs/app-studio-operator-guide.md) before using App Studio for governed project work. It covers:

- Registering and managing projects
- Choosing permission profiles and reading blocked-action messages
- Reviewing plans, proposals, approvals, checks, rollback, and recovery
- Using scaffold jobs, Git workflows, readiness validation, and Build Missions
- Operational safety rules for secrets, network access, `.env`, Git, and project boundaries

## Safety model

App Studio is designed around human final authority:

- Agents may plan and propose work, but they do not approve their own work.
- File mutations must flow through proposal validation, approval, apply, checks, rollback, recovery, and audit.
- Project roots, workspace roots, worktree roots, secrets, `.env` files, and network usage are governed by policy.
- High-risk work requires fresh human approval.
- Git merge and permission escalation require human approval.

## Useful commands

```powershell
npm run typecheck
npm test
npm run build
```

## Repository layout

- `apps/api` - local Fastify API and App Studio services
- `apps/web` - React UI for App Studio and Media Studio
- `packages/db` - SQLite schema, migrations, and seed data
- `packages/shared` - shared validation schemas and types
- `docs` - operator-facing documentation
