# Shrinika Technologies Business Control Centre Step 1 PRD

## Product name

Shrinika Technologies Business Control Centre, also referred to as the Admin Portal.

## Parent company

Shrinika Technologies.

## Main admin

Shrinika is the main admin and owner authority for the Business Control Centre.

## Product context

Shrinika Automation Studio is a combined internal workspace for multiple companies under the parent company Shrinika Technologies. The Business Control Centre is the central administrative layer for company operations, project oversight, approvals, support visibility, finance summaries, HRMS visibility, agent operations, audit controls, and system health.

Step 1 is documentation and planning only. It defines the intended MVP shell and operating boundaries before implementation begins.

## Internal vs customer-facing boundary

App Studio and the Business Control Centre are internal-only systems for Shrinika Technologies employees and approved internal operators. They are not customer-facing products.

Customers must not access App Studio or the Business Control Centre. Customer interactions must use separate customer-facing channels:

- Public customer website
- Customer email
- Support channels
- Future client portal

The future client portal must be designed as a separate customer-facing product surface with separate access controls, data exposure rules, and support workflows.

## App Studio access restriction

App Studio access is restricted to approved Shrinika Technologies internal users only, including:

- Shrinika as main admin
- Employees
- Developers
- Managers
- Team leaders
- HR staff
- Approved internal operators

Customers, vendors without approval, and public users must not access App Studio.

## Role hierarchy

The initial role hierarchy is:

- Main Admin: Shrinika
- Admin Operators
- Managers
- Team Leaders
- Frontend Developers
- Backend Developers
- Testing / QA Developers
- Final Production Readiness Developers
- HR Operators
- Finance Operators
- Support Operators
- Agent Operators
- Read-only Internal Viewers

Role permissions must follow least privilege. Each role should only see the sections and actions required for its operational responsibility.

## Project assignment workflow

The target project assignment workflow is:

1. Admin assigns project
2. Manager receives project ownership
3. Team Leader receives delivery coordination responsibility
4. Developer 1 handles frontend implementation
5. Developer 2 handles backend implementation
6. Developer 3 handles testing / QA
7. Developer 4 handles final production readiness
8. Manager performs final approval
9. Deployment approval is granted by the authorized approver

The workflow should support clear ownership, status tracking, approvals, audit logging, and handoff visibility.

## Dashboard sections

The Business Control Centre must include these primary sections:

- Company Dashboard
- Project Operations
- Client Management
- Approvals Control Centre
- Support Desk
- Finance & Billing Overview
- HRMS / Employee Management
- Agent Operations
- Audit & Compliance
- System Health

## MVP scope

Step 1 implementation planning targets a Business Control Centre MVP Shell only. The MVP shell is a static internal admin dashboard structure with placeholder data and no production backend integration.

The planned MVP shell should include:

- Header showing Shrinika Technologies
- Main admin display showing Shrinika
- Sidebar navigation for all primary sections
- Company dashboard overview cards
- Project operations placeholder table
- Client management placeholder table
- Approvals placeholder table
- Support tickets placeholder table
- Agent activity placeholder table
- Audit placeholder table
- System health cards
- Finance placeholder section
- HRMS placeholder section

Out of scope for Step 1:

- Admin Portal UI implementation
- Backend routes
- Database migrations
- App Studio behavior changes
- Media Studio changes
- Authentication or authorization implementation
- Customer portal implementation
- Production deployment

## Security rules

The Business Control Centre must follow these rules:

- Internal-only access must be enforced before production use.
- Customers must never access App Studio or the Business Control Centre.
- Role-based access control must be required for future implementation.
- Sensitive data must not be exposed in placeholder UI, logs, test fixtures, docs examples, or API responses.
- `.env` secrets must never be revealed, copied, logged, or modified.
- Future API input must be validated at route boundaries.
- Future routes must remain thin, with business logic in services.
- Audit logging must cover approvals, project assignment transitions, access-sensitive actions, and deployment approvals.
- Read-only views must not expose mutation actions.
- Finance, HRMS, support, and audit data require stricter access controls than general dashboard overview data.

## Acceptance criteria

Step 1 documentation is accepted when:

- The PRD exists at `docs/business-control-centre-step-1-prd.md`.
- The PRD identifies the product name, parent company, and main admin.
- The PRD states the internal-only App Studio and Business Control Centre boundary.
- The PRD states that customers must use separate customer-facing channels.
- The PRD defines the initial role hierarchy.
- The PRD documents the project assignment workflow from admin assignment through deployment approval.
- The PRD lists all required dashboard sections.
- The PRD defines MVP shell scope and explicit out-of-scope items.
- The PRD includes security rules.
- The PRD includes future expansion notes.
- No UI, backend, database, test, App Studio, or Media Studio behavior changes are made.
- `npm run typecheck` completes successfully or any failure is reported with details.

## Future expansion notes

Future phases may add:

- Real authentication and role-based authorization
- Company dashboard metrics backed by database records
- Project assignment workflow automation
- Approval queue actions and audit trails
- Client records and linked project history
- Support desk ticket ingestion from customer channels
- Finance and billing integrations
- HRMS employee records, attendance, leave, and performance views
- Agent operations monitoring and task history
- Compliance exports and audit review workflows
- System health checks for internal services
- Separate customer-facing client portal with strict data isolation

