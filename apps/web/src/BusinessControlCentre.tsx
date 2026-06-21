import { type FormEvent, useEffect, useState } from "react";
import {
  approveBuildMissionQueueItem,
  approveDevelopmentStart,
  blockDevelopmentStart,
  listAssignableUsers,
  listBuildMissionQueue,
  requestBuildMissionQueueChanges,
  requestDevelopmentStart,
  saveBuildMissionTeamAssignment,
  type AssignableUser,
  type BuildMissionQueueItem,
  type BuildMissionTeamAssignmentPayload
} from "./build-mission-queue";
import {
  archiveBuildMissionExecutionStatus,
  buildMissionExecutionStages,
  buildMissionExecutionStatuses,
  createBuildMissionExecutionStatus,
  listBuildMissionExecutionDashboard,
  updateBuildMissionExecutionStatus,
  type BuildMissionExecutionPayload
} from "./build-mission-execution";
import { createBuildMissionFromProjectIntake, createBusinessProjectIntake, listBusinessProjectIntakes, type BusinessProjectIntake, type BusinessProjectIntakePayload } from "./business-project-intake";
import type { InternalAuthState } from "./internal-auth";

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

type GovernanceRisk = "Low" | "Medium" | "High" | "Critical";

type AgentType =
  | "Developer Agent"
  | "Reviewer Agent"
  | "QA Agent"
  | "Security Agent"
  | "Media Agent"
  | "Social Agent"
  | "Growth Agent"
  | "Support Agent"
  | "Finance Agent"
  | "HR Agent"
  | "Cloud Agent"
  | "Audit Agent";

type AgentStatus = "Active" | "Paused" | "Waiting Approval" | "Blocked" | "Failed Placeholder" | "Review Required";

type AgentTaskStatus =
  | "Draft"
  | "Running Placeholder"
  | "Waiting Approval"
  | "In Review"
  | "Blocked"
  | "Completed Placeholder"
  | "Failed Placeholder";

type AgentApprovalState = "Not Required" | "Required" | "Pending" | "Approved" | "Rejected";

type AgentRegistryRecord = {
  agentName: string;
  agentType: AgentType;
  assignedModule: string;
  status: AgentStatus;
  currentTask: string;
  approvalRequirement: string;
  lastActivity: string;
  riskLevel: GovernanceRisk;
  provider: string;
};

type AgentTaskRecord = {
  taskId: string;
  agent: string;
  module: string;
  taskTitle: string;
  status: AgentTaskStatus;
  approvalState: AgentApprovalState;
  riskLevel: GovernanceRisk;
  owner: string;
  lastUpdate: string;
};

type AuditCategory = "Approval" | "Agent Task" | "Security" | "Finance" | "HR" | "Support" | "Client" | "Project" | "System" | "Policy";

type AuditSeverity = "Info" | "Low" | "Medium" | "High" | "Critical";

type AuditStatus = "Recorded" | "Needs Review" | "Approved" | "Blocked" | "Resolved" | "Escalated";

type AuditEventRecord = {
  eventId: string;
  category: AuditCategory;
  actor: string;
  target: string;
  severity: AuditSeverity;
  status: AuditStatus;
  timestamp: string;
  auditNote: string;
};

type BlockedSafetyEvent = {
  action: string;
  reasonBlocked: string;
  relatedModule: string;
  riskLevel: GovernanceRisk;
  requiredNextStep: string;
};

type SystemComponentStatus = "Healthy" | "Warning" | "Degraded Placeholder" | "Offline Placeholder" | "Not Connected" | "Needs Review";

type SystemComponentRecord = {
  componentName: string;
  area: string;
  status: SystemComponentStatus;
  healthNote: string;
  owner: string;
  lastChecked: string;
  riskLevel: GovernanceRisk;
  nextAction: string;
};

type DeploymentEnvironment = "Local" | "Staging Placeholder" | "Production Placeholder";

type ReleaseStatus =
  | "Draft"
  | "Waiting Approval"
  | "Testing"
  | "Security Review"
  | "Ready for Staging"
  | "Ready for Production"
  | "Deployed Placeholder"
  | "Rollback Required"
  | "Failed Placeholder";

type DeploymentReleaseRecord = {
  releaseId: string;
  projectModule: string;
  environment: DeploymentEnvironment;
  status: ReleaseStatus;
  approvalOwner: string;
  gitCheckpoint: string;
  testStatus: string;
  securityReviewStatus: string;
  rollbackStatus: string;
  lastUpdate: string;
};

type BackupRecoveryRecord = {
  item: string;
  frequency: string;
  status: SystemComponentStatus;
  owner: string;
  lastChecked: string;
  recoveryNote: string;
};

type IncidentStatus = "Open Placeholder" | "Investigating" | "Waiting Approval" | "Resolved Placeholder" | "Monitoring";

type IncidentRecord = {
  incidentId: string;
  area: string;
  severity: GovernanceRisk;
  status: IncidentStatus;
  owner: string;
  impact: string;
  requiredNextStep: string;
  lastUpdate: string;
};

type RoleDelegationRecord = {
  role: string;
  primaryAssignee: string;
  backupAssignee: string;
  temporaryDelegate: string;
  canHoldMultipleRoles: "Yes" | "No";
  approvalRequired: "Yes" | "No";
  maxWorkloadLevel: "Low" | "Medium" | "High";
  notes: string;
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

const sidebarSectionGroups = ["Company", "Organization", "Operations", "People", "Governance", "System"] as const;
type SidebarSectionGroup = (typeof sidebarSectionGroups)[number];

type SidebarSection = {
  id: string;
  label: string;
  group: SidebarSectionGroup;
};

const sidebarSections: SidebarSection[] = [
  { id: "company-dashboard", label: "Company Dashboard", group: "Company" },
  { id: "company-workspaces", label: "Company / Workspaces", group: "Company" },
  { id: "department-structure", label: "Department Structure", group: "Company" },
  { id: "role-hierarchy", label: "Role Hierarchy", group: "Company" },
  { id: "role-hierarchy-editor", label: "Role Hierarchy Editor", group: "Organization" },
  { id: "access-boundary", label: "Access Boundary", group: "Company" },
  { id: "project-operations", label: "Project Operations", group: "Operations" },
  { id: "create-project-prd", label: "Create Project / PRD", group: "Operations" },
  { id: "build-mission-queue", label: "Build Mission Queue", group: "Operations" },
  { id: "build-mission-execution", label: "Build Mission Execution", group: "Operations" },
  { id: "project-assignment-control", label: "Project Assignment Control", group: "Operations" },
  { id: "client-management", label: "Client Management", group: "Operations" },
  { id: "approvals", label: "Approvals Control Centre", group: "Operations" },
  { id: "support-desk", label: "Support Desk", group: "Operations" },
  { id: "finance-billing", label: "Finance & Billing", group: "Operations" },
  { id: "hrms", label: "HRMS / Employee Management", group: "People" },
  { id: "agent-operations", label: "Agent Operations", group: "Governance" },
  { id: "audit-compliance", label: "Audit & Compliance", group: "Governance" },
  { id: "system-health", label: "System Health", group: "System" },
  { id: "deployment-cloud", label: "Deployment / Cloud Ops", group: "System" }
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

const projectTypeOptions = ["Website", "SaaS", "Mobile App", "Automation", "CRM", "Media System", "Trading System", "Internal Tool", "Other"];
const projectPriorityOptions = ["Low", "Medium", "High", "Urgent"];
const projectSourceOptions = ["Client request", "Internal product idea", "Admin instruction", "Existing business workflow", "Product Discovery Agent"];
const prdStatusOptions = ["Not started", "Drafting", "Under review", "Approved", "Changes requested"];
const finalApprovalOwners = ["Admin", "Manager", "Shiva", "Shrinika"];

const prdWorkspaceItems = [
  "PRD upload placeholder",
  "PRD text draft placeholder",
  "AI-assisted PRD generation placeholder",
  "Human approval required",
  "App Studio build mission readiness checklist"
];

const appStudioReadinessChecklist = [
  "PRD approved",
  "Scope approved",
  "Core modules listed",
  "Risk assumptions reviewed",
  "Final approval owner selected",
  "Customer communication boundary confirmed"
];

const projectCreationWorkflowSteps = [
  "Project Created",
  "PRD Drafted",
  "PRD Reviewed",
  "Scope Approved",
  "App Studio Build Mission",
  "Team Assignment",
  "Development",
  "QA",
  "Manager Approval",
  "Deployment Approval"
];

const emptyProjectIntakeForm: BusinessProjectIntakePayload = {
  projectName: "",
  clientOrCompanyName: "",
  projectType: "SaaS",
  priority: "Medium",
  projectSource: "Admin instruction",
  prdStatus: "Not started",
  shortSummary: "",
  problemStatement: "",
  targetUsers: "",
  coreModulesRequired: "",
  keyFeatures: "",
  integrationsNeeded: "",
  designReferences: "",
  deliveryDeadline: "",
  estimatedBudgetRange: "",
  risksAssumptions: "",
  finalApprovalOwner: "Manager",
  workflowStatus: "PROJECT_CREATED"
};

const emptyBuildMissionAssignmentForm: BuildMissionTeamAssignmentPayload = {
  assignmentStatus: "DRAFT",
  managerUserId: "",
  teamLeaderUserId: "",
  frontendDeveloperUserId: "",
  backendDeveloperUserId: "",
  qaUserId: "",
  productionReadinessUserId: "",
  supportOwnerUserId: "",
  financeOwnerUserId: "",
  hrOwnerUserId: "",
  notes: ""
};

const emptyBuildMissionExecutionForm: BuildMissionExecutionPayload = {
  executionStatus: "READY_TO_START",
  currentStage: "DEVELOPMENT_START_APPROVED",
  progressPercent: 0,
  frontendStatus: "",
  backendStatus: "",
  qaStatus: "",
  productionReadinessStatus: "",
  blockerSummary: "",
  nextAction: "",
  ownerUserId: ""
};

const buildMissionAssignmentStatuses = ["DRAFT", "ASSIGNED", "IN_REVIEW", "READY_FOR_DEVELOPMENT_APPROVAL", "CHANGES_REQUESTED"] as const;

const roleDelegationCards: RoleDelegationRecord[] = [
  { role: "Admin / Main Admin", primaryAssignee: "Shrinika", backupAssignee: "Shiva", temporaryDelegate: "Company Admin placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Owner authority remains active for sensitive actions." },
  { role: "Manager", primaryAssignee: "Manager placeholder", backupAssignee: "Shrinika", temporaryDelegate: "Team Leader placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Can temporarily cover team leadership but cannot skip final gates." },
  { role: "Team Leader", primaryAssignee: "Team Leader placeholder", backupAssignee: "Manager placeholder", temporaryDelegate: "Senior developer placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Can coordinate delivery and request reassignment." },
  { role: "Frontend Developer", primaryAssignee: "Developer 1", backupAssignee: "Developer 2", temporaryDelegate: "Full-stack delegate placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "May combine with backend only after manager approval." },
  { role: "Backend Developer", primaryAssignee: "Developer 2", backupAssignee: "Developer 1", temporaryDelegate: "Full-stack delegate placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "API/database-sensitive work remains approval-gated." },
  { role: "QA / Testing Developer", primaryAssignee: "Developer 3", backupAssignee: "Team Leader placeholder", temporaryDelegate: "QA reviewer placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "QA cannot be skipped, only reassigned." },
  { role: "Production Readiness Developer", primaryAssignee: "Developer 4", backupAssignee: "Manager placeholder", temporaryDelegate: "Release reviewer placeholder", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Cannot approve own final production release." },
  { role: "Support Operator", primaryAssignee: "Support operator placeholder", backupAssignee: "Support Manager", temporaryDelegate: "Team Leader placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Low", notes: "Customer updates stay outside Business Control Centre." },
  { role: "Finance Operator", primaryAssignee: "Finance operator placeholder", backupAssignee: "Finance Admin", temporaryDelegate: "Admin placeholder", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Finance approvals require finance/admin authority." },
  { role: "HR Operator", primaryAssignee: "HR operator placeholder", backupAssignee: "HR Manager", temporaryDelegate: "Admin placeholder", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "HR approvals require HR/admin authority." },
  { role: "Agent Supervisor", primaryAssignee: "Agent supervisor placeholder", backupAssignee: "Shiva", temporaryDelegate: "Auditor placeholder", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Agent production action remains approval-gated." }
];

const shortOfEmployeesRules = [
  "Allow Manager to temporarily combine responsibilities.",
  "One developer can handle frontend + backend if approved.",
  "Team Leader can cover QA review only if Manager approves.",
  "Manager can cover Team Leader temporarily.",
  "Admin/Shiva final authority remains active.",
  "Deployment approval cannot be skipped.",
  "Sensitive actions still require approval."
];

const roleDelegationRules = [
  "No one can approve their own final production release.",
  "Final deployment approval must remain with Manager/Admin.",
  "QA cannot be skipped, only reassigned.",
  "Finance/billing approvals cannot be given to development roles without admin approval.",
  "HR approvals cannot be given to project developers without admin approval.",
  "All temporary role changes require audit log later when backend is connected."
];

const roleDelegationWorkflowSteps = [
  "Role Need Detected",
  "Backup Assigned",
  "Temporary Delegation Requested",
  "Manager/Admin Approval",
  "Active Delegation",
  "Review",
  "Revert or Extend"
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
  }
];

const systemHealthOverviewCards: MetricCard[] = [
  { label: "Overall system status", value: "Stable", note: "Static placeholder", tone: "success" },
  { label: "Web app status", value: "Healthy", note: "No live probe connected", tone: "success" },
  { label: "API status", value: "Not connected", note: "Placeholder API view", tone: "neutral" },
  { label: "Database status", value: "Sample", note: "No database read in UI", tone: "neutral" },
  { label: "Background jobs", value: "Placeholder", note: "No job runner connected", tone: "warning" },
  { label: "Provider health", value: "Stable", note: "No provider calls from UI", tone: "success" },
  { label: "Storage health", value: "Needs review", note: "Mock storage signal", tone: "warning" },
  { label: "Backup status", value: "Sample", note: "No backup job connected", tone: "neutral" },
  { label: "Last deployment", value: "Placeholder", note: "No deployment execution", tone: "neutral" },
  { label: "Uptime", value: "99.9%", note: "Placeholder uptime", tone: "success" },
  { label: "Open incidents", value: "2", note: "Mock incident count", tone: "danger" },
  { label: "Security checks", value: "Pending", note: "Static security review", tone: "warning" }
];

const systemComponentStatuses: SystemComponentStatus[] = ["Healthy", "Warning", "Degraded Placeholder", "Offline Placeholder", "Not Connected", "Needs Review"];

const systemComponents: SystemComponentRecord[] = [
  {
    componentName: "Business Control Centre",
    area: "Internal Admin",
    status: "Healthy",
    healthNote: "Static dashboard rendering placeholder.",
    owner: "Shrinika / Shiva",
    lastChecked: "Placeholder: today",
    riskLevel: "Low",
    nextAction: "Continue UI validation."
  },
  {
    componentName: "App Studio",
    area: "Internal Development",
    status: "Healthy",
    healthNote: "Internal-only workspace placeholder.",
    owner: "Shiva",
    lastChecked: "Placeholder: today",
    riskLevel: "Medium",
    nextAction: "Keep access boundary reviewed."
  },
  {
    componentName: "Agent Core",
    area: "Agent Governance",
    status: "Warning",
    healthNote: "Approval-gated agent controls placeholder.",
    owner: "Agent Supervisor",
    lastChecked: "Placeholder: this week",
    riskLevel: "High",
    nextAction: "Review blocked actions before release."
  },
  {
    componentName: "Media Studio",
    area: "Media",
    status: "Needs Review",
    healthNote: "Media provider view remains separate.",
    owner: "Media Operator",
    lastChecked: "Placeholder: sample",
    riskLevel: "Medium",
    nextAction: "No changes in this step."
  },
  {
    componentName: "Client Portal placeholder",
    area: "Customer Surface",
    status: "Not Connected",
    healthNote: "Future customer portal remains separate.",
    owner: "Future portal team",
    lastChecked: "Placeholder: not connected",
    riskLevel: "Medium",
    nextAction: "Do not expose internal systems."
  },
  {
    componentName: "Customer Website placeholder",
    area: "Customer Surface",
    status: "Not Connected",
    healthNote: "Customer website is outside this UI.",
    owner: "Customer systems team",
    lastChecked: "Placeholder: not connected",
    riskLevel: "Low",
    nextAction: "Keep customer access separate."
  },
  {
    componentName: "API Server",
    area: "Backend",
    status: "Warning",
    healthNote: "No live probe connected from dashboard.",
    owner: "Backend Operator",
    lastChecked: "Placeholder: sample",
    riskLevel: "Medium",
    nextAction: "Add real probes only in future backend step."
  },
  {
    componentName: "Database",
    area: "Data",
    status: "Degraded Placeholder",
    healthNote: "Mock status; no database read performed.",
    owner: "Database Operator",
    lastChecked: "Placeholder: sample",
    riskLevel: "High",
    nextAction: "Require backup and recovery review before production."
  },
  {
    componentName: "File Storage",
    area: "Storage",
    status: "Needs Review",
    healthNote: "Storage provider is placeholder only.",
    owner: "Cloud Operator",
    lastChecked: "Placeholder: sample",
    riskLevel: "Medium",
    nextAction: "Validate provider later with approval."
  },
  {
    componentName: "Provider Gateway",
    area: "Providers",
    status: "Warning",
    healthNote: "No real provider calls from this UI.",
    owner: "Shiva",
    lastChecked: "Placeholder: today",
    riskLevel: "High",
    nextAction: "Keep API keys redacted."
  },
  {
    componentName: "Audit Log",
    area: "Governance",
    status: "Healthy",
    healthNote: "Static audit log placeholder.",
    owner: "Auditor",
    lastChecked: "Placeholder: today",
    riskLevel: "Medium",
    nextAction: "Connect persistence in future approved step."
  },
  {
    componentName: "Notification System placeholder",
    area: "Notifications",
    status: "Offline Placeholder",
    healthNote: "Email/SMS notifications are not connected.",
    owner: "Support Manager",
    lastChecked: "Placeholder: not connected",
    riskLevel: "Low",
    nextAction: "Do not send emails from this UI."
  }
];

const deploymentOverviewCards: MetricCard[] = [
  { label: "Deployment candidates", value: "5", note: "Static release queue", tone: "neutral" },
  { label: "Awaiting approval", value: "3", note: "Manager/Admin approval required", tone: "warning" },
  { label: "Ready for staging", value: "2", note: "Placeholder readiness", tone: "success" },
  { label: "Ready for production", value: "1", note: "Requires final approval", tone: "warning" },
  { label: "Rollback plans", value: "4", note: "Placeholder plans", tone: "neutral" },
  { label: "Failed deployments", value: "1", note: "Mock failure count", tone: "danger" },
  { label: "Git checkpoints", value: "9", note: "Static checkpoint count", tone: "success" },
  { label: "Release notes pending", value: "3", note: "Documentation placeholder", tone: "warning" }
];

const deploymentPipelineSteps = [
  "Build mission complete",
  "Manager review",
  "Typecheck/tests",
  "Security review",
  "Git checkpoint",
  "Staging deployment placeholder",
  "QA validation",
  "Final approval",
  "Production deployment placeholder",
  "Post-deployment monitoring",
  "Rollback plan archived"
];

const deploymentEnvironments: DeploymentEnvironment[] = ["Local", "Staging Placeholder", "Production Placeholder"];

const releaseStatuses: ReleaseStatus[] = ["Draft", "Waiting Approval", "Testing", "Security Review", "Ready for Staging", "Ready for Production", "Deployed Placeholder", "Rollback Required", "Failed Placeholder"];

const deploymentReleases: DeploymentReleaseRecord[] = [
  {
    releaseId: "REL-9001",
    projectModule: "Business Control Centre",
    environment: "Local",
    status: "Testing",
    approvalOwner: "Manager",
    gitCheckpoint: "Checkpoint placeholder",
    testStatus: "Typecheck/tests placeholder passed",
    securityReviewStatus: "Pending security review",
    rollbackStatus: "Rollback plan draft",
    lastUpdate: "Placeholder: today"
  },
  {
    releaseId: "REL-9002",
    projectModule: "Client Management",
    environment: "Staging Placeholder",
    status: "Ready for Staging",
    approvalOwner: "Shrinika",
    gitCheckpoint: "Git checkpoint sample",
    testStatus: "Passed placeholder",
    securityReviewStatus: "Approved placeholder",
    rollbackStatus: "Plan archived placeholder",
    lastUpdate: "Placeholder: this week"
  },
  {
    releaseId: "REL-9003",
    projectModule: "Finance & Billing",
    environment: "Production Placeholder",
    status: "Waiting Approval",
    approvalOwner: "Shrinika / Finance Admin",
    gitCheckpoint: "Required before production",
    testStatus: "Waiting validation",
    securityReviewStatus: "Required before production",
    rollbackStatus: "Required before production",
    lastUpdate: "Placeholder: approval queue"
  },
  {
    releaseId: "REL-9004",
    projectModule: "Agent Operations",
    environment: "Staging Placeholder",
    status: "Security Review",
    approvalOwner: "Security reviewer",
    gitCheckpoint: "Checkpoint placeholder",
    testStatus: "Passed placeholder",
    securityReviewStatus: "In review placeholder",
    rollbackStatus: "Draft placeholder",
    lastUpdate: "Placeholder: security review"
  },
  {
    releaseId: "REL-9005",
    projectModule: "Media Studio",
    environment: "Local",
    status: "Rollback Required",
    approvalOwner: "Manager",
    gitCheckpoint: "Checkpoint sample",
    testStatus: "Failed placeholder",
    securityReviewStatus: "Needs review",
    rollbackStatus: "Rollback approval required",
    lastUpdate: "Placeholder: blocked"
  },
  {
    releaseId: "REL-9006",
    projectModule: "System Health",
    environment: "Production Placeholder",
    status: "Failed Placeholder",
    approvalOwner: "Cloud Operator",
    gitCheckpoint: "Missing checkpoint placeholder",
    testStatus: "Missing test validation",
    securityReviewStatus: "Not approved",
    rollbackStatus: "No action connected",
    lastUpdate: "Placeholder: failed sample"
  }
];

const cloudOperationsPlaceholders = [
  "Hosting provider placeholder",
  "Domain/DNS placeholder",
  "Email provider placeholder",
  "Storage provider placeholder",
  "Backup provider placeholder",
  "Monitoring provider placeholder",
  "SSL certificate placeholder",
  "CDN placeholder",
  "No real provider calls",
  "No secrets shown"
];

const backupRecoveryItems: BackupRecoveryRecord[] = [
  {
    item: "Database backup placeholder",
    frequency: "Daily placeholder",
    status: "Needs Review",
    owner: "Database Operator",
    lastChecked: "Placeholder: today",
    recoveryNote: "Recovery process not connected."
  },
  {
    item: "File storage backup placeholder",
    frequency: "Weekly placeholder",
    status: "Warning",
    owner: "Cloud Operator",
    lastChecked: "Placeholder: this week",
    recoveryNote: "Storage backup provider not connected."
  },
  {
    item: "Git repository checkpoint",
    frequency: "Before risky changes",
    status: "Healthy",
    owner: "Shiva",
    lastChecked: "Placeholder: active",
    recoveryNote: "Checkpoint required before deployment."
  },
  {
    item: "Environment config backup placeholder",
    frequency: "Manual placeholder",
    status: "Not Connected",
    owner: "Admin",
    lastChecked: "Placeholder: not connected",
    recoveryNote: "No secrets shown or copied."
  },
  {
    item: "Audit log export placeholder",
    frequency: "Monthly placeholder",
    status: "Warning",
    owner: "Auditor",
    lastChecked: "Placeholder: sample",
    recoveryNote: "Future export must redact sensitive data."
  },
  {
    item: "Media assets backup placeholder",
    frequency: "Weekly placeholder",
    status: "Degraded Placeholder",
    owner: "Media Operator",
    lastChecked: "Placeholder: sample",
    recoveryNote: "No backup jobs connected."
  }
];

const incidentStatuses: IncidentStatus[] = ["Open Placeholder", "Investigating", "Waiting Approval", "Resolved Placeholder", "Monitoring"];

const incidents: IncidentRecord[] = [
  {
    incidentId: "INC-7001",
    area: "Provider Gateway",
    severity: "High",
    status: "Investigating",
    owner: "Shiva",
    impact: "Provider health placeholder warning.",
    requiredNextStep: "Review provider circuit breaker before any real provider call.",
    lastUpdate: "Placeholder: today"
  },
  {
    incidentId: "INC-7002",
    area: "Database",
    severity: "Critical",
    status: "Waiting Approval",
    owner: "Database Operator",
    impact: "Backup review required before production readiness.",
    requiredNextStep: "Admin approval for future backup integration.",
    lastUpdate: "Placeholder: approval queue"
  },
  {
    incidentId: "INC-7003",
    area: "Deployment",
    severity: "Medium",
    status: "Open Placeholder",
    owner: "Manager",
    impact: "Release notes and rollback plan missing.",
    requiredNextStep: "Complete release notes and rollback plan.",
    lastUpdate: "Placeholder: this week"
  },
  {
    incidentId: "INC-7004",
    area: "Cloud / DNS",
    severity: "High",
    status: "Monitoring",
    owner: "Cloud Operator",
    impact: "DNS changes are blocked in this UI.",
    requiredNextStep: "Keep all domain changes approval-gated.",
    lastUpdate: "Placeholder: monitoring"
  },
  {
    incidentId: "INC-7005",
    area: "Security",
    severity: "Low",
    status: "Resolved Placeholder",
    owner: "Security reviewer",
    impact: "Secret display prevented in placeholder event.",
    requiredNextStep: "Keep redaction checks in approval rules.",
    lastUpdate: "Placeholder: resolved"
  }
];

const deploymentApprovalRules = [
  "Production deployment requires Manager/Admin approval",
  "Rollback requires approval unless emergency rule exists later",
  "Domain/DNS changes require Admin approval",
  "Provider changes require Admin approval",
  "Secret/API key changes require Admin + audit review",
  "Failed tests block deployment",
  "Security review required before production",
  "Git checkpoint required before deployment",
  "Post-deployment monitoring required",
  "Rollback plan required before production release"
];

type ReadinessTone = "ready" | "pending" | "warning";

type ReadinessItem = {
  label: string;
  status: string;
  tone: ReadinessTone;
};

const businessReadinessItems: ReadinessItem[] = [
  { label: "UI shell ready", status: "Ready", tone: "ready" },
  { label: "Internal-only boundary visible", status: "Ready", tone: "ready" },
  { label: "Company dashboard ready", status: "Ready", tone: "ready" },
  { label: "Project operations placeholder ready", status: "Ready", tone: "ready" },
  { label: "Client/support placeholder ready", status: "Ready", tone: "ready" },
  { label: "Finance placeholder ready", status: "Ready", tone: "ready" },
  { label: "HRMS placeholder ready", status: "Ready", tone: "ready" },
  { label: "Agent governance placeholder ready", status: "Ready", tone: "ready" },
  { label: "Audit/compliance placeholder ready", status: "Ready", tone: "ready" },
  { label: "System/cloud placeholder ready", status: "Ready", tone: "ready" },
  { label: "Backend wiring pending", status: "Pending", tone: "pending" },
  { label: "Auth/RBAC pending", status: "Pending", tone: "warning" },
  { label: "Database persistence pending", status: "Pending", tone: "pending" },
  { label: "Production approval pending", status: "Pending", tone: "warning" }
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

const agentOperationsOverviewCards: MetricCard[] = [
  { label: "Active agents", value: "8", note: "Static internal agent count", tone: "success" },
  { label: "Paused agents", value: "2", note: "Mock paused agents", tone: "warning" },
  { label: "Tasks running", value: "4", note: "Placeholder task activity", tone: "neutral" },
  { label: "Tasks waiting approval", value: "5", note: "Human review required", tone: "warning" },
  { label: "Failed tasks", value: "1", note: "Failure placeholder", tone: "danger" },
  { label: "Blocked actions", value: "7", note: "Safety gates prevented action", tone: "danger" },
  { label: "Provider health", value: "Stable", note: "No real probes from this UI", tone: "success" },
  { label: "Human approvals pending", value: "6", note: "Approval queue placeholder", tone: "warning" },
  { label: "Daily usage", value: "Sample", note: "Usage/cost placeholder", tone: "neutral" },
  { label: "Safety incidents", value: "2", note: "Mock incident queue", tone: "danger" },
  { label: "Sandbox checks", value: "Enabled", note: "Governance placeholder", tone: "success" },
  { label: "Git checkpoints", value: "12", note: "Mock checkpoint count", tone: "neutral" }
];

const agentTypes: AgentType[] = [
  "Developer Agent",
  "Reviewer Agent",
  "QA Agent",
  "Security Agent",
  "Media Agent",
  "Social Agent",
  "Growth Agent",
  "Support Agent",
  "Finance Agent",
  "HR Agent",
  "Cloud Agent",
  "Audit Agent"
];

const agentStatuses: AgentStatus[] = ["Active", "Paused", "Waiting Approval", "Blocked", "Failed Placeholder", "Review Required"];

const agentRegistry: AgentRegistryRecord[] = [
  {
    agentName: "Developer Agent",
    agentType: "Developer Agent",
    assignedModule: "App Studio",
    status: "Active",
    currentTask: "Build mission planning placeholder",
    approvalRequirement: "Required before file changes",
    lastActivity: "Placeholder: today",
    riskLevel: "High",
    provider: "OpenAI-compatible placeholder"
  },
  {
    agentName: "Reviewer Agent",
    agentType: "Reviewer Agent",
    assignedModule: "Code Review",
    status: "Review Required",
    currentTask: "Review pending change summary",
    approvalRequirement: "Human final review required",
    lastActivity: "Placeholder: this week",
    riskLevel: "Medium",
    provider: "Local/mock provider placeholder"
  },
  {
    agentName: "QA Agent",
    agentType: "QA Agent",
    assignedModule: "Testing",
    status: "Waiting Approval",
    currentTask: "Typecheck/test validation placeholder",
    approvalRequirement: "Required for risky checks",
    lastActivity: "Placeholder: queued",
    riskLevel: "Medium",
    provider: "NVIDIA provider placeholder"
  },
  {
    agentName: "Security Agent",
    agentType: "Security Agent",
    assignedModule: "Security Review",
    status: "Blocked",
    currentTask: "Secret exposure review placeholder",
    approvalRequirement: "Always required",
    lastActivity: "Placeholder: blocked event",
    riskLevel: "Critical",
    provider: "Local/mock provider placeholder"
  },
  {
    agentName: "Media Agent",
    agentType: "Media Agent",
    assignedModule: "Media Studio",
    status: "Paused",
    currentTask: "Asset generation placeholder",
    approvalRequirement: "Required before media job",
    lastActivity: "Placeholder: paused",
    riskLevel: "Low",
    provider: "Media provider placeholder"
  },
  {
    agentName: "Finance Agent",
    agentType: "Finance Agent",
    assignedModule: "Finance & Billing",
    status: "Failed Placeholder",
    currentTask: "Quotation review placeholder",
    approvalRequirement: "Required for documents",
    lastActivity: "Placeholder: failed sample",
    riskLevel: "High",
    provider: "OpenAI-compatible placeholder"
  },
  {
    agentName: "HR Agent",
    agentType: "HR Agent",
    assignedModule: "HRMS",
    status: "Active",
    currentTask: "Onboarding checklist placeholder",
    approvalRequirement: "Required for HR-sensitive actions",
    lastActivity: "Placeholder: active",
    riskLevel: "High",
    provider: "Local/mock provider placeholder"
  },
  {
    agentName: "Audit Agent",
    agentType: "Audit Agent",
    assignedModule: "Audit & Compliance",
    status: "Active",
    currentTask: "Audit log summary placeholder",
    approvalRequirement: "Human escalation required",
    lastActivity: "Placeholder: monitoring",
    riskLevel: "Medium",
    provider: "Local/mock provider placeholder"
  }
];

const agentTaskStatuses: AgentTaskStatus[] = ["Draft", "Running Placeholder", "Waiting Approval", "In Review", "Blocked", "Completed Placeholder", "Failed Placeholder"];

const agentApprovalStates: AgentApprovalState[] = ["Not Required", "Required", "Pending", "Approved", "Rejected"];

const agentTaskQueue: AgentTaskRecord[] = [
  {
    taskId: "AGT-1001",
    agent: "Developer Agent",
    module: "Business Control Centre",
    taskTitle: "Prepare Step 8 UI placeholder",
    status: "In Review",
    approvalState: "Pending",
    riskLevel: "High",
    owner: "Shiva",
    lastUpdate: "Placeholder: today"
  },
  {
    taskId: "AGT-1002",
    agent: "QA Agent",
    module: "Testing",
    taskTitle: "Run validation checks placeholder",
    status: "Waiting Approval",
    approvalState: "Required",
    riskLevel: "Medium",
    owner: "Manager",
    lastUpdate: "Placeholder: queued"
  },
  {
    taskId: "AGT-1003",
    agent: "Security Agent",
    module: "Security",
    taskTitle: "Review blocked secret exposure event",
    status: "Blocked",
    approvalState: "Rejected",
    riskLevel: "Critical",
    owner: "Security reviewer",
    lastUpdate: "Placeholder: blocked"
  },
  {
    taskId: "AGT-1004",
    agent: "Finance Agent",
    module: "Finance & Billing",
    taskTitle: "Quotation document review placeholder",
    status: "Draft",
    approvalState: "Required",
    riskLevel: "High",
    owner: "Finance Admin",
    lastUpdate: "Placeholder: draft"
  },
  {
    taskId: "AGT-1005",
    agent: "Support Agent",
    module: "Support Desk",
    taskTitle: "Ticket summary placeholder",
    status: "Completed Placeholder",
    approvalState: "Approved",
    riskLevel: "Low",
    owner: "Support Manager",
    lastUpdate: "Placeholder: complete"
  },
  {
    taskId: "AGT-1006",
    agent: "Cloud Agent",
    module: "Cloud / Deployment",
    taskTitle: "Deployment readiness placeholder",
    status: "Failed Placeholder",
    approvalState: "Pending",
    riskLevel: "Critical",
    owner: "Manager",
    lastUpdate: "Placeholder: failed"
  }
];

const agentGovernanceWorkflowSteps = [
  "Task request",
  "Agent planning",
  "Risk classification",
  "Human approval if required",
  "Sandboxed execution",
  "Git checkpoint",
  "Typecheck/test validation",
  "Security review",
  "Audit log",
  "Human final approval",
  "Release / archive"
];

const providerHealthPlaceholders = [
  "OpenAI-compatible provider placeholder",
  "NVIDIA provider placeholder",
  "Local/mock provider placeholder",
  "Media provider placeholder",
  "Provider circuit breaker placeholder",
  "Daily usage/cost limit placeholder",
  "No API keys shown",
  "No real provider calls from this UI"
];

const auditOverviewCards: MetricCard[] = [
  { label: "Audit events today", value: "28", note: "Static event count", tone: "neutral" },
  { label: "Approval decisions", value: "9", note: "Mock approval trail", tone: "success" },
  { label: "Blocked unsafe actions", value: "7", note: "Safety enforcement placeholder", tone: "danger" },
  { label: "Failed checks", value: "3", note: "Validation failures placeholder", tone: "danger" },
  { label: "Policy warnings", value: "5", note: "Governance warnings", tone: "warning" },
  { label: "Sensitive actions", value: "4", note: "Needs audit attention", tone: "warning" },
  { label: "Security reviews pending", value: "2", note: "Security queue placeholder", tone: "warning" },
  { label: "Compliance reviews pending", value: "3", note: "Compliance queue placeholder", tone: "warning" },
  { label: "Open incidents", value: "2", note: "Mock incident count", tone: "danger" },
  { label: "Resolved incidents", value: "6", note: "Static resolved count", tone: "success" }
];

const auditCategories: AuditCategory[] = ["Approval", "Agent Task", "Security", "Finance", "HR", "Support", "Client", "Project", "System", "Policy"];

const auditSeverities: AuditSeverity[] = ["Info", "Low", "Medium", "High", "Critical"];

const auditStatuses: AuditStatus[] = ["Recorded", "Needs Review", "Approved", "Blocked", "Resolved", "Escalated"];

const auditEvents: AuditEventRecord[] = [
  {
    eventId: "AUD-5001",
    category: "Approval",
    actor: "Shrinika",
    target: "Deployment approval placeholder",
    severity: "High",
    status: "Approved",
    timestamp: "Placeholder: today",
    auditNote: "Human final approval recorded as static sample."
  },
  {
    eventId: "AUD-5002",
    category: "Agent Task",
    actor: "Developer Agent",
    target: "Business Control Centre Step 8",
    severity: "Medium",
    status: "Needs Review",
    timestamp: "Placeholder: today",
    auditNote: "Agent task requires human review before release."
  },
  {
    eventId: "AUD-5003",
    category: "Security",
    actor: "Security Agent",
    target: "Secret/API key redaction gate",
    severity: "Critical",
    status: "Blocked",
    timestamp: "Placeholder: blocked sample",
    auditNote: "Secret exposure prevented. No secret value shown."
  },
  {
    eventId: "AUD-5004",
    category: "Finance",
    actor: "Finance Admin",
    target: "Quotation send placeholder",
    severity: "High",
    status: "Escalated",
    timestamp: "Placeholder: this week",
    auditNote: "Commercial document send requires approval."
  },
  {
    eventId: "AUD-5005",
    category: "HR",
    actor: "HR Manager",
    target: "Role change placeholder",
    severity: "High",
    status: "Needs Review",
    timestamp: "Placeholder: this week",
    auditNote: "Sensitive employee action requires Manager + Admin approval."
  },
  {
    eventId: "AUD-5006",
    category: "Policy",
    actor: "System",
    target: "Customer access restriction",
    severity: "Critical",
    status: "Recorded",
    timestamp: "Placeholder: continuous",
    auditNote: "Customers must not access internal systems."
  },
  {
    eventId: "AUD-5007",
    category: "Project",
    actor: "Manager",
    target: "Git checkpoint placeholder",
    severity: "Medium",
    status: "Resolved",
    timestamp: "Placeholder: yesterday",
    auditNote: "Risky change requires checkpoint before apply."
  }
];

const complianceControls = [
  "App Studio internal-only boundary",
  "Customer access restriction",
  "Human approval required for sensitive actions",
  "Commercial document approval required",
  "HR sensitive action approval required",
  "Agent production action approval required",
  "Audit logging required",
  "Secret/API key redaction required",
  "Sandbox and file boundary required",
  "Git checkpoint required before risky changes"
];

const blockedSafetyEvents: BlockedSafetyEvent[] = [
  {
    action: "Internal access attempt placeholder",
    reasonBlocked: "Customer attempted internal access placeholder",
    relatedModule: "Access Boundary",
    riskLevel: "Critical",
    requiredNextStep: "Keep customer on public website, email, support, or future Client Portal."
  },
  {
    action: "Production action placeholder",
    reasonBlocked: "Agent attempted unapproved production action",
    relatedModule: "Agent Operations",
    riskLevel: "Critical",
    requiredNextStep: "Require human approval and audit review."
  },
  {
    action: "Quotation send placeholder",
    reasonBlocked: "Finance document send without approval",
    relatedModule: "Finance & Billing",
    riskLevel: "High",
    requiredNextStep: "Route to Shrinika or Finance/Admin approval."
  },
  {
    action: "Role change placeholder",
    reasonBlocked: "HR role change without approval",
    relatedModule: "HRMS",
    riskLevel: "High",
    requiredNextStep: "Require Manager + Admin approval."
  },
  {
    action: "Sensitive output placeholder",
    reasonBlocked: "Secret/API key exposure prevented",
    relatedModule: "Security",
    riskLevel: "Critical",
    requiredNextStep: "Redact output and record audit event."
  },
  {
    action: "File path operation placeholder",
    reasonBlocked: "Unsafe file path blocked",
    relatedModule: "Sandbox",
    riskLevel: "High",
    requiredNextStep: "Validate path boundaries before continuing."
  },
  {
    action: "Release readiness placeholder",
    reasonBlocked: "Missing test validation",
    relatedModule: "Project Operations",
    riskLevel: "Medium",
    requiredNextStep: "Run typecheck/tests before final approval."
  }
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

function formatInternalRole(role: string | undefined): string {
  if (!role) return "Internal user";
  return role.split("_").map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function hasIntakeContent(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length >= 3;
}

function buildProjectIntakeHandoffChecklist(intake: BusinessProjectIntake | null) {
  return [
    { label: "PRD Approved", complete: intake?.prdStatus === "Approved" },
    { label: "Workflow Ready for App Studio", complete: intake?.workflowStatus === "READY_FOR_APP_STUDIO" },
    { label: "Core modules present", complete: hasIntakeContent(intake?.coreModulesRequired) },
    { label: "Key features present", complete: hasIntakeContent(intake?.keyFeatures) },
    { label: "Problem statement present", complete: hasIntakeContent(intake?.problemStatement) }
  ];
}

export function BusinessControlCentre({ navigate, auth, onLogout }: { navigate: (path: string) => void; auth: InternalAuthState; onLogout: () => Promise<void> }) {
  const { theme, setTheme } = useStoredAppTheme();
  const [activeSectionId, setActiveSectionId] = useState("company-dashboard");
  const activeSection = sidebarSections.find(section => section.id === activeSectionId) ?? sidebarSections[0];
  const [projectIntakeForm, setProjectIntakeForm] = useState<BusinessProjectIntakePayload>(emptyProjectIntakeForm);
  const [projectIntakes, setProjectIntakes] = useState<BusinessProjectIntake[]>([]);
  const [selectedProjectIntakeId, setSelectedProjectIntakeId] = useState<string>("");
  const [projectIntakeLoading, setProjectIntakeLoading] = useState(false);
  const [projectIntakeSaving, setProjectIntakeSaving] = useState(false);
  const [projectIntakeHandoffSaving, setProjectIntakeHandoffSaving] = useState(false);
  const [projectIntakeMessage, setProjectIntakeMessage] = useState("");
  const [projectIntakeError, setProjectIntakeError] = useState("");
  const [buildMissionQueue, setBuildMissionQueue] = useState<BuildMissionQueueItem[]>([]);
  const [selectedBuildMissionId, setSelectedBuildMissionId] = useState("");
  const [buildMissionQueueLoading, setBuildMissionQueueLoading] = useState(false);
  const [buildMissionQueueSaving, setBuildMissionQueueSaving] = useState(false);
  const [buildMissionQueueMessage, setBuildMissionQueueMessage] = useState("");
  const [buildMissionQueueError, setBuildMissionQueueError] = useState("");
  const [buildMissionApprovalNote, setBuildMissionApprovalNote] = useState("");
  const [buildMissionChangeReason, setBuildMissionChangeReason] = useState("");
  const [developmentStartNote, setDevelopmentStartNote] = useState("");
  const [developmentStartApprovalNote, setDevelopmentStartApprovalNote] = useState("");
  const [developmentStartBlockReason, setDevelopmentStartBlockReason] = useState("");
  const [buildMissionAssignmentForm, setBuildMissionAssignmentForm] = useState<BuildMissionTeamAssignmentPayload>(emptyBuildMissionAssignmentForm);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [assignableUsersLoading, setAssignableUsersLoading] = useState(false);
  const [assignableUsersError, setAssignableUsersError] = useState("");
  const [assignmentWarnings, setAssignmentWarnings] = useState<string[]>([]);
  const [buildMissionExecutionItems, setBuildMissionExecutionItems] = useState<BuildMissionQueueItem[]>([]);
  const [selectedExecutionBuildMissionId, setSelectedExecutionBuildMissionId] = useState("");
  const [buildMissionExecutionLoading, setBuildMissionExecutionLoading] = useState(false);
  const [buildMissionExecutionSaving, setBuildMissionExecutionSaving] = useState(false);
  const [buildMissionExecutionMessage, setBuildMissionExecutionMessage] = useState("");
  const [buildMissionExecutionError, setBuildMissionExecutionError] = useState("");
  const [buildMissionExecutionForm, setBuildMissionExecutionForm] = useState<BuildMissionExecutionPayload>(emptyBuildMissionExecutionForm);

  useEffect(() => {
    if (activeSection.id !== "create-project-prd") return;
    let cancelled = false;
    setProjectIntakeLoading(true);
    setProjectIntakeError("");
    listBusinessProjectIntakes()
      .then(intakes => {
        if (cancelled) return;
        setProjectIntakes(intakes);
        setSelectedProjectIntakeId(current => current || intakes[0]?.id || "");
      })
      .catch(error => {
        if (!cancelled) setProjectIntakeError(error instanceof Error ? error.message : "Unable to load project intakes");
      })
      .finally(() => {
        if (!cancelled) setProjectIntakeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-queue") return;
    let cancelled = false;
    setBuildMissionQueueLoading(true);
    setAssignableUsersLoading(true);
    setBuildMissionQueueError("");
    setAssignableUsersError("");
    Promise.allSettled([listBuildMissionQueue(), listAssignableUsers()])
      .then(results => {
        if (cancelled) return;
        const [queueResult, usersResult] = results;
        if (queueResult.status === "fulfilled") {
          setBuildMissionQueue(queueResult.value);
          setSelectedBuildMissionId(current => current || queueResult.value[0]?.buildMissionId || "");
        } else {
          setBuildMissionQueueError(queueResult.reason instanceof Error ? queueResult.reason.message : "Unable to load Build Mission queue");
        }
        if (usersResult.status === "fulfilled") {
          setAssignableUsers(usersResult.value);
        } else {
          setAssignableUsersError(usersResult.reason instanceof Error ? usersResult.reason.message : "Unable to load assignable internal users");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBuildMissionQueueLoading(false);
          setAssignableUsersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-execution") return;
    let cancelled = false;
    setBuildMissionExecutionLoading(true);
    setAssignableUsersLoading(true);
    setBuildMissionExecutionError("");
    setAssignableUsersError("");
    Promise.allSettled([listBuildMissionExecutionDashboard(), listAssignableUsers()])
      .then(results => {
        if (cancelled) return;
        const [dashboardResult, usersResult] = results;
        if (dashboardResult.status === "fulfilled") {
          setBuildMissionExecutionItems(dashboardResult.value);
          setSelectedExecutionBuildMissionId(current => current || dashboardResult.value[0]?.buildMissionId || "");
        } else {
          setBuildMissionExecutionError(dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Unable to load Build Mission execution dashboard");
        }
        if (usersResult.status === "fulfilled") {
          setAssignableUsers(usersResult.value);
        } else {
          setAssignableUsersError(usersResult.reason instanceof Error ? usersResult.reason.message : "Unable to load assignable internal users");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBuildMissionExecutionLoading(false);
          setAssignableUsersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  const selectedProjectIntake = projectIntakes.find(intake => intake.id === selectedProjectIntakeId) ?? projectIntakes[0] ?? null;
  const selectedProjectIntakeHandoffChecklist = buildProjectIntakeHandoffChecklist(selectedProjectIntake);
  const selectedProjectIntakeHandoffEligible = Boolean(selectedProjectIntake) && selectedProjectIntakeHandoffChecklist.every(item => item.complete) && !selectedProjectIntake?.appStudioBuildMissionId;
  const selectedBuildMission = buildMissionQueue.find(item => item.buildMissionId === selectedBuildMissionId) ?? buildMissionQueue[0] ?? null;
  const selectedExecutionItem = buildMissionExecutionItems.find(item => item.buildMissionId === selectedExecutionBuildMissionId) ?? buildMissionExecutionItems[0] ?? null;

  useEffect(() => {
    if (!selectedBuildMission) {
      setBuildMissionAssignmentForm(emptyBuildMissionAssignmentForm);
      setAssignmentWarnings([]);
      return;
    }
    setBuildMissionAssignmentForm({
      assignmentStatus: selectedBuildMission.assignment?.assignmentStatus ?? "DRAFT",
      managerUserId: selectedBuildMission.assignment?.managerUserId ?? "",
      teamLeaderUserId: selectedBuildMission.assignment?.teamLeaderUserId ?? "",
      frontendDeveloperUserId: selectedBuildMission.assignment?.frontendDeveloperUserId ?? "",
      backendDeveloperUserId: selectedBuildMission.assignment?.backendDeveloperUserId ?? "",
      qaUserId: selectedBuildMission.assignment?.qaUserId ?? "",
      productionReadinessUserId: selectedBuildMission.assignment?.productionReadinessUserId ?? "",
      supportOwnerUserId: selectedBuildMission.assignment?.supportOwnerUserId ?? "",
      financeOwnerUserId: selectedBuildMission.assignment?.financeOwnerUserId ?? "",
      hrOwnerUserId: selectedBuildMission.assignment?.hrOwnerUserId ?? "",
      notes: selectedBuildMission.assignment?.notes ?? ""
    });
    setAssignmentWarnings([]);
  }, [selectedBuildMission?.buildMissionId, selectedBuildMission?.assignment?.updatedAt]);
  useEffect(() => {
    const execution = selectedExecutionItem?.executionStatus;
    if (!selectedExecutionItem) {
      setBuildMissionExecutionForm(emptyBuildMissionExecutionForm);
      return;
    }
    setBuildMissionExecutionForm({
      executionStatus: execution?.executionStatus ?? "READY_TO_START",
      currentStage: execution?.currentStage ?? "DEVELOPMENT_START_APPROVED",
      progressPercent: execution?.progressPercent ?? 0,
      frontendStatus: execution?.frontendStatus ?? "",
      backendStatus: execution?.backendStatus ?? "",
      qaStatus: execution?.qaStatus ?? "",
      productionReadinessStatus: execution?.productionReadinessStatus ?? "",
      blockerSummary: execution?.blockerSummary ?? "",
      nextAction: execution?.nextAction ?? "",
      ownerUserId: execution?.ownerUserId ?? ""
    });
  }, [selectedExecutionItem?.buildMissionId, selectedExecutionItem?.executionStatus?.updatedAt]);
  const updateProjectIntakeField = (field: keyof BusinessProjectIntakePayload, value: string) => {
    setProjectIntakeForm(current => ({ ...current, [field]: value }));
  };
  const handleProjectIntakeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProjectIntakeSaving(true);
    setProjectIntakeMessage("");
    setProjectIntakeError("");
    try {
      const intake = await createBusinessProjectIntake(projectIntakeForm);
      setProjectIntakes(current => [intake, ...current]);
      setSelectedProjectIntakeId(intake.id);
      setProjectIntakeForm(emptyProjectIntakeForm);
      setProjectIntakeMessage(`Project intake created: ${intake.projectName}`);
    } catch (error) {
      setProjectIntakeError(error instanceof Error ? error.message : "Unable to create project intake");
    } finally {
      setProjectIntakeSaving(false);
    }
  };
  const handleProjectIntakeHandoff = async () => {
    if (!selectedProjectIntake || !selectedProjectIntakeHandoffEligible) return;
    setProjectIntakeHandoffSaving(true);
    setProjectIntakeMessage("");
    setProjectIntakeError("");
    try {
      const result = await createBuildMissionFromProjectIntake(selectedProjectIntake.id);
      setProjectIntakes(current => current.map(intake => intake.id === result.intake.id ? result.intake : intake));
      setSelectedProjectIntakeId(result.intake.id);
      setProjectIntakeMessage(`Build Mission draft created. App Studio approval is still required. Mission: ${result.buildMission.id}`);
    } catch (error) {
      setProjectIntakeError(error instanceof Error ? error.message : "Unable to create App Studio Build Mission draft");
    } finally {
      setProjectIntakeHandoffSaving(false);
    }
  };
  const updateBuildMissionAssignmentField = (field: keyof BuildMissionTeamAssignmentPayload, value: string) => {
    setBuildMissionAssignmentForm(current => ({ ...current, [field]: value }));
  };
  const refreshBuildMissionQueue = async (selectedId?: string) => {
    const queue = await listBuildMissionQueue();
    setBuildMissionQueue(queue);
    setSelectedBuildMissionId(selectedId || queue.find(item => item.buildMissionId === selectedBuildMission?.buildMissionId)?.buildMissionId || queue[0]?.buildMissionId || "");
  };
  const updateBuildMissionExecutionField = (field: keyof BuildMissionExecutionPayload, value: string | number) => {
    setBuildMissionExecutionForm(current => ({ ...current, [field]: value }));
  };
  const refreshBuildMissionExecutionDashboard = async (selectedId?: string) => {
    const dashboard = await listBuildMissionExecutionDashboard();
    setBuildMissionExecutionItems(dashboard);
    setSelectedExecutionBuildMissionId(selectedId || dashboard.find(item => item.buildMissionId === selectedExecutionItem?.buildMissionId)?.buildMissionId || dashboard[0]?.buildMissionId || "");
  };
  const handleApproveBuildMission = async () => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    try {
      const item = await approveBuildMissionQueueItem(selectedBuildMission.buildMissionId, buildMissionApprovalNote);
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionId(item.buildMissionId);
      setBuildMissionApprovalNote("");
      setBuildMissionQueueMessage("Build Mission approved. Development still requires App Studio governed approval before execution.");
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to approve Build Mission");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleRequestBuildMissionChanges = async () => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    try {
      const item = await requestBuildMissionQueueChanges(selectedBuildMission.buildMissionId, buildMissionChangeReason);
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionId(item.buildMissionId);
      setBuildMissionChangeReason("");
      setBuildMissionQueueMessage("Changes requested. Linked PRD intake moved back for review.");
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to request changes");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleSaveBuildMissionAssignment = async (assignmentStatus: "DRAFT" | "ASSIGNED") => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    setAssignmentWarnings([]);
    try {
      const result = await saveBuildMissionTeamAssignment(selectedBuildMission.buildMissionId, { ...buildMissionAssignmentForm, assignmentStatus });
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === result.item.buildMissionId ? result.item : entry));
      setSelectedBuildMissionId(result.item.buildMissionId);
      setAssignmentWarnings([...result.assignmentWarnings, ...result.roleFitWarnings]);
      setBuildMissionQueueMessage(assignmentStatus === "ASSIGNED" ? "Team assignment finalized. Implementation still starts only through App Studio governance." : "Team assignment draft saved.");
      await refreshBuildMissionQueue(result.item.buildMissionId);
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to save team assignment");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleRequestDevelopmentStart = async () => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    try {
      const item = await requestDevelopmentStart(selectedBuildMission.buildMissionId, developmentStartNote);
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionId(item.buildMissionId);
      setDevelopmentStartNote("");
      setBuildMissionQueueMessage("Development-start approval requested. No agents or proposals were started.");
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to request development start");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleApproveDevelopmentStart = async () => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    try {
      const item = await approveDevelopmentStart(selectedBuildMission.buildMissionId, developmentStartApprovalNote);
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionId(item.buildMissionId);
      setDevelopmentStartApprovalNote("");
      setBuildMissionQueueMessage("Development-start gate approved. This permits planning only; App Studio execution controls still apply.");
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to approve development start");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleBlockDevelopmentStart = async () => {
    if (!selectedBuildMission) return;
    setBuildMissionQueueSaving(true);
    setBuildMissionQueueMessage("");
    setBuildMissionQueueError("");
    try {
      const item = await blockDevelopmentStart(selectedBuildMission.buildMissionId, developmentStartBlockReason);
      setBuildMissionQueue(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionId(item.buildMissionId);
      setDevelopmentStartBlockReason("");
      setBuildMissionQueueMessage("Development-start gate blocked. Build Mission and assignment remain preserved.");
    } catch (error) {
      setBuildMissionQueueError(error instanceof Error ? error.message : "Unable to block development start");
    } finally {
      setBuildMissionQueueSaving(false);
    }
  };
  const handleCreateBuildMissionExecutionStatus = async () => {
    if (!selectedExecutionItem) return;
    setBuildMissionExecutionSaving(true);
    setBuildMissionExecutionMessage("");
    setBuildMissionExecutionError("");
    try {
      const item = await createBuildMissionExecutionStatus(selectedExecutionItem.buildMissionId);
      setBuildMissionExecutionItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedExecutionBuildMissionId(item.buildMissionId);
      setBuildMissionExecutionMessage("Execution record created. No agents, proposals, file changes, or deployment were started.");
      await refreshBuildMissionExecutionDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionExecutionError(error instanceof Error ? error.message : "Unable to create execution record");
    } finally {
      setBuildMissionExecutionSaving(false);
    }
  };
  const handleUpdateBuildMissionExecutionStatus = async () => {
    if (!selectedExecutionItem) return;
    setBuildMissionExecutionSaving(true);
    setBuildMissionExecutionMessage("");
    setBuildMissionExecutionError("");
    try {
      const item = await updateBuildMissionExecutionStatus(selectedExecutionItem.buildMissionId, {
        ...buildMissionExecutionForm,
        progressPercent: Number(buildMissionExecutionForm.progressPercent ?? 0)
      });
      setBuildMissionExecutionItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedExecutionBuildMissionId(item.buildMissionId);
      setBuildMissionExecutionMessage("Execution status updated manually.");
      await refreshBuildMissionExecutionDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionExecutionError(error instanceof Error ? error.message : "Unable to update execution status");
    } finally {
      setBuildMissionExecutionSaving(false);
    }
  };
  const handleArchiveBuildMissionExecutionStatus = async () => {
    if (!selectedExecutionItem) return;
    setBuildMissionExecutionSaving(true);
    setBuildMissionExecutionMessage("");
    setBuildMissionExecutionError("");
    try {
      const item = await archiveBuildMissionExecutionStatus(selectedExecutionItem.buildMissionId);
      setBuildMissionExecutionItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedExecutionBuildMissionId(item.buildMissionId);
      setBuildMissionExecutionMessage("Execution record archived. Historical database record is preserved.");
      await refreshBuildMissionExecutionDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionExecutionError(error instanceof Error ? error.message : "Unable to archive execution record");
    } finally {
      setBuildMissionExecutionSaving(false);
    }
  };
  const assignableUserLabel = (user: AssignableUser) => {
    const roleSummary = user.roleKeys.length ? user.roleKeys.join(", ") : user.title || "internal user";
    return `${user.displayName} (${user.email}) - ${roleSummary}`;
  };
  const displayAssignableUser = (userId: string | null | undefined) => {
    if (!userId) return "Not assigned";
    const user = assignableUsers.find(entry => entry.id === userId);
    return user ? `${user.displayName} (${user.email})` : userId;
  };
  const renderAssignableUserSelect = (label: string, field: keyof BuildMissionTeamAssignmentPayload, placeholder: string) => (
    <label>
      {label}
      <select value={String(buildMissionAssignmentForm[field] ?? "")} onChange={event => updateBuildMissionAssignmentField(field, event.target.value)} disabled={assignableUsersLoading}>
        <option value="">{placeholder}</option>
        {assignableUsers.map(user => <option key={`${field}-${user.id}`} value={user.id}>{assignableUserLabel(user)}</option>)}
      </select>
    </label>
  );

  return (
    <main className="app-shell app-studio-shell business-control-shell" data-theme={theme}>
      <header className="topbar business-topbar">
        <div className="business-title-block">
          <span>Internal-only admin workspace</span>
          <h1>Business Control Centre</h1>
          <p>Shrinika Technologies business administration</p>
        </div>
        <div className="business-header-meta">
          <div><span>Main Admin / Owner Admin</span><strong>Shrinika</strong></div>
          <div><span>Founder-builder / system guardian</span><strong>Shiva</strong></div>
          <div><span>Customer access boundary</span><strong className="success">Internal only</strong></div>
          <div className="business-session-state">
            <span>{auth.authenticated ? "Internal session active" : "Internal login"}</span>
            <strong>{auth.authenticated && auth.user ? auth.user.displayName || auth.user.email : "Not signed in"}</strong>
            <small>{auth.authenticated && auth.user ? formatInternalRole(auth.user.roles[0]) : "Business Control Centre and App Studio are internal-only."}</small>
          </div>
        </div>
        <div className="top-actions business-actions">
          {auth.authenticated ? <button className="top-link" onClick={() => void onLogout()}>Logout</button> : <button className="top-link" onClick={() => navigate("/internal-login")}>Internal login</button>}
          <button className="top-link" onClick={() => navigate("/")}>App Studio</button>
          <label className="theme-select">Theme<select value={theme} onChange={event => setTheme(event.target.value as AppTheme)} aria-label="Business Control Centre theme">{appThemeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </div>
      </header>

      <div className="business-layout">
        <aside className="business-sidebar">
          <strong>Business Control</strong>
          <p>Internal sections</p>
          <nav aria-label="Business Control Centre sections">
            {sidebarSectionGroups.map(group => (
              <div className="business-nav-group" key={group}>
                <span>{group}</span>
                {sidebarSections.filter(section => section.group === group).map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className={`business-nav-item${section.id === activeSection.id ? " active" : ""}`}
                    aria-current={section.id === activeSection.id ? "page" : undefined}
                    onClick={() => setActiveSectionId(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <section className="business-content">
          {activeSection.id === "company-dashboard" ? (
            <>
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

          <section className="business-section readiness-section" aria-label="Business Control Centre readiness">
            <div className="business-section-heading">
              <span>Static final-readiness snapshot before backend, auth, and persistence wiring.</span>
              <h2>Business Control Centre Readiness</h2>
            </div>
            <div className="readiness-panel-grid">
              {businessReadinessItems.map(item => (
                <article className={`readiness-item ${item.tone}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.status}</strong>
                </article>
              ))}
            </div>
          </section>

          <section className="business-boundary-notice backend-readiness-warning">
            <strong>Backend readiness warning</strong>
            <p>This Business Control Centre is currently a UI-only internal operations dashboard. Before production use, it still requires authentication, role-based access control, database persistence, backend APIs, audit persistence, approval workflow enforcement, security review, and deployment approval.</p>
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
            </>
          ) : null}

          {activeSection.id === "company-workspaces" ? (
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
          ) : null}

          {activeSection.id === "department-structure" ? (
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
          ) : null}

          {activeSection.id === "role-hierarchy" ? (
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
          ) : null}

          {activeSection.id === "role-hierarchy-editor" ? (
          <section className="business-section role-delegation-section" id="role-hierarchy-editor">
            <div className="business-section-heading">
              <span>Editable planning UI for role coverage, backup owners, and temporary delegation. No persistence or audit enforcement is connected yet.</span>
              <h2>Role Hierarchy Editor / Delegation Planner</h2>
            </div>
            <div className="business-boundary-notice role-delegation-boundary">
              <strong>Planning-only delegation boundary</strong>
              <p>This is a planning UI only. Backend persistence and audit enforcement will be added later. Role flexibility helps when employee count is low, but approval gates remain active.</p>
            </div>
            <div className="role-delegation-grid">
              {roleDelegationCards.map(role => (
                <article className="role-delegation-card" key={role.role}>
                  <div className="role-delegation-card-header">
                    <div>
                      <span>Internal role</span>
                      <h3>{role.role}</h3>
                    </div>
                    <strong className={`workload-badge ${role.maxWorkloadLevel.toLowerCase()}`}>{role.maxWorkloadLevel} workload</strong>
                  </div>
                  <div className="role-delegation-controls">
                    <label>Primary assignee<input defaultValue={role.primaryAssignee} aria-label={`${role.role} primary assignee`} /></label>
                    <label>Backup assignee<input defaultValue={role.backupAssignee} aria-label={`${role.role} backup assignee`} /></label>
                    <label>Temporary delegate<input defaultValue={role.temporaryDelegate} aria-label={`${role.role} temporary delegate`} /></label>
                    <label>Can hold multiple roles<select defaultValue={role.canHoldMultipleRoles} aria-label={`${role.role} multiple roles`}><option>Yes</option><option>No</option></select></label>
                    <label>Approval required<select defaultValue={role.approvalRequired} aria-label={`${role.role} approval required`}><option>Yes</option><option>No</option></select></label>
                    <label>Max workload level<select defaultValue={role.maxWorkloadLevel} aria-label={`${role.role} max workload`}><option>Low</option><option>Medium</option><option>High</option></select></label>
                    <label className="wide">Notes<textarea defaultValue={role.notes} aria-label={`${role.role} notes`} /></label>
                  </div>
                </article>
              ))}
            </div>
            <div className="delegation-panel-grid">
              <article className="short-staffing-panel">
                <div className="business-section-heading">
                  <span>Short of employees mode</span>
                  <h2>Temporary Coverage Rules</h2>
                </div>
                <div>{shortOfEmployeesRules.map(rule => <strong key={rule}>{rule}</strong>)}</div>
              </article>
              <article className="delegation-rules-panel">
                <div className="business-section-heading">
                  <span>Role delegation rules</span>
                  <h2>Approval Gates Stay Active</h2>
                </div>
                <div>{roleDelegationRules.map(rule => <strong key={rule}>{rule}</strong>)}</div>
              </article>
            </div>
            <div className="role-workflow-panel">
              <div className="business-section-heading">
                <span>Role hierarchy workflow preview</span>
                <h2>Delegation Lifecycle</h2>
              </div>
              <div className="role-workflow-chain" aria-label="Role delegation workflow">
                {roleDelegationWorkflowSteps.map((step, index) => (
                  <div className="role-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
          ) : null}

          {activeSection.id === "access-boundary" ? (
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
          ) : null}

          {activeSection.id === "project-assignment-control" ? (
            <>
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
            </>
          ) : null}

          {activeSection.id === "project-operations" ? <BusinessTableSection section={tableSections[0]} /> : null}

          {activeSection.id === "create-project-prd" ? (
          <section className="business-section project-prd-section" id="create-project-prd">
            <div className="business-section-heading">
              <span>Internal-only project creation and PRD intake. App Studio handoff creates a draft only after approval readiness.</span>
              <h2>Create Project & PRD Intake</h2>
            </div>
            <div className="business-boundary-notice project-prd-boundary">
              <strong>Project intake boundary</strong>
              <p>No project is sent to App Studio until PRD and scope are approved. Customer-facing communication remains outside Business Control Centre. Build Mission handoff creates a governed draft only; no agents start automatically.</p>
            </div>
            <div className="project-prd-layout">
              <form className="project-prd-form" aria-label="Create internal project and PRD intake form" onSubmit={event => void handleProjectIntakeSubmit(event)}>
                <div className="project-prd-form-grid">
                  <label>Project name<input value={projectIntakeForm.projectName} onChange={event => updateProjectIntakeField("projectName", event.target.value)} placeholder="Example: Client Portal Foundation" /></label>
                  <label>Client / internal company name<input value={projectIntakeForm.clientOrCompanyName} onChange={event => updateProjectIntakeField("clientOrCompanyName", event.target.value)} placeholder="Example: Shrinika Technologies or client company" /></label>
                  <label>Project type<select value={projectIntakeForm.projectType} onChange={event => updateProjectIntakeField("projectType", event.target.value)}>{projectTypeOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Priority<select value={projectIntakeForm.priority} onChange={event => updateProjectIntakeField("priority", event.target.value)}>{projectPriorityOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Project source<select value={projectIntakeForm.projectSource} onChange={event => updateProjectIntakeField("projectSource", event.target.value)}>{projectSourceOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>PRD status<select value={projectIntakeForm.prdStatus} onChange={event => updateProjectIntakeField("prdStatus", event.target.value)}>{prdStatusOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Delivery deadline<input type="date" value={projectIntakeForm.deliveryDeadline ?? ""} onChange={event => updateProjectIntakeField("deliveryDeadline", event.target.value)} /></label>
                  <label>Estimated budget range<input value={projectIntakeForm.estimatedBudgetRange ?? ""} onChange={event => updateProjectIntakeField("estimatedBudgetRange", event.target.value)} placeholder="Placeholder range only" /></label>
                  <label>Final approval owner<select value={projectIntakeForm.finalApprovalOwner} onChange={event => updateProjectIntakeField("finalApprovalOwner", event.target.value)}>{finalApprovalOwners.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label className="wide">Short project summary<textarea value={projectIntakeForm.shortSummary} onChange={event => updateProjectIntakeField("shortSummary", event.target.value)} placeholder="Summarize the project objective and expected business outcome." /></label>
                  <label className="wide">Problem statement<textarea value={projectIntakeForm.problemStatement} onChange={event => updateProjectIntakeField("problemStatement", event.target.value)} placeholder="Describe the problem this project should solve." /></label>
                  <label>Target users<textarea value={projectIntakeForm.targetUsers ?? ""} onChange={event => updateProjectIntakeField("targetUsers", event.target.value)} placeholder="Internal operators, customers, managers, support, etc." /></label>
                  <label>Core modules required<textarea value={projectIntakeForm.coreModulesRequired ?? ""} onChange={event => updateProjectIntakeField("coreModulesRequired", event.target.value)} placeholder="Dashboard, auth, billing, support, reporting, etc." /></label>
                  <label>Key features<textarea value={projectIntakeForm.keyFeatures ?? ""} onChange={event => updateProjectIntakeField("keyFeatures", event.target.value)} placeholder="List the primary features required for MVP scope." /></label>
                  <label>Integrations needed<textarea value={projectIntakeForm.integrationsNeeded ?? ""} onChange={event => updateProjectIntakeField("integrationsNeeded", event.target.value)} placeholder="Email, payment, provider, CRM, analytics, etc." /></label>
                  <label>Design references / notes<textarea value={projectIntakeForm.designReferences ?? ""} onChange={event => updateProjectIntakeField("designReferences", event.target.value)} placeholder="Brand, layout, UI references, accessibility notes." /></label>
                  <label>Risks / assumptions<textarea value={projectIntakeForm.risksAssumptions ?? ""} onChange={event => updateProjectIntakeField("risksAssumptions", event.target.value)} placeholder="Delivery, data, integrations, staffing, approval, or compliance assumptions." /></label>
                </div>
                {projectIntakeMessage ? <p className="success">{projectIntakeMessage}</p> : null}
                {projectIntakeError ? <p className="error">{projectIntakeError}</p> : null}
                <div className="project-prd-actions">
                  <button type="submit" disabled={projectIntakeSaving}>{projectIntakeSaving ? "Saving..." : "Create project intake"}</button>
                  <button type="button" disabled>Create Build Mission Draft from a saved approved intake</button>
                </div>
              </form>
              <aside className="prd-workspace-panel">
                <div className="business-section-heading">
                  <span>PRD workspace panel</span>
                  <h2>PRD Controls</h2>
                </div>
                <div className="prd-workspace-items">
                  {prdWorkspaceItems.map(item => <strong className={item === "Human approval required" ? "approval-required" : ""} key={item}>{item}</strong>)}
                </div>
                <div className="prd-checklist">
                  <span>App Studio build mission readiness checklist</span>
                  {appStudioReadinessChecklist.map(item => <label key={item}><input type="checkbox" disabled />{item}</label>)}
                </div>
              </aside>
            </div>
            <div className="recent-intakes-panel">
              <div className="business-section-heading">
                <span>Recent Project Intakes</span>
                <h2>Saved PRD Intake Records</h2>
              </div>
              {projectIntakeLoading ? <p>Loading project intakes...</p> : null}
              {!projectIntakeLoading && !projectIntakes.length ? <p>No project intakes saved yet.</p> : null}
              {projectIntakes.length ? (
                <div className="recent-intakes-layout">
                  <div className="recent-intake-list">
                    {projectIntakes.map(intake => (
                      <button type="button" className={intake.id === selectedProjectIntake?.id ? "active" : ""} key={intake.id} onClick={() => setSelectedProjectIntakeId(intake.id)}>
                        <strong>{intake.projectName}</strong>
                        <span>{intake.prdStatus} / {intake.priority}</span>
                      </button>
                    ))}
                  </div>
                  {selectedProjectIntake ? (
                    <article className="recent-intake-detail">
                      <span>{selectedProjectIntake.projectType} / {selectedProjectIntake.workflowStatus}</span>
                      <h3>{selectedProjectIntake.projectName}</h3>
                      <p>{selectedProjectIntake.shortSummary}</p>
                      <div className="recent-intake-meta">
                        <div><span>Client/company</span><strong>{selectedProjectIntake.clientOrCompanyName}</strong></div>
                        <div><span>Source</span><strong>{selectedProjectIntake.projectSource}</strong></div>
                        <div><span>Final owner</span><strong>{selectedProjectIntake.finalApprovalOwner}</strong></div>
                        <div><span>Updated</span><strong>{selectedProjectIntake.updatedAt}</strong></div>
                      </div>
                      <div className="handoff-status-panel">
                        <div className="handoff-status-header">
                          <div>
                            <span>App Studio handoff status</span>
                            <strong>{selectedProjectIntake.appStudioBuildMissionId ? "Build Mission draft created" : "Not handed off"}</strong>
                          </div>
                          {selectedProjectIntake.appStudioBuildMissionId ? <small>Mission: {selectedProjectIntake.appStudioBuildMissionId}</small> : <small>Approval readiness required</small>}
                        </div>
                        <div className="handoff-checklist" aria-label="App Studio handoff eligibility checklist">
                          {selectedProjectIntakeHandoffChecklist.map(item => (
                            <span className={item.complete ? "complete" : "pending"} key={item.label}>{item.complete ? "Ready" : "Needed"}: {item.label}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleProjectIntakeHandoff()}
                          disabled={!selectedProjectIntakeHandoffEligible || projectIntakeHandoffSaving}
                        >
                          {projectIntakeHandoffSaving ? "Creating draft..." : selectedProjectIntake.appStudioBuildMissionId ? "Build Mission draft created" : "Create App Studio Build Mission Draft"}
                        </button>
                        <p>Build Mission draft creation still requires App Studio approval. No development agents start automatically.</p>
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="project-prd-workflow-panel">
              <div className="business-section-heading">
                <span>Workflow preview</span>
                <h2>PRD to Delivery Flow</h2>
              </div>
              <div className="project-prd-workflow-chain" aria-label="Project and PRD workflow">
                {projectCreationWorkflowSteps.map((step, index) => (
                  <div className="project-prd-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
          ) : null}

          {activeSection.id === "build-mission-queue" ? (
          <section className="business-section build-mission-queue-section" id="build-mission-queue">
            <div className="business-section-heading">
              <span>Internal App Studio review queue. Approval and assignment do not start agents, generate code, or deploy.</span>
              <h2>Build Mission Approval + Team Assignment Queue</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>Governed queue boundary</strong>
              <p>Approval does not start agents. Assignment does not start implementation. Development starts only through App Studio governed approval, validation, and human authority.</p>
            </div>
            {buildMissionQueueMessage ? <p className="success">{buildMissionQueueMessage}</p> : null}
            {buildMissionQueueError ? <p className="error">{buildMissionQueueError}</p> : null}
            {buildMissionQueueLoading ? <p>Loading Build Mission queue...</p> : null}
            {!buildMissionQueueLoading && !buildMissionQueue.length ? <p>No Build Mission drafts from Project Intake handoff are waiting in the queue.</p> : null}
            {buildMissionQueue.length ? (
              <div className="build-mission-queue-layout">
                <div className="build-mission-queue-list">
                  {buildMissionQueue.map(item => (
                    <button type="button" className={item.buildMissionId === selectedBuildMission?.buildMissionId ? "active" : ""} key={item.buildMissionId} onClick={() => setSelectedBuildMissionId(item.buildMissionId)}>
                      <strong>{item.intake.projectName}</strong>
                      <span>{item.targetModule} / {item.riskLevel}</span>
                      <small>{item.status} / {item.assignment?.assignmentStatus ?? "UNASSIGNED"}</small>
                    </button>
                  ))}
                </div>
                {selectedBuildMission ? (
                  <article className="build-mission-queue-detail">
                    <div className="build-mission-detail-header">
                      <div>
                        <span>Mission ID</span>
                        <h3>{selectedBuildMission.buildMissionId}</h3>
                      </div>
                      <strong className={`assignment-risk ${selectedBuildMission.riskLevel}`}>{selectedBuildMission.riskLevel} risk</strong>
                    </div>
                    <div className="recent-intake-meta">
                      <div><span>Linked intake</span><strong>{selectedBuildMission.intake.projectName}</strong></div>
                      <div><span>Target module</span><strong>{selectedBuildMission.targetModule}</strong></div>
                      <div><span>Approval state</span><strong>{selectedBuildMission.approvalState}</strong></div>
                      <div><span>Assignment</span><strong>{selectedBuildMission.assignment?.assignmentStatus ?? "Not assigned"}</strong></div>
                      <div><span>PRD status</span><strong>{selectedBuildMission.intake.prdStatus}</strong></div>
                      <div><span>Workflow</span><strong>{selectedBuildMission.intake.workflowStatus}</strong></div>
                    </div>
                    <div className="mission-scope-preview">
                      <span>Mission scope preview</span>
                      <p>{selectedBuildMission.scopeSummary}</p>
                    </div>
                    <div className="queue-action-grid">
                      <section className="queue-action-card">
                        <h3>Approval Review</h3>
                        <label>Approval note<textarea value={buildMissionApprovalNote} onChange={event => setBuildMissionApprovalNote(event.target.value)} placeholder="Manager/Admin approval note required." /></label>
                        <button type="button" onClick={() => void handleApproveBuildMission()} disabled={buildMissionQueueSaving || !buildMissionApprovalNote.trim() || !["DRAFT", "AWAITING_APPROVAL"].includes(selectedBuildMission.status)}>Approve Build Mission Draft</button>
                        <small>Approval keeps the mission governed. It does not convert, execute, or start agents.</small>
                      </section>
                      <section className="queue-action-card">
                        <h3>Request Changes</h3>
                        <label>Change reason<textarea value={buildMissionChangeReason} onChange={event => setBuildMissionChangeReason(event.target.value)} placeholder="Explain what PRD/scope changes are needed." /></label>
                        <button type="button" onClick={() => void handleRequestBuildMissionChanges()} disabled={buildMissionQueueSaving || !buildMissionChangeReason.trim()}>Request Changes</button>
                        <small>Linked intake returns to PRD review. The Build Mission draft remains for audit history.</small>
                      </section>
                    </div>
                    <section className="queue-assignment-card">
                      <div className="business-section-heading">
                        <span>Team assignment form</span>
                        <h2>Internal Work Chain</h2>
                      </div>
                      {assignableUsersError ? <p className="error">{assignableUsersError}</p> : null}
                      {assignableUsersLoading ? <p>Loading assignable internal users...</p> : null}
                      {assignmentWarnings.length ? (
                        <div className="assignment-warning-panel">
                          <strong>Assignment guidance</strong>
                          {assignmentWarnings.map(warning => <span key={warning}>{warning}</span>)}
                        </div>
                      ) : null}
                      <div className="queue-assignment-grid">
                        <label>Assignment status<select value={buildMissionAssignmentForm.assignmentStatus ?? "DRAFT"} onChange={event => updateBuildMissionAssignmentField("assignmentStatus", event.target.value)}>{buildMissionAssignmentStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
                        {renderAssignableUserSelect("Manager", "managerUserId", "Select manager")}
                        {renderAssignableUserSelect("Team Leader", "teamLeaderUserId", "Optional if short-staffed")}
                        {renderAssignableUserSelect("Frontend Developer", "frontendDeveloperUserId", "Optional frontend owner")}
                        {renderAssignableUserSelect("Backend Developer", "backendDeveloperUserId", "Optional backend owner")}
                        {renderAssignableUserSelect("QA / Testing", "qaUserId", "Optional QA owner")}
                        {renderAssignableUserSelect("Production Readiness", "productionReadinessUserId", "Optional production readiness owner")}
                        {renderAssignableUserSelect("Support Owner", "supportOwnerUserId", "Optional support owner")}
                        {renderAssignableUserSelect("Finance Owner", "financeOwnerUserId", "Optional finance owner")}
                        {renderAssignableUserSelect("HR Owner", "hrOwnerUserId", "Optional HR owner")}
                        <label className="wide">Notes / short-staffing coverage<textarea value={buildMissionAssignmentForm.notes ?? ""} onChange={event => updateBuildMissionAssignmentField("notes", event.target.value)} placeholder="Document temporary role coverage, backup responsibility, and approval assumptions." /></label>
                      </div>
                      <div className="project-prd-actions">
                        <button type="button" onClick={() => void handleSaveBuildMissionAssignment("DRAFT")} disabled={buildMissionQueueSaving}>Save Assignment Draft</button>
                        <button type="button" onClick={() => void handleSaveBuildMissionAssignment("ASSIGNED")} disabled={buildMissionQueueSaving || !String(buildMissionAssignmentForm.managerUserId ?? "").trim()}>Finalize Assignment</button>
                      </div>
                      <p>Assignment records responsibility only. It does not create code proposals, start development agents, or approve deployment.</p>
                    </section>
                    <section className="development-gate-card">
                      <div className="business-section-heading">
                        <span>Development Start Gate</span>
                        <h2>Approval Before Planning Starts</h2>
                      </div>
                      <div className="development-gate-status">
                        <div><span>Gate status</span><strong>{selectedBuildMission.developmentGate?.gateStatus ?? "Not requested"}</strong></div>
                        <div><span>Requested by</span><strong>{selectedBuildMission.developmentGate?.requestedByUserId ?? "Pending"}</strong></div>
                        <div><span>Requested at</span><strong>{selectedBuildMission.developmentGate?.requestedAt ?? "Pending"}</strong></div>
                        <div><span>Approved by</span><strong>{selectedBuildMission.developmentGate?.approvedByUserId ?? "Pending"}</strong></div>
                        <div><span>Approved at</span><strong>{selectedBuildMission.developmentGate?.approvedAt ?? "Pending"}</strong></div>
                        <div><span>Block reason</span><strong>{selectedBuildMission.developmentGate?.blockReason ?? "None"}</strong></div>
                      </div>
                      <p>Approval permits development planning only. Agents still require App Studio governed execution controls.</p>
                      <div className="queue-action-grid">
                        <section className="queue-action-card">
                          <h3>Request Development Start</h3>
                          <label>Request note<textarea value={developmentStartNote} onChange={event => setDevelopmentStartNote(event.target.value)} placeholder="Explain why the approved and assigned mission is ready to start development planning." /></label>
                          <button type="button" onClick={() => void handleRequestDevelopmentStart()} disabled={buildMissionQueueSaving || selectedBuildMission.status !== "APPROVED" || !["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedBuildMission.assignment?.assignmentStatus ?? "") || Boolean(selectedBuildMission.developmentGate && ["REQUESTED", "APPROVED"].includes(selectedBuildMission.developmentGate.gateStatus))}>Request Development Start</button>
                        </section>
                        <section className="queue-action-card">
                          <h3>Approve Development Start</h3>
                          <label>Approval note<textarea value={developmentStartApprovalNote} onChange={event => setDevelopmentStartApprovalNote(event.target.value)} placeholder="Optional approval note for the development-start gate." /></label>
                          <button type="button" onClick={() => void handleApproveDevelopmentStart()} disabled={buildMissionQueueSaving || selectedBuildMission.developmentGate?.gateStatus !== "REQUESTED"}>Approve Development Start</button>
                        </section>
                        <section className="queue-action-card">
                          <h3>Block Development Start</h3>
                          <label>Block reason<textarea value={developmentStartBlockReason} onChange={event => setDevelopmentStartBlockReason(event.target.value)} placeholder="Reason is required to block development start." /></label>
                          <button type="button" onClick={() => void handleBlockDevelopmentStart()} disabled={buildMissionQueueSaving || selectedBuildMission.developmentGate?.gateStatus !== "REQUESTED" || !developmentStartBlockReason.trim()}>Block Development Start</button>
                        </section>
                      </div>
                    </section>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          ) : null}

          {activeSection.id === "build-mission-execution" ? (
          <section className="business-section build-mission-execution-section" id="build-mission-execution">
            <div className="business-section-heading">
              <span>Real backend execution visibility. No demo Build Missions or fake progress are shown.</span>
              <h2>Build Mission Execution Dashboard</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>Execution tracking boundary</strong>
              <p>This dashboard tracks execution only. It does not start agents, create proposals, apply code, deploy, or expose customer access.</p>
            </div>
            {buildMissionExecutionMessage ? <p className="success">{buildMissionExecutionMessage}</p> : null}
            {buildMissionExecutionError ? <p className="error">{buildMissionExecutionError}</p> : null}
            {assignableUsersError ? <p className="error">{assignableUsersError}</p> : null}
            {buildMissionExecutionLoading ? <p>Loading Build Mission execution dashboard...</p> : null}
            {!buildMissionExecutionLoading && !buildMissionExecutionItems.length ? <p>No Build Missions are ready for execution yet.</p> : null}
            {buildMissionExecutionItems.length ? (
              <div className="build-mission-queue-layout">
                <div className="build-mission-queue-list">
                  {buildMissionExecutionItems.map(item => (
                    <button type="button" className={item.buildMissionId === selectedExecutionItem?.buildMissionId ? "active" : ""} key={item.buildMissionId} onClick={() => setSelectedExecutionBuildMissionId(item.buildMissionId)}>
                      <strong>{item.intake.projectName}</strong>
                      <span>{item.targetModule} / {item.riskLevel}</span>
                      <small>{item.executionStatus?.executionStatus ?? "Execution record not created yet"} / {item.developmentGate?.gateStatus ?? "Gate pending"}</small>
                    </button>
                  ))}
                </div>
                {selectedExecutionItem ? (
                  <article className="build-mission-queue-detail">
                    <div className="build-mission-detail-header">
                      <div>
                        <span>Build Mission</span>
                        <h3>{selectedExecutionItem.intake.projectName}</h3>
                      </div>
                      <strong className={`assignment-risk ${selectedExecutionItem.riskLevel}`}>{selectedExecutionItem.riskLevel} risk</strong>
                    </div>
                    <div className="recent-intake-meta">
                      <div><span>Mission status</span><strong>{selectedExecutionItem.status}</strong></div>
                      <div><span>Execution status</span><strong>{selectedExecutionItem.executionStatus?.executionStatus ?? "Not created"}</strong></div>
                      <div><span>Current stage</span><strong>{selectedExecutionItem.executionStatus?.currentStage ?? "Pending record"}</strong></div>
                      <div><span>Progress</span><strong>{selectedExecutionItem.executionStatus ? `${selectedExecutionItem.executionStatus.progressPercent}%` : "0%"}</strong></div>
                      <div><span>Owner</span><strong>{displayAssignableUser(selectedExecutionItem.executionStatus?.ownerUserId)}</strong></div>
                      <div><span>Updated</span><strong>{selectedExecutionItem.executionStatus?.updatedAt ?? "Not updated"}</strong></div>
                    </div>
                    <div className="execution-readiness-grid">
                      {([
                        ["Build Mission approved", selectedExecutionItem.status === "APPROVED"],
                        ["Team assigned", ["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedExecutionItem.assignment?.assignmentStatus ?? "")],
                        ["Development start approved", selectedExecutionItem.developmentGate?.gateStatus === "APPROVED"],
                        ["Execution record created", Boolean(selectedExecutionItem.executionStatus)]
                      ] as Array<[string, boolean]>).map(([label, ready]) => (
                        <div className={ready ? "ready" : "pending"} key={String(label)}>
                          <span>{ready ? "Ready" : "Pending"}</span>
                          <strong>{label}</strong>
                        </div>
                      ))}
                    </div>
                    <section className="queue-assignment-card">
                      <div className="business-section-heading">
                        <span>Assigned internal team</span>
                        <h2>Execution Responsibility</h2>
                      </div>
                      <div className="recent-intake-meta">
                        <div><span>Manager</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.managerUserId)}</strong></div>
                        <div><span>Team Leader</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.teamLeaderUserId)}</strong></div>
                        <div><span>Frontend</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.frontendDeveloperUserId)}</strong></div>
                        <div><span>Backend</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.backendDeveloperUserId)}</strong></div>
                        <div><span>QA</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.qaUserId)}</strong></div>
                        <div><span>Production Readiness</span><strong>{displayAssignableUser(selectedExecutionItem.assignment?.productionReadinessUserId)}</strong></div>
                      </div>
                    </section>
                    <section className="development-gate-card">
                      <div className="business-section-heading">
                        <span>Manual status controls</span>
                        <h2>Execution Record</h2>
                      </div>
                      {!selectedExecutionItem.executionStatus ? <p>Execution record not created yet.</p> : null}
                      <div className="project-prd-actions">
                        <button type="button" onClick={() => void handleCreateBuildMissionExecutionStatus()} disabled={buildMissionExecutionSaving || Boolean(selectedExecutionItem.executionStatus) || selectedExecutionItem.status !== "APPROVED" || !["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedExecutionItem.assignment?.assignmentStatus ?? "") || selectedExecutionItem.developmentGate?.gateStatus !== "APPROVED"}>Create Execution Record</button>
                      </div>
                      <div className="queue-assignment-grid">
                        <label>Execution status<select value={buildMissionExecutionForm.executionStatus ?? "READY_TO_START"} onChange={event => updateBuildMissionExecutionField("executionStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus}>{buildMissionExecutionStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
                        <label>Current stage<select value={buildMissionExecutionForm.currentStage ?? "DEVELOPMENT_START_APPROVED"} onChange={event => updateBuildMissionExecutionField("currentStage", event.target.value)} disabled={!selectedExecutionItem.executionStatus}>{buildMissionExecutionStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
                        <label>Progress percent<input type="number" min={0} max={100} value={Number(buildMissionExecutionForm.progressPercent ?? 0)} onChange={event => updateBuildMissionExecutionField("progressPercent", Number(event.target.value))} disabled={!selectedExecutionItem.executionStatus} /></label>
                        <label>Owner<select value={String(buildMissionExecutionForm.ownerUserId ?? "")} onChange={event => updateBuildMissionExecutionField("ownerUserId", event.target.value)} disabled={!selectedExecutionItem.executionStatus || assignableUsersLoading}><option value="">No owner selected</option>{assignableUsers.map(user => <option key={`execution-owner-${user.id}`} value={user.id}>{assignableUserLabel(user)}</option>)}</select></label>
                        <label>Frontend status<input value={buildMissionExecutionForm.frontendStatus ?? ""} onChange={event => updateBuildMissionExecutionField("frontendStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Backend connected status only" /></label>
                        <label>Backend status<input value={buildMissionExecutionForm.backendStatus ?? ""} onChange={event => updateBuildMissionExecutionField("backendStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Backend connected status only" /></label>
                        <label>QA status<input value={buildMissionExecutionForm.qaStatus ?? ""} onChange={event => updateBuildMissionExecutionField("qaStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Backend connected status only" /></label>
                        <label>Production readiness status<input value={buildMissionExecutionForm.productionReadinessStatus ?? ""} onChange={event => updateBuildMissionExecutionField("productionReadinessStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Backend connected status only" /></label>
                        <label className="wide">Blocker summary<textarea value={buildMissionExecutionForm.blockerSummary ?? ""} onChange={event => updateBuildMissionExecutionField("blockerSummary", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Required when execution status is BLOCKED." /></label>
                        <label className="wide">Next action<textarea value={buildMissionExecutionForm.nextAction ?? ""} onChange={event => updateBuildMissionExecutionField("nextAction", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Manual next action for manager/team review." /></label>
                      </div>
                      <div className="project-prd-actions">
                        <button type="button" onClick={() => void handleUpdateBuildMissionExecutionStatus()} disabled={buildMissionExecutionSaving || !selectedExecutionItem.executionStatus}>Update Execution Status</button>
                        <button type="button" onClick={() => void handleArchiveBuildMissionExecutionStatus()} disabled={buildMissionExecutionSaving || !selectedExecutionItem.executionStatus}>Archive Execution Record</button>
                      </div>
                    </section>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          ) : null}

          {activeSection.id === "client-management" ? (
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
          ) : null}

          {activeSection.id === "approvals" ? <BusinessTableSection section={tableSections[1]} /> : null}

          {activeSection.id === "support-desk" ? (
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
          ) : null}

          {activeSection.id === "finance-billing" ? (
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
          ) : null}

          {activeSection.id === "hrms" ? (
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
          ) : null}

          {activeSection.id === "agent-operations" ? (
          <section className="business-section agent-operations-section" id="agent-operations">
            <div className="business-section-heading">
              <span>Static agent governance UI. No real agent execution, provider calls, or production action is connected.</span>
              <h2>Agent Operations</h2>
            </div>
            <div className="business-boundary-notice governance-boundary-notice">
              <strong>Agent Operations Boundary</strong>
              <p>Agent Operations is an internal governance dashboard only. Agents remain governed by Agent Core, human approvals, sandboxing, Git checkpoints, tests, security review, audit logs, and final human authority. No autonomous production action may bypass approval.</p>
            </div>
            <div className="business-card-grid governance-overview-grid" aria-label="Agent Operations overview cards">
              {agentOperationsOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="governance-reference-grid">
              <article>
                <span>Agent types</span>
                <div>{agentTypes.map(type => <strong key={type}>{type}</strong>)}</div>
              </article>
              <article>
                <span>Agent statuses</span>
                <div>{agentStatuses.map(status => <strong className={`governance-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
            </div>
            <div className="governance-subsection">
              <div className="business-section-heading">
                <span>Mock agent registry. Providers and activity are placeholders only.</span>
                <h2>Agent Registry</h2>
              </div>
              <div className="agent-registry-grid">
                {agentRegistry.map(agent => (
                  <article className="governance-card" key={agent.agentName}>
                    <div className="governance-card-header">
                      <div>
                        <span>{agent.agentType}</span>
                        <h3>{agent.agentName}</h3>
                        <small>{agent.assignedModule}</small>
                      </div>
                      <span className={`governance-status-badge ${badgeClassName(agent.status)}`}>{agent.status}</span>
                    </div>
                    <div className="governance-detail-grid">
                      <div><span>Current task</span><strong>{agent.currentTask}</strong></div>
                      <div><span>Approval requirement</span><strong>{agent.approvalRequirement}</strong></div>
                      <div><span>Last activity</span><strong>{agent.lastActivity}</strong></div>
                      <div><span>Risk level</span><strong className={`priority-text ${agent.riskLevel.toLowerCase()}`}>{agent.riskLevel}</strong></div>
                      <div><span>Provider</span><strong>{agent.provider}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="governance-subsection">
              <div className="business-section-heading">
                <span>Mock task queue. No real execution or approval mutation is connected.</span>
                <h2>Agent Task Queue</h2>
              </div>
              <div className="governance-status-grid">
                <article>
                  <span>Task statuses</span>
                  <div>{agentTaskStatuses.map(status => <strong className={`governance-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
                </article>
                <article>
                  <span>Approval states</span>
                  <div>{agentApprovalStates.map(state => <strong className={`governance-status-badge ${badgeClassName(state)}`} key={state}>{state}</strong>)}</div>
                </article>
              </div>
              <div className="agent-task-grid">
                {agentTaskQueue.map(task => (
                  <article className="governance-card" key={task.taskId}>
                    <div className="governance-card-header">
                      <div>
                        <span>{task.taskId}</span>
                        <h3>{task.taskTitle}</h3>
                        <small>{task.agent} / {task.module}</small>
                      </div>
                      <span className={`governance-status-badge ${badgeClassName(task.status)}`}>{task.status}</span>
                    </div>
                    <div className="governance-detail-grid">
                      <div><span>Approval state</span><strong className={`governance-status-badge ${badgeClassName(task.approvalState)}`}>{task.approvalState}</strong></div>
                      <div><span>Risk level</span><strong className={`priority-text ${task.riskLevel.toLowerCase()}`}>{task.riskLevel}</strong></div>
                      <div><span>Owner</span><strong>{task.owner}</strong></div>
                      <div><span>Last update</span><strong>{task.lastUpdate}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="governance-workflow-panel">
              <div className="business-section-heading">
                <span>Agent Governance Workflow</span>
                <h2>Approval-Gated Agent Flow</h2>
              </div>
              <div className="governance-workflow-chain" aria-label="Agent governance workflow">
                {agentGovernanceWorkflowSteps.map((step, index) => (
                  <div className="governance-workflow-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="provider-health-panel">
              <div className="business-section-heading">
                <span>Provider Health Placeholder</span>
                <h2>Provider Governance</h2>
              </div>
              <div>{providerHealthPlaceholders.map(item => <strong key={item}>{item}</strong>)}</div>
            </div>
          </section>
          ) : null}

          {activeSection.id === "audit-compliance" ? (
          <section className="business-section audit-compliance-section" id="audit-compliance">
            <div className="business-section-heading">
              <span>Static audit and compliance UI. No real audit persistence, policy engine, or compliance enforcement is connected.</span>
              <h2>Audit & Compliance</h2>
            </div>
            <div className="business-boundary-notice governance-boundary-notice">
              <strong>Governance Dashboard Boundary</strong>
              <p>Agent Operations and Audit/Compliance are internal governance dashboards only. They are not customer-facing and must not expose secrets, API keys, private employee data, or sensitive customer data.</p>
            </div>
            <div className="business-card-grid audit-overview-grid" aria-label="Audit and compliance overview cards">
              {auditOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="governance-reference-grid">
              <article>
                <span>Audit categories</span>
                <div>{auditCategories.map(category => <strong key={category}>{category}</strong>)}</div>
              </article>
              <article>
                <span>Severity</span>
                <div>{auditSeverities.map(severity => <strong className={`severity-badge ${badgeClassName(severity)}`} key={severity}>{severity}</strong>)}</div>
              </article>
              <article>
                <span>Audit statuses</span>
                <div>{auditStatuses.map(status => <strong className={`governance-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
            </div>
            <div className="governance-subsection">
              <div className="business-section-heading">
                <span>Mock audit event log. Notes are placeholders and contain no secrets.</span>
                <h2>Audit Event Log</h2>
              </div>
              <div className="audit-event-grid">
                {auditEvents.map(event => (
                  <article className="governance-card" key={event.eventId}>
                    <div className="governance-card-header">
                      <div>
                        <span>{event.eventId} / {event.category}</span>
                        <h3>{event.target}</h3>
                        <small>{event.actor}</small>
                      </div>
                      <span className={`severity-badge ${badgeClassName(event.severity)}`}>{event.severity}</span>
                    </div>
                    <div className="governance-detail-grid">
                      <div><span>Status</span><strong className={`governance-status-badge ${badgeClassName(event.status)}`}>{event.status}</strong></div>
                      <div><span>Timestamp</span><strong>{event.timestamp}</strong></div>
                      <div><span>Audit note</span><strong>{event.auditNote}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="compliance-control-panel">
              <div className="business-section-heading">
                <span>Compliance Control Panel</span>
                <h2>Required Controls</h2>
              </div>
              <div>{complianceControls.map(control => <strong key={control}>{control}</strong>)}</div>
            </div>
            <div className="blocked-actions-panel">
              <div className="business-section-heading">
                <span>Blocked Actions / Safety Events</span>
                <h2>Safety Gate Queue</h2>
              </div>
              <div className="blocked-actions-grid">
                {blockedSafetyEvents.map(event => (
                  <article className="blocked-action-card" key={event.action}>
                    <div className="governance-card-header">
                      <div>
                        <span>{event.relatedModule}</span>
                        <h3>{event.action}</h3>
                        <small>{event.reasonBlocked}</small>
                      </div>
                      <span className={`severity-badge ${badgeClassName(event.riskLevel)}`}>{event.riskLevel}</span>
                    </div>
                    <p>{event.requiredNextStep}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
          ) : null}

          {activeSection.id === "system-health" ? (
          <section className="business-section system-operations-section" id="system-health">
            <div className="business-section-heading">
              <span>Static operations UI. No monitoring probes, provider calls, backup jobs, deployment execution, or infrastructure actions are connected.</span>
              <h2>System Health</h2>
            </div>
            <div className="business-boundary-notice system-boundary-notice">
              <strong>System / Cloud Boundary Notice</strong>
              <p>System Health and Cloud Operations are internal-only dashboards. This UI must not execute deployments, expose secrets, call providers, change DNS, send emails, modify infrastructure, or perform production actions.</p>
            </div>
            <div className="business-card-grid system-overview-grid" aria-label="System Health overview cards">
              {systemHealthOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="system-ops-status-grid">
              <article>
                <span>Component statuses</span>
                <div>{systemComponentStatuses.map(status => <strong className={`system-ops-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
            </div>
            <div className="ops-subsection">
              <div className="business-section-heading">
                <span>Mock component health. No live status checks are performed.</span>
                <h2>System Component Status</h2>
              </div>
              <div className="system-component-grid">
                {systemComponents.map(component => (
                  <article className="system-ops-card" key={component.componentName}>
                    <div className="system-ops-card-header">
                      <div>
                        <span>{component.area}</span>
                        <h3>{component.componentName}</h3>
                        <small>{component.owner}</small>
                      </div>
                      <span className={`system-ops-status-badge ${badgeClassName(component.status)}`}>{component.status}</span>
                    </div>
                    <div className="system-ops-detail-grid">
                      <div><span>Health note</span><strong>{component.healthNote}</strong></div>
                      <div><span>Last checked</span><strong>{component.lastChecked}</strong></div>
                      <div><span>Risk level</span><strong className={`priority-text ${component.riskLevel.toLowerCase()}`}>{component.riskLevel}</strong></div>
                      <div><span>Next action</span><strong>{component.nextAction}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
          ) : null}

          {activeSection.id === "deployment-cloud" ? (
          <section className="business-section deployment-cloud-section" id="deployment-cloud">
            <div className="business-section-heading">
              <span>Static deployment and cloud operations visibility. No deployment, rollback, DNS, provider, email, backup, or infrastructure action is connected.</span>
              <h2>Deployment / Cloud Operations</h2>
            </div>
            <div className="business-boundary-notice system-boundary-notice">
              <strong>Deployment Approval Boundary</strong>
              <p>Deployment and cloud operations are approval-gated. No production deployment, rollback, domain change, provider change, secret change, or infrastructure change should bypass human approval, audit logging, Git checkpoints, tests, and security review.</p>
            </div>
            <div className="business-card-grid deployment-overview-grid" aria-label="Deployment overview cards">
              {deploymentOverviewCards.map(card => (
                <article className={`business-metric-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="deployment-pipeline-panel">
              <div className="business-section-heading">
                <span>Deployment Pipeline</span>
                <h2>Approval-Gated Release Flow</h2>
              </div>
              <div className="deployment-pipeline-chain" aria-label="Deployment pipeline">
                {deploymentPipelineSteps.map((step, index) => (
                  <div className="deployment-pipeline-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="system-ops-status-grid">
              <article>
                <span>Environments</span>
                <div>{deploymentEnvironments.map(environment => <strong key={environment}>{environment}</strong>)}</div>
              </article>
              <article>
                <span>Release statuses</span>
                <div>{releaseStatuses.map(status => <strong className={`system-ops-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
              </article>
            </div>
            <div className="ops-subsection">
              <div className="business-section-heading">
                <span>Mock releases. No deployment execution or environment mutation is connected.</span>
                <h2>Deployment Releases</h2>
              </div>
              <div className="deployment-release-grid">
                {deploymentReleases.map(release => (
                  <article className="system-ops-card" key={release.releaseId}>
                    <div className="system-ops-card-header">
                      <div>
                        <span>{release.releaseId} / {release.environment}</span>
                        <h3>{release.projectModule}</h3>
                        <small>{release.approvalOwner}</small>
                      </div>
                      <span className={`system-ops-status-badge ${badgeClassName(release.status)}`}>{release.status}</span>
                    </div>
                    <div className="system-ops-detail-grid">
                      <div><span>Git checkpoint</span><strong>{release.gitCheckpoint}</strong></div>
                      <div><span>Test status</span><strong>{release.testStatus}</strong></div>
                      <div><span>Security review</span><strong>{release.securityReviewStatus}</strong></div>
                      <div><span>Rollback status</span><strong>{release.rollbackStatus}</strong></div>
                      <div><span>Last update</span><strong>{release.lastUpdate}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="cloud-ops-panel">
              <div className="business-section-heading">
                <span>Cloud Operations Placeholder</span>
                <h2>Provider Surfaces</h2>
              </div>
              <div>{cloudOperationsPlaceholders.map(item => <strong key={item}>{item}</strong>)}</div>
            </div>
            <div className="ops-subsection">
              <div className="business-section-heading">
                <span>Mock backup/recovery visibility. No backup jobs or exports are connected.</span>
                <h2>Backup & Recovery</h2>
              </div>
              <div className="backup-recovery-grid">
                {backupRecoveryItems.map(item => (
                  <article className="system-ops-card" key={item.item}>
                    <div className="system-ops-card-header">
                      <div>
                        <span>{item.frequency}</span>
                        <h3>{item.item}</h3>
                        <small>{item.owner}</small>
                      </div>
                      <span className={`system-ops-status-badge ${badgeClassName(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="system-ops-detail-grid">
                      <div><span>Last checked</span><strong>{item.lastChecked}</strong></div>
                      <div><span>Recovery note</span><strong>{item.recoveryNote}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="ops-subsection">
              <div className="business-section-heading">
                <span>Mock incident queue. No incident automation or notifications are connected.</span>
                <h2>Incident Management</h2>
              </div>
              <div className="system-ops-status-grid">
                <article>
                  <span>Incident statuses</span>
                  <div>{incidentStatuses.map(status => <strong className={`system-ops-status-badge ${badgeClassName(status)}`} key={status}>{status}</strong>)}</div>
                </article>
              </div>
              <div className="incident-grid">
                {incidents.map(incident => (
                  <article className="system-ops-card" key={incident.incidentId}>
                    <div className="system-ops-card-header">
                      <div>
                        <span>{incident.incidentId} / {incident.area}</span>
                        <h3>{incident.impact}</h3>
                        <small>{incident.owner}</small>
                      </div>
                      <span className={`severity-badge ${badgeClassName(incident.severity)}`}>{incident.severity}</span>
                    </div>
                    <div className="system-ops-detail-grid">
                      <div><span>Status</span><strong className={`system-ops-status-badge ${badgeClassName(incident.status)}`}>{incident.status}</strong></div>
                      <div><span>Required next step</span><strong>{incident.requiredNextStep}</strong></div>
                      <div><span>Last update</span><strong>{incident.lastUpdate}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="deployment-rules-panel">
              <div className="business-section-heading">
                <span>Deployment Approval Rules</span>
                <h2>Release Controls</h2>
              </div>
              <div>{deploymentApprovalRules.map(rule => <strong key={rule}>{rule}</strong>)}</div>
            </div>
          </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
