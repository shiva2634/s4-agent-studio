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

type ClientStatus = "Lead" | "Active" | "Waiting Approval" | "Support Needed" | "Payment Pending" | "Paused";

type ClientPriority = "Low" | "Medium" | "High";

type ClientRecord = {
  clientName: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  linkedProjects: string[];
  supportTicketCount: number;
  pendingApprovalCount: number;
  accountStatus: ClientStatus;
  priority: ClientPriority;
  lastContact: string;
};

type SupportIssueType =
  | "Bug"
  | "Feature request"
  | "Complaint"
  | "Billing issue"
  | "Access issue"
  | "Project correction"
  | "General support";

type SupportChannel = "Website form" | "Email" | "Phone" | "WhatsApp placeholder" | "Future Client Portal";

type SupportTicketStatus = "Open" | "Waiting Customer Reply" | "Waiting Internal Team" | "Escalated" | "Resolved Placeholder";

type SupportTicketRecord = {
  ticketId: string;
  client: string;
  relatedProject: string;
  issueType: SupportIssueType;
  priority: ClientPriority;
  status: SupportTicketStatus;
  assignedOwner: string;
  sourceChannel: SupportChannel;
  lastUpdate: string;
  internalNote: string;
};

type QuotationStatus = "Draft" | "Waiting Approval" | "Approved" | "Sent to Client" | "Revision Needed" | "Rejected";

type PaymentStatus = "Draft" | "Sent" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";

type FinanceQuotation = {
  quoteId: string;
  client: string;
  relatedProject: string;
  estimatedProductionCost: string;
  recommendedPrice: string;
  margin: string;
  status: QuotationStatus;
  approvalOwner: string;
  lastUpdate: string;
  riskLevel: ClientPriority;
};

type InvoicePaymentRecord = {
  invoiceId: string;
  client: string;
  relatedProject: string;
  amount: string;
  paymentStatus: PaymentStatus;
  dueDate: string;
  owner: string;
  lastUpdate: string;
};

type EmployeeDepartment =
  | "Admin & Governance"
  | "Project Operations"
  | "Development"
  | "Testing / QA"
  | "Production Readiness"
  | "HR"
  | "Finance & Billing"
  | "Customer Support"
  | "Agent Operations"
  | "Audit & Compliance"
  | "Cloud / Deployment";

type EmployeeRole =
  | "Main Admin / Owner Admin"
  | "Founder Builder / System Guardian"
  | "Company Admin"
  | "Manager"
  | "Team Leader"
  | "Frontend Developer"
  | "Backend Developer"
  | "Testing / QA Developer"
  | "Final Production Readiness Developer"
  | "HR Manager"
  | "Finance Admin"
  | "Support Manager"
  | "Agent Supervisor"
  | "Auditor"
  | "Cloud / Deployment Operator";

type EmployeeWorkStatus = "Active" | "Onboarding" | "Leave Placeholder" | "Access Review" | "Paused";

type EmployeeRecord = {
  employeeName: string;
  employeeId: string;
  department: EmployeeDepartment;
  role: EmployeeRole;
  reportingManager: string;
  workStatus: EmployeeWorkStatus;
  assignedProjects: string[];
  accessLevel: string;
  lastActivity: string;
};

type HRRequestType =
  | "Onboarding"
  | "Leave request"
  | "Access change"
  | "Role change"
  | "Payroll query placeholder"
  | "Performance review"
  | "Exit process placeholder"
  | "Compliance review";

type HRRequestStatus =
  | "Draft"
  | "Waiting Manager Approval"
  | "Waiting HR Approval"
  | "Waiting Admin Approval"
  | "Approved"
  | "Rejected"
  | "Completed";

type HRRequestRecord = {
  requestId: string;
  employee: string;
  requestType: HRRequestType;
  department: EmployeeDepartment;
  priority: ClientPriority;
  status: HRRequestStatus;
  approvalOwner: string;
  lastUpdate: string;
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

const clientStatusBadges: ClientStatus[] = ["Lead", "Active", "Waiting Approval", "Support Needed", "Payment Pending", "Paused"];

const clientOverviewCards: MetricCard[] = [
  { label: "Total clients", value: "8", note: "Static placeholder count", tone: "neutral" },
  { label: "Active clients", value: "4", note: "Mock active accounts", tone: "success" },
  { label: "New leads", value: "2", note: "Placeholder lead pipeline", tone: "neutral" },
  { label: "Clients with active projects", value: "5", note: "Linked to mock projects", tone: "success" },
  { label: "Pending approvals", value: "3", note: "Waiting internal/customer approval", tone: "warning" },
  { label: "Open support tickets", value: "7", note: "Static support workload", tone: "warning" },
  { label: "Payment pending", value: "2", note: "Placeholder billing follow-up", tone: "warning" },
  { label: "High priority clients", value: "2", note: "Mock priority watchlist", tone: "danger" }
];

const clients: ClientRecord[] = [
  {
    clientName: "Client Alpha",
    companyName: "Alpha Industries",
    contactPerson: "Priya Rao",
    email: "client.alpha@example.com",
    phone: "+91 90000 10001",
    linkedProjects: ["Automation Studio Client Workspace", "Reporting Dashboard"],
    supportTicketCount: 2,
    pendingApprovalCount: 1,
    accountStatus: "Active",
    priority: "High",
    lastContact: "Placeholder: this week"
  },
  {
    clientName: "Client Beta",
    companyName: "Beta Retail",
    contactPerson: "Arjun Mehta",
    email: "client.beta@example.com",
    phone: "+91 90000 10002",
    linkedProjects: ["Support Desk Upgrade"],
    supportTicketCount: 3,
    pendingApprovalCount: 2,
    accountStatus: "Support Needed",
    priority: "High",
    lastContact: "Placeholder: yesterday"
  },
  {
    clientName: "Client Gamma",
    companyName: "Gamma Services",
    contactPerson: "Neha Iyer",
    email: "client.gamma@example.com",
    phone: "+91 90000 10003",
    linkedProjects: ["Client Portal Foundation"],
    supportTicketCount: 1,
    pendingApprovalCount: 0,
    accountStatus: "Waiting Approval",
    priority: "Medium",
    lastContact: "Placeholder: last week"
  },
  {
    clientName: "Client Delta",
    companyName: "Delta Logistics",
    contactPerson: "Rahul Nair",
    email: "client.delta@example.com",
    phone: "+91 90000 10004",
    linkedProjects: ["Operations Intake"],
    supportTicketCount: 0,
    pendingApprovalCount: 0,
    accountStatus: "Lead",
    priority: "Medium",
    lastContact: "Placeholder: new inquiry"
  },
  {
    clientName: "Client Epsilon",
    companyName: "Epsilon Foods",
    contactPerson: "Anika Shah",
    email: "client.epsilon@example.com",
    phone: "+91 90000 10005",
    linkedProjects: ["Billing Workflow Review"],
    supportTicketCount: 1,
    pendingApprovalCount: 0,
    accountStatus: "Payment Pending",
    priority: "Medium",
    lastContact: "Placeholder: payment follow-up"
  },
  {
    clientName: "Client Zeta",
    companyName: "Zeta Manufacturing",
    contactPerson: "Vikram Das",
    email: "client.zeta@example.com",
    phone: "+91 90000 10006",
    linkedProjects: ["Maintenance Retainer"],
    supportTicketCount: 0,
    pendingApprovalCount: 0,
    accountStatus: "Paused",
    priority: "Low",
    lastContact: "Placeholder: paused account"
  }
];

const supportOverviewCards: MetricCard[] = [
  { label: "Open tickets", value: "7", note: "Static queue count", tone: "warning" },
  { label: "High priority tickets", value: "2", note: "Needs focused review", tone: "danger" },
  { label: "Waiting customer reply", value: "2", note: "External channel follow-up", tone: "warning" },
  { label: "Waiting internal team", value: "3", note: "Assigned owner follow-up", tone: "warning" },
  { label: "Resolved this week", value: "5", note: "Placeholder resolved metric", tone: "success" },
  { label: "Escalated tickets", value: "1", note: "Mock escalation placeholder", tone: "danger" }
];

const supportIssueTypes: SupportIssueType[] = ["Bug", "Feature request", "Complaint", "Billing issue", "Access issue", "Project correction", "General support"];

const supportChannels: SupportChannel[] = ["Website form", "Email", "Phone", "WhatsApp placeholder", "Future Client Portal"];

const supportWorkflowSteps = [
  "Customer request",
  "Support Desk",
  "Support Manager",
  "Assigned internal owner",
  "Manager / Team Leader if project-related",
  "Resolution",
  "Customer update through external channel"
];

const supportTickets: SupportTicketRecord[] = [
  {
    ticketId: "SUP-1042",
    client: "Client Beta",
    relatedProject: "Support Desk Upgrade",
    issueType: "Bug",
    priority: "High",
    status: "Waiting Internal Team",
    assignedOwner: "Support Manager",
    sourceChannel: "Email",
    lastUpdate: "Placeholder: 2 hours ago",
    internalNote: "Engineering review needed before customer update."
  },
  {
    ticketId: "SUP-1043",
    client: "Client Alpha",
    relatedProject: "Automation Studio Client Workspace",
    issueType: "Feature request",
    priority: "Medium",
    status: "Waiting Customer Reply",
    assignedOwner: "Client Success",
    sourceChannel: "Website form",
    lastUpdate: "Placeholder: today",
    internalNote: "Clarify scope before adding to project queue."
  },
  {
    ticketId: "SUP-1044",
    client: "Client Gamma",
    relatedProject: "Client Portal Foundation",
    issueType: "Project correction",
    priority: "High",
    status: "Escalated",
    assignedOwner: "Team Leader",
    sourceChannel: "Phone",
    lastUpdate: "Placeholder: yesterday",
    internalNote: "Manager review required because this affects delivery scope."
  },
  {
    ticketId: "SUP-1045",
    client: "Client Epsilon",
    relatedProject: "Billing Workflow Review",
    issueType: "Billing issue",
    priority: "Medium",
    status: "Open",
    assignedOwner: "Finance Admin",
    sourceChannel: "WhatsApp placeholder",
    lastUpdate: "Placeholder: this week",
    internalNote: "Finance placeholder only; no real billing action connected."
  },
  {
    ticketId: "SUP-1046",
    client: "Client Delta",
    relatedProject: "Operations Intake",
    issueType: "Access issue",
    priority: "Low",
    status: "Waiting Customer Reply",
    assignedOwner: "Support Operator",
    sourceChannel: "Future Client Portal",
    lastUpdate: "Placeholder: pending portal launch",
    internalNote: "Future portal channel shown for planning only."
  },
  {
    ticketId: "SUP-1047",
    client: "Client Alpha",
    relatedProject: "Reporting Dashboard",
    issueType: "Complaint",
    priority: "Medium",
    status: "Waiting Internal Team",
    assignedOwner: "Manager",
    sourceChannel: "Email",
    lastUpdate: "Placeholder: last week",
    internalNote: "Review expectation mismatch with internal delivery owner."
  },
  {
    ticketId: "SUP-1048",
    client: "Client Zeta",
    relatedProject: "Maintenance Retainer",
    issueType: "General support",
    priority: "Low",
    status: "Resolved Placeholder",
    assignedOwner: "Support Operator",
    sourceChannel: "Website form",
    lastUpdate: "Placeholder: resolved this week",
    internalNote: "Resolved metric placeholder; no ticket persistence connected."
  }
];

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

const financeOverviewCards: MetricCard[] = [
  { label: "Draft quotations", value: "3", note: "Static quotation drafts", tone: "neutral" },
  { label: "Awaiting approval", value: "2", note: "Human approval required", tone: "warning" },
  { label: "Approved quotations", value: "4", note: "Ready for controlled send", tone: "success" },
  { label: "Pending agreements", value: "2", note: "Contract placeholders", tone: "warning" },
  { label: "Draft invoices", value: "3", note: "Not issued to customers", tone: "neutral" },
  { label: "Pending payments", value: "5", note: "Mock collection queue", tone: "warning" },
  { label: "Payments received", value: "INR 4.8L", note: "Placeholder received total", tone: "success" },
  { label: "Refund requests", value: "1", note: "Requires finance/admin approval", tone: "danger" },
  { label: "Monthly revenue", value: "INR 8.6L", note: "Placeholder revenue metric", tone: "success" },
  { label: "Expenses", value: "INR 2.1L", note: "Placeholder expense metric", tone: "neutral" }
];

const commercialWorkflowSteps = [
  "Client requirement",
  "App Studio production cost estimate",
  "Manager/Admin review",
  "Finance quotation draft",
  "Human approval",
  "Client send",
  "Agreement / contract",
  "Invoice",
  "Payment tracking",
  "Receipt",
  "Renewal / follow-up"
];

const quotationStatuses: QuotationStatus[] = ["Draft", "Waiting Approval", "Approved", "Sent to Client", "Revision Needed", "Rejected"];

const paymentStatuses: PaymentStatus[] = ["Draft", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled"];

const financeQuotations: FinanceQuotation[] = [
  {
    quoteId: "QTN-2401",
    client: "Client Alpha",
    relatedProject: "Automation Studio Client Workspace",
    estimatedProductionCost: "INR 1.8L placeholder",
    recommendedPrice: "INR 3.2L placeholder",
    margin: "Placeholder margin",
    status: "Waiting Approval",
    approvalOwner: "Shrinika / Manager",
    lastUpdate: "Placeholder: today",
    riskLevel: "High"
  },
  {
    quoteId: "QTN-2402",
    client: "Client Beta",
    relatedProject: "Support Desk Upgrade",
    estimatedProductionCost: "INR 90K placeholder",
    recommendedPrice: "INR 1.6L placeholder",
    margin: "Placeholder margin",
    status: "Draft",
    approvalOwner: "Finance Admin",
    lastUpdate: "Placeholder: yesterday",
    riskLevel: "Medium"
  },
  {
    quoteId: "QTN-2403",
    client: "Client Gamma",
    relatedProject: "Client Portal Foundation",
    estimatedProductionCost: "INR 2.4L placeholder",
    recommendedPrice: "INR 4.1L placeholder",
    margin: "Placeholder margin",
    status: "Approved",
    approvalOwner: "Shrinika",
    lastUpdate: "Placeholder: this week",
    riskLevel: "Low"
  },
  {
    quoteId: "QTN-2404",
    client: "Client Delta",
    relatedProject: "Operations Intake",
    estimatedProductionCost: "INR 65K placeholder",
    recommendedPrice: "INR 1.2L placeholder",
    margin: "Placeholder margin",
    status: "Sent to Client",
    approvalOwner: "Manager",
    lastUpdate: "Placeholder: sent sample",
    riskLevel: "Low"
  },
  {
    quoteId: "QTN-2405",
    client: "Client Epsilon",
    relatedProject: "Billing Workflow Review",
    estimatedProductionCost: "INR 75K placeholder",
    recommendedPrice: "INR 1.4L placeholder",
    margin: "Placeholder margin",
    status: "Revision Needed",
    approvalOwner: "Finance Admin",
    lastUpdate: "Placeholder: revision requested",
    riskLevel: "Medium"
  },
  {
    quoteId: "QTN-2406",
    client: "Client Zeta",
    relatedProject: "Maintenance Retainer",
    estimatedProductionCost: "INR 40K placeholder",
    recommendedPrice: "INR 80K placeholder",
    margin: "Placeholder margin",
    status: "Rejected",
    approvalOwner: "Shrinika",
    lastUpdate: "Placeholder: rejected sample",
    riskLevel: "High"
  }
];

const invoicePayments: InvoicePaymentRecord[] = [
  {
    invoiceId: "INV-3001",
    client: "Client Alpha",
    relatedProject: "Automation Studio Client Workspace",
    amount: "INR 3.2L placeholder",
    paymentStatus: "Sent",
    dueDate: "Placeholder: 15 days",
    owner: "Finance Admin",
    lastUpdate: "Placeholder: today"
  },
  {
    invoiceId: "INV-3002",
    client: "Client Beta",
    relatedProject: "Support Desk Upgrade",
    amount: "INR 1.6L placeholder",
    paymentStatus: "Partially Paid",
    dueDate: "Placeholder: this month",
    owner: "Finance Admin",
    lastUpdate: "Placeholder: payment follow-up"
  },
  {
    invoiceId: "INV-3003",
    client: "Client Gamma",
    relatedProject: "Client Portal Foundation",
    amount: "INR 4.1L placeholder",
    paymentStatus: "Paid",
    dueDate: "Placeholder: closed",
    owner: "Finance Admin",
    lastUpdate: "Placeholder: receipt prepared"
  },
  {
    invoiceId: "INV-3004",
    client: "Client Delta",
    relatedProject: "Operations Intake",
    amount: "INR 1.2L placeholder",
    paymentStatus: "Draft",
    dueDate: "Placeholder: not issued",
    owner: "Manager / Finance",
    lastUpdate: "Placeholder: draft"
  },
  {
    invoiceId: "INV-3005",
    client: "Client Epsilon",
    relatedProject: "Billing Workflow Review",
    amount: "INR 1.4L placeholder",
    paymentStatus: "Overdue",
    dueDate: "Placeholder: overdue",
    owner: "Finance Admin",
    lastUpdate: "Placeholder: approval needed before reminder"
  },
  {
    invoiceId: "INV-3006",
    client: "Client Zeta",
    relatedProject: "Maintenance Retainer",
    amount: "INR 80K placeholder",
    paymentStatus: "Cancelled",
    dueDate: "Placeholder: cancelled",
    owner: "Shrinika",
    lastUpdate: "Placeholder: cancelled sample"
  }
];

const financeApprovalRules = [
  "Quotation release requires human approval",
  "Invoice issue requires human approval",
  "Agreement/contract send requires human approval",
  "Refunds require finance/admin approval",
  "Payment reminders require approval if sensitive or high-value",
  "Customer-facing commercial documents must be audit logged"
];

const hrmsOverviewCards: MetricCard[] = [
  { label: "Total employees", value: "42", note: "Static employee placeholder", tone: "neutral" },
  { label: "Active employees", value: "36", note: "Mock active internal users", tone: "success" },
  { label: "Managers", value: "3", note: "Project ownership layer", tone: "neutral" },
  { label: "Team leaders", value: "3", note: "Delivery coordination layer", tone: "neutral" },
  { label: "Developers", value: "12", note: "Frontend, backend, readiness", tone: "neutral" },
  { label: "QA / testing members", value: "4", note: "Validation placeholder", tone: "neutral" },
  { label: "HR requests pending", value: "6", note: "Static request queue", tone: "warning" },
  { label: "Leave requests pending", value: "2", note: "Placeholder only", tone: "warning" },
  { label: "Onboarding in progress", value: "3", note: "Mock onboarding flow", tone: "success" },
  { label: "Payroll status", value: "Not connected", note: "Placeholder status only", tone: "warning" },
  { label: "Compliance checks", value: "Sample", note: "Static review placeholder", tone: "neutral" },
  { label: "Access reviews pending", value: "4", note: "Admin review required", tone: "danger" }
];

const employeeDepartments: EmployeeDepartment[] = [
  "Admin & Governance",
  "Project Operations",
  "Development",
  "Testing / QA",
  "Production Readiness",
  "HR",
  "Finance & Billing",
  "Customer Support",
  "Agent Operations",
  "Audit & Compliance",
  "Cloud / Deployment"
];

const employeeRoles: EmployeeRole[] = [
  "Main Admin / Owner Admin",
  "Founder Builder / System Guardian",
  "Company Admin",
  "Manager",
  "Team Leader",
  "Frontend Developer",
  "Backend Developer",
  "Testing / QA Developer",
  "Final Production Readiness Developer",
  "HR Manager",
  "Finance Admin",
  "Support Manager",
  "Agent Supervisor",
  "Auditor",
  "Cloud / Deployment Operator"
];

const employeeDirectory: EmployeeRecord[] = [
  {
    employeeName: "Shrinika",
    employeeId: "EMP-OWN-001",
    department: "Admin & Governance",
    role: "Main Admin / Owner Admin",
    reportingManager: "Owner authority",
    workStatus: "Active",
    assignedProjects: ["Business Control Centre", "Company Governance"],
    accessLevel: "Owner admin placeholder",
    lastActivity: "Placeholder: today"
  },
  {
    employeeName: "Shiva",
    employeeId: "EMP-SYS-002",
    department: "Agent Operations",
    role: "Founder Builder / System Guardian",
    reportingManager: "Shrinika",
    workStatus: "Active",
    assignedProjects: ["App Studio", "System Guardian Workflow"],
    accessLevel: "Internal operator placeholder",
    lastActivity: "Placeholder: active this week"
  },
  {
    employeeName: "Aarav",
    employeeId: "EMP-MGR-101",
    department: "Project Operations",
    role: "Manager",
    reportingManager: "Shrinika",
    workStatus: "Active",
    assignedProjects: ["Automation Studio Client Workspace"],
    accessLevel: "Manager access placeholder",
    lastActivity: "Placeholder: manager review"
  },
  {
    employeeName: "Meera",
    employeeId: "EMP-TL-201",
    department: "Development",
    role: "Team Leader",
    reportingManager: "Aarav",
    workStatus: "Active",
    assignedProjects: ["Automation Studio Client Workspace", "Reporting Dashboard"],
    accessLevel: "Team leader placeholder",
    lastActivity: "Placeholder: delivery sync"
  },
  {
    employeeName: "Dev Frontend 1",
    employeeId: "EMP-FE-301",
    department: "Development",
    role: "Frontend Developer",
    reportingManager: "Meera",
    workStatus: "Active",
    assignedProjects: ["Automation Studio Client Workspace"],
    accessLevel: "Developer access placeholder",
    lastActivity: "Placeholder: frontend task"
  },
  {
    employeeName: "Dev Backend 2",
    employeeId: "EMP-BE-302",
    department: "Development",
    role: "Backend Developer",
    reportingManager: "Meera",
    workStatus: "Access Review",
    assignedProjects: ["Support Desk Upgrade"],
    accessLevel: "Backend developer placeholder",
    lastActivity: "Placeholder: access review"
  },
  {
    employeeName: "QA Developer 3",
    employeeId: "EMP-QA-401",
    department: "Testing / QA",
    role: "Testing / QA Developer",
    reportingManager: "Karan",
    workStatus: "Active",
    assignedProjects: ["Client Portal Foundation"],
    accessLevel: "QA access placeholder",
    lastActivity: "Placeholder: QA queue"
  },
  {
    employeeName: "Readiness Developer 4",
    employeeId: "EMP-PR-501",
    department: "Production Readiness",
    role: "Final Production Readiness Developer",
    reportingManager: "Rohan",
    workStatus: "Onboarding",
    assignedProjects: ["Deployment Approval Placeholder"],
    accessLevel: "Readiness access placeholder",
    lastActivity: "Placeholder: onboarding"
  },
  {
    employeeName: "Nisha",
    employeeId: "EMP-HR-601",
    department: "HR",
    role: "HR Manager",
    reportingManager: "Shrinika",
    workStatus: "Active",
    assignedProjects: ["HRMS Placeholder"],
    accessLevel: "HR manager placeholder",
    lastActivity: "Placeholder: HR request review"
  },
  {
    employeeName: "Riya",
    employeeId: "EMP-FIN-701",
    department: "Finance & Billing",
    role: "Finance Admin",
    reportingManager: "Shrinika",
    workStatus: "Leave Placeholder",
    assignedProjects: ["Finance & Billing Placeholder"],
    accessLevel: "Finance admin placeholder",
    lastActivity: "Placeholder: leave request"
  }
];

const hrRequestTypes: HRRequestType[] = [
  "Onboarding",
  "Leave request",
  "Access change",
  "Role change",
  "Payroll query placeholder",
  "Performance review",
  "Exit process placeholder",
  "Compliance review"
];

const hrRequestStatuses: HRRequestStatus[] = [
  "Draft",
  "Waiting Manager Approval",
  "Waiting HR Approval",
  "Waiting Admin Approval",
  "Approved",
  "Rejected",
  "Completed"
];

const hrRequestQueue: HRRequestRecord[] = [
  {
    requestId: "HR-REQ-1001",
    employee: "Readiness Developer 4",
    requestType: "Onboarding",
    department: "Production Readiness",
    priority: "High",
    status: "Waiting Admin Approval",
    approvalOwner: "Shrinika",
    lastUpdate: "Placeholder: today"
  },
  {
    requestId: "HR-REQ-1002",
    employee: "Riya",
    requestType: "Leave request",
    department: "Finance & Billing",
    priority: "Medium",
    status: "Waiting Manager Approval",
    approvalOwner: "Finance Manager",
    lastUpdate: "Placeholder: yesterday"
  },
  {
    requestId: "HR-REQ-1003",
    employee: "Dev Backend 2",
    requestType: "Access change",
    department: "Development",
    priority: "High",
    status: "Waiting Admin Approval",
    approvalOwner: "Admin",
    lastUpdate: "Placeholder: access review"
  },
  {
    requestId: "HR-REQ-1004",
    employee: "QA Developer 3",
    requestType: "Performance review",
    department: "Testing / QA",
    priority: "Medium",
    status: "Waiting HR Approval",
    approvalOwner: "HR Manager",
    lastUpdate: "Placeholder: review cycle"
  },
  {
    requestId: "HR-REQ-1005",
    employee: "Meera",
    requestType: "Role change",
    department: "Development",
    priority: "High",
    status: "Draft",
    approvalOwner: "Manager / Admin",
    lastUpdate: "Placeholder: draft only"
  },
  {
    requestId: "HR-REQ-1006",
    employee: "Former Employee Placeholder",
    requestType: "Exit process placeholder",
    department: "Customer Support",
    priority: "High",
    status: "Completed",
    approvalOwner: "HR + Admin",
    lastUpdate: "Placeholder: access revoked sample"
  },
  {
    requestId: "HR-REQ-1007",
    employee: "Support Manager Placeholder",
    requestType: "Compliance review",
    department: "Customer Support",
    priority: "Low",
    status: "Approved",
    approvalOwner: "Auditor",
    lastUpdate: "Placeholder: approved"
  }
];

const onboardingWorkflowSteps = [
  "Candidate selected",
  "HR onboarding draft",
  "Manager role confirmation",
  "Admin access approval",
  "Tool/account setup",
  "Department assignment",
  "Project assignment",
  "Policy acknowledgement",
  "Active employee"
];

const leaveAttendancePlaceholders = [
  "Leave requests are placeholders only",
  "Attendance is not tracked yet",
  "Payroll is not connected yet",
  "Final approval rules must be added before real HR operations"
];

const hrApprovalRules = [
  "New employee onboarding requires HR + Admin approval",
  "Role changes require Manager + Admin approval",
  "Access changes require Admin approval",
  "Payroll-related actions require Finance/HR approval",
  "Exit process must revoke access before closure",
  "Sensitive employee actions must be audit logged"
];

function isAppTheme(value: string | null): value is AppTheme {
  return appThemeOptions.some(theme => theme.id === value);
}

function badgeClassName(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
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

function BusinessTableSection({ section }: { section: TableSection }) {
  return (
    <section className="business-section" id={section.id}>
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
  );
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

          <BusinessTableSection section={tableSections[0]} />

          <section className="business-section client-management-section" id="client-management">
            <div className="business-section-heading">
              <span>Static client workspace visibility. Customer-facing access is not enabled here.</span>
              <h2>Client Management</h2>
            </div>
            <div className="business-boundary-notice client-boundary-notice">
              <strong>Client Communication Boundary</strong>
              <p>Customers communicate through the customer website, email, support, and future Client Portal. Internal App Studio and Business Control Centre remain restricted to Shrinika Technologies internal teams.</p>
            </div>
            <div className="business-card-grid client-overview-grid" aria-label="Client management overview cards">
              {clientOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="client-status-strip" aria-label="Client status badges">
              {clientStatusBadges.map(status => <span className={`client-status-badge ${badgeClassName(status)}`} key={status}>{status}</span>)}
            </div>
            <div className="client-card-grid">
              {clients.map(client => (
                <article className="client-record-card" key={client.clientName}>
                  <div className="client-card-header">
                    <div>
                      <span>{client.companyName}</span>
                      <h3>{client.clientName}</h3>
                      <small>{client.contactPerson}</small>
                    </div>
                    <span className={`client-status-badge ${badgeClassName(client.accountStatus)}`}>{client.accountStatus}</span>
                  </div>
                  <div className="client-contact-grid">
                    <div><span>Email</span><strong>{client.email}</strong></div>
                    <div><span>Phone</span><strong>{client.phone}</strong></div>
                    <div><span>Last contact</span><strong>{client.lastContact}</strong></div>
                    <div><span>Priority</span><strong className={`priority-text ${client.priority.toLowerCase()}`}>{client.priority}</strong></div>
                  </div>
                  <div className="client-projects">
                    <span>Linked projects</span>
                    <div>{client.linkedProjects.map(project => <strong key={project}>{project}</strong>)}</div>
                  </div>
                  <div className="client-count-grid">
                    <div><span>Support tickets</span><strong>{client.supportTicketCount}</strong></div>
                    <div><span>Pending approvals</span><strong>{client.pendingApprovalCount}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <BusinessTableSection section={tableSections[1]} />

          <section className="business-section support-desk-section" id="support-desk">
            <div className="business-section-heading">
              <span>Static support queue. No real ticket persistence, email, or portal integration is connected.</span>
              <h2>Support Desk</h2>
            </div>
            <div className="business-boundary-notice support-boundary-notice">
              <strong>Support Desk is internal</strong>
              <p>Customers do not log into Business Control Centre. Customer updates must go through the website, email, phone, WhatsApp placeholder, support channels, or future Client Portal.</p>
            </div>
            <div className="business-card-grid support-overview-grid" aria-label="Support desk overview cards">
              {supportOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="support-reference-grid">
              <article>
                <span>Issue types</span>
                <div>{supportIssueTypes.map(type => <strong key={type}>{type}</strong>)}</div>
              </article>
              <article>
                <span>Source channels</span>
                <div>{supportChannels.map(channel => <strong key={channel}>{channel}</strong>)}</div>
              </article>
            </div>
            <div className="support-workflow-panel">
              <div className="business-section-heading">
                <span>Internal Support Workflow</span>
                <h2>Support Routing Chain</h2>
              </div>
              <div className="support-workflow-chain" aria-label="Internal support workflow">
                {supportWorkflowSteps.map((step, index) => (
                  <div className="support-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="support-ticket-grid">
              {supportTickets.map(ticket => (
                <article className="support-ticket-card" key={ticket.ticketId}>
                  <div className="support-ticket-header">
                    <div>
                      <span>{ticket.ticketId}</span>
                      <h3>{ticket.client}</h3>
                      <small>{ticket.relatedProject}</small>
                    </div>
                    <span className={`support-status-badge ${badgeClassName(ticket.status)}`}>{ticket.status}</span>
                  </div>
                  <div className="support-ticket-meta">
                    <div><span>Issue type</span><strong>{ticket.issueType}</strong></div>
                    <div><span>Priority</span><strong className={`priority-text ${ticket.priority.toLowerCase()}`}>{ticket.priority}</strong></div>
                    <div><span>Assigned owner</span><strong>{ticket.assignedOwner}</strong></div>
                    <div><span>Source channel</span><strong>{ticket.sourceChannel}</strong></div>
                    <div><span>Last update</span><strong>{ticket.lastUpdate}</strong></div>
                    <div><span>Internal note</span><strong>{ticket.internalNote}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {tableSections.slice(2).map(section => <BusinessTableSection section={section} key={section.id} />)}

          <section className="business-section finance-billing-section" id="finance-billing">
            <div className="business-section-heading">
              <span>Static commercial planning UI. No payment gateway, tax engine, invoice issue, or contract send is connected.</span>
              <h2>Finance & Billing</h2>
            </div>
            <div className="business-boundary-notice finance-boundary-notice">
              <strong>Finance Boundary Notice</strong>
              <p>This section is only a planning and placeholder UI. No real payments, invoices, tax calculation, contracts, or customer billing actions are connected yet.</p>
            </div>
            <div className="finance-scope-panel">
              <article>
                <span>App Studio owns</span>
                <p>Requirement analysis, scope, effort estimation, production-cost calculation, delivery risk, and recommended pricing.</p>
              </article>
              <article>
                <span>Finance & Billing owns</span>
                <p>Quotations, agreements/contracts, invoices, taxes, payment schedules, collections, receipts, renewals, refunds, and commercial document workflows.</p>
              </article>
            </div>
            <div className="business-card-grid finance-overview-grid" aria-label="Finance and billing overview cards">
              {financeOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="commercial-workflow-panel">
              <div className="business-section-heading">
                <span>Commercial Workflow</span>
                <h2>Requirement to Renewal Flow</h2>
              </div>
              <div className="commercial-workflow-chain" aria-label="Commercial workflow">
                {commercialWorkflowSteps.map((step, index) => (
                  <div className="commercial-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="finance-status-grid">
              <article>
                <span>Quotation statuses</span>
                <div>{quotationStatuses.map(status => <strong className={`finance-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
              <article>
                <span>Payment statuses</span>
                <div>{paymentStatuses.map(status => <strong className={`finance-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
            </div>
            <div className="finance-subsection">
              <div className="business-section-heading">
                <span>Mock quotation cards. Production cost comes from App Studio planning, commercial release stays with Finance.</span>
                <h2>Quotation Pipeline</h2>
              </div>
              <div className="quotation-card-grid">
                {financeQuotations.map(quotation => (
                  <article className="quotation-card" key={quotation.quoteId}>
                    <div className="finance-card-header">
                      <div>
                        <span>{quotation.quoteId}</span>
                        <h3>{quotation.client}</h3>
                        <small>{quotation.relatedProject}</small>
                      </div>
                      <span className={`finance-status-badge ${badgeClassName(quotation.status)}`}>{quotation.status}</span>
                    </div>
                    <div className="finance-detail-grid">
                      <div><span>Estimated production cost</span><strong>{quotation.estimatedProductionCost}</strong></div>
                      <div><span>Recommended price</span><strong>{quotation.recommendedPrice}</strong></div>
                      <div><span>Margin</span><strong>{quotation.margin}</strong></div>
                      <div><span>Approval owner</span><strong>{quotation.approvalOwner}</strong></div>
                      <div><span>Last update</span><strong>{quotation.lastUpdate}</strong></div>
                      <div><span>Risk level</span><strong className={`priority-text ${quotation.riskLevel.toLowerCase()}`}>{quotation.riskLevel}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="finance-subsection">
              <div className="business-section-heading">
                <span>Mock invoice and payment tracking. No real billing documents or collections are generated.</span>
                <h2>Invoices & Payments</h2>
              </div>
              <div className="invoice-table-wrap">
                <table className="business-table invoice-payment-table">
                  <thead>
                    <tr>
                      <th>Invoice ID</th>
                      <th>Client</th>
                      <th>Related project</th>
                      <th>Amount</th>
                      <th>Payment status</th>
                      <th>Due date</th>
                      <th>Owner</th>
                      <th>Last update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicePayments.map(invoice => (
                      <tr key={invoice.invoiceId}>
                        <td>{invoice.invoiceId}</td>
                        <td>{invoice.client}</td>
                        <td>{invoice.relatedProject}</td>
                        <td>{invoice.amount}</td>
                        <td><span className={`finance-status-badge ${badgeClassName(invoice.paymentStatus)}`}>{invoice.paymentStatus}</span></td>
                        <td>{invoice.dueDate}</td>
                        <td>{invoice.owner}</td>
                        <td>{invoice.lastUpdate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="approval-rules-panel">
              <div className="business-section-heading">
                <span>Approval Rules</span>
                <h2>Commercial Controls</h2>
              </div>
              <div className="approval-rules-grid">
                {financeApprovalRules.map(rule => <article key={rule}><span>Rule</span><strong>{rule}</strong></article>)}
              </div>
            </div>
          </section>

          <section className="business-section hrms-section" id="hrms">
            <div className="business-section-heading">
              <span>Static HRMS planning UI. No real employee records, attendance, leave approval, payroll, or HR backend is connected.</span>
              <h2>HRMS / Employee Management</h2>
            </div>
            <div className="business-boundary-notice hrms-boundary-notice">
              <strong>Employee Access Boundary</strong>
              <p>HRMS is internal-only. Employees may later receive role-based internal access, but customers must never access HRMS, Business Control Centre, or App Studio.</p>
            </div>
            <div className="business-card-grid hrms-overview-grid" aria-label="HRMS overview cards">
              {hrmsOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="hrms-reference-grid">
              <article>
                <span>Departments</span>
                <div>{employeeDepartments.map(department => <strong key={department}>{department}</strong>)}</div>
              </article>
              <article>
                <span>Roles</span>
                <div>{employeeRoles.map(role => <strong key={role}>{role}</strong>)}</div>
              </article>
            </div>
            <div className="hrms-subsection">
              <div className="business-section-heading">
                <span>Mock employee directory. No real employee database or attendance tracking is connected.</span>
                <h2>Employee Directory</h2>
              </div>
              <div className="employee-card-grid">
                {employeeDirectory.map(employee => (
                  <article className="employee-card" key={employee.employeeId}>
                    <div className="hrms-card-header">
                      <div>
                        <span>{employee.employeeId}</span>
                        <h3>{employee.employeeName}</h3>
                        <small>{employee.role}</small>
                      </div>
                      <span className={`hrms-status-badge ${badgeClassName(employee.workStatus)}`}>{employee.workStatus}</span>
                    </div>
                    <div className="hrms-detail-grid">
                      <div><span>Department</span><strong>{employee.department}</strong></div>
                      <div><span>Reporting manager</span><strong>{employee.reportingManager}</strong></div>
                      <div><span>Access level</span><strong>{employee.accessLevel}</strong></div>
                      <div><span>Last activity</span><strong>{employee.lastActivity}</strong></div>
                    </div>
                    <div className="employee-projects">
                      <span>Assigned projects</span>
                      <div>{employee.assignedProjects.map(project => <strong key={project}>{project}</strong>)}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="hrms-subsection">
              <div className="business-section-heading">
                <span>Mock HR request queue. No real leave, payroll, access, or role workflow is connected.</span>
                <h2>HR Request Queue</h2>
              </div>
              <div className="hrms-status-grid">
                <article>
                  <span>Request types</span>
                  <div>{hrRequestTypes.map(type => <strong key={type}>{type}</strong>)}</div>
                </article>
                <article>
                  <span>Request statuses</span>
                  <div>{hrRequestStatuses.map(status => <strong className={`hrms-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
                </article>
              </div>
              <div className="hr-request-grid">
                {hrRequestQueue.map(request => (
                  <article className="hr-request-card" key={request.requestId}>
                    <div className="hrms-card-header">
                      <div>
                        <span>{request.requestId}</span>
                        <h3>{request.employee}</h3>
                        <small>{request.requestType}</small>
                      </div>
                      <span className={`hrms-status-badge ${badgeClassName(request.status)}`}>{request.status}</span>
                    </div>
                    <div className="hrms-detail-grid">
                      <div><span>Department</span><strong>{request.department}</strong></div>
                      <div><span>Priority</span><strong className={`priority-text ${request.priority.toLowerCase()}`}>{request.priority}</strong></div>
                      <div><span>Approval owner</span><strong>{request.approvalOwner}</strong></div>
                      <div><span>Last update</span><strong>{request.lastUpdate}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="onboarding-workflow-panel">
              <div className="business-section-heading">
                <span>Onboarding Workflow</span>
                <h2>Candidate to Active Employee</h2>
              </div>
              <div className="onboarding-workflow-chain" aria-label="Onboarding workflow">
                {onboardingWorkflowSteps.map((step, index) => (
                  <div className="onboarding-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="hrms-control-grid">
              <article className="leave-attendance-panel">
                <div className="business-section-heading">
                  <span>Leave / Attendance Placeholder</span>
                  <h2>Operations Not Connected</h2>
                </div>
                <div>{leaveAttendancePlaceholders.map(item => <strong key={item}>{item}</strong>)}</div>
              </article>
              <article className="hr-approval-rules-panel">
                <div className="business-section-heading">
                  <span>HR Approval Rules</span>
                  <h2>Employee Controls</h2>
                </div>
                <div>{hrApprovalRules.map(rule => <strong key={rule}>{rule}</strong>)}</div>
              </article>
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
