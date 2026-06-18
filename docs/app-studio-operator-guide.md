# App Studio Operator Guide

This guide is for operating App Studio safely. It focuses on what Shiva should inspect, approve, reject, retry, recover, or leave blocked.

## Operating principles

- Shiva remains the final authority for approvals, policy escalation, scaffold application, file mutation, Git merge, and high-risk retries.
- The Developer Agent coordinates task work. Specialist agents can plan, inspect, report findings, and produce proposals through the governed pipeline.
- Proposals are not file changes. Files change only after proposal validation, human approval, apply, checks, rollback readiness, and audit recording.
- Security Review Agent and Final Review Agent are read-only. They should produce findings, not mutations.
- App Studio must not expose raw secrets in UI, API payloads, logs, audit events, task history, provider errors, or check output.
- Media Studio is separate. Do not use App Studio operations as an implicit Media Studio redesign path.

## Start App Studio

```powershell
npm run db:init
npm run dev
```

Open `http://localhost:5173`.

Use `npm run typecheck` and `npm test` before trusting a changed build.

## Header controls

The App Studio header shows:

- App Studio title
- selected project and project status
- API status
- theme selector
- mode selector

The theme selector is browser-local. It stores the selected theme in `localStorage` under `app-studio-theme` and applies it immediately.

## Left sidebar

Use the left sidebar for compact project and agent administration:

- Register project: adds an existing local folder as a governed project.
- Project list: switches the active project.
- Project management: pause, resume, archive, or de-register a project record.
- Agents: shows Developer Agent and registered specialists.
- Specialist registry: shows specialist roles, capabilities, and allowed tools.
- Provider: shows configured provider status and lets you test the provider connection.

Register existing project is different from create project. Registration points App Studio at an existing folder. Scaffolding creates proposals for a new governed workspace or module.

## Main workspace

The center workspace is the normal operating area:

- Developer Agent chat: describe the outcome you want.
- Current task: read status, risk, attempts, correction rounds, and next action.
- Execution and checks: run approved package-script checks, recover interrupted execution, or roll back task-owned changes.
- Change proposals: inspect file path, operation, owner, risk, conflict state, reason, diff, and approval controls.
- Coordinator plan: read decomposition and next action.
- Specialist assignments: pause, resume, retry, cancel, or reassign specialists.
- Scaffold plan: inspect generated scaffold steps and proposal files when a task is scaffold-backed.
- Task history: review rounds, approvals, executions, recovery, and proposal counts.
- Pending approvals: approve or reject human-gated actions.
- Recent tasks and audit events: confirm continuity and traceability.

## Right operations panel

The right panel is tabbed to keep long controls out of the sidebar.

### Sandbox

Use Sandbox Policy to review the selected project's current permission profile and recent permission decisions.

Profiles:

- Locked-down: highly restrictive, best for review-only situations.
- Standard governed: default profile for new projects.
- Advanced development: broader capability; requires approval.
- Emergency recovery: recovery-focused elevated mode; requires approval.

Changing to advanced development or emergency recovery must be treated as a high-risk action. Agents must not change their own permissions.

### Git

Use Git Workflow for repository status and governed task isolation.

Check before starting:

- branch
- HEAD commit
- dirty state
- untracked file count
- redacted remote URL
- active task workflow mode

Use branch or worktree mode when a task should not directly risk the main project state. Merge remains blocked until checks pass, conflicts are resolved, approvals are complete, and human merge approval is granted.

Do not force push. Do not push to remote. Do not delete untracked user files. Cleanup must only remove App Studio-recorded worktrees.

### Readiness

Use Self-Build Readiness before allowing App Studio to plan remaining platform modules.

The decision is:

- READY: all gates pass.
- READY_WITH_WARNINGS: no blocking failures, but warnings exist.
- NOT_READY: at least one blocking gate failed.

Blocking readiness failures should stop Build Mission execution. Review the recommended fix for each failed gate before trying again.

### Missions

Build Missions are planning-only drafts for future modules such as Social Studio, CRM, Cloud Studio, Finance and Billing Studio, Business Control Centre, and Client Portal.

A mission draft should include:

- target module
- scope
- risk
- specialist plan
- scaffold needs
- Git mode
- acceptance criteria
- rollback plan

Request approval before conversion. Conversion should create a governed task/scaffold/Git workflow plan, not direct code changes.

### Scaffold

Use Scaffold to create proposal-backed project or module scaffolds.

Supported template families include:

- Next.js web app
- Node/Fastify API
- Full-stack app with web and API
- Static landing page
- Internal tool/admin app
- Empty governed project

Scaffolding must not write files before approval. Generated files should appear as proposals, then move through approval, apply, checks, rollback, recovery, and audit.

## Task workflow

1. Select or register a project.
2. Describe the task in Developer Agent chat.
3. Read the current task summary and coordinator plan.
4. Inspect specialist assignments if the task was decomposed.
5. Review generated proposals and ownership.
6. Resolve same-file conflicts before applying.
7. Approve or reject proposals.
8. Apply approved changes only when governance permits.
9. Run checks.
10. Use rollback or recovery if needed.
11. Review task history and audit events.

## Approval workflow

Approvals may be required for:

- task execution
- scaffold proposal application
- high-risk specialist retry or reassignment
- permission profile changes
- Git merge
- Build Mission conversion
- database changes
- high-risk test weakening or deletion

Reject when a proposal is unclear, unsafe, secret-bearing, outside the project root, unrelated to the task, or missing rollback guidance for high-risk work.

## Proposal review checklist

Before approving a proposal, verify:

- file path is inside the active project or approved scaffold target
- operation matches the task
- owner is visible
- same-file conflicts are absent or reviewed
- no `.env`, private key, token, credential, SSH key, `node_modules`, or Git internals mutation is included
- tests are not weakened, skipped, deleted, or disabled without explicit high-risk approval
- database proposals include rollback guidance
- DevOps proposals do not access secrets or `.env`
- human approval is fresh for the current proposal round

## Checks, rollback, and recovery

Run checks after applying approved changes. Checks should use approved package scripts from `package.json`, such as typecheck, test, or build.

Rollback should only touch task-owned applied files. Recovery should only resume or repair interrupted App Studio workflow state. If rollback or recovery reports a blocker, inspect audit events and task history before retrying.

## Project lifecycle

- Active: available for governed work.
- Paused: blocked for new governed work.
- Archived: hidden from active work but history is retained.
- De-registered: removed from App Studio's active project list without deleting files.

Paused, archived, and de-registered projects should remain blocked for agent actions.

## Safety controls

App Studio should block:

- path traversal and external paths
- `.env` and secret files
- private keys, tokens, credentials, and SSH keys
- OS or user home sensitive folders
- `node_modules` mutation
- Git internals mutation
- destructive deletes by default
- arbitrary shell commands
- unapproved network calls
- provider calls without configured provider policy

Network access is default-deny for agents and checks unless policy allows it. Provider API calls must go through configured provider adapters.

## Troubleshooting

Use this sequence when something looks wrong:

1. Confirm the selected project is active.
2. Check Sandbox Policy for the latest denied action.
3. Check Current task for next required action.
4. Check Change proposals for conflicts or missing approvals.
5. Check Git Workflow for dirty state, blocked release candidate, or failed checks.
6. Check Execution and checks for recovery availability.
7. Check Audit events for the last allowed or denied decision.
8. Re-run readiness only when testing self-build readiness, not as a general repair button.

Do not manually edit external registered projects to fix App Studio workflow state. Use proposals, rollback, recovery, or explicit human-managed repository operations outside App Studio.
