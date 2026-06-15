# S4 Agent Studio — Product Requirements Document

## Product direction

S4 Agent Studio is one unified local-first application. The earlier separate Phase 2A, 2B, 2C, and 2D development sections are removed.

The complete application includes:

- Developer Agent chat workspace
- Natural-language project creation
- Natural-language specialist-agent creation
- Local project isolation
- Controlled file tools
- Controlled command execution
- Git checkpoints and rollback
- Approval inbox
- OpenAI-compatible adviser reviews
- Deterministic Guardian policy enforcement
- Sandboxed execution
- Web research gateway
- Model provider routing
- Task history
- Artifacts
- Audit logs
- Budget controls
- Tauri desktop packaging

## Core principle

The user describes the required result. Agents plan and work. The adviser reviews. The Guardian enforces policy. The user remains the final authority.

## Primary routes

- `/workspace`
- `/workspace/projects`
- `/workspace/agents`
- `/workspace/tasks`
- `/workspace/approvals`
- `/workspace/artifacts`
- `/workspace/research`
- `/workspace/providers`
- `/workspace/usage`
- `/workspace/audit`
- `/workspace/settings`

## Complete application acceptance criteria

The application is complete when the user can:

1. Install and open S4 Agent Studio locally.
2. Create or open a local project.
3. Chat with the Developer Agent.
4. Ask it to create websites, apps, APIs, tools, and specialist agents.
5. Review a structured implementation plan.
6. Approve or reject sensitive actions.
7. See file diffs before changes are applied.
8. Create Git checkpoints automatically.
9. Run controlled tests, builds, and migrations.
10. Access approved websites for research.
11. Review adviser recommendations.
12. Enforce hard policies through the Guardian.
13. Pause, stop, retry, or roll back tasks.
14. View artifacts and audit history.
15. Prevent agents from bypassing approvals or project boundaries.
