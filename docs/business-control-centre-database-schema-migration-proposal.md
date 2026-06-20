# Business Control Centre Database Schema Planning And Migration Proposal

## 1. Purpose

Step 12 translates the Step 11 Backend/Auth/RBAC Planning PRD into a safe database schema and migration proposal for the Shrinika Technologies Business Control Centre backend foundation.

This document is planning only. It proposes future tables, relationships, seed data, indexes, constraints, migration phases, test requirements, and rollback expectations before implementation begins.

No migration is implemented in this step. No schema file is edited. No backend API, authentication/session code, UI wiring, seed script, production database change, provider call, deployment action, payment logic, HR workflow, support workflow, customer portal logic, or Media Studio change is included.

## 2. Existing Database/ORM Audit

### Tooling and ORM status

- The DB package is `@s4/db`.
- The database engine is SQLite through `better-sqlite3`.
- There is no ORM layer currently in use.
- Schema creation and additive migration logic live in TypeScript in `packages/db/src/index.ts`.
- Database initialization is exposed through `initializeDatabase()` and `initializeDatabaseOn(database)`.
- `packages/db/src/init.ts` calls `initializeDatabase()` for the `npm run db:init -w @s4/db` script.
- The root `npm run db:init` delegates to `@s4/db`.
- The database path is resolved from `S4_DB_PATH` with a default of `./data/s4-agent-studio.db`.
- The DB enables `journal_mode = WAL` and `foreign_keys = ON`.

### Existing schema files

- `packages/db/src/index.ts` contains table creation, additive column checks, indexes, and seed helpers.
- `packages/db/src/init.ts` initializes the database.
- `packages/db/src/index.test.ts` validates selected migration behavior.
- `packages/shared/src/index.ts` contains Zod schemas and shared TypeScript types used by the API.
- `apps/api/src/server.ts` contains current Fastify routes and uses the DB package directly.

### Existing migration pattern

- Tables are created with `CREATE TABLE IF NOT EXISTS`.
- Indexes are created with `CREATE INDEX IF NOT EXISTS`.
- Existing table columns are inspected with `PRAGMA table_info`.
- Missing columns are added with `ALTER TABLE ... ADD COLUMN`.
- Seeds use idempotent `INSERT OR IGNORE` or `INSERT OR REPLACE`.
- Existing tests create legacy SQLite databases and then call `initializeDatabaseOn(db)` to verify additive migrations do not disturb existing rows.

### Existing test DB pattern

- Tests use `better-sqlite3` in-memory databases for isolated schema validation.
- Some tests create temporary file databases with `fs.mkdtemp` and a test `S4_DB_PATH`.
- Tests check legacy rows remain intact after initialization.
- Tests inspect columns with `PRAGMA table_info`.
- Tests verify seeded template/workspace records are created idempotently.

### Naming conventions

- Existing table names use snake_case plural nouns.
- Primary keys are generally `id TEXT PRIMARY KEY`.
- Timestamps are stored as text fields such as `created_at`, `updated_at`, `decided_at`, `completed_at`, and archived/deleted timestamps.
- JSON payloads are stored in `*_json` text columns.
- Status fields are text with selected `CHECK` constraints where the state set is stable.
- Index names use `idx_<table>_<purpose>`.
- Foreign keys are used where relationships are stable and safe.

### Risks when adding Business Control Centre models

- The current schema is centralized and already large; adding many tables in one patch increases review risk.
- Existing `approvals` and `audit_events` tables are App Studio-oriented and may not be sufficient for Business Control Centre without careful compatibility planning.
- Adding broad RBAC tables before auth is finalized could cause later rework.
- Customers and internal users must not be mixed through a casual shared role model.
- Finance, HRMS, audit, deployment, and agent operations contain sensitive data and require stricter permissions than dashboard summaries.
- Placeholder tables can become accidental production contracts if not clearly versioned and scoped.
- Migrations must stay additive until backup, rollback, and review processes are established.

## 3. Schema Principles

- Internal/customer separation is mandatory.
- Business Control Centre and App Studio must require internal identity.
- Customer records are company-managed business records, not internal admin accounts.
- Deny-by-default permissions must be supported by schema design.
- Least privilege must be representable through roles, permissions, and scoped assignments.
- Audit-first design: sensitive actions need durable audit events.
- Approval-first design: sensitive writes need approval request records before state mutation.
- Secrets must never be stored in plain text.
- API keys, provider credentials, password reset tokens, and session secrets must be hashed, encrypted, or externalized depending on the future auth/security design.
- Use soft delete/archive fields where records need retention.
- Audit events should be immutable. Corrections should be new events, not updates to old events.
- Future Client Portal identities, routes, APIs, and permissions must remain separate from internal Business Control Centre access.
- Add minimal MVP tables first, then module placeholders only after identity, RBAC, approval, and audit foundations are approved.

## 4. Proposed Table Groups

### A. Identity & Access

- `users`
- `internal_user_profiles`
- `external_client_users` placeholder
- `roles`
- `permissions`
- `role_permissions`
- `user_roles`
- `auth_sessions` placeholder
- `login_events` placeholder

### B. Company Structure

- `companies`
- `workspaces`
- `departments`
- `job_roles`
- `employee_profiles`
- `reporting_lines`

### C. Project Operations

- `business_projects`
- `project_assignments`
- `project_assignment_steps`
- `project_status_events`
- `project_handoffs`

### D. Client & Support

- `clients`
- `client_contacts`
- `support_tickets`
- `support_ticket_events`
- `support_ticket_comments`

### E. Finance & Billing Placeholders

- `finance_records`
- `quotations`
- `quotation_approvals`
- `invoices`
- `payment_records` placeholder
- `commercial_documents` placeholder

### F. HRMS Placeholders

- `hr_requests`
- `employee_onboarding_records`
- `leave_requests` placeholder
- `access_change_requests`
- `employee_status_events`

### G. Agent Operations

- `agent_registry`
- `agent_tasks`
- `agent_task_events`
- `agent_provider_status` placeholder
- `blocked_agent_actions`

### H. Approvals

- `approval_requests`
- `approval_steps`
- `approval_decisions`
- `approval_policy_rules` placeholder

### I. Audit & Compliance

- `audit_events`
- `denied_access_events`
- `compliance_checks` placeholder
- `sensitive_action_records`

### J. System / Deployment / Cloud

- `system_components`
- `system_health_events` placeholder
- `deployment_records`
- `deployment_approvals`
- `rollback_plans`
- `incidents`
- `backup_records` placeholder

## 5. Table Details

| Table | Purpose | Key fields | Relationships | Ownership/internal boundary | MVP or future | Audit requirements | Sensitive data notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `users` | Base identity record for internal and future external identities. | id, email, email_normalized, user_type, auth_provider, password_hash_placeholder, status, last_login_at, created_at, updated_at, archived_at. | One user to profiles, sessions, roles, audit actor. | Business Control Centre requires `user_type='INTERNAL'`. | MVP. | Login, status changes, role-impacting updates. | Store password hash only if password auth is chosen. Never plaintext. |
| `internal_user_profiles` | Internal staff profile for Shrinika Technologies users. | id, user_id, display_name, employee_id, company_id, department_id, job_role_id, access_status, created_at, updated_at. | Belongs to users, companies, departments, job_roles. | Internal only. Required for admin dashboard access. | MVP. | Profile/access status changes. | Contains employee data; restrict HR/Admin/Audit access. |
| `external_client_users` | Placeholder for future Client Portal identities. | id, user_id, client_id, display_name, portal_status, created_at, updated_at. | Belongs to users and clients. | External only. Must not join internal roles. | Future placeholder. | Portal access changes and denied internal attempts. | Client data only; no internal role grants. |
| `roles` | Named RBAC roles. | id, role_key, name, description, role_scope, is_system_role, status, created_at, updated_at. | Many-to-many with permissions and users. | Internal role scope separate from external/customer role scope. | MVP. | Role creation/update/archive. | Role keys are security-sensitive. |
| `permissions` | Atomic module/action permissions. | id, permission_key, module_key, action_key, risk_level, description, created_at. | Many-to-many with roles. | Internal permission keys for Business Control Centre/App Studio only. | MVP. | Permission creation/update. | Must not grant internal permissions to customers. |
| `role_permissions` | Maps roles to permissions. | role_id, permission_id, granted_by_user_id, created_at, revoked_at. | Joins roles, permissions, users. | Internal grants require Admin/Owner. | MVP. | Every grant/revoke. | Duplicate active grants must be prevented. |
| `user_roles` | Assigns roles to users. | id, user_id, role_id, company_id, workspace_id, assigned_by_user_id, status, created_at, revoked_at. | Joins users, roles, companies, workspaces. | Internal roles only for internal users. Customer role separate and denied internal perms. | MVP. | Every assignment/revocation. | High risk because it controls access. |
| `auth_sessions` | Placeholder for server-side sessions. | id, user_id, session_hash, user_type, expires_at, revoked_at, created_at, last_seen_at. | Belongs to users. | Internal sessions required for Business Control Centre. | Future placeholder unless auth phase starts. | Session create/revoke/expiry events. | Store hashed tokens only. |
| `login_events` | Login and authentication attempt log. | id, user_id, email_normalized, result, reason, ip_placeholder, session_id, created_at. | Optional user/session link. | Internal and external login streams can share structure with type markers. | Future placeholder. | Immutable login event. | Avoid logging passwords or tokens. |
| `companies` | Parent company and future company entities. | id, name, company_type, parent_company_id, owner_user_id, status, created_at, updated_at, archived_at. | Parent hierarchy, users, workspaces. | Shrinika Technologies is internal owner company. | MVP. | Company settings/status changes. | Company metadata only. |
| `workspaces` | Internal workspace/product surfaces. | id, company_id, workspace_key, name, workspace_type, access_boundary, status, created_at, updated_at. | Belongs to companies. | Marks App Studio and Business Control Centre internal-only. | MVP. | Boundary/status changes. | Boundary field must not be user-controlled text in security checks. |
| `departments` | Internal department catalog. | id, company_id, department_key, name, purpose, owner_role_id, status, created_at, updated_at. | Belongs to company and optional owner role. | Internal only. | MVP. | Department create/update/archive. | May expose staff structure; internal only. |
| `job_roles` | HR/job role catalog. | id, department_id, job_role_key, name, default_role_id, description, status, created_at, updated_at. | Belongs to departments and maps to optional default RBAC role. | Internal only. | MVP. | Job role changes. | Default role mapping is access-sensitive. |
| `employee_profiles` | HR employee profile. | id, internal_user_profile_id, employee_id, work_status, hire_date_placeholder, manager_profile_id, created_at, updated_at, archived_at. | Belongs to internal_user_profiles; self-link to manager. | Internal HR/Admin only. | Future placeholder after identity. | Status, manager, onboarding, exit changes. | Sensitive HR data. Keep MVP fields minimal. |
| `reporting_lines` | Explicit reporting relationships and history. | id, employee_profile_id, manager_profile_id, relationship_type, status, effective_from, effective_to, created_at. | Links employee_profiles. | Internal HR/Admin/Manager only. | Future placeholder. | Manager/reporting changes. | Sensitive org data. |
| `business_projects` | Business Control Centre project portfolio. | id, client_id, project_name, module_key, status, priority, risk_level, manager_user_id, created_at, updated_at, archived_at. | Clients, assignments, approvals, support, finance, deployments. | Internal project operations only. | MVP. | Create/update/status/archive. | Client/project metadata may be confidential. |
| `project_assignments` | Current ownership and delivery role assignment. | id, project_id, manager_user_id, team_leader_user_id, frontend_user_id, backend_user_id, qa_user_id, production_readiness_user_id, status, due_at, created_at, updated_at. | Belongs to business_projects and users. | Internal only. | MVP. | Assignment and role-owner changes. | Staff assignment data internal only. |
| `project_assignment_steps` | Workflow step state from admin assignment to deployment approval. | id, assignment_id, step_key, owner_user_id, status, sequence, completed_at, created_at, updated_at. | Belongs to project_assignments. | Internal only. | MVP. | Step transitions. | Avoid exposing internal handoff details externally. |
| `project_status_events` | Project state timeline. | id, project_id, actor_user_id, previous_status, next_status, note, created_at. | Belongs to business_projects and users. | Internal only. | MVP. | Immutable status event. | Notes must be redacted. |
| `project_handoffs` | Team handoff records. | id, project_id, from_user_id, to_user_id, from_step_key, to_step_key, status, note, created_at, accepted_at. | Projects and users. | Internal only. | Future placeholder. | Handoff create/accept/reject. | Notes may include internal delivery details. |
| `clients` | Client company/account records. | id, company_name, client_name, account_status, priority, last_contact_at, created_at, updated_at, archived_at. | Contacts, projects, support, finance. | Managed internally. Not a login account. | MVP. | Create/update/archive/status changes. | Client data; restrict exports. |
| `client_contacts` | Contact people for client companies. | id, client_id, contact_name, email_placeholder, phone_placeholder, role_title, is_primary, status, created_at, updated_at. | Belongs to clients. | Internal CRM/support use. | Future placeholder. | Contact create/update/delete/archive. | PII. Avoid unnecessary MVP collection. |
| `support_tickets` | Internal support ticket queue. | id, client_id, project_id, ticket_id, issue_type, priority, status, assigned_owner_id, source_channel, summary, internal_note, last_update_at, created_at, updated_at. | Clients, projects, users. | Internal support desk only. | MVP. | Ticket create/status/assignment changes. | Customer issue content may be sensitive. |
| `support_ticket_events` | Ticket event timeline. | id, ticket_id, actor_user_id, event_type, previous_status, next_status, metadata_json, created_at. | Belongs to support_tickets and users. | Internal support/audit. | Future placeholder. | Immutable ticket event. | Redact customer-sensitive text. |
| `support_ticket_comments` | Internal and external-channel comments. | id, ticket_id, author_user_id, author_type, visibility, body_redacted, created_at, archived_at. | Belongs to support_tickets. | Internal comments never exposed to customers. | Future placeholder. | Comment create/archive. | Store redacted body; no secrets. |
| `finance_records` | General finance placeholder umbrella. | id, client_id, project_id, record_type, status, amount_placeholder, owner_user_id, metadata_json, created_at, updated_at. | Clients, projects, users, approvals. | Finance/Admin only. | Future placeholder. | All create/update/status changes. | Financial data sensitive; placeholder only. |
| `quotations` | Quotation draft and approval state. | id, client_id, project_id, quote_id, production_cost_placeholder, recommended_price_placeholder, margin_placeholder, status, approval_request_id, created_at, updated_at. | Clients, projects, approval_requests. | Finance/Admin only. | MVP when finance wiring starts. | Draft, approve, send, revise, reject. | Commercially sensitive. |
| `quotation_approvals` | Quotation-specific approval bridge/history if needed. | id, quotation_id, approval_request_id, status, created_at, decided_at. | Quotations and approval_requests. | Finance/Admin/Audit only. | Future placeholder if generic approvals need module bridge. | Approval state changes. | Avoid duplicating decision source of truth. |
| `invoices` | Invoice placeholders and payment status. | id, client_id, project_id, invoice_id, amount_placeholder, payment_status, due_date_placeholder, owner_user_id, approval_request_id, created_at, updated_at. | Clients, projects, users, approvals. | Finance/Admin only. | MVP when finance wiring starts. | Draft, issue, payment status changes. | No real tax/payment processing in MVP. |
| `payment_records` | Payment tracking placeholder. | id, invoice_id, client_id, payment_status, amount_placeholder, reference_placeholder, received_at_placeholder, created_at, updated_at. | Invoices and clients. | Finance/Admin only. | Future placeholder. | Payment status changes. | No gateway secrets or real payment tokens. |
| `commercial_documents` | Agreement/contract/receipt document metadata placeholder. | id, client_id, project_id, document_type, status, approval_request_id, storage_ref_placeholder, created_at, updated_at. | Clients, projects, approvals. | Finance/Admin only. | Future placeholder. | Document create/send/archive. | Store metadata only until secure document storage exists. |
| `hr_requests` | HR request queue. | id, employee_profile_id, request_type, department_id, priority, status, approval_request_id, created_at, updated_at. | Employee profiles, departments, approvals. | HR/Admin only. | MVP when HR wiring starts. | Request status/decision. | Sensitive employee workflow data. |
| `employee_onboarding_records` | Onboarding workflow placeholder. | id, employee_profile_id, candidate_ref_placeholder, status, manager_confirmed_by, admin_approved_by, created_at, updated_at. | Employee profiles and users. | HR/Admin only. | Future placeholder. | Onboarding step changes. | Avoid collecting private documents in MVP. |
| `leave_requests` | Leave request placeholder. | id, employee_profile_id, leave_type, status, start_date_placeholder, end_date_placeholder, approval_request_id, created_at, updated_at. | Employee profiles and approvals. | HR/Manager/Admin only. | Future placeholder. | Request/approval changes. | Attendance/payroll not connected. |
| `access_change_requests` | Internal role/access change workflow. | id, employee_profile_id, requested_role_id, requested_permission_json, status, approval_request_id, created_at, updated_at. | Employee profiles, roles, approvals. | HR/Admin/Audit only. | MVP for RBAC admin safety. | Every access request and decision. | Critical access-sensitive table. |
| `employee_status_events` | Employee lifecycle event log. | id, employee_profile_id, actor_user_id, event_type, previous_status, next_status, created_at. | Employee profiles and users. | HR/Admin/Audit only. | Future placeholder. | Immutable employee event. | Sensitive HR data. |
| `agent_registry` | Business Control Centre agent registry view. | id, agent_name, agent_type, assigned_module, status, approval_requirement, provider_placeholder, risk_level, created_at, updated_at. | Optional link to existing agents later. | Internal agent governance only. | Future placeholder. | Agent status/config changes. | No API keys or provider secrets. |
| `agent_tasks` | Agent task queue records. | id, agent_registry_id, task_id, module_key, title, status, approval_state, risk_level, owner_user_id, created_at, updated_at. | Agent registry, users, approvals, audit. | Internal agent governance only. | Future placeholder. | Task lifecycle and approval changes. | No secret prompt payloads in MVP. |
| `agent_task_events` | Agent task timeline. | id, agent_task_id, actor_user_id, event_type, result, metadata_json, created_at. | Agent tasks and users. | Internal only. | Future placeholder. | Immutable event. | Redact prompts, provider details, and file paths as needed. |
| `agent_provider_status` | Provider health placeholder. | id, provider_key, display_name, status, circuit_breaker_state, daily_usage_placeholder, last_checked_at, created_at, updated_at. | Referenced by agent tasks if needed. | Internal only. | Future placeholder. | Provider status/config changes. | No API keys shown or stored. |
| `blocked_agent_actions` | Blocked unsafe agent action records. | id, agent_task_id, action, reason_blocked, risk_level, required_next_step, created_at. | Agent tasks and audit events. | Internal governance only. | Future placeholder. | Immutable blocked action event. | May contain sensitive action details; redact. |
| `approval_requests` | Generic approval workflow request. | id, module, request_type, requester_user_id, target_type, target_id, status, risk_level, required_role, current_approver_id, expires_at, audit_event_id, created_at, updated_at. | Users, approval steps, decisions, module targets, audit. | Internal only for Business Control Centre/App Studio sensitive actions. | MVP. | Create/status/expire/decision link. | Payloads must be redacted. |
| `approval_steps` | Multi-step approval requirements. | id, approval_request_id, step_order, required_role, approver_user_id, status, due_at_placeholder, created_at, updated_at. | Approval requests, users, roles. | Internal only. | Future placeholder after basic approvals. | Step assignment/status changes. | Access-sensitive. |
| `approval_decisions` | Immutable approval/rejection decisions. | id, approval_request_id, approver_user_id, decision, decision_note_redacted, created_at, audit_event_id. | Approval requests, users, audit events. | Internal only. | MVP. | Immutable decision event. | Decision notes redacted and retained. |
| `approval_policy_rules` | Placeholder rules for required approvals. | id, module, request_type, risk_level, required_role, rule_json, status, created_at, updated_at. | Used by approval service. | Admin/Audit only. | Future placeholder. | Rule create/update/archive. | Critical because it can allow or block approvals. |
| `audit_events` | Durable audit log for sensitive actions. | id, actor_user_id, actor_role, action, module, target_type, target_id, result, severity, ip_placeholder, session_id, metadata_json, before_json, after_json, created_at. | Users, sessions, optional module targets. | Internal audit only. | MVP. | Immutable append only. | Mandatory redaction before insert. |
| `denied_access_events` | Dedicated denied access log. | id, user_id, user_type, route_or_action, module, reason, ip_placeholder, session_id, created_at. | Users/sessions optional. | Internal security/audit only. | MVP. | Immutable denied event. | Do not include tokens or credentials. |
| `compliance_checks` | Compliance control placeholder. | id, check_key, module, status, severity, owner_user_id, last_checked_at, metadata_json, created_at, updated_at. | Users and audit events. | Audit/Admin only. | Future placeholder. | Check status changes. | Avoid sensitive data in metadata. |
| `sensitive_action_records` | Sensitive action registry for review. | id, module, action, target_type, target_id, approval_request_id, audit_event_id, status, created_at. | Approvals and audit events. | Audit/Admin only. | Future placeholder. | Create/status changes. | Central high-sensitivity index. |
| `system_components` | System component inventory. | id, component_key, name, area, owner_user_id, status, risk_level, next_action, created_at, updated_at. | Users, health events, incidents. | Internal system/cloud only. | Future placeholder. | Component status/config changes. | No infrastructure secrets. |
| `system_health_events` | Component health timeline placeholder. | id, component_id, status, health_note, checked_by_user_id, checked_at, metadata_json. | System components and users. | Internal only. | Future placeholder. | Immutable health event. | No raw provider responses with secrets. |
| `deployment_records` | Deployment/release record. | id, release_id, project_id, module_key, environment, status, approval_request_id, git_checkpoint_placeholder, test_status, security_review_status, created_at, updated_at. | Projects, approvals, rollback plans, incidents. | Internal deployment only. | Future placeholder. | Release status and gate changes. | No provider credentials. |
| `deployment_approvals` | Deployment-specific approval bridge/history. | id, deployment_record_id, approval_request_id, status, created_at, decided_at. | Deployment records and approval requests. | Internal deployment only. | Future placeholder. | Approval state changes. | Keep generic approval source of truth. |
| `rollback_plans` | Rollback plan metadata. | id, deployment_record_id, plan_summary, status, owner_user_id, archived_at, created_at, updated_at. | Deployment records and users. | Internal deployment only. | Future placeholder. | Plan create/update/archive. | Plan text may reveal system details. |
| `incidents` | Incident management queue. | id, area, severity, status, owner_user_id, impact_placeholder, required_next_step, last_update_at, created_at, updated_at, resolved_at. | Users, system components, deployments optional. | Internal governance/system only. | Future placeholder. | Incident create/update/resolve. | Incident notes may contain sensitive details. |
| `backup_records` | Backup/recovery placeholder. | id, item_key, frequency_placeholder, status, owner_user_id, last_checked_at, recovery_note, created_at, updated_at. | Users, audit events optional. | Internal cloud/admin only. | Future placeholder. | Backup status and restore request changes. | No backup secrets or storage keys. |

## 6. Core Relationships

- `users` to `user_roles` to `roles` represents user role assignments.
- `roles` to `role_permissions` to `permissions` represents RBAC grants.
- `internal_user_profiles` belongs to `users` and links to `departments` and `job_roles`.
- `employee_profiles` extends internal staff details and may point to a manager profile.
- `reporting_lines` records employee-manager relationships over time.
- `companies` contain `workspaces`, `departments`, and internal users.
- `business_projects` may link to `clients`, support tickets, finance records, approvals, deployments, and incidents.
- `project_assignments` belongs to `business_projects` and links to assigned internal users.
- `project_assignment_steps` belongs to `project_assignments`.
- `project_handoffs` belongs to projects and links from/to internal users.
- `approval_requests` can target projects, assignments, finance records, HR requests, agent tasks, deployments, provider changes, backup/restore actions, and access changes.
- `approval_decisions` and `approval_steps` belong to `approval_requests`.
- `clients` own `client_contacts`, `support_tickets`, and finance records.
- `support_tickets` may link to clients and projects.
- `finance_records`, `quotations`, `invoices`, and `commercial_documents` link to clients, projects, and approval requests.
- `hr_requests`, `employee_onboarding_records`, `leave_requests`, and `access_change_requests` link to employee profiles and approvals.
- `agent_tasks` link to `agent_registry`, approvals, and audit events.
- `deployment_records` link to approval requests and rollback plans.
- `incidents` can link conceptually to system components, deployments, support, audit, or agent operations.
- All sensitive actions create `audit_events`.
- Denied internal or customer attempts create `denied_access_events`.

## 7. Permission Data Seed Plan

Seed scripts must be idempotent and reviewed before implementation.

### Internal seed roles

| Role key | Display name | Seed plan |
| --- | --- | --- |
| `main_admin_owner` | Shrinika - Main Admin / Owner Admin | Seed as system role with all internal permissions and admin override. Create only through bootstrap approval. |
| `system_guardian` | Shiva - Founder-builder / System Guardian | Seed as system role with technical governance, audit, App Studio, agent, and system review permissions. |
| `company_admin` | Company Admin | Seed broad company operations permissions except owner-only recovery and override. |
| `manager` | Manager | Seed project, assignment, support escalation, final approval, and deployment review permissions. |
| `team_leader` | Team Leader | Seed project/team assignment and handoff permissions for assigned work. |
| `frontend_developer` | Frontend Developer | Seed view/update permissions only for assigned project frontend work. |
| `backend_developer` | Backend Developer | Seed view/update permissions only for assigned project backend work. |
| `testing_qa_developer` | Testing / QA Developer | Seed QA/test validation permissions for assigned projects. |
| `production_readiness_developer` | Final Production Readiness Developer | Seed readiness review permissions for assigned projects. |
| `hr_manager` | HR Manager | Seed HRMS/onboarding/access request workflow permissions with approvals scoped by policy. |
| `finance_admin` | Finance Admin | Seed finance, quotation, invoice, agreement, receipt, and refund workflow permissions. |
| `support_manager` | Support Manager | Seed support desk, ticket assignment, escalation, and external-channel update coordination permissions. |
| `agent_supervisor` | Agent Supervisor | Seed agent registry, task queue, blocked action, and approval request permissions. |
| `auditor` | Auditor | Seed audit/compliance read/export/review permissions with no mutation except review notes/status. |
| `cloud_deployment_operator` | Cloud / Deployment Operator | Seed system health, deployment record, rollback plan, backup placeholder, and incident permissions under approval gates. |
| `customer_external` | Customer / Client user | Seed only in external scope with no internal permissions. Must be denied Business Control Centre and App Studio permissions. |

### Permission seed rules

- Permission keys should use `<module>.<action>` format, for example `finance.approve`, `deployment.deploy`, `audit.view`.
- Internal module permissions must be marked `scope='INTERNAL'`.
- Future Client Portal permissions must be marked `scope='EXTERNAL_CLIENT'`.
- No `customer_external` role may receive any `scope='INTERNAL'` permission.
- Seed scripts must use stable role keys and permission keys, not display names.
- Seed reruns must not duplicate active role or permission records.
- Seed changes must create audit records after audit persistence exists.

## 8. Migration Sequence Proposal

| Phase | Tables added | Risk level | Rollback strategy | Test requirements | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| Phase 12A - planning document only | None. | Low. | Delete or revise document only. | `npm run typecheck`, `npm test`. | Document reviewed; no schema changes. |
| Phase 12B - base identity/access tables | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, optional placeholders `auth_sessions`, `login_events`, `external_client_users`. | Critical. | Backup DB; additive only; rollback by disabling auth wiring and leaving inert tables or restoring backup before production. | Schema creation, seed idempotency, no duplicate roles, no internal perms for customer role. | Identity/RBAC tables created with no UI/API exposure until auth phase. |
| Phase 12C - company/departments/job roles | `companies`, `workspaces`, `departments`, `job_roles`, `internal_user_profiles`, `employee_profiles`, `reporting_lines`. | High. | Additive only; restore backup if production; no destructive deletes. | FK validation, default Shrinika Technologies company seed, department/job role seed idempotency. | Company structure can represent Step 4 UI without exposing data. |
| Phase 12D - project operations and assignment workflow tables | `business_projects`, `project_assignments`, `project_assignment_steps`, `project_status_events`, `project_handoffs`. | High. | Additive only; keep current App Studio `projects` table untouched; rollback by ignoring new tables or restore backup. | Workflow step creation, assignment relationships, status constraints, no orphan assignment steps. | Project assignment workflow can be persisted conceptually. |
| Phase 12E - approvals and audit persistence | `approval_requests`, `approval_steps`, `approval_decisions`, `approval_policy_rules`, expanded/new `audit_events`, `denied_access_events`, `sensitive_action_records`. | Critical. | Backup required; additive only; do not replace existing `approvals`/`audit_events` without compatibility plan. | Approval creation/decision, audit append-only behavior, denied access event tests, redaction tests. | Sensitive actions have approval and audit tables ready before module writes. |
| Phase 12F - client/support placeholders | `clients`, `client_contacts`, `support_tickets`, `support_ticket_events`, `support_ticket_comments`. | Medium. | Additive only; archive placeholder data if abandoned. | Client/ticket relationships, status constraints, customer PII redaction tests. | Client/support mock UI can later be wired to placeholder records. |
| Phase 12G - finance placeholders | `finance_records`, `quotations`, `quotation_approvals`, `invoices`, `payment_records`, `commercial_documents`. | Critical. | Backup required; additive only; no payment gateway fields; no tax calculations. | Approval required for send/issue states, finance permission tests, sensitive export denial tests. | Finance data remains placeholder and approval-gated. |
| Phase 12H - HRMS placeholders | `hr_requests`, `employee_onboarding_records`, `leave_requests`, `access_change_requests`, `employee_status_events`. | Critical. | Backup required; additive only; avoid importing real HR data. | HR permission tests, access-change approval tests, no customer access, PII redaction tests. | HRMS placeholders support approval-gated internal workflows. |
| Phase 12I - agent operations placeholders | `agent_registry`, `agent_tasks`, `agent_task_events`, `agent_provider_status`, `blocked_agent_actions`. | High. | Additive only; no real agent execution; provider data inert. | Agent status constraints, blocked action audit, no API key persistence. | Agent operations visibility tables remain governance-only. |
| Phase 12J - system/deployment/cloud placeholders | `system_components`, `system_health_events`, `deployment_records`, `deployment_approvals`, `rollback_plans`, `incidents`, `backup_records`. | Critical. | Backup required; additive only; no real deployment/cloud provider integration. | Deployment approval gate tests, rollback plan required tests, incident status constraints. | Deployment/cloud records are visibility-only and approval-gated. |
| Phase 12K - seed data and permission tests | Seed roles, permissions, Shrinika owner role, Shiva guardian role, company/departments/job roles. | Critical. | Seed script idempotent; backup before production; rollback by restore or explicit archive script. | Seed idempotency, permission matrix, customer denied internal access, duplicate active user-role prevention. | Permission seed matches reviewed matrix. |
| Phase 12L - API wiring after DB approval | No new tables by default; add APIs only after DB/auth/RBAC approval. | Critical. | Feature flag or route disable; restore backup if writes occurred. | API auth/RBAC, input validation, audit, approval, and module tests. | APIs remain thin and service-backed with internal-only enforcement. |

## 9. Migration Safety Rules

- No destructive migration without a verified backup.
- Prefer additive migrations first.
- Use nullable fields for MVP where the final workflow is not yet settled.
- Add strict `NOT NULL` constraints only when seed/default behavior is proven.
- Add indexes after relationship and query decisions are reviewed.
- Use foreign keys where relationships are stable and safe.
- Plan unique constraints carefully to avoid blocking legitimate history records.
- No production migration without Main Admin/Admin approval.
- Migration review is required before DB changes.
- Rollback plan is required before DB changes.
- Test DB migration is required before main DB migration.
- Seed scripts must be idempotent.
- Do not add secrets, provider keys, payment tokens, payroll data, or private HR documents to schema during placeholder phases.
- Do not modify Media Studio tables as part of Business Control Centre schema work.

## 10. Index And Constraint Planning

Proposed indexes and constraints:

- `users.email_normalized` unique where active, or unique globally if account recovery design allows.
- `users.user_type` check for `INTERNAL`, `EXTERNAL_CLIENT`, and future safe values.
- `roles.role_key` unique.
- `permissions.permission_key` unique.
- `role_permissions(role_id, permission_id)` unique for active grants.
- `user_roles(user_id, role_id, company_id, workspace_id)` unique for active role assignment.
- `audit_events(created_at DESC)`.
- `audit_events(action, created_at DESC)`.
- `audit_events(actor_user_id, created_at DESC)`.
- `audit_events(module, target_type, target_id, created_at DESC)`.
- `denied_access_events(user_id, created_at DESC)`.
- `approval_requests(status, created_at DESC)`.
- `approval_requests(module, request_type, status)`.
- `approval_steps(approval_request_id, step_order)`.
- `approval_decisions(approval_request_id, created_at DESC)`.
- `project_assignments(status, updated_at DESC)`.
- `project_assignments(project_id)` unique for active assignment if only one active assignment is allowed.
- `project_assignment_steps(assignment_id, sequence)` unique.
- `clients(account_status, priority, updated_at DESC)`.
- `support_tickets(status, priority, updated_at DESC)`.
- `support_tickets(client_id, status)`.
- `quotations(status, updated_at DESC)`.
- `invoices(payment_status, due_date_placeholder)`.
- `hr_requests(status, priority, updated_at DESC)`.
- `agent_tasks(status, approval_state, risk_level)`.
- `deployment_records(status, environment, updated_at DESC)`.
- `incidents(severity, status, updated_at DESC)`.
- Unique internal role keys for all seed roles.
- No duplicate active user-role pairs.
- Check constraints for stable status fields only after status vocabulary is reviewed.

## 11. Audit Data Model

Proposed `audit_events` structure:

- `id`
- `actor_user_id`
- `actor_role`
- `action`
- `module`
- `target_type`
- `target_id`
- `result`
- `severity`
- `ip_placeholder`
- `session_id`
- `metadata_json`
- `before_json`
- `after_json`
- `created_at`

Redaction rules:

- Never store raw passwords, session tokens, API keys, provider secrets, payment tokens, payroll secrets, or `.env` values.
- Redact known secret patterns before insert.
- Redact secrets before API response serialization.
- Store references to secret records only if a future encrypted secret store exists.
- Store before/after JSON only for fields that are safe for audit retention.
- Audit events are append-only. Corrections require a new audit event.

## 12. Approval Data Model

Proposed `approval_requests` structure:

- `id`
- `module`
- `request_type`
- `requester_user_id`
- `target_type`
- `target_id`
- `status`
- `risk_level`
- `required_role`
- `current_approver_id`
- `expires_at`
- `created_at`
- `updated_at`
- linked `approval_decisions`
- linked `approval_steps` for multi-step approvals
- linked `audit_event_id`

Decision records:

- Decision records are immutable.
- Every approval/rejection records approver, decision, redacted note, timestamp, and audit link.
- A request can have one final decision in MVP unless multi-step approval is enabled later.
- Expired approvals should require a new request, not silent reuse.
- Emergency override is future-only and must require owner authority, reason capture, time limit, and audit review.

## 13. Internal/Customer Separation Model

The database must prevent customer/internal mixing through both schema and permission logic:

- Use separate `external_client_users` for future Client Portal users, or enforce explicit `users.user_type`.
- Business Control Centre access requires `users.user_type='INTERNAL'` and an active internal profile.
- Internal roles must not be assigned to external customer users.
- The `customer_external` role is external scope only and has no internal permissions.
- Permission checks for Business Control Centre and App Studio always require an internal user.
- Client records in `clients` are company-managed business records, not internal admin accounts.
- Future Client Portal routes must use a separate API permission group and must expose only customer-safe records.
- Denied customer attempts to internal routes must create `denied_access_events`.

## 14. Test Plan

Future migration tests should cover:

- Schema creation on a fresh SQLite database.
- Additive migration from a legacy database.
- Seed idempotency across repeated initializer runs.
- Permission matrix coverage for every internal role.
- Customer role denied for Business Control Centre and App Studio permissions.
- No duplicate roles, permissions, role-permission grants, or active user-role pairs.
- Audit event creation for sensitive actions.
- Denied access event creation for blocked internal/customer attempts.
- Approval request creation and decision recording.
- Approval workflow links to audit events.
- Migration rollback safety using temporary DB backups or fixture copies.
- Redaction tests proving no secret/API key/session token is persisted in audit metadata.
- Foreign key behavior for stable relationships.
- Soft archive behavior where records must be retained.

## 15. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Schema too large too early. | Implement in phases; create only identity/RBAC/audit/approval foundations first. |
| RBAC bypass. | Deny-by-default middleware, service-layer checks, permission matrix tests, audit denied attempts. |
| Customer/internal role confusion. | Separate external user table or strict user type, external role scope, tests for denied internal access. |
| Destructive migrations. | Additive first, backup required, migration review, rollback plan, test DB run before main DB. |
| Missing audit logs. | Central audit service, audit-required tests, block sensitive writes if audit insert fails. |
| Broken seed data. | Idempotent seeds, stable keys, no duplicate active constraints, seed tests. |
| Overcomplicated placeholders. | Mark placeholders as future, keep MVP fields minimal, avoid real payment/HR/provider data. |
| Sensitive HR/finance data exposure. | Strict module permissions, export controls, redaction, audit trails, no real HR/payroll/payment data in placeholder phase. |

## 16. Out Of Scope

Step 12 explicitly excludes:

- Actual migrations.
- Schema file edits.
- Backend APIs.
- Auth/session implementation.
- UI edits.
- Seed script implementation.
- Production database changes.
- Media Studio changes.
- Real customer portal logic.
- Real payments, payroll, invoices, provider calls, deployment actions, DNS changes, backup jobs, or support integrations.
- Commit or push.

