import { useEffect, useState } from "react";

type AppTheme = "dark" | "midnight" | "purple" | "emerald" | "sunset" | "light" | "contrast";

type MetricCard = {
  label: string;
  value: string;
  note: string;
  tone: "neutral" | "success" | "warning" | "danger";
};

type TableSection = {
  id: string;
  title: string;
  description: string;
  columns: string[];
  rows: string[][];
};

type AssignmentStatus =
  | "Assigned"
  | "In Development"
  | "Testing"
  | "Production Readiness"
  | "Waiting Manager Approval"
  | "Approved for Deployment"
  | "Deployed";

type ProjectAssignment = {
  projectName: string;
  clientCompany: string;
  currentStage: AssignmentStatus;
  assignedManager: string;
  assignedTeamLeader: string;
  frontendDeveloper: string;
  backendDeveloper: string;
  testingDeveloper: string;
  productionReadinessDeveloper: string;
  managerApprovalStatus: string;
  deploymentApprovalStatus: string;
  riskLevel: "Low" | "Medium" | "High";
  deadline: string;
  activeStep: number;
};

type WorkspaceOverview = {
  name: string;
  type: string;
  accessLevel: string;
  ownerAdmin: string;
  status: string;
  notes: string;
};

type DepartmentOverview = {
  name: string;
  purpose: string;
  responsibleRole: string;
  employeeCount: string;
  activeWork: string;
  status: string;
};

type RoleHierarchyItem = {
  role: string;
  description: string;
};

const appThemeOptions: Array<{ id: AppTheme; label: string }> = [
  { id: "dark", label: "Dark / Default" },
  { id: "midnight", label: "Midnight Blue" },
  { id: "purple", label: "Royal Purple" },
  { id: "emerald", label: "Emerald" },
  { id: "sunset", label: "Sunset" },
  { id: "light", label: "Light" },
  { id: "contrast", label: "High Contrast" }
];

const sidebarSections = [
  { id: "company-dashboard", label: "Company Dashboard" },
  { id: "company-workspaces", label: "Company / Workspaces" },
  { id: "department-structure", label: "Department Structure" },
  { id: "role-hierarchy", label: "Role Hierarchy" },
  { id: "access-boundary", label: "Access Boundary" },
  { id: "project-operations", label: "Project Operations" },
  { id: "project-assignment-control", label: "Project Assignment Control" },
  { id: "client-management", label: "Client Management" },
  { id: "approvals", label: "Approvals Control Centre" },
  { id: "support-desk", label: "Support Desk" },
  { id: "finance-billing", label: "Finance & Billing" },
  { id: "hrms", label: "HRMS / Employee Management" },
  { id: "agent-operations", label: "Agent Operations" },
  { id: "audit-compliance", label: "Audit & Compliance" },
  { id: "system-health", label: "System Health" }
];

const dashboardCards: MetricCard[] = [
  { label: "Parent company", value: "Shrinika Technologies", note: "Owner organization", tone: "neutral" },
  { label: "Main Admin / Owner", value: "Shrinika", note: "Primary admin authority", tone: "success" },
  { label: "Internal operator", value: "Shiva", note: "Founder builder / system guardian", tone: "success" },
  { label: "Internal companies/workspaces", value: "5", note: "Placeholder structure count", tone: "neutral" },
  { label: "Active departments", value: "11", note: "Mock department map", tone: "neutral" },
  { label: "Active employees", value: "42", note: "HRMS placeholder", tone: "success" },
  { label: "Active managers", value: "3", note: "Mock manager count", tone: "neutral" },
  { label: "Active team leaders", value: "3", note: "Mock team leader count", tone: "neutral" },
  { label: "Active developers", value: "12", note: "Frontend, backend, QA, readiness", tone: "neutral" },
  { label: "Active projects", value: "12", note: "Placeholder portfolio count", tone: "neutral" },
  { label: "Pending manager approvals", value: "1", note: "Static approval workload", tone: "warning" },
  { label: "System health", value: "Stable", note: "No live probes connected", tone: "success" }
];

const workspaceOverview: WorkspaceOverview[] = [
  {
    name: "Shrinika Technologies",
    type: "Parent Company",
    accessLevel: "Owner / internal governance",
    ownerAdmin: "Shrinika",
    status: "Active",
    notes: "Top-level company identity and admin authority."
  },
  {
    name: "Shrinika Automation Studio",
    type: "Internal Automation Workspace",
    accessLevel: "Internal employees and approved operators",
    ownerAdmin: "Shrinika",
    status: "Active placeholder",
    notes: "Combined internal workspace for multiple company operations."
  },
  {
    name: "App Studio",
    type: "Internal Development Workspace",
    accessLevel: "Internal builders only",
    ownerAdmin: "Shrinika / Shiva",
    status: "Active",
    notes: "Developer Agent, sandbox, Git workflow, readiness, missions, and scaffold controls."
  },
  {
    name: "Business Control Centre",
    type: "Internal Operations Workspace",
    accessLevel: "Internal admins, managers, and operators",
    ownerAdmin: "Shrinika",
    status: "MVP shell",
    notes: "Administrative dashboard for operations, approvals, roles, departments, and audit visibility."
  },
  {
    name: "Customer Website & Support",
    type: "External customer-facing system placeholder",
    accessLevel: "Customers, leads, visitors, support contacts",
    ownerAdmin: "Future customer systems team",
    status: "Separate surface",
    notes: "Customers use this path, email, support, and future Client Portal instead of App Studio."
  }
];

const departments: DepartmentOverview[] = [
  { name: "Admin & Governance", purpose: "Company controls, permissions, policy, and admin oversight.", responsibleRole: "Main Admin / Company Admin", employeeCount: "Placeholder", activeWork: "Governance queue", status: "Active" },
  { name: "Project Operations", purpose: "Project intake, assignment, handoffs, and delivery visibility.", responsibleRole: "Manager", employeeCount: "Placeholder", activeWork: "12 projects", status: "Active" },
  { name: "Development", purpose: "Frontend and backend implementation delivery.", responsibleRole: "Team Leader", employeeCount: "Placeholder", activeWork: "Development tasks", status: "Active" },
  { name: "Testing / QA", purpose: "Validation, bug review, regression checks, and release confidence.", responsibleRole: "Testing / QA Developer", employeeCount: "Placeholder", activeWork: "QA queue", status: "Active" },
  { name: "Production Readiness", purpose: "Final readiness, deployment preparation, and release checks.", responsibleRole: "Final Production Readiness Developer", employeeCount: "Placeholder", activeWork: "Readiness reviews", status: "Active" },
  { name: "HR", purpose: "Employee records, staffing, roles, and internal people operations.", responsibleRole: "HR", employeeCount: "Placeholder", activeWork: "HRMS placeholder", status: "Placeholder" },
  { name: "Finance & Billing", purpose: "Billing visibility, payment follow-ups, and finance oversight.", responsibleRole: "Finance Admin", employeeCount: "Placeholder", activeWork: "Finance placeholders", status: "Placeholder" },
  { name: "Customer Support", purpose: "Support queue handling through customer-facing channels.", responsibleRole: "Support Manager", employeeCount: "Placeholder", activeWork: "17 tickets", status: "Active placeholder" },
  { name: "Agent Operations", purpose: "Agent task visibility, coordination, and operational supervision.", responsibleRole: "Agent Supervisor", employeeCount: "Placeholder", activeWork: "9 agent tasks", status: "Active" },
  { name: "Audit & Compliance", purpose: "Audit trails, compliance review, and sensitive action visibility.", responsibleRole: "Auditor", employeeCount: "Placeholder", activeWork: "Audit review", status: "Active" },
  { name: "Cloud / Deployment", purpose: "Deployment approvals, cloud readiness, and release operations.", responsibleRole: "Manager / Cloud Operator", employeeCount: "Placeholder", activeWork: "Deployment placeholders", status: "Future integration" }
];

const roleHierarchy: RoleHierarchyItem[] = [
  { role: "Shrinika", description: "Main Admin / Owner Admin" },
  { role: "Shiva", description: "Founder Builder / Internal Operator / System Guardian" },
  { role: "Company Admin", description: "Company-level administration and governance" },
  { role: "Manager", description: "Project ownership, approvals, and final deployment approval" },
  { role: "Team Leader", description: "Delivery coordination and team execution" },
  { role: "Frontend Developer", description: "Frontend implementation" },
  { role: "Backend Developer", description: "Backend implementation" },
  { role: "Testing / QA Developer", description: "Testing, QA, and release validation" },
  { role: "Final Production Readiness Developer", description: "Final production readiness checks" },
  { role: "HR", description: "Employee and people operations" },
  { role: "Finance Admin", description: "Finance and billing oversight" },
  { role: "Support Manager", description: "Customer support operations" },
  { role: "Agent Supervisor", description: "Agent operations supervision" },
  { role: "Auditor", description: "Audit and compliance review" }
];

const internalAccessRoles = [
  "Shrinika",
  "Shiva",
  "Admin",
  "Manager",
  "Team Leader",
  "Developers",
  "HR",
  "Finance",
  "Support",
  "Agent Operators",
  "Auditors"
];

const externalAccessRoles = [
  "Customers",
  "Leads",
  "Website visitors",
  "Client Portal users",
  "Email/support contacts"
];

const workflowSteps = [
  "Admin assigns project",
  "Manager",
  "Team Leader",
  "Developer 1 Frontend",
  "Developer 2 Backend",
  "Developer 3 Testing / QA",
  "Developer 4 Final Production Readiness",
  "Manager final approval",
  "Deployment approval"
];

const assignmentWorkflowSteps = [
  "Admin",
  "Manager",
  "TL",
  "Frontend",
  "Backend",
  "Testing",
  "Production Readiness",
  "Manager Approval",
  "Deployment"
];

const assignmentStatusBadges: AssignmentStatus[] = [
  "Assigned",
  "In Development",
  "Testing",
  "Production Readiness",
  "Waiting Manager Approval",
  "Approved for Deployment",
  "Deployed"
];

const projectAssignments: ProjectAssignment[] = [
  {
    projectName: "Automation Studio Client Workspace",
    clientCompany: "Alpha Industries",
    currentStage: "In Development",
    assignedManager: "Aarav",
    assignedTeamLeader: "Meera",
    frontendDeveloper: "Developer 1 - Frontend",
    backendDeveloper: "Developer 2 - Backend",
    testingDeveloper: "Developer 3 - Testing / QA",
    productionReadinessDeveloper: "Developer 4 - Production Readiness",
    managerApprovalStatus: "Not ready",
    deploymentApprovalStatus: "Blocked until manager approval",
    riskLevel: "Medium",
    deadline: "Placeholder deadline",
    activeStep: 4
  },
  {
    projectName: "Support Desk Upgrade",
    clientCompany: "Beta Retail",
    currentStage: "Waiting Manager Approval",
    assignedManager: "Nisha",
    assignedTeamLeader: "Karan",
    frontendDeveloper: "Developer 1 - Frontend",
    backendDeveloper: "Developer 2 - Backend",
    testingDeveloper: "Developer 3 - Testing / QA",
    productionReadinessDeveloper: "Developer 4 - Production Readiness",
    managerApprovalStatus: "Pending manager approval",
    deploymentApprovalStatus: "Waiting",
    riskLevel: "High",
    deadline: "Placeholder deadline",
    activeStep: 8
  },
  {
    projectName: "Client Portal Foundation",
    clientCompany: "Gamma Services",
    currentStage: "Approved for Deployment",
    assignedManager: "Rohan",
    assignedTeamLeader: "Isha",
    frontendDeveloper: "Developer 1 - Frontend",
    backendDeveloper: "Developer 2 - Backend",
    testingDeveloper: "Developer 3 - Testing / QA",
    productionReadinessDeveloper: "Developer 4 - Production Readiness",
    managerApprovalStatus: "Approved by manager",
    deploymentApprovalStatus: "Approved placeholder",
    riskLevel: "Low",
    deadline: "Placeholder deadline",
    activeStep: 9
  }
];

const pendingManagerApprovals = projectAssignments.filter(assignment => assignment.currentStage === "Waiting Manager Approval");
const productionReadinessCompleted = projectAssignments.filter(assignment => ["Waiting Manager Approval", "Approved for Deployment", "Deployed"].includes(assignment.currentStage));

const tableSections: TableSection[] = [
  {
    id: "project-operations",
    title: "Project Operations",
    description: "Mock project assignment visibility for the internal workflow.",
    columns: ["Project", "Manager", "Team Leader", "Frontend", "Backend", "QA", "Production Readiness", "Status", "Next Approval"],
    rows: [
      ["Automation Studio", "Aarav", "Meera", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "In Review", "Manager"],
      ["Client Portal", "Nisha", "Karan", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "Planning", "Admin"],
      ["Support Desk", "Rohan", "Isha", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "QA", "Final Readiness"]
    ]
  },
  {
    id: "client-management",
    title: "Client Management",
    description: "Placeholder client records. No customer-facing access is enabled.",
    columns: ["Client", "Company", "Active Projects", "Support Status", "Billing Status"],
    rows: [
      ["Client Alpha", "Alpha Industries", "2", "Open follow-up", "Placeholder"],
      ["Client Beta", "Beta Retail", "1", "Stable", "Placeholder"],
      ["Client Gamma", "Gamma Services", "3", "Priority watch", "Placeholder"]
    ]
  },
  {
    id: "approvals",
    title: "Approvals Control Centre",
    description: "Static approval queue for future governance integration.",
    columns: ["Approval", "Requested By", "Current Owner", "Risk", "Status", "Due Date"],
    rows: [
      ["Deployment approval", "Manager", "Shrinika", "High", "Pending", "Sample"],
      ["Project assignment", "Admin Operator", "Manager", "Medium", "Pending", "Sample"],
      ["Final readiness", "QA Lead", "Manager", "High", "Reviewing", "Sample"]
    ]
  },
  {
    id: "support-desk",
    title: "Support Tickets",
    description: "Sample support queue. Customer intake remains outside App Studio.",
    columns: ["Ticket", "Source", "Assigned Team", "Priority", "Status"],
    rows: [
      ["SUP-1042", "Support email", "Support Ops", "High", "Triage"],
      ["SUP-1043", "Website form", "Client Success", "Medium", "Open"],
      ["SUP-1044", "Internal escalation", "Engineering", "High", "Investigating"]
    ]
  },
  {
    id: "agent-operations",
    title: "Agent Activity",
    description: "Placeholder visibility into internal agent tasks.",
    columns: ["Agent", "Task", "Current State", "Last Activity", "Requires Approval"],
    rows: [
      ["Developer Agent", "Plan dashboard shell", "Complete", "Sample", "No"],
      ["Security Review Agent", "Review access boundary", "Queued", "Sample", "No"],
      ["Final Review Agent", "Readiness checklist", "Waiting", "Sample", "Yes"]
    ]
  },
  {
    id: "audit-compliance",
    title: "Audit Events",
    description: "Static audit trail preview for future compliance reporting.",
    columns: ["Event", "Actor", "Area", "Severity", "Timestamp"],
    rows: [
      ["Approval viewed", "Shrinika", "Approvals", "Medium", "Placeholder"],
      ["Project assigned", "Admin Operator", "Projects", "Medium", "Placeholder"],
      ["Access boundary notice displayed", "System", "Compliance", "Low", "Placeholder"]
    ]
  }
];

const systemHealthCards = [
  { label: "App Studio", value: "Online placeholder", tone: "success" },
  { label: "API", value: "Not connected on this shell", tone: "neutral" },
  { label: "Database", value: "No reads in MVP shell", tone: "neutral" },
  { label: "Agent queue", value: "Static preview", tone: "warning" },
  { label: "Audit logging", value: "Future integration", tone: "warning" }
];

const financePlaceholders = [
  "Current month billing placeholder",
  "Pending invoices placeholder",
  "Payment follow-ups placeholder",
  "Finance alerts placeholder"
];

const hrmsPlaceholders = [
  "Employee count placeholder",
  "Active managers placeholder",
  "Team leaders placeholder",
  "Developer allocation placeholder",
  "HR alerts placeholder"
];

function isAppTheme(value: string | null): value is AppTheme {
  return appThemeOptions.some(theme => theme.id === value);
}

function useStoredAppTheme() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const storedTheme = window.localStorage.getItem("app-studio-theme");
      return isAppTheme(storedTheme) ? storedTheme : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("app-studio-theme", theme);
    } catch {
      // Theme persistence should never block internal dashboard access.
    }
  }, [theme]);

  return { theme, setTheme };
}

export function BusinessControlCentre({ navigate }: { navigate: (path: string) => void }) {
  const { theme, setTheme } = useStoredAppTheme();

  return (
    <main className="app-shell app-studio-shell business-control-shell" data-theme={theme}>
      <header className="topbar business-topbar">
        <div className="business-title-block">
          <span>Internal Admin Portal</span>
          <h1>Business Control Centre</h1>
          <p>Parent company: Shrinika Technologies</p>
        </div>
        <div className="business-header-meta">
          <div><span>Main Admin / Owner</span><strong>Shrinika</strong></div>
          <div><span>Operator</span><strong>Shiva / Internal Operator</strong></div>
          <div><span>System status</span><strong className="success">Placeholder stable</strong></div>
        </div>
        <div className="top-actions business-actions">
          <button className="top-link" onClick={() => navigate("/")}>App Studio</button>
          <label className="theme-select">Theme<select value={theme} onChange={event => setTheme(event.target.value as AppTheme)} aria-label="Business Control Centre theme">{appThemeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </div>
      </header>

      <div className="business-layout">
        <aside className="business-sidebar">
          <strong>Business Control</strong>
          <p>Internal sections</p>
          <nav aria-label="Business Control Centre sections">
            {sidebarSections.map(section => (
              <a key={section.id} href={`#${section.id}`} className="business-nav-item">{section.label}</a>
            ))}
          </nav>
        </aside>

        <section className="business-content">
          <section className="business-hero" id="company-dashboard">
            <div>
              <span className="business-kicker">Shrinika Technologies</span>
              <h2>Company Dashboard</h2>
              <p>Static MVP shell for internal business oversight. All data shown here is placeholder/mock data until approved database and API integrations are built.</p>
            </div>
            <div className="business-status-card">
              <span>Access boundary</span>
              <strong>Internal only</strong>
              <p>Customers must use the separate website, email, support channels, and future client portal.</p>
            </div>
          </section>

          <section className="business-boundary-notice">
            <strong>Internal-only notice</strong>
            <p>App Studio and Business Control Centre are restricted to Shrinika Technologies employees, developers, managers, team leaders, HR, and approved internal operators. Customers use the separate website, email, support, and future client portal.</p>
          </section>

          <section className="business-card-grid" aria-label="Company dashboard overview cards">
            {dashboardCards.map(card => (
              <article className={`business-metric-card ${card.tone}`} key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </article>
            ))}
          </section>

          <section className="business-section" id="company-workspaces">
            <div className="business-section-heading">
              <span>Mock company and workspace map. Customer systems remain separate from internal tools.</span>
              <h2>Company / Workspace Overview</h2>
            </div>
            <div className="workspace-overview-grid">
              {workspaceOverview.map(workspace => (
                <article className="workspace-overview-card" key={workspace.name}>
                  <div>
                    <span>{workspace.type}</span>
                    <h3>{workspace.name}</h3>
                  </div>
                  <div className="workspace-meta-grid">
                    <div><span>Access level</span><strong>{workspace.accessLevel}</strong></div>
                    <div><span>Owner/admin</span><strong>{workspace.ownerAdmin}</strong></div>
                    <div><span>Status</span><strong>{workspace.status}</strong></div>
                  </div>
                  <p>{workspace.notes}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="business-section" id="department-structure">
            <div className="business-section-heading">
              <span>Static department map for Shrinika Technologies operations.</span>
              <h2>Department Structure</h2>
            </div>
            <div className="department-grid">
              {departments.map(department => (
                <article className="department-card" key={department.name}>
                  <div className="department-card-header">
                    <h3>{department.name}</h3>
                    <span>{department.status}</span>
                  </div>
                  <p>{department.purpose}</p>
                  <div className="department-meta-grid">
                    <div><span>Responsible role</span><strong>{department.responsibleRole}</strong></div>
                    <div><span>Employees</span><strong>{department.employeeCount}</strong></div>
                    <div><span>Active projects/tasks</span><strong>{department.activeWork}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="business-section" id="role-hierarchy">
            <div className="business-section-heading">
              <span>Internal authority and delivery ladder.</span>
              <h2>Role Hierarchy</h2>
            </div>
            <div className="role-ladder" aria-label="Shrinika Technologies internal role hierarchy">
              {roleHierarchy.map((item, index) => (
                <article className="role-ladder-item" key={item.role}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.role}</strong>
                    <small>{item.description}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="business-section access-boundary-section" id="access-boundary">
            <div className="business-section-heading">
              <span>Internal systems and customer-facing systems must stay separated.</span>
              <h2>Access Boundary</h2>
            </div>
            <div className="access-boundary-grid">
              <article className="access-list-card internal">
                <span>Internal access</span>
                <h3>Allowed internal roles</h3>
                <div>{internalAccessRoles.map(role => <strong key={role}>{role}</strong>)}</div>
              </article>
              <article className="access-list-card external">
                <span>External access</span>
                <h3>Customer-facing roles and contacts</h3>
                <div>{externalAccessRoles.map(role => <strong key={role}>{role}</strong>)}</div>
              </article>
              <article className="access-rule-card">
                <span>Important rule</span>
                <strong>Customers must not access App Studio or Business Control Centre.</strong>
                <p>Customers, leads, website visitors, Client Portal users, and email/support contacts must use the separate customer website, email, support systems, and future Client Portal.</p>
              </article>
            </div>
          </section>

          <section className="business-section workflow-section">
            <div className="business-section-heading">
              <span>Project assignment workflow</span>
              <h2>Internal Delivery Chain</h2>
            </div>
            <div className="workflow-chain" aria-label="Internal project assignment chain">
              {workflowSteps.map((step, index) => (
                <div className="workflow-step" key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="business-section assignment-control-section" id="project-assignment-control">
            <div className="business-section-heading">
              <span>Static mock workflow data. No assignment persistence or deployment action is connected.</span>
              <h2>Project Assignment Control</h2>
            </div>
            <div className="role-boundary-notice">
              <strong>Role boundary</strong>
              <p>Only authorized internal Shrinika Technologies admins, managers, team leaders, and delivery members can access assignment workflows.</p>
            </div>
            <div className="assignment-status-strip" aria-label="Mock assignment statuses">
              {assignmentStatusBadges.map(status => <span className="assignment-status-badge" key={status}>{status}</span>)}
            </div>
            <div className="assignment-card-grid">
              {projectAssignments.map(assignment => (
                <article className="assignment-control-card" key={assignment.projectName}>
                  <div className="assignment-card-header">
                    <div>
                      <span>{assignment.clientCompany}</span>
                      <h3>{assignment.projectName}</h3>
                    </div>
                    <div className={`assignment-risk ${assignment.riskLevel.toLowerCase()}`}>{assignment.riskLevel} risk</div>
                  </div>
                  <div className="assignment-current-stage">
                    <span>Current stage</span>
                    <strong>{assignment.currentStage}</strong>
                    <small>{assignment.deadline}</small>
                  </div>
                  <div className="assignment-detail-grid">
                    <div><span>Assigned Manager</span><strong>{assignment.assignedManager}</strong></div>
                    <div><span>Assigned Team Leader</span><strong>{assignment.assignedTeamLeader}</strong></div>
                    <div><span>Frontend Developer</span><strong>{assignment.frontendDeveloper}</strong></div>
                    <div><span>Backend Developer</span><strong>{assignment.backendDeveloper}</strong></div>
                    <div><span>Testing / QA Developer</span><strong>{assignment.testingDeveloper}</strong></div>
                    <div><span>Final Production Readiness Developer</span><strong>{assignment.productionReadinessDeveloper}</strong></div>
                    <div><span>Manager final approval</span><strong>{assignment.managerApprovalStatus}</strong></div>
                    <div><span>Deployment approval</span><strong>{assignment.deploymentApprovalStatus}</strong></div>
                  </div>
                  <div className="assignment-tracker" aria-label={`${assignment.projectName} workflow tracker`}>
                    {assignmentWorkflowSteps.map((step, index) => {
                      const stepNumber = index + 1;
                      const state = stepNumber < assignment.activeStep ? "complete" : stepNumber === assignment.activeStep ? "active" : "pending";
                      return (
                        <div className={`assignment-tracker-step ${state}`} key={step}>
                          <span>{stepNumber}</span>
                          <strong>{step}</strong>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
            <div className="manager-approval-panel">
              <div className="business-section-heading">
                <span>Manager approval panel</span>
                <h2>Final Approval Control</h2>
              </div>
              <div className="approval-panel-grid">
                <article>
                  <span>Pending manager approvals</span>
                  <strong>{pendingManagerApprovals.length}</strong>
                  {pendingManagerApprovals.map(assignment => <small key={assignment.projectName}>{assignment.projectName}</small>)}
                </article>
                <article>
                  <span>Production readiness completed</span>
                  <strong>{productionReadinessCompleted.length}</strong>
                  {productionReadinessCompleted.map(assignment => <small key={assignment.projectName}>{assignment.projectName}</small>)}
                </article>
                <article>
                  <span>Deployment approval</span>
                  <strong>Placeholder only</strong>
                  <button type="button" disabled>Approve deployment</button>
                  <small>Final deployment approval must be given by the Manager.</small>
                </article>
              </div>
            </div>
          </section>

          {tableSections.map(section => (
            <section className="business-section" id={section.id} key={section.id}>
              <div className="business-section-heading">
                <span>{section.description}</span>
                <h2>{section.title}</h2>
              </div>
              <div className="business-table-wrap">
                <table className="business-table">
                  <thead>
                    <tr>{section.columns.map(column => <th key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {section.rows.map(row => (
                      <tr key={row.join("-")}>{row.map((cell, index) => <td key={`${cell}-${index}`}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="business-section split-business-section" id="finance-billing">
            <div>
              <div className="business-section-heading">
                <span>Placeholder section only</span>
                <h2>Finance & Billing</h2>
              </div>
              <div className="placeholder-list">{financePlaceholders.map(item => <span key={item}>{item}</span>)}</div>
            </div>
            <div id="hrms">
              <div className="business-section-heading">
                <span>Placeholder section only</span>
                <h2>HRMS / Employee Management</h2>
              </div>
              <div className="placeholder-list">{hrmsPlaceholders.map(item => <span key={item}>{item}</span>)}</div>
            </div>
          </section>

          <section className="business-section" id="system-health">
            <div className="business-section-heading">
              <span>Static system health cards. No backend probes in this slice.</span>
              <h2>System Health</h2>
            </div>
            <div className="system-health-grid">
              {systemHealthCards.map(card => (
                <article className={`system-health-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
