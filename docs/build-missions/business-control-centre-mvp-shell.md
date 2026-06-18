# Business Control Centre MVP Shell Build Mission

## Target module

Business Control Centre / Admin Portal.

## First build slice

Business Control Centre MVP Shell only.

This build slice should create the first internal dashboard shell for Shrinika Technologies business administration. It should not add backend routes, database migrations, production workflows, or customer-facing features.

## Proposed route/page

Proposed future route:

- `/business-control-centre`

Alternative route if the existing app routing convention prefers admin naming:

- `/admin/business-control-centre`

The final route should be chosen during implementation after checking the current App Studio routing structure.

## Proposed layout

The MVP shell should use a two-column admin layout:

- Fixed or sticky left sidebar for section navigation
- Main content area for dashboard cards, placeholder tables, and status panels
- Header showing `Shrinika Technologies`
- Header metadata showing `Main Admin: Shrinika`
- Clear internal-only label to prevent customer-facing confusion

The page should be readable on desktop first and remain usable on smaller screens.

## Sidebar navigation

The sidebar should include:

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

Navigation may anchor to sections in the first shell. Full routed subpages can be added later.

## Dashboard cards

Company dashboard overview cards should include placeholders for:

- Active projects
- Pending approvals
- Open support tickets
- Active employees
- Monthly billing overview
- Agent activity
- System health
- Audit alerts

All values should be clearly marked as placeholder or sample data until real database/API integration exists.

## Placeholder tables

The MVP shell should include placeholder tables for:

- Project operations
- Client management
- Approvals
- Support tickets
- Agent activity
- Audit and compliance

Project operations placeholder columns:

- Project
- Manager
- Team Leader
- Frontend Developer
- Backend Developer
- QA Developer
- Production Readiness Owner
- Status
- Next Approval

Client management placeholder columns:

- Client
- Company
- Active Projects
- Support Status
- Billing Status

Approvals placeholder columns:

- Approval
- Requested By
- Current Owner
- Risk
- Status
- Due Date

Support tickets placeholder columns:

- Ticket
- Source
- Assigned Team
- Priority
- Status

Agent activity placeholder columns:

- Agent
- Task
- Current State
- Last Activity
- Requires Approval

Audit placeholder columns:

- Event
- Actor
- Area
- Severity
- Timestamp

## System health cards

System health placeholders should include:

- App Studio status
- API status
- Database status
- Agent queue status
- Audit logging status

## Finance and HRMS placeholders

Finance & Billing Overview should include placeholders for:

- Current month billing
- Pending invoices
- Payment follow-ups
- Finance alerts

HRMS / Employee Management should include placeholders for:

- Employee count
- Active managers
- Team leaders
- Developer allocation
- HR alerts

## Future DB/API needs

Future implementation will likely need database models or service-backed records for:

- Internal users and roles
- Companies and business units
- Clients
- Projects
- Project assignments
- Approval requests
- Support tickets
- Finance summaries and invoices
- HRMS employee records
- Agent tasks and activity
- Audit events
- System health checks

Future API routes should:

- Validate all input
- Keep route handlers thin
- Move business logic into services
- Enforce role-based access
- Reject unauthorized customer or public access
- Avoid exposing secrets, raw environment values, or sensitive internal details

## Role/access model notes

Initial access model assumptions:

- Shrinika has full main admin access.
- Admin operators may view and coordinate across all sections.
- Managers may view assigned projects and approval items.
- Team leaders may view assigned teams and project delivery status.
- Developers may view only assigned work context.
- QA and production readiness developers may view handoff and readiness status.
- HR operators may access HRMS-related sections.
- Finance operators may access finance and billing sections.
- Support operators may access support desk sections.
- Agent operators may access agent operations sections.
- Read-only internal viewers may view limited non-sensitive summaries.

Customers must have no access to this module.

## Acceptance criteria

The future MVP shell implementation will be accepted when:

- A Business Control Centre page exists at the selected internal route.
- The header shows `Shrinika Technologies`.
- The page shows `Main Admin: Shrinika`.
- Sidebar navigation includes all required sections.
- Company dashboard overview cards are visible.
- Project operations placeholder table is visible.
- Client management placeholder table is visible.
- Approvals placeholder table is visible.
- Support tickets placeholder table is visible.
- Agent activity placeholder table is visible.
- Audit placeholder table is visible.
- System health cards are visible.
- Finance and HRMS placeholder sections are visible.
- Placeholder data is clearly non-production.
- No customer-facing access path is introduced.
- No backend routes or database migrations are added in the MVP shell slice unless a later mission explicitly approves them.

## Rollback plan

If the future MVP shell causes issues:

- Remove the new Business Control Centre route/page from the app router.
- Remove any page-specific components introduced for the shell.
- Remove any page-specific styles introduced for the shell.
- Verify App Studio still loads without the Business Control Centre route.
- Run typecheck and relevant tests after rollback.

The rollback must not delete unrelated files or modify Media Studio.

## Test plan

For the future MVP shell implementation:

- Run `npm run typecheck`.
- Run relevant frontend tests if the web app has route or component tests.
- Add or update tests only for new Business Control Centre shell behavior.
- Verify sidebar labels render.
- Verify header renders `Shrinika Technologies`.
- Verify main admin renders as `Shrinika`.
- Verify placeholder sections render without backend data.
- Verify no new backend routes are required.
- Verify no customer-facing route exposes the internal page.

## Explicit non-goals

Do not include in the MVP shell slice:

- Backend route implementation
- Database migrations
- Real finance data
- Real HRMS data
- Real support ticket ingestion
- Real approval actions
- Real deployment actions
- Customer portal functionality
- App Studio behavior changes
- Media Studio changes

