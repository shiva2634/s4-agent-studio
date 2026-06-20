# Business Control Centre Backend/Auth/RBAC Planning PRD

## 1. Purpose

The Shrinika Technologies Business Control Centre is now ready as a static, internal-only admin dashboard. Steps 1 through 10 established the UI shell, project assignment workflow, company dashboard, client/support placeholders, finance placeholders, HRMS placeholders, agent governance, audit/compliance, system/cloud operations, and final UI polish.

Step 11 is planning only. It defines the safe backend, authentication, RBAC, database, API, audit, and approval workflow foundation required before any real data wiring begins.

No backend code, database migration, auth change, UI change, Media Studio change, provider call, deployment action, customer portal logic, payment logic, HR workflow, or support workflow is implemented in this step.

## 2. Internal-Only Access Model

Hard access rules:

- Business Control Centre is internal-only.
- App Studio is internal-only.
- Customers must never access Business Control Centre, App Studio, HRMS, Agent Operations, Audit/Compliance, Finance Admin, or Deployment/Cloud Operations.
- Customers will later use only the customer website, customer email, support channels, payment pages, and a separate future Client Portal.
- The future Client Portal must be a separate product surface with separate routes, separate permissions, separate API exposure, and separate data access policies.
- Internal route access must be denied by default until authentication and RBAC explicitly allow the request.
- Frontend hiding is not security. All internal access rules must be enforced by server-side middleware and service-layer permission checks.

## 3. Identity And Roles

### Internal roles

| Role | Identity / Purpose | Planning scope |
| --- | --- | --- |
| Main Admin / Owner Admin | Shrinika | Full owner authority, final override, role administration, production approval authority. |
| Founder-builder / System Guardian | Shiva | Internal operator, technical guardian, system safety reviewer, emergency support under owner governance. |
| Company Admin | Company-level operator | Administers company settings, departments, internal workspaces, and non-owner governance operations. |
| Manager | Project owner | Owns project delivery, project assignment approval, manager final approval, escalation handling. |
| Team Leader | Delivery coordinator | Coordinates developers, project stage handoffs, and team delivery status. |
| Frontend Developer | UI implementer | Views assigned project context and frontend tasks only. |
| Backend Developer | API/service implementer | Views assigned project context and backend tasks only. |
| Testing / QA Developer | Validation owner | Views assigned project context, test status, QA findings, and release validation queue. |
| Final Production Readiness Developer | Release readiness owner | Performs final readiness checks before manager/deployment approval. |
| HR Manager | People operations owner | Handles HRMS, onboarding, leave placeholders, access-change requests, and HR approvals. |
| Finance Admin | Commercial operations owner | Handles quotations, agreements, invoices, payment tracking, refunds, and finance approvals. |
| Support Manager | Support desk owner | Handles support tickets, support assignment, escalations, and customer update coordination. |
| Agent Supervisor | Agent operations owner | Supervises agent registry, task queue, approvals, incidents, and safe execution boundaries. |
| Auditor | Audit/compliance reviewer | Reviews audit logs, sensitive actions, denied attempts, policy warnings, and compliance evidence. |
| Cloud / Deployment Operator | Release/cloud operator | Handles deployment records, release preparation, cloud/provider placeholders, backup/recovery, and incident operations under approval. |

### External role

| Role | Boundary |
| --- | --- |
| Customer / Client user | Separate external role only. May later access the customer website, support/payment surfaces, and future Client Portal. Must not receive Business Control Centre or App Studio access. |

## 4. Permission Matrix

Permission meanings:

- View: read module records.
- Create: create new records.
- Update: edit existing records.
- Approve: approve controlled actions.
- Reject: reject controlled actions.
- Assign: assign ownership or work.
- Export: export records or reports.
- Configure: change module settings.
- Deploy: execute or record deployment action.
- Audit: review audit evidence.
- Admin override: owner/admin emergency override with audit logging.

Legend: Owner = Shrinika; Guardian = Shiva; Admin = Company Admin; Mgr = Manager; TL = Team Leader; FE/BE/QA/PR = delivery roles; HR = HR Manager; Fin = Finance Admin; Sup = Support Manager; Agent = Agent Supervisor; Audit = Auditor; Cloud = Cloud / Deployment Operator; Cust = Customer / Client user.

| Module | View | Create | Update | Approve | Reject | Assign | Export | Configure | Deploy | Audit | Admin override |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company Dashboard | Owner, Guardian, Admin, Mgr, Audit | Admin | Admin | Owner, Admin | Owner, Admin | Admin | Owner, Admin, Audit | Owner, Admin | None | Owner, Audit | Owner |
| Project Operations | Owner, Guardian, Admin, Mgr, TL, FE/BE/QA/PR, Audit | Admin, Mgr | Admin, Mgr, TL | Owner, Admin, Mgr | Owner, Admin, Mgr | Admin, Mgr, TL | Owner, Admin, Mgr, Audit | Owner, Admin | None | Owner, Audit | Owner |
| Project Assignment Control | Owner, Guardian, Admin, Mgr, TL, Audit | Admin, Mgr | Admin, Mgr | Owner, Admin, Mgr | Owner, Admin, Mgr | Admin, Mgr, TL | Owner, Admin, Audit | Owner, Admin | None | Owner, Audit | Owner |
| Client Management | Owner, Admin, Mgr, Sup, Fin, Audit | Admin, Mgr, Sup | Admin, Mgr, Sup | Owner, Admin, Mgr | Owner, Admin, Mgr | Admin, Mgr, Sup | Owner, Admin, Sup, Audit | Owner, Admin | None | Owner, Audit | Owner |
| Support Desk | Owner, Admin, Mgr, Sup, TL, Audit | Sup, Admin | Sup, Admin, Mgr | Sup, Mgr, Admin | Sup, Mgr, Admin | Sup, Mgr | Owner, Admin, Sup, Audit | Owner, Admin, Sup | None | Owner, Audit | Owner |
| Finance & Billing | Owner, Admin, Fin, Audit | Fin, Admin | Fin, Admin | Owner, Admin, Fin | Owner, Admin, Fin | Fin, Admin | Owner, Admin, Fin, Audit | Owner, Admin, Fin | None | Owner, Audit | Owner |
| HRMS | Owner, Admin, HR, Audit | HR, Admin | HR, Admin | Owner, Admin, HR | Owner, Admin, HR | HR, Admin | Owner, Admin, HR, Audit | Owner, Admin, HR | None | Owner, Audit | Owner |
| Agent Operations | Owner, Guardian, Admin, Agent, Audit | Agent, Admin | Agent, Admin, Guardian | Owner, Admin, Guardian, Agent | Owner, Admin, Guardian, Agent | Agent, Admin | Owner, Admin, Agent, Audit | Owner, Admin, Guardian | None | Owner, Guardian, Audit | Owner |
| Audit & Compliance | Owner, Guardian, Admin, Audit | Audit, Admin | Audit, Admin | Owner, Admin, Audit | Owner, Admin, Audit | Audit, Admin | Owner, Admin, Audit | Owner, Admin, Audit | None | Owner, Guardian, Audit | Owner |
| System Health | Owner, Guardian, Admin, Cloud, Audit | Cloud, Admin | Cloud, Admin | Owner, Admin, Cloud | Owner, Admin, Cloud | Cloud, Admin | Owner, Admin, Cloud, Audit | Owner, Admin, Cloud | None | Owner, Guardian, Audit | Owner |
| Deployment / Cloud Operations | Owner, Guardian, Admin, Cloud, Mgr, Audit | Cloud, Admin | Cloud, Admin | Owner, Admin, Mgr | Owner, Admin, Mgr | Cloud, Admin, Mgr | Owner, Admin, Cloud, Audit | Owner, Admin, Cloud | Cloud only after approval | Owner, Guardian, Audit | Owner |
| App Studio | Owner, Guardian, Admin, approved internal builders | Approved internal builders | Approved internal builders | Owner, Admin, Guardian | Owner, Admin, Guardian | Owner, Admin, Mgr, TL | Owner, Admin, Audit | Owner, Guardian, Admin | None directly | Owner, Guardian, Audit | Owner |
| Client Portal future | Cust, Sup, Mgr, Admin, Owner | Cust for allowed requests only | Cust for own allowed records only | Internal roles only | Internal roles only | Internal roles only | Cust own records only; internal export gated | Admin only | None | Internal audit only | Owner internal only |

Customers have no permissions for Business Control Centre, App Studio, HRMS, Agent Operations, Audit/Compliance, Finance Admin, or Deployment/Cloud Operations.

## 5. Authentication Plan

Internal authentication requirements:

- Add login/session handling for internal users before any real Business Control Centre data is exposed.
- Use secure password authentication or provider-based login as an implementation decision in the next phase.
- Store password hashes only if password login is selected. Never store plaintext passwords.
- Use secure session cookies or equivalent server-validated session tokens.
- Sessions must expire and support explicit logout.
- Protected routes must include `/business-control-centre`, `/admin`, App Studio internal routes, and all internal APIs.
- API authentication middleware must run before RBAC middleware.
- CSRF/session protection must be used if cookie-based sessions are selected.
- Admin bootstrap must create Shrinika as Main Admin / Owner Admin through a controlled, one-time process.
- Super admin recovery must require a documented, audited recovery path and must not be exposed as a public endpoint.
- Customer identities must be separate from internal identities.
- Customer login, when later built, must not grant access to internal routes or internal APIs.

## 6. RBAC Enforcement Plan

Backend RBAC enforcement requirements:

- Route-level guards protect web/internal route access.
- API-level guards protect every `/api/business-control/*`, `/api/admin/*`, and internal App Studio endpoint.
- Role-based middleware loads the authenticated internal user and resolves permissions from roles.
- Service-layer permission checks validate each sensitive action before writing data.
- Deny-by-default behavior applies to unknown roles, unknown modules, unknown actions, missing sessions, expired sessions, and malformed permission claims.
- Denied attempts must be audit logged with redacted metadata.
- Internal users and external customers must be stored, authenticated, and authorized separately.
- Frontend-only checks are for usability only and must never be treated as security.
- Admin override must require Main Admin authority, reason capture, and audit logging.

## 7. Database Planning

This section is conceptual only. No migrations are created in Step 11.

| Model / table | Purpose | Key fields |
| --- | --- | --- |
| users | Authentication identity for internal users and future external users. | id, email, password_hash/provider_subject, user_type, status, last_login_at, created_at, updated_at. |
| internal_user_profiles | Internal staff profile linked to users. | id, user_id, display_name, employee_id, department_id, job_role_id, manager_user_id, access_status, created_at, updated_at. |
| roles | Named RBAC roles. | id, name, description, scope, is_system_role, created_at, updated_at. |
| permissions | Atomic permission definitions. | id, module, action, description, risk_level, created_at. |
| role_permissions | Join table between roles and permissions. | role_id, permission_id, granted_by, created_at. |
| user_roles | Role assignments for users. | user_id, role_id, organization_id, assigned_by, status, created_at, revoked_at. |
| organizations / companies / workspaces | Parent company and internal workspace structure. | id, name, type, parent_id, owner_user_id, status, created_at, updated_at. |
| departments | Internal departments. | id, organization_id, name, purpose, owner_role_id, status, created_at, updated_at. |
| job_roles | HR/job role catalog. | id, department_id, name, description, default_role_id, status, created_at, updated_at. |
| project_assignments | Project delivery ownership and stage assignments. | id, project_id, manager_user_id, team_leader_user_id, frontend_user_id, backend_user_id, qa_user_id, production_readiness_user_id, status, risk_level, due_at, created_at, updated_at. |
| approval_requests | Generic approval engine records. | id, module, action_type, target_type, target_id, requested_by, approval_owner_id, status, risk_level, payload_json, decision_note, decided_by, decided_at, created_at. |
| audit_events | Persistent audit log for sensitive actions. | id, actor_user_id, actor_type, category, action, target_type, target_id, result, severity, ip_placeholder, session_id, before_json, after_json, metadata_json, created_at. |
| support_tickets | Internal support desk records sourced from external channels. | id, client_id, project_id, issue_type, priority, status, assigned_owner_id, source_channel, summary, internal_note, last_update_at, created_at, updated_at. |
| clients | Client organization/contact records. | id, company_name, client_name, contact_person, email_placeholder, phone_placeholder, status, priority, last_contact_at, created_at, updated_at. |
| finance_records placeholders | Commercial workflow records until split into quotes/invoices/payments. | id, client_id, project_id, record_type, amount_placeholder, status, approval_owner_id, due_date_placeholder, metadata_json, created_at, updated_at. |
| hr_requests placeholders | HR request queue records. | id, employee_profile_id, request_type, department_id, priority, status, approval_owner_id, metadata_json, created_at, updated_at. |
| agent_operations placeholders | Agent registry and task queue visibility records. | id, agent_name, agent_type, module, status, current_task, approval_requirement, risk_level, provider_placeholder, created_at, updated_at. |
| deployment_records placeholders | Release/deployment planning records. | id, release_id, module, environment, status, approval_owner_id, git_checkpoint_placeholder, test_status, security_review_status, rollback_status, created_at, updated_at. |
| incidents placeholders | System, audit, support, deployment, and safety incident records. | id, area, severity, status, owner_user_id, impact, required_next_step, last_update_at, created_at, updated_at. |

Existing `packages/db` uses SQLite via `better-sqlite3`, schema initialization in `packages/db/src/index.ts`, and existing audit/approval/project tables for App Studio. Step 11 does not change those tables. Future phases should decide whether Business Control Centre records extend existing tables or introduce separate business-control tables with migrations.

## 8. API Planning

Future API groups must validate input with shared schemas, keep route handlers thin, move business rules into services, enforce authentication/RBAC, and audit sensitive actions.

| Route group | Purpose | Required permissions | Risk |
| --- | --- | --- | --- |
| `/api/auth/*` | Login, logout, session status, internal bootstrap, recovery planning. | Public only for login; authenticated self for session; Owner for bootstrap/recovery. | Critical |
| `/api/admin/users/*` | Internal user lifecycle, status, profile linkage. | Owner/Admin user administration. | Critical |
| `/api/admin/roles/*` | Role and permission assignment. | Owner/Admin RBAC administration; Auditor view. | Critical |
| `/api/business-control/company/*` | Company dashboard, workspaces, departments, job roles. | Company Dashboard and configuration permissions. | High |
| `/api/business-control/projects/*` | Project operations and project assignment control. | Project view/create/update/assign/approve permissions. | High |
| `/api/business-control/clients/*` | Client records and account status. | Client Management permissions. | High |
| `/api/business-control/support/*` | Support ticket queues and internal notes. | Support Desk permissions. | Medium |
| `/api/business-control/finance/*` | Quotations, agreements, invoices, payment tracking placeholders. | Finance & Billing permissions. | Critical |
| `/api/business-control/hrms/*` | Employee directory and HR request workflows. | HRMS permissions. | Critical |
| `/api/business-control/agents/*` | Agent registry, task queue, governance controls. | Agent Operations permissions. | Critical |
| `/api/business-control/audit/*` | Audit logs, compliance controls, blocked action events. | Audit & Compliance permissions. | Critical |
| `/api/business-control/system/*` | System health, incidents, backup/recovery placeholders. | System Health permissions. | High |
| `/api/business-control/deployments/*` | Deployment candidates, release records, cloud operations placeholders. | Deployment / Cloud Operations permissions. | Critical |

## 9. Approval Workflow Enforcement

Approval workflows must be enforced by backend services, not by UI state.

| Workflow | Required approval rule |
| --- | --- |
| Project assignment | Admin or Manager assignment required; Team Leader/developer handoffs audited. |
| Manager final approval | Manager final approval required before deployment readiness can advance. |
| Deployment approval | Production deployment requires Manager/Admin approval, passing checks, security review, Git checkpoint, and rollback plan. |
| Finance quotation release | Human Finance/Admin approval required before sending a quotation. |
| Invoice issue | Human Finance/Admin approval required before issuing an invoice. |
| Agreement/contract send | Human Finance/Admin approval required before sending agreements/contracts. |
| HR onboarding | HR plus Admin approval required before activating internal access. |
| HR role/access changes | Manager plus Admin approval for role changes; Admin approval for access changes. |
| Agent production actions | Human approval required for any production-impacting agent action. |
| Provider/API key changes | Admin plus audit review required; secrets never displayed in UI or logs. |
| Domain/DNS changes | Admin approval required; change record and rollback plan required. |
| Backup/restore actions | Admin approval required for restore; backup schedule changes require Cloud/Admin approval. |
| Emergency override future | Must be explicitly designed later with owner authority, reason capture, time limit, and audit review. |

## 10. Audit Logging Plan

Audit requirements:

- All sensitive actions must be logged.
- All approvals and rejections must be logged.
- All denied access attempts must be logged.
- All role and permission changes must be logged.
- All finance, HR, deployment, support, agent, and audit/compliance actions must be logged.
- Secret/API key redaction is mandatory before storing logs or returning API responses.
- Audit events must include actor, target, action, result, timestamp, IP/session placeholder, before metadata placeholder, after metadata placeholder, and risk/severity.
- Audit logging failure for sensitive write actions should block the write unless a future emergency rule explicitly defines otherwise.
- Audit exports must be permission-gated and redacted.

Recommended audit event fields:

- id
- actor_user_id
- actor_type
- category
- action
- target_type
- target_id
- result
- severity
- reason_or_note
- ip_placeholder
- session_id
- before_json
- after_json
- metadata_json
- created_at

## 11. Security Requirements

Security requirements before backend wiring:

- Deny-by-default for routes, APIs, services, and permissions.
- Least privilege for every role.
- Strict internal/external identity separation.
- No secrets in UI, logs, audit payloads, docs examples, test fixtures, or API responses.
- API key redaction before persistence and before response serialization.
- Input validation for all route bodies, query params, and path params.
- File path safety for any project/file inspection or future export/import features.
- Rate limiting for login, recovery, approval, export, and sensitive mutation routes.
- Session security with expiry, logout, secure cookies or secure token handling, and CSRF protection if cookies are used.
- Admin recovery safeguards with owner-level control and audit logging.
- Backup and restore approval gates.
- Production deployment gates requiring tests, security review, Git checkpoint, rollback plan, audit log, and final human approval.

## 12. Implementation Phases

| Phase | Scope |
| --- | --- |
| Phase 11A - PRD only | Create and review this planning document. No implementation. |
| Phase 11B - DB schema planning and migration proposal | Produce migration proposal and schema review without applying migrations until approved. |
| Phase 11C - Auth/session foundation | Add internal login/session infrastructure and protected route/API session checks. |
| Phase 11D - RBAC middleware | Add permission resolution, deny-by-default middleware, and service guard helpers. |
| Phase 11E - User/role admin APIs | Add internal user, role, and permission administration APIs. |
| Phase 11F - Audit event persistence | Add durable audit events for all sensitive actions and denied attempts. |
| Phase 11G - Approval request engine | Add reusable approval request service for project, finance, HR, agent, deployment, and admin actions. |
| Phase 11H - Module-by-module data wiring | Replace mock Business Control Centre sections one module at a time after security gates exist. |
| Phase 11I - Client Portal separation | Plan and implement separate external customer identity, routes, APIs, and data exposure rules. |
| Phase 11J - Production security review | Perform security review, RBAC review, audit review, deployment gate review, and owner approval before production use. |

## 13. Acceptance Criteria

Before backend coding starts:

- This PRD is reviewed.
- Role matrix is approved.
- DB model plan is approved.
- Auth approach is approved.
- Internal/customer boundary is approved.
- No backend implementation is included in Step 11.
- No database migrations are included in Step 11.
- No UI changes are included in Step 11.
- `npm run typecheck` and `npm test` pass if docs/tooling changes affect the workspace.
- Commit occurs only after review.

## 14. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Customer accidentally accesses internal systems. | Separate internal/customer identities, protected routes, server-side RBAC, deny-by-default, audit denied attempts. |
| Employees become over-permissioned. | Least privilege roles, role review, admin approval for role changes, audit logs. |
| Missing audit records. | Central audit service, tests for sensitive actions, block sensitive writes if audit persistence fails. |
| Approval bypass. | Backend approval engine, service-layer guards, status transition validation, audit decisions. |
| Secret exposure. | Redaction service, no raw secrets in UI/logs/API responses, secret scanning in review. |
| Bad deployment/rollback controls. | Deployment gates, Git checkpoints, rollback plans, test/security review, final approval. |
| HR/finance sensitive data exposure. | Strict module permissions, exports gated, redaction, audit access, separate customer surfaces. |
| Premature backend wiring. | Phase gates, PRD approval, module-by-module implementation only after auth/RBAC/audit foundations. |

## 15. Out Of Scope

Step 11 explicitly excludes:

- Backend implementation.
- Database migrations.
- Real authentication.
- Real user creation.
- Real customer portal.
- Real payments.
- Real HR data.
- Real deployment/cloud actions.
- Provider calls.
- Media Studio changes.
- UI changes.
- Commit or push.

