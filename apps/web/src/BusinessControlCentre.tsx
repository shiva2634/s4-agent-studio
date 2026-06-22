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
import {
  archiveBuildMissionQaChecklist,
  approveBuildMissionQaChecklist,
  buildMissionQaChecklistItemStatuses,
  buildMissionQaChecklistSeverities,
  buildMissionQaChecklistStatuses,
  createBuildMissionQaChecklist,
  getBuildMissionQaDashboardItem,
  listBuildMissionQaDashboard,
  rejectBuildMissionQaChecklist,
  type BuildMissionQaChecklistStatus,
  type BuildMissionQaChecklistItemStatus,
  type BuildMissionQaChecklistSeverity,
  updateBuildMissionQaChecklistItem,
  updateBuildMissionQaChecklistStatus,
  type BuildMissionQaDashboardItem,
  type BuildMissionQaDetailItem
} from "./build-mission-qa";
import {
  archiveBuildMissionProductionReadiness,
  approveBuildMissionProductionReadiness,
  buildMissionProductionReadinessChecklistItemStatuses,
  buildMissionProductionReadinessChecklistSeverities,
  buildMissionProductionReadinessChecklistStatuses,
  createBuildMissionProductionReadinessChecklist,
  getBuildMissionProductionReadinessDashboardItem,
  listBuildMissionProductionReadinessDashboard,
  rejectBuildMissionProductionReadiness,
  updateBuildMissionProductionReadinessItem,
  updateBuildMissionProductionReadinessStatus,
  type BuildMissionProductionReadinessChecklistStatus,
  type BuildMissionProductionReadinessChecklistItemStatus,
  type BuildMissionProductionReadinessChecklistSeverity,
  type BuildMissionProductionReadinessDashboardItem,
  type BuildMissionProductionReadinessDetailItem
} from "./build-mission-production-readiness";
import {
  approveBuildMissionDeploymentApproval,
  archiveBuildMissionDeploymentApproval,
  createBuildMissionDeploymentApproval,
  getBuildMissionDeploymentApprovalDashboardItem,
  listBuildMissionDeploymentApprovalDashboard,
  rejectBuildMissionDeploymentApproval,
  type BuildMissionDeploymentApprovalDashboardItem
} from "./build-mission-deployment-approval";
import { createBuildMissionFromProjectIntake, createBusinessProjectIntake, listBusinessProjectIntakes, socialAutomationStudioPhase1MvpShellIntakePayload, type BusinessProjectIntake, type BusinessProjectIntakePayload } from "./business-project-intake";
import type { InternalAuthState } from "./internal-auth";
import { getDeploymentHardeningStatus, type DeploymentHardeningStatus } from "./deployment-hardening";
import { getInternalDeploymentSmokeStatus, type InternalDeploymentSmokeStatus } from "./internal-deployment-smoke";

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

type SocialAutomationStudioModuleCard = {
  title: string;
  status: "Not Started" | "Intake Ready" | "Approval Required" | "Provider Ready" | "No Live Integrations";
  chips: Array<"Not Started" | "Intake Ready" | "Approval Required" | "Provider Ready" | "No Live Integrations">;
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

type SupportChannel = "Website form" | "Email" | "Phone" | "WhatsApp" | "Future Client Portal";

type SupportTicketStatus = "Open" | "Waiting Customer Reply" | "Waiting Internal Team" | "Escalated" | "Resolved";

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

type EmployeeWorkStatus = "Active" | "Onboarding" | "Leave" | "Access Review" | "Paused";

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
  | "Payroll query"
  | "Performance review"
  | "Exit process"
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

type AgentStatus = "Active" | "Paused" | "Waiting Approval" | "Blocked" | "Failed" | "Review Required";

type AgentTaskStatus =
  | "Draft"
  | "Running"
  | "Waiting Approval"
  | "In Review"
  | "Blocked"
  | "Completed"
  | "Failed";

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

type SystemComponentStatus = "Healthy" | "Warning" | "Degraded" | "Offline" | "Not Connected" | "Needs Review";

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

type DeploymentEnvironment = "Local" | "Staging" | "Production";

type ReleaseStatus =
  | "Draft"
  | "Waiting Approval"
  | "Testing"
  | "Security Review"
  | "Ready for Staging"
  | "Ready for Production"
  | "Deployed"
  | "Rollback Required"
  | "Failed";

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

type IncidentStatus = "Open" | "Investigating" | "Waiting Approval" | "Resolved" | "Monitoring";

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
  { id: "social-automation-studio", label: "Social Automation Studio", group: "Operations" },
  { id: "create-project-prd", label: "Create Project / PRD", group: "Operations" },
  { id: "build-mission-queue", label: "Build Mission Queue", group: "Operations" },
  { id: "build-mission-execution", label: "Build Mission Execution", group: "Operations" },
  { id: "build-mission-qa", label: "QA / Testing Approval", group: "Operations" },
  { id: "build-mission-production-readiness", label: "Production Readiness", group: "Operations" },
  { id: "build-mission-deployment-approval", label: "Deployment Approval", group: "Operations" },
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
  { label: "Live metric", value: "Not connected yet", note: "Use workflow sections for real records", tone: "warning" }
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
    status: "Active",
    notes: "Combined internal workspace for company operations."
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
    status: "Active",
    notes: "Administrative dashboard for operations, approvals, roles, departments, and audit visibility."
  },
  {
    name: "Customer Website & Support",
    type: "External customer-facing system",
    accessLevel: "Customers, leads, visitors, support contacts",
    ownerAdmin: "Customer systems team",
    status: "Separate surface",
    notes: "Customers use this path, email, support, and future Client Portal instead of App Studio."
  }
];

const departments: DepartmentOverview[] = [
  { name: "Admin & Governance", purpose: "Company controls, permissions, policy, and admin oversight.", responsibleRole: "Main Admin / Company Admin", employeeCount: "Backend-connected", activeWork: "Governed records", status: "Active" },
  { name: "Project Operations", purpose: "Project intake, assignment, handoffs, and delivery visibility.", responsibleRole: "Manager", employeeCount: "Backend-connected", activeWork: "Use workflow sections", status: "Active" },
  { name: "Development", purpose: "Frontend and backend implementation delivery.", responsibleRole: "Team Leader", employeeCount: "Backend-connected", activeWork: "Build Mission flow", status: "Active" },
  { name: "Testing / QA", purpose: "Validation, bug review, regression checks, and release confidence.", responsibleRole: "Testing / QA Developer", employeeCount: "Backend-connected", activeWork: "QA approval flow", status: "Active" },
  { name: "Production Readiness", purpose: "Final readiness, deployment preparation, and release checks.", responsibleRole: "Final Production Readiness Developer", employeeCount: "Backend-connected", activeWork: "Readiness approval flow", status: "Active" },
  { name: "HR", purpose: "Employee records, staffing, roles, and internal people operations.", responsibleRole: "HR", employeeCount: "Not connected", activeWork: "Use backend identity system", status: "Not connected" },
  { name: "Finance & Billing", purpose: "Billing visibility, payment follow-ups, and finance oversight.", responsibleRole: "Finance Admin", employeeCount: "Not connected", activeWork: "Policy guidance only", status: "Not connected" },
  { name: "Customer Support", purpose: "Support queue handling through customer-facing channels.", responsibleRole: "Support Manager", employeeCount: "Not connected", activeWork: "External support channels", status: "Not connected" },
  { name: "Agent Operations", purpose: "Agent task visibility, coordination, and operational supervision.", responsibleRole: "Agent Supervisor", employeeCount: "Backend-connected", activeWork: "Agent governance", status: "Active" },
  { name: "Audit & Compliance", purpose: "Audit trails, compliance review, and sensitive action visibility.", responsibleRole: "Auditor", employeeCount: "Backend-connected", activeWork: "Audit controls", status: "Active" },
  { name: "Cloud / Deployment", purpose: "Deployment approvals, cloud readiness, and release operations.", responsibleRole: "Manager / Cloud Operator", employeeCount: "Backend-connected", activeWork: "Hardening and smoke test", status: "Active" }
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
  "Frontend assignment",
  "Backend assignment",
  "QA assignment",
  "Readiness assignment",
  "Manager final approval",
  "Deployment approval"
];

const projectTypeOptions = ["Website", "SaaS", "Mobile App", "Automation", "CRM", "Media System", "Trading System", "Internal Tool", "Other"];
const projectPriorityOptions = ["Low", "Medium", "High", "Urgent"];
const projectSourceOptions = ["Client request", "Internal product idea", "Admin instruction", "Existing business workflow", "Product Discovery Agent"];
const prdStatusOptions = ["Not started", "Drafting", "Under review", "Approved", "Changes requested"];
const finalApprovalOwners = ["Admin", "Manager", "Shiva", "Shrinika"];

const prdWorkspaceItems = [
  "PRD upload handled by backend",
  "PRD text draft handled by backend",
  "AI-assisted PRD generation is approval gated",
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
  { role: "Admin / Main Admin", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Manager", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Team Leader", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Frontend Developer", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Backend Developer", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "QA / Testing Developer", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Production Readiness Developer", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "High", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Support Operator", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Low", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Finance Operator", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "HR Operator", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "No", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." },
  { role: "Agent Supervisor", primaryAssignee: "Unassigned", backupAssignee: "Unassigned", temporaryDelegate: "Unassigned", canHoldMultipleRoles: "Yes", approvalRequired: "Yes", maxWorkloadLevel: "Medium", notes: "Select a real internal user through backend-connected assignment flows." }
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
  "Delegation rules are policy guidance. Real project assignment happens through Build Mission Queue using internal assignable users."
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

const projectAssignments: ProjectAssignment[] = [];

const socialAutomationStudioModuleCards: SocialAutomationStudioModuleCard[] = [
  {
    title: "Overview / Command Centre",
    status: "Intake Ready",
    chips: ["Intake Ready", "No Live Integrations"],
    description: "Coordinates governed Phase 1 work for the Android shell and internal website dashboard while keeping customer access separate."
  },
  {
    title: "Social Media Automation",
    status: "Not Started",
    chips: ["Not Started", "No Live Integrations"],
    description: "Will manage approval-gated social post planning, scheduling, and workflow visibility without direct platform publishing yet."
  },
  {
    title: "Content Creation for Wealth",
    status: "Provider Ready",
    chips: ["Approval Required", "Provider Ready", "No Live Integrations"],
    description: "Will manage governed script, prompt, caption, and compliance drafting for wealth-oriented content."
  },
  {
    title: "Meta Ads Agency",
    status: "Not Started",
    chips: ["Not Started", "No Live Integrations"],
    description: "Will manage ad intake, review, and governed handoff for Meta Ads work without live campaign execution."
  },
  {
    title: "Third-Party Advertisement Marketplace",
    status: "Not Started",
    chips: ["Not Started", "No Live Integrations"],
    description: "Will manage partner advertisement intake, approvals, and marketplace coordination with no live integrations yet."
  },
  {
    title: "CRM",
    status: "Intake Ready",
    chips: ["Intake Ready", "No Live Integrations"],
    description: "Will manage customer relationship records, governed follow-ups, and future internal-to-customer handoffs."
  },
  {
    title: "Finance & Credits",
    status: "Approval Required",
    chips: ["Approval Required", "No Live Integrations"],
    description: "Will manage internal credit accounting, usage visibility, and finance governance without payment automation."
  },
  {
    title: "Analytics & Reports",
    status: "Intake Ready",
    chips: ["Intake Ready", "No Live Integrations"],
    description: "Will manage operational reporting, funnel visibility, and approval-gated analytics summaries."
  },
  {
    title: "Customer Support",
    status: "Not Started",
    chips: ["Not Started", "No Live Integrations"],
    description: "Will manage support intake, triage, and internal resolution tracking while customers continue using external support channels."
  },
  {
    title: "Compliance & Approval Engine",
    status: "Approval Required",
    chips: ["Approval Required", "No Live Integrations"],
    description: "Will manage human approval checkpoints, policy enforcement, and governed release review for all phase work."
  }
];

const pendingManagerApprovals = projectAssignments.filter(assignment => assignment.currentStage === "Waiting Manager Approval");
const productionReadinessCompleted = projectAssignments.filter(assignment => ["Waiting Manager Approval", "Approved for Deployment", "Deployed"].includes(assignment.currentStage));

const clientStatusBadges: ClientStatus[] = ["Lead", "Active", "Waiting Approval", "Support Needed", "Payment Pending", "Paused"];

const clientOverviewCards: MetricCard[] = [];
const clients: ClientRecord[] = [];

const supportOverviewCards: MetricCard[] = [];

const supportIssueTypes: SupportIssueType[] = ["Bug", "Feature request", "Complaint", "Billing issue", "Access issue", "Project correction", "General support"];

const supportChannels: SupportChannel[] = ["Website form", "Email", "Phone", "WhatsApp", "Future Client Portal"];

const supportWorkflowSteps = [
  "Customer request",
  "Support Desk",
  "Support Manager",
  "Assigned internal owner",
  "Manager / Team Leader if project-related",
  "Resolution",
  "Customer update through external channel"
];

const supportTickets: SupportTicketRecord[] = [];

const tableSections: TableSection[] = [];

const systemHealthOverviewCards: MetricCard[] = [];

const systemComponentStatuses: SystemComponentStatus[] = ["Healthy", "Warning", "Degraded", "Offline", "Not Connected", "Needs Review"];

const systemComponents: SystemComponentRecord[] = [];

const deploymentOverviewCards: MetricCard[] = [];

const deploymentPipelineSteps = [
  "Build mission complete",
  "Manager review",
  "Typecheck/tests",
  "Security review",
  "Git checkpoint",
  "QA validation",
  "Final approval",
  "Production deployment remains manual"
];

const deploymentEnvironments: DeploymentEnvironment[] = ["Local", "Staging", "Production"];

const releaseStatuses: ReleaseStatus[] = ["Draft", "Waiting Approval", "Testing", "Security Review", "Ready for Staging", "Ready for Production", "Deployed", "Rollback Required", "Failed"];

const deploymentReleases: DeploymentReleaseRecord[] = [];

const cloudOperationsPlaceholders: string[] = [];

const backupRecoveryItems: BackupRecoveryRecord[] = [];

const incidentStatuses: IncidentStatus[] = ["Open", "Investigating", "Waiting Approval", "Resolved", "Monitoring"];

const incidents: IncidentRecord[] = [];

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
  { label: "Authentication", status: "Ready", tone: "ready" },
  { label: "RBAC", status: "Ready", tone: "ready" },
  { label: "Project intake", status: "Ready", tone: "ready" },
  { label: "Build missions", status: "Ready", tone: "ready" },
  { label: "Team assignment", status: "Ready", tone: "ready" },
  { label: "Execution", status: "Ready", tone: "ready" },
  { label: "QA approval", status: "Ready", tone: "ready" },
  { label: "Production readiness", status: "Ready", tone: "ready" },
  { label: "Deployment approval", status: "Ready", tone: "ready" },
  { label: "Hardening", status: "Ready", tone: "ready" },
  { label: "Smoke test", status: "Ready", tone: "ready" },
  { label: "Manual production deployment", status: "Pending", tone: "warning" }
];

const financeOverviewCards: MetricCard[] = [];

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

const financeQuotations: FinanceQuotation[] = [];

const invoicePayments: InvoicePaymentRecord[] = [];

const financeApprovalRules = [
  "Quotation release requires human approval",
  "Invoice issue requires human approval",
  "Agreement/contract send requires human approval",
  "Refunds require finance/admin approval",
  "Payment reminders require approval if sensitive or high-value",
  "Customer-facing commercial documents must be audit logged"
];

const hrmsOverviewCards: MetricCard[] = [];

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

const employeeDirectory: EmployeeRecord[] = [];

const hrRequestTypes: HRRequestType[] = [
  "Onboarding",
  "Leave request",
  "Access change",
  "Role change",
  "Payroll query",
  "Performance review",
  "Exit process",
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

const hrRequestQueue: HRRequestRecord[] = [];

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

const leaveAttendanceNotes = [
  "Leave requests are not connected yet",
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

const agentOperationsOverviewCards: MetricCard[] = [];

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

const agentStatuses: AgentStatus[] = ["Active", "Paused", "Waiting Approval", "Blocked", "Failed", "Review Required"];

const agentRegistry: AgentRegistryRecord[] = [];

const agentTaskStatuses: AgentTaskStatus[] = ["Draft", "Running", "Waiting Approval", "In Review", "Blocked", "Completed", "Failed"];

const agentApprovalStates: AgentApprovalState[] = ["Not Required", "Required", "Pending", "Approved", "Rejected"];

const agentTaskQueue: AgentTaskRecord[] = [];

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

const providerHealthPlaceholders: string[] = [];

const auditOverviewCards: MetricCard[] = [];

const auditCategories: AuditCategory[] = ["Approval", "Agent Task", "Security", "Finance", "HR", "Support", "Client", "Project", "System", "Policy"];

const auditSeverities: AuditSeverity[] = ["Info", "Low", "Medium", "High", "Critical"];

const auditStatuses: AuditStatus[] = ["Recorded", "Needs Review", "Approved", "Blocked", "Resolved", "Escalated"];

const auditEvents: AuditEventRecord[] = [];

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

const blockedSafetyEvents: BlockedSafetyEvent[] = [];

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

function EmptyStateSection({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <section className="business-section" id={id}>
      <div className="business-section-heading">
        <span>{description}</span>
        <h2>{title}</h2>
      </div>
      <div className="business-boundary-notice">
        <strong>No real records yet</strong>
        <p>Use the backend-connected workflow sections for real records.</p>
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

type QaChecklistStatusForm = {
  qaStatus: BuildMissionQaChecklistStatus;
  note: string;
  qaOwnerUserId: string;
};

type QaChecklistItemDraft = {
  itemStatus: BuildMissionQaChecklistItemStatus;
  severity: BuildMissionQaChecklistSeverity;
  evidenceNote: string;
  blockerReason: string;
};

type ProductionReadinessChecklistStatusForm = {
  readinessStatus: BuildMissionProductionReadinessChecklistStatus;
  note: string;
  readinessOwnerUserId: string;
};

type ProductionReadinessChecklistItemDraft = {
  itemStatus: BuildMissionProductionReadinessChecklistItemStatus;
  severity: BuildMissionProductionReadinessChecklistSeverity;
  evidenceNote: string;
  blockerReason: string;
};

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
  const [buildMissionQaItems, setBuildMissionQaItems] = useState<BuildMissionQaDashboardItem[]>([]);
  const [selectedBuildMissionQaId, setSelectedBuildMissionQaId] = useState("");
  const [selectedBuildMissionQaDetail, setSelectedBuildMissionQaDetail] = useState<BuildMissionQaDetailItem | null>(null);
  const [buildMissionQaLoading, setBuildMissionQaLoading] = useState(false);
  const [buildMissionQaSaving, setBuildMissionQaSaving] = useState(false);
  const [buildMissionQaMessage, setBuildMissionQaMessage] = useState("");
  const [buildMissionQaError, setBuildMissionQaError] = useState("");
  const [buildMissionQaStatusForm, setBuildMissionQaStatusForm] = useState<QaChecklistStatusForm>({ qaStatus: "DRAFT", note: "", qaOwnerUserId: "" });
  const [buildMissionQaItemDrafts, setBuildMissionQaItemDrafts] = useState<Record<string, QaChecklistItemDraft>>({});
  const [buildMissionProductionReadinessItems, setBuildMissionProductionReadinessItems] = useState<BuildMissionProductionReadinessDashboardItem[]>([]);
  const [selectedBuildMissionProductionReadinessId, setSelectedBuildMissionProductionReadinessId] = useState("");
  const [selectedBuildMissionProductionReadinessDetail, setSelectedBuildMissionProductionReadinessDetail] = useState<BuildMissionProductionReadinessDetailItem | null>(null);
  const [buildMissionProductionReadinessLoading, setBuildMissionProductionReadinessLoading] = useState(false);
  const [buildMissionProductionReadinessSaving, setBuildMissionProductionReadinessSaving] = useState(false);
  const [buildMissionProductionReadinessMessage, setBuildMissionProductionReadinessMessage] = useState("");
  const [buildMissionProductionReadinessError, setBuildMissionProductionReadinessError] = useState("");
  const [buildMissionProductionReadinessStatusForm, setBuildMissionProductionReadinessStatusForm] = useState<ProductionReadinessChecklistStatusForm>({ readinessStatus: "DRAFT", note: "", readinessOwnerUserId: "" });
  const [buildMissionProductionReadinessItemDrafts, setBuildMissionProductionReadinessItemDrafts] = useState<Record<string, ProductionReadinessChecklistItemDraft>>({});
  const [buildMissionDeploymentApprovalItems, setBuildMissionDeploymentApprovalItems] = useState<BuildMissionDeploymentApprovalDashboardItem[]>([]);
  const [selectedBuildMissionDeploymentApprovalId, setSelectedBuildMissionDeploymentApprovalId] = useState("");
  const [selectedBuildMissionDeploymentApprovalDetail, setSelectedBuildMissionDeploymentApprovalDetail] = useState<BuildMissionDeploymentApprovalDashboardItem | null>(null);
  const [buildMissionDeploymentApprovalLoading, setBuildMissionDeploymentApprovalLoading] = useState(false);
  const [buildMissionDeploymentApprovalSaving, setBuildMissionDeploymentApprovalSaving] = useState(false);
  const [buildMissionDeploymentApprovalMessage, setBuildMissionDeploymentApprovalMessage] = useState("");
  const [buildMissionDeploymentApprovalError, setBuildMissionDeploymentApprovalError] = useState("");
  const [buildMissionDeploymentApprovalNote, setBuildMissionDeploymentApprovalNote] = useState("");
  const [deploymentHardeningStatus, setDeploymentHardeningStatus] = useState<DeploymentHardeningStatus | null>(null);
  const [deploymentHardeningLoading, setDeploymentHardeningLoading] = useState(false);
  const [deploymentHardeningError, setDeploymentHardeningError] = useState("");
  const [internalDeploymentSmokeStatus, setInternalDeploymentSmokeStatus] = useState<InternalDeploymentSmokeStatus | null>(null);
  const [internalDeploymentSmokeLoading, setInternalDeploymentSmokeLoading] = useState(false);
  const [internalDeploymentSmokeError, setInternalDeploymentSmokeError] = useState("");

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

  useEffect(() => {
    if (activeSection.id !== "build-mission-qa") return;
    let cancelled = false;
    setBuildMissionQaLoading(true);
    setAssignableUsersLoading(true);
    setBuildMissionQaError("");
    setAssignableUsersError("");
    Promise.allSettled([listBuildMissionQaDashboard(), listAssignableUsers()])
      .then(results => {
        if (cancelled) return;
        const [dashboardResult, usersResult] = results;
        if (dashboardResult.status === "fulfilled") {
          setBuildMissionQaItems(dashboardResult.value);
          setSelectedBuildMissionQaId(current => current || dashboardResult.value[0]?.buildMissionId || "");
        } else {
          setBuildMissionQaError(dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Unable to load QA dashboard");
        }
        if (usersResult.status === "fulfilled") {
          setAssignableUsers(usersResult.value);
        } else {
          setAssignableUsersError(usersResult.reason instanceof Error ? usersResult.reason.message : "Unable to load assignable internal users");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBuildMissionQaLoading(false);
          setAssignableUsersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-qa" || !selectedBuildMissionQaId) return;
    let cancelled = false;
    setBuildMissionQaLoading(true);
    setBuildMissionQaError("");
    getBuildMissionQaDashboardItem(selectedBuildMissionQaId)
      .then(item => {
        if (!cancelled) setSelectedBuildMissionQaDetail(item);
      })
      .catch(error => {
        if (!cancelled) setBuildMissionQaError(error instanceof Error ? error.message : "Unable to load QA dashboard item");
      })
      .finally(() => {
        if (!cancelled) setBuildMissionQaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id, selectedBuildMissionQaId]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-production-readiness") return;
    let cancelled = false;
    setBuildMissionProductionReadinessLoading(true);
    setAssignableUsersLoading(true);
    setBuildMissionProductionReadinessError("");
    setAssignableUsersError("");
    Promise.allSettled([listBuildMissionProductionReadinessDashboard(), listAssignableUsers()])
      .then(results => {
        if (cancelled) return;
        const [dashboardResult, usersResult] = results;
        if (dashboardResult.status === "fulfilled") {
          setBuildMissionProductionReadinessItems(dashboardResult.value);
          setSelectedBuildMissionProductionReadinessId(current => current || dashboardResult.value[0]?.buildMissionId || "");
        } else {
          setBuildMissionProductionReadinessError(dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Unable to load production readiness dashboard");
        }
        if (usersResult.status === "fulfilled") {
          setAssignableUsers(usersResult.value);
        } else {
          setAssignableUsersError(usersResult.reason instanceof Error ? usersResult.reason.message : "Unable to load assignable internal users");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBuildMissionProductionReadinessLoading(false);
          setAssignableUsersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-production-readiness" || !selectedBuildMissionProductionReadinessId) return;
    let cancelled = false;
    setBuildMissionProductionReadinessLoading(true);
    setBuildMissionProductionReadinessError("");
    getBuildMissionProductionReadinessDashboardItem(selectedBuildMissionProductionReadinessId)
      .then(item => {
        if (!cancelled) setSelectedBuildMissionProductionReadinessDetail(item);
      })
      .catch(error => {
        if (!cancelled) setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to load production readiness dashboard item");
      })
      .finally(() => {
        if (!cancelled) setBuildMissionProductionReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id, selectedBuildMissionProductionReadinessId]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-deployment-approval") return;
    let cancelled = false;
    setBuildMissionDeploymentApprovalLoading(true);
    setBuildMissionDeploymentApprovalError("");
    listBuildMissionDeploymentApprovalDashboard()
      .then(dashboard => {
        if (cancelled) return;
        setBuildMissionDeploymentApprovalItems(dashboard);
        setSelectedBuildMissionDeploymentApprovalId(current => current || dashboard[0]?.buildMissionId || "");
      })
      .catch(error => {
        if (!cancelled) setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to load deployment approval dashboard");
      })
      .finally(() => {
        if (!cancelled) setBuildMissionDeploymentApprovalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "build-mission-deployment-approval" || !selectedBuildMissionDeploymentApprovalId) return;
    let cancelled = false;
    setBuildMissionDeploymentApprovalLoading(true);
    setBuildMissionDeploymentApprovalError("");
    getBuildMissionDeploymentApprovalDashboardItem(selectedBuildMissionDeploymentApprovalId)
      .then(item => {
        if (!cancelled) setSelectedBuildMissionDeploymentApprovalDetail(item);
      })
      .catch(error => {
        if (!cancelled) setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to load deployment approval dashboard item");
      })
      .finally(() => {
        if (!cancelled) setBuildMissionDeploymentApprovalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id, selectedBuildMissionDeploymentApprovalId]);

  useEffect(() => {
    if (activeSection.id !== "deployment-cloud") return;
    let cancelled = false;
    setDeploymentHardeningLoading(true);
    setDeploymentHardeningError("");
    getDeploymentHardeningStatus()
      .then(status => {
        if (!cancelled) setDeploymentHardeningStatus(status);
      })
      .catch(error => {
        if (!cancelled) setDeploymentHardeningError(error instanceof Error ? error.message : "Unable to load deployment hardening status");
      })
      .finally(() => {
        if (!cancelled) setDeploymentHardeningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection.id]);

  useEffect(() => {
    if (activeSection.id !== "deployment-cloud") return;
    let cancelled = false;
    setInternalDeploymentSmokeLoading(true);
    setInternalDeploymentSmokeError("");
    getInternalDeploymentSmokeStatus()
      .then(status => {
        if (!cancelled) setInternalDeploymentSmokeStatus(status);
      })
      .catch(error => {
        if (!cancelled) setInternalDeploymentSmokeError(error instanceof Error ? error.message : "Unable to load internal smoke test status");
      })
      .finally(() => {
        if (!cancelled) setInternalDeploymentSmokeLoading(false);
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
  const selectedQaSummaryItem = selectedBuildMissionQaDetail ?? buildMissionQaItems.find(item => item.buildMissionId === selectedBuildMissionQaId) ?? null;
  const selectedQaChecklist = selectedBuildMissionQaDetail?.qaChecklist ?? null;
  const selectedQaChecklistTerminal = Boolean(selectedQaChecklist && ["APPROVED", "REJECTED", "ARCHIVED"].includes(selectedQaChecklist.qaStatus));
  const selectedBuildMissionProductionReadinessDetailResolved = selectedBuildMissionProductionReadinessDetail ?? buildMissionProductionReadinessItems.find(item => item.buildMissionId === selectedBuildMissionProductionReadinessId) ?? null;
  const selectedBuildMissionProductionReadinessChecklistSummary = selectedBuildMissionProductionReadinessDetailResolved?.productionReadinessChecklist ?? null;
  const selectedBuildMissionProductionReadinessChecklist = selectedBuildMissionProductionReadinessDetail?.productionReadinessChecklist ?? null;
  const selectedBuildMissionProductionReadinessChecklistTerminal = Boolean(selectedBuildMissionProductionReadinessChecklistSummary && ["APPROVED", "REJECTED", "ARCHIVED"].includes(selectedBuildMissionProductionReadinessChecklistSummary.readinessStatus));
  const selectedBuildMissionDeploymentApprovalDetailResolved = selectedBuildMissionDeploymentApprovalDetail ?? buildMissionDeploymentApprovalItems.find(item => item.buildMissionId === selectedBuildMissionDeploymentApprovalId) ?? null;
  const selectedBuildMissionDeploymentApproval = selectedBuildMissionDeploymentApprovalDetailResolved?.deploymentApproval ?? null;
  const selectedBuildMissionDeploymentApprovalTerminal = Boolean(selectedBuildMissionDeploymentApproval && ["APPROVED", "REJECTED", "ARCHIVED"].includes(selectedBuildMissionDeploymentApproval.approvalStatus));

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
  useEffect(() => {
    const checklist = selectedBuildMissionQaDetail?.qaChecklist;
    if (!selectedBuildMissionQaDetail || !checklist) {
      setBuildMissionQaStatusForm({ qaStatus: "DRAFT", note: "", qaOwnerUserId: "" });
      setBuildMissionQaItemDrafts({});
      return;
    }
    setBuildMissionQaStatusForm({
      qaStatus: checklist.qaStatus,
      note: checklist.approvalNote ?? checklist.rejectionReason ?? "",
      qaOwnerUserId: checklist.qaOwnerUserId ?? ""
    });
    const drafts: Record<string, QaChecklistItemDraft> = {};
    for (const item of checklist.items) {
      drafts[item.id] = {
        itemStatus: item.itemStatus,
        severity: item.severity,
        evidenceNote: item.evidenceNote ?? "",
        blockerReason: item.blockerReason ?? ""
      };
    }
    setBuildMissionQaItemDrafts(drafts);
  }, [selectedBuildMissionQaDetail?.buildMissionId, selectedBuildMissionQaDetail?.qaChecklist?.updatedAt]);

  useEffect(() => {
    const checklist = selectedBuildMissionProductionReadinessChecklist;
    if (!selectedBuildMissionProductionReadinessDetailResolved || !checklist) {
      setBuildMissionProductionReadinessStatusForm({ readinessStatus: "DRAFT", note: "", readinessOwnerUserId: "" });
      setBuildMissionProductionReadinessItemDrafts({});
      return;
    }
    setBuildMissionProductionReadinessStatusForm({
      readinessStatus: checklist.readinessStatus,
      note: checklist.approvalNote ?? checklist.rejectionReason ?? "",
      readinessOwnerUserId: checklist.readinessOwnerUserId ?? ""
    });
    const drafts: Record<string, ProductionReadinessChecklistItemDraft> = {};
    for (const item of checklist.items) {
      drafts[item.id] = {
        itemStatus: item.itemStatus,
        severity: item.severity,
        evidenceNote: item.evidenceNote ?? "",
        blockerReason: item.blockerReason ?? ""
      };
    }
    setBuildMissionProductionReadinessItemDrafts(drafts);
  }, [selectedBuildMissionProductionReadinessDetail?.buildMissionId, selectedBuildMissionProductionReadinessChecklist?.updatedAt]);
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
  const handleCreateSocialAutomationStudioIntake = async () => {
    const existingIntake = projectIntakes.find(intake => intake.projectName === socialAutomationStudioPhase1MvpShellIntakePayload.projectName);
    if (existingIntake) {
      setSelectedProjectIntakeId(existingIntake.id);
      setProjectIntakeMessage(`Social Automation Studio intake already exists: ${existingIntake.projectName}`);
      setProjectIntakeError("");
      return;
    }
    setProjectIntakeSaving(true);
    setProjectIntakeMessage("");
    setProjectIntakeError("");
    try {
      const intake = await createBusinessProjectIntake(socialAutomationStudioPhase1MvpShellIntakePayload);
      setProjectIntakes(current => [intake, ...current]);
      setSelectedProjectIntakeId(intake.id);
      setProjectIntakeMessage(`Social Automation Studio intake created: ${intake.projectName}`);
    } catch (error) {
      setProjectIntakeError(error instanceof Error ? error.message : "Unable to create Social Automation Studio intake");
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
  const refreshBuildMissionQaDashboard = async (selectedId?: string) => {
    const dashboard = await listBuildMissionQaDashboard();
    setBuildMissionQaItems(dashboard);
    setSelectedBuildMissionQaId(selectedId || dashboard.find(item => item.buildMissionId === selectedQaSummaryItem?.buildMissionId)?.buildMissionId || dashboard[0]?.buildMissionId || "");
  };
  const updateBuildMissionQaStatusField = (field: keyof QaChecklistStatusForm, value: string) => {
    setBuildMissionQaStatusForm(current => ({ ...current, [field]: value } as QaChecklistStatusForm));
  };
  const updateBuildMissionQaItemDraftField = (itemId: string, field: keyof QaChecklistItemDraft, value: string) => {
    setBuildMissionQaItemDrafts(current => ({
      ...current,
      [itemId]: {
        itemStatus: current[itemId]?.itemStatus ?? "NOT_CHECKED",
        severity: current[itemId]?.severity ?? "MEDIUM",
        evidenceNote: current[itemId]?.evidenceNote ?? "",
        blockerReason: current[itemId]?.blockerReason ?? "",
        [field]: value
      } as QaChecklistItemDraft
    }));
  };
  const handleCreateBuildMissionQaChecklist = async () => {
    if (!selectedQaSummaryItem) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    try {
      const item = await createBuildMissionQaChecklist(selectedQaSummaryItem.buildMissionId, {
        qaOwnerUserId: buildMissionQaStatusForm.qaOwnerUserId || null
      });
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist created. QA approval still does not deploy or start agents.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to create QA checklist");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const handleUpdateBuildMissionQaChecklistStatus = async () => {
    if (!selectedBuildMissionQaDetail?.qaChecklist) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    try {
      const item = await updateBuildMissionQaChecklistStatus(selectedBuildMissionQaDetail.buildMissionId, {
        qaStatus: buildMissionQaStatusForm.qaStatus,
        note: buildMissionQaStatusForm.note,
        qaOwnerUserId: buildMissionQaStatusForm.qaOwnerUserId || null
      });
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist status updated.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to update QA checklist status");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const handleUpdateBuildMissionQaChecklistItem = async (itemId: string) => {
    if (!selectedBuildMissionQaDetail?.qaChecklist) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    const draft = buildMissionQaItemDrafts[itemId];
    if (!draft) {
      setBuildMissionQaSaving(false);
      return;
    }
    try {
      const item = await updateBuildMissionQaChecklistItem(selectedBuildMissionQaDetail.buildMissionId, itemId, {
        itemStatus: draft.itemStatus,
        severity: draft.severity,
        evidenceNote: draft.evidenceNote,
        blockerReason: draft.blockerReason
      });
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist item updated.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to update QA checklist item");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const handleApproveBuildMissionQaChecklist = async () => {
    if (!selectedBuildMissionQaDetail?.qaChecklist) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    try {
      const item = await approveBuildMissionQaChecklist(selectedBuildMissionQaDetail.buildMissionId, buildMissionQaStatusForm.note);
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist approved. Production readiness and deployment remain separate gates.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to approve QA checklist");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const handleRejectBuildMissionQaChecklist = async () => {
    if (!selectedBuildMissionQaDetail?.qaChecklist) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    try {
      const item = await rejectBuildMissionQaChecklist(selectedBuildMissionQaDetail.buildMissionId, buildMissionQaStatusForm.note);
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist rejected. Fixes remain governed.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to reject QA checklist");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const handleArchiveBuildMissionQaChecklist = async () => {
    if (!selectedBuildMissionQaDetail?.qaChecklist) return;
    setBuildMissionQaSaving(true);
    setBuildMissionQaMessage("");
    setBuildMissionQaError("");
    try {
      const item = await archiveBuildMissionQaChecklist(selectedBuildMissionQaDetail.buildMissionId);
      setBuildMissionQaItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionQaId(item.buildMissionId);
      setSelectedBuildMissionQaDetail(item);
      setBuildMissionQaMessage("QA checklist archived. History is preserved.");
      await refreshBuildMissionQaDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionQaError(error instanceof Error ? error.message : "Unable to archive QA checklist");
    } finally {
      setBuildMissionQaSaving(false);
    }
  };
  const refreshBuildMissionProductionReadinessDashboard = async (selectedId?: string) => {
    const dashboard = await listBuildMissionProductionReadinessDashboard();
    setBuildMissionProductionReadinessItems(dashboard);
    setSelectedBuildMissionProductionReadinessId(selectedId || dashboard.find(item => item.buildMissionId === selectedBuildMissionProductionReadinessDetailResolved?.buildMissionId)?.buildMissionId || dashboard[0]?.buildMissionId || "");
  };
  const updateBuildMissionProductionReadinessStatusField = (field: keyof ProductionReadinessChecklistStatusForm, value: string) => {
    setBuildMissionProductionReadinessStatusForm(current => ({ ...current, [field]: value } as ProductionReadinessChecklistStatusForm));
  };
  const updateBuildMissionProductionReadinessItemDraftField = (itemId: string, field: keyof ProductionReadinessChecklistItemDraft, value: string) => {
    setBuildMissionProductionReadinessItemDrafts(current => ({
      ...current,
      [itemId]: {
        itemStatus: current[itemId]?.itemStatus ?? "NOT_CHECKED",
        severity: current[itemId]?.severity ?? "MEDIUM",
        evidenceNote: current[itemId]?.evidenceNote ?? "",
        blockerReason: current[itemId]?.blockerReason ?? "",
        [field]: value
      } as ProductionReadinessChecklistItemDraft
    }));
  };
  const handleCreateBuildMissionProductionReadinessChecklist = async () => {
    if (!selectedBuildMissionProductionReadinessDetailResolved) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    try {
      const item = await createBuildMissionProductionReadinessChecklist(selectedBuildMissionProductionReadinessDetailResolved.buildMissionId, {
        readinessOwnerUserId: buildMissionProductionReadinessStatusForm.readinessOwnerUserId || null
      });
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist created. Deployment approval remains separate.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to create production readiness checklist");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const handleUpdateBuildMissionProductionReadinessChecklistStatus = async () => {
    if (!selectedBuildMissionProductionReadinessChecklistSummary) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    try {
      const item = await updateBuildMissionProductionReadinessStatus(selectedBuildMissionProductionReadinessChecklistSummary.buildMissionId, {
        readinessStatus: buildMissionProductionReadinessStatusForm.readinessStatus,
        note: buildMissionProductionReadinessStatusForm.note,
        readinessOwnerUserId: buildMissionProductionReadinessStatusForm.readinessOwnerUserId || null
      });
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist status updated.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to update production readiness checklist status");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const handleUpdateBuildMissionProductionReadinessChecklistItem = async (itemId: string) => {
    if (!selectedBuildMissionProductionReadinessChecklistSummary) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    const draft = buildMissionProductionReadinessItemDrafts[itemId];
    if (!draft) {
      setBuildMissionProductionReadinessSaving(false);
      return;
    }
    try {
      const item = await updateBuildMissionProductionReadinessItem(selectedBuildMissionProductionReadinessChecklistSummary.buildMissionId, itemId, {
        itemStatus: draft.itemStatus,
        severity: draft.severity,
        evidenceNote: draft.evidenceNote,
        blockerReason: draft.blockerReason
      });
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist item updated.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to update production readiness checklist item");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const handleApproveBuildMissionProductionReadinessChecklist = async () => {
    if (!selectedBuildMissionProductionReadinessChecklistSummary) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    try {
      const item = await approveBuildMissionProductionReadiness(selectedBuildMissionProductionReadinessChecklistSummary.buildMissionId, buildMissionProductionReadinessStatusForm.note);
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist approved. Deployment approval remains separate.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to approve production readiness checklist");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const handleRejectBuildMissionProductionReadinessChecklist = async () => {
    if (!selectedBuildMissionProductionReadinessChecklistSummary) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    try {
      const item = await rejectBuildMissionProductionReadiness(selectedBuildMissionProductionReadinessChecklistSummary.buildMissionId, buildMissionProductionReadinessStatusForm.note);
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist rejected. Deployment approval remains separate.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to reject production readiness checklist");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const handleArchiveBuildMissionProductionReadinessChecklist = async () => {
    if (!selectedBuildMissionProductionReadinessChecklistSummary) return;
    setBuildMissionProductionReadinessSaving(true);
    setBuildMissionProductionReadinessMessage("");
    setBuildMissionProductionReadinessError("");
    try {
      const item = await archiveBuildMissionProductionReadiness(selectedBuildMissionProductionReadinessChecklistSummary.buildMissionId);
      setBuildMissionProductionReadinessItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionProductionReadinessId(item.buildMissionId);
      setSelectedBuildMissionProductionReadinessDetail(item);
      setBuildMissionProductionReadinessMessage("Production readiness checklist archived. History is preserved.");
      await refreshBuildMissionProductionReadinessDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionProductionReadinessError(error instanceof Error ? error.message : "Unable to archive production readiness checklist");
    } finally {
      setBuildMissionProductionReadinessSaving(false);
    }
  };
  const refreshBuildMissionDeploymentApprovalDashboard = async (selectedId?: string) => {
    const dashboard = await listBuildMissionDeploymentApprovalDashboard();
    setBuildMissionDeploymentApprovalItems(dashboard);
    setSelectedBuildMissionDeploymentApprovalId(selectedId || dashboard.find(item => item.buildMissionId === selectedBuildMissionDeploymentApprovalDetailResolved?.buildMissionId)?.buildMissionId || dashboard[0]?.buildMissionId || "");
  };
  const handleCreateBuildMissionDeploymentApproval = async () => {
    if (!selectedBuildMissionDeploymentApprovalDetailResolved) return;
    setBuildMissionDeploymentApprovalSaving(true);
    setBuildMissionDeploymentApprovalMessage("");
    setBuildMissionDeploymentApprovalError("");
    try {
      const item = await createBuildMissionDeploymentApproval(selectedBuildMissionDeploymentApprovalDetailResolved.buildMissionId, buildMissionDeploymentApprovalNote);
      setBuildMissionDeploymentApprovalItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionDeploymentApprovalId(item.buildMissionId);
      setSelectedBuildMissionDeploymentApprovalDetail(item);
      setBuildMissionDeploymentApprovalMessage("Deployment approval requested. Approval does not deploy.");
      await refreshBuildMissionDeploymentApprovalDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to create deployment approval");
    } finally {
      setBuildMissionDeploymentApprovalSaving(false);
    }
  };
  const handleApproveBuildMissionDeploymentApproval = async () => {
    if (!selectedBuildMissionDeploymentApproval) return;
    setBuildMissionDeploymentApprovalSaving(true);
    setBuildMissionDeploymentApprovalMessage("");
    setBuildMissionDeploymentApprovalError("");
    try {
      const item = await approveBuildMissionDeploymentApproval(selectedBuildMissionDeploymentApproval.buildMissionId, buildMissionDeploymentApprovalNote);
      setBuildMissionDeploymentApprovalItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionDeploymentApprovalId(item.buildMissionId);
      setSelectedBuildMissionDeploymentApprovalDetail(item);
      setBuildMissionDeploymentApprovalMessage("Deployment approval manually approved. Cloud deployment execution remains separate.");
      await refreshBuildMissionDeploymentApprovalDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to approve deployment approval");
    } finally {
      setBuildMissionDeploymentApprovalSaving(false);
    }
  };
  const handleRejectBuildMissionDeploymentApproval = async () => {
    if (!selectedBuildMissionDeploymentApproval) return;
    setBuildMissionDeploymentApprovalSaving(true);
    setBuildMissionDeploymentApprovalMessage("");
    setBuildMissionDeploymentApprovalError("");
    try {
      const item = await rejectBuildMissionDeploymentApproval(selectedBuildMissionDeploymentApproval.buildMissionId, buildMissionDeploymentApprovalNote);
      setBuildMissionDeploymentApprovalItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionDeploymentApprovalId(item.buildMissionId);
      setSelectedBuildMissionDeploymentApprovalDetail(item);
      setBuildMissionDeploymentApprovalMessage("Deployment approval rejected. No deployment action was triggered.");
      await refreshBuildMissionDeploymentApprovalDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to reject deployment approval");
    } finally {
      setBuildMissionDeploymentApprovalSaving(false);
    }
  };
  const handleArchiveBuildMissionDeploymentApproval = async () => {
    if (!selectedBuildMissionDeploymentApproval) return;
    setBuildMissionDeploymentApprovalSaving(true);
    setBuildMissionDeploymentApprovalMessage("");
    setBuildMissionDeploymentApprovalError("");
    try {
      const item = await archiveBuildMissionDeploymentApproval(selectedBuildMissionDeploymentApproval.buildMissionId);
      setBuildMissionDeploymentApprovalItems(current => current.map(entry => entry.buildMissionId === item.buildMissionId ? item : entry));
      setSelectedBuildMissionDeploymentApprovalId(item.buildMissionId);
      setSelectedBuildMissionDeploymentApprovalDetail(item);
      setBuildMissionDeploymentApprovalMessage("Deployment approval archived. History is preserved.");
      await refreshBuildMissionDeploymentApprovalDashboard(item.buildMissionId);
    } catch (error) {
      setBuildMissionDeploymentApprovalError(error instanceof Error ? error.message : "Unable to archive deployment approval");
    } finally {
      setBuildMissionDeploymentApprovalSaving(false);
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
              <p>Internal governance backend is connected for authentication, RBAC, project intake, build missions, team assignment, execution, QA, production readiness, deployment approval, hardening, and smoke-test status. Public production deployment still requires manual environment setup and final operator approval.</p>
            </div>
            <div className="business-status-card">
              <span>Access boundary</span>
              <strong>Internal only</strong>
              <p>Customers use the separate website, email, support, payments, and future client portal.</p>
            </div>
          </section>

          <section className="business-boundary-notice">
            <strong>Internal-only notice</strong>
            <p>App Studio and Business Control Centre are restricted to Shrinika Technologies internal users. Customers use the separate website, email, support, payments, and future client portal.</p>
          </section>

          <section className="business-section readiness-section" aria-label="Business Control Centre readiness">
            <div className="business-section-heading">
              <span>Connected internal readiness snapshot for protected business workflows.</span>
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
            <strong>Backend readiness note</strong>
            <p>Internal governance backend is connected for authentication, RBAC, project intake, build missions, team assignment, execution, QA, production readiness, deployment approval, hardening, and smoke-test status. Public production deployment still requires manual environment setup and final operator approval.</p>
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
              <span>Internal company and workspace map. Customer systems remain separate from internal tools.</span>
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
              <span>Internal department map for Shrinika Technologies operations.</span>
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
              <span>Policy guidance for role coverage, backup owners, and temporary delegation.</span>
              <h2>Role Hierarchy Editor / Delegation Planner</h2>
            </div>
            <div className="business-boundary-notice role-delegation-boundary">
              <strong>Delegation rules are policy guidance</strong>
              <p>Real project assignment happens through Build Mission Queue using internal assignable users.</p>
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
              <span>Backend-connected assignment flow. Use Build Mission Queue for real records.</span>
              <h2>Project Assignment Control</h2>
            </div>
            <div className="role-boundary-notice">
              <strong>Role boundary</strong>
              <p>Only authorized internal Shrinika Technologies admins, managers, team leaders, and delivery members can access assignment workflows.</p>
            </div>
            <div className="assignment-status-strip" aria-label="Assignment statuses">
              {assignmentStatusBadges.map(status => <span className="assignment-status-badge" key={status}>{status}</span>)}
            </div>
            {projectAssignments.length ? (
              <div className="assignment-card-grid">
                {projectAssignments.map((assignment) => (
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
            ) : (
              <EmptyStateSection id="project-assignment-control-empty" title="Project Assignment Control" description="No real project assignment records are displayed here. Use Build Mission Queue for backend-connected assignments." />
            )}
          </section>
            </>
          ) : null}

          {activeSection.id === "project-operations" ? <EmptyStateSection id="project-operations" title="Project Operations" description="No real project assignment records are displayed here. Use Build Mission Queue for backend-connected assignments." /> : null}

          {activeSection.id === "social-automation-studio" ? (
          <section className="business-section social-automation-studio-section" id="social-automation-studio">
            <div className="business-section-heading">
              <span>Internal website dashboard shell for the approved Social Automation Studio Phase 1 MVP.</span>
              <h2>Social Automation Studio</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>Internal dashboard boundary</strong>
              <p>This shell is internal only. Customers stay on the separate website, email, support, payments, and future client portal. No live integrations, publishing, payment automation, or external API calls are executed from this page.</p>
            </div>
            <div className="assignment-status-strip" aria-label="Social Automation Studio status chips">
              {["Not Started", "Intake Ready", "Approval Required", "Provider Ready", "No Live Integrations"].map(status => <span className="assignment-status-badge" key={status}>{status}</span>)}
            </div>
            <div className="business-card-grid" aria-label="Social Automation Studio module overview">
              {socialAutomationStudioModuleCards.map(module => (
                <article className="business-metric-card neutral" key={module.title}>
                  <span>{module.title}</span>
                  <strong>{module.status}</strong>
                  <div className="assignment-status-strip" aria-label={`${module.title} status chips`}>
                    {module.chips.map(chip => <span className="assignment-status-badge" key={`${module.title}-${chip}`}>{chip}</span>)}
                  </div>
                  <p>{module.description}</p>
                </article>
              ))}
            </div>
            <EmptyStateSection id="social-automation-studio-empty" title="Social Automation Studio" description="No real records yet. Use the backend-connected workflow sections for real records." />
          </section>
          ) : null}

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
                  <label>Project name<input value={projectIntakeForm.projectName} onChange={event => updateProjectIntakeField("projectName", event.target.value)} placeholder="Enter an internal project name" /></label>
                  <label>Client / internal company name<input value={projectIntakeForm.clientOrCompanyName} onChange={event => updateProjectIntakeField("clientOrCompanyName", event.target.value)} placeholder="Enter an internal company or client name" /></label>
                  <label>Project type<select value={projectIntakeForm.projectType} onChange={event => updateProjectIntakeField("projectType", event.target.value)}>{projectTypeOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Priority<select value={projectIntakeForm.priority} onChange={event => updateProjectIntakeField("priority", event.target.value)}>{projectPriorityOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Project source<select value={projectIntakeForm.projectSource} onChange={event => updateProjectIntakeField("projectSource", event.target.value)}>{projectSourceOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>PRD status<select value={projectIntakeForm.prdStatus} onChange={event => updateProjectIntakeField("prdStatus", event.target.value)}>{prdStatusOptions.map(option => <option key={option}>{option}</option>)}</select></label>
                  <label>Delivery deadline<input type="date" value={projectIntakeForm.deliveryDeadline ?? ""} onChange={event => updateProjectIntakeField("deliveryDeadline", event.target.value)} /></label>
                  <label>Estimated budget range<input value={projectIntakeForm.estimatedBudgetRange ?? ""} onChange={event => updateProjectIntakeField("estimatedBudgetRange", event.target.value)} placeholder="Enter a budget range if available" /></label>
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
                  <button type="button" onClick={() => void handleCreateSocialAutomationStudioIntake()} disabled={projectIntakeSaving}>{projectIntakeSaving ? "Saving..." : "Create Social Automation Studio intake"}</button>
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
                        <label>Approval note<textarea value={buildMissionApprovalNote} onChange={event => setBuildMissionApprovalNote(event.target.value)} placeholder="Enter the approval note" /></label>
                        <button type="button" onClick={() => void handleApproveBuildMission()} disabled={buildMissionQueueSaving || !buildMissionApprovalNote.trim() || !["DRAFT", "AWAITING_APPROVAL"].includes(selectedBuildMission.status)}>Approve Build Mission Draft</button>
                        <small>Approval keeps the mission governed. It does not convert, execute, or start agents.</small>
                      </section>
                      <section className="queue-action-card">
                        <h3>Request Changes</h3>
                        <label>Change reason<textarea value={buildMissionChangeReason} onChange={event => setBuildMissionChangeReason(event.target.value)} placeholder="Explain the required PRD or scope changes" /></label>
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
                        <label className="wide">Notes / short-staffing coverage<textarea value={buildMissionAssignmentForm.notes ?? ""} onChange={event => updateBuildMissionAssignmentField("notes", event.target.value)} placeholder="Document temporary coverage and approval assumptions" /></label>
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
                          <label>Request note<textarea value={developmentStartNote} onChange={event => setDevelopmentStartNote(event.target.value)} placeholder="Explain why the mission is ready for development planning" /></label>
                          <button type="button" onClick={() => void handleRequestDevelopmentStart()} disabled={buildMissionQueueSaving || selectedBuildMission.status !== "APPROVED" || !["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedBuildMission.assignment?.assignmentStatus ?? "") || Boolean(selectedBuildMission.developmentGate && ["REQUESTED", "APPROVED"].includes(selectedBuildMission.developmentGate.gateStatus))}>Request Development Start</button>
                        </section>
                        <section className="queue-action-card">
                          <h3>Approve Development Start</h3>
                          <label>Approval note<textarea value={developmentStartApprovalNote} onChange={event => setDevelopmentStartApprovalNote(event.target.value)} placeholder="Optional note for the development-start gate" /></label>
                          <button type="button" onClick={() => void handleApproveDevelopmentStart()} disabled={buildMissionQueueSaving || selectedBuildMission.developmentGate?.gateStatus !== "REQUESTED"}>Approve Development Start</button>
                        </section>
                        <section className="queue-action-card">
                          <h3>Block Development Start</h3>
                          <label>Block reason<textarea value={developmentStartBlockReason} onChange={event => setDevelopmentStartBlockReason(event.target.value)} placeholder="Enter the reason to block development start" /></label>
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
                    <section className="qa-summary-panel">
                      <div className="business-section-heading">
                        <span>QA checklist summary</span>
                        <h2>Testing Readiness</h2>
                      </div>
                      {selectedExecutionItem.qaChecklist ? (
                        <>
                          <div className="recent-intake-meta">
                            <div><span>QA status</span><strong>{selectedExecutionItem.qaChecklist.qaStatus}</strong></div>
                            <div><span>Checklist items</span><strong>{selectedExecutionItem.qaChecklist.itemCount}</strong></div>
                            <div><span>Passed</span><strong>{selectedExecutionItem.qaChecklist.passCount}</strong></div>
                            <div><span>Failures</span><strong>{selectedExecutionItem.qaChecklist.failCount}</strong></div>
                            <div><span>Blocked</span><strong>{selectedExecutionItem.qaChecklist.blockedCount}</strong></div>
                            <div><span>Ready for approval</span><strong>{selectedExecutionItem.qaChecklist.readyForApproval ? "Yes" : "No"}</strong></div>
                          </div>
                          <p>QA approval does not deploy. Production readiness and deployment approval remain separate gates.</p>
                        </>
                      ) : <p>QA checklist not created yet.</p>}
                    </section>
                    <section className="qa-summary-panel">
                      <div className="business-section-heading">
                        <span>Production readiness summary</span>
                        <h2>Release Readiness</h2>
                      </div>
                      {selectedExecutionItem.productionReadinessChecklist ? (
                        <>
                          <div className="recent-intake-meta">
                            <div><span>Readiness status</span><strong>{selectedExecutionItem.productionReadinessChecklist.readinessStatus}</strong></div>
                            <div><span>Checklist items</span><strong>{selectedExecutionItem.productionReadinessChecklist.itemCount}</strong></div>
                            <div><span>Passed</span><strong>{selectedExecutionItem.productionReadinessChecklist.passCount}</strong></div>
                            <div><span>Failures</span><strong>{selectedExecutionItem.productionReadinessChecklist.failCount}</strong></div>
                            <div><span>Blocked</span><strong>{selectedExecutionItem.productionReadinessChecklist.blockedCount}</strong></div>
                            <div><span>Ready for approval</span><strong>{selectedExecutionItem.productionReadinessChecklist.readyForApproval ? "Yes" : "No"}</strong></div>
                          </div>
                          <p>Production readiness approval does not deploy. Deployment approval remains a separate Step 32 gate.</p>
                        </>
                      ) : <p>Production readiness checklist not created yet.</p>}
                    </section>
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
                        <label>Frontend status<input value={buildMissionExecutionForm.frontendStatus ?? ""} onChange={event => updateBuildMissionExecutionField("frontendStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Enter frontend status when available" /></label>
                        <label>Backend status<input value={buildMissionExecutionForm.backendStatus ?? ""} onChange={event => updateBuildMissionExecutionField("backendStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Enter backend status when available" /></label>
                        <label>QA status<input value={buildMissionExecutionForm.qaStatus ?? ""} onChange={event => updateBuildMissionExecutionField("qaStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Enter QA status when available" /></label>
                        <label>Production readiness status<input value={buildMissionExecutionForm.productionReadinessStatus ?? ""} onChange={event => updateBuildMissionExecutionField("productionReadinessStatus", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Enter readiness status when available" /></label>
                        <label className="wide">Blocker summary<textarea value={buildMissionExecutionForm.blockerSummary ?? ""} onChange={event => updateBuildMissionExecutionField("blockerSummary", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Required when execution status is blocked" /></label>
                        <label className="wide">Next action<textarea value={buildMissionExecutionForm.nextAction ?? ""} onChange={event => updateBuildMissionExecutionField("nextAction", event.target.value)} disabled={!selectedExecutionItem.executionStatus} placeholder="Enter the next action for review" /></label>
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

          {activeSection.id === "build-mission-qa" ? (
          <section className="business-section build-mission-qa-section" id="build-mission-qa">
            <div className="business-section-heading">
              <span>Real QA checklist records only. No fake QA missions are shown.</span>
              <h2>QA / Testing Checklist and Approval Flow</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>QA governance boundary</strong>
              <p>QA approval does not deploy. Production readiness and deployment approval remain separate gates.</p>
            </div>
            {buildMissionQaMessage ? <p className="success">{buildMissionQaMessage}</p> : null}
            {buildMissionQaError ? <p className="error">{buildMissionQaError}</p> : null}
            {assignableUsersError ? <p className="error">{assignableUsersError}</p> : null}
            {buildMissionQaLoading ? <p>Loading QA dashboard...</p> : null}
            {!buildMissionQaLoading && !buildMissionQaItems.length ? <p>No Build Missions are ready for QA yet.</p> : null}
            {buildMissionQaItems.length ? (
              <div className="build-mission-queue-layout">
                <div className="build-mission-queue-list">
                  {buildMissionQaItems.map(item => (
                    <button type="button" className={item.buildMissionId === selectedQaSummaryItem?.buildMissionId ? "active" : ""} key={item.buildMissionId} onClick={() => setSelectedBuildMissionQaId(item.buildMissionId)}>
                      <strong>{item.intake.projectName}</strong>
                      <span>{item.targetModule} / {item.riskLevel}</span>
                      <small>{item.qaChecklist?.qaStatus ?? "QA checklist not created yet"} / {item.executionStatus?.currentStage ?? "Execution pending"}</small>
                    </button>
                  ))}
                </div>
                {selectedQaSummaryItem ? (
                  <article className="build-mission-queue-detail">
                    <div className="build-mission-detail-header">
                      <div>
                        <span>Build Mission</span>
                        <h3>{selectedQaSummaryItem.intake.projectName}</h3>
                      </div>
                      <strong className={`assignment-risk ${selectedQaSummaryItem.riskLevel}`}>{selectedQaSummaryItem.riskLevel} risk</strong>
                    </div>
                    <div className="recent-intake-meta">
                      <div><span>Mission status</span><strong>{selectedQaSummaryItem.status}</strong></div>
                      <div><span>Execution status</span><strong>{selectedQaSummaryItem.executionStatus?.executionStatus ?? "Not created"}</strong></div>
                      <div><span>Current stage</span><strong>{selectedQaSummaryItem.executionStatus?.currentStage ?? "Pending record"}</strong></div>
                      <div><span>QA checklist</span><strong>{selectedQaSummaryItem.qaChecklist?.qaStatus ?? "Not created"}</strong></div>
                      <div><span>QA owner</span><strong>{displayAssignableUser(selectedQaSummaryItem.qaChecklist?.qaOwnerUserId ?? null)}</strong></div>
                      <div><span>Updated</span><strong>{selectedQaSummaryItem.qaChecklist?.updatedAt ?? selectedQaSummaryItem.executionStatus?.updatedAt ?? "Not updated"}</strong></div>
                    </div>
                    <div className="execution-readiness-grid">
                      {([
                        ["Build Mission approved", selectedQaSummaryItem.status === "APPROVED"],
                        ["Team assigned", ["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedQaSummaryItem.assignment?.assignmentStatus ?? "")],
                        ["Development start approved", selectedQaSummaryItem.developmentGate?.gateStatus === "APPROVED"],
                        ["Execution record exists", Boolean(selectedQaSummaryItem.executionStatus)],
                        ["Execution in QA-ready stage", Boolean(selectedQaSummaryItem.executionStatus && (["TESTING_QA", "PRODUCTION_READINESS", "DEPLOYMENT_APPROVAL_PENDING", "COMPLETED"].includes(selectedQaSummaryItem.executionStatus.currentStage) || ["QA_REVIEW", "PRODUCTION_READINESS_REVIEW", "COMPLETED"].includes(selectedQaSummaryItem.executionStatus.executionStatus)))],
                        ["QA checklist created", Boolean(selectedQaSummaryItem.qaChecklist)]
                      ] as Array<[string, boolean]>).map(([label, ready]) => (
                        <div className={ready ? "ready" : "pending"} key={String(label)}>
                          <span>{ready ? "Ready" : "Pending"}</span>
                          <strong>{label}</strong>
                        </div>
                      ))}
                    </div>
                    <section className="qa-summary-panel">
                      <div className="business-section-heading">
                        <span>QA checklist summary</span>
                        <h2>Checklist Completion</h2>
                      </div>
                      {selectedQaSummaryItem.qaChecklist ? (
                        <>
                          <div className="recent-intake-meta">
                            <div><span>Checklist items</span><strong>{selectedQaSummaryItem.qaChecklist.itemCount}</strong></div>
                            <div><span>Passed</span><strong>{selectedQaSummaryItem.qaChecklist.passCount}</strong></div>
                            <div><span>Failures</span><strong>{selectedQaSummaryItem.qaChecklist.failCount}</strong></div>
                            <div><span>Blocked</span><strong>{selectedQaSummaryItem.qaChecklist.blockedCount}</strong></div>
                            <div><span>Not applicable</span><strong>{selectedQaSummaryItem.qaChecklist.notApplicableCount}</strong></div>
                            <div><span>Ready for approval</span><strong>{selectedQaSummaryItem.qaChecklist.readyForApproval ? "Yes" : "No"}</strong></div>
                          </div>
                          <p>QA approval does not deploy. Production readiness and deployment approval remain separate gates.</p>
                        </>
                      ) : <p>QA checklist not created yet.</p>}
                    </section>
                    <div className="queue-action-grid">
                      <section className="queue-action-card">
                        <h3>Create QA checklist</h3>
                        <label>QA owner<select value={buildMissionQaStatusForm.qaOwnerUserId} onChange={event => updateBuildMissionQaStatusField("qaOwnerUserId", event.target.value)} disabled={assignableUsersLoading}><option value="">No owner selected</option>{assignableUsers.map(user => <option key={`qa-owner-${user.id}`} value={user.id}>{assignableUserLabel(user)}</option>)}</select></label>
                        <button type="button" onClick={() => void handleCreateBuildMissionQaChecklist()} disabled={buildMissionQaSaving || Boolean(selectedQaSummaryItem.qaChecklist) || selectedQaSummaryItem.status !== "APPROVED" || !["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedQaSummaryItem.assignment?.assignmentStatus ?? "") || selectedQaSummaryItem.developmentGate?.gateStatus !== "APPROVED" || !selectedQaSummaryItem.executionStatus || !(["TESTING_QA", "PRODUCTION_READINESS", "DEPLOYMENT_APPROVAL_PENDING", "COMPLETED"].includes(selectedQaSummaryItem.executionStatus.currentStage) || ["QA_REVIEW", "PRODUCTION_READINESS_REVIEW", "COMPLETED"].includes(selectedQaSummaryItem.executionStatus.executionStatus))}>Create QA Checklist</button>
                        <small>Checklist templates are real QA requirements. They do not start agents or deployments.</small>
                      </section>
                      <section className="queue-action-card">
                        <h3>QA status controls</h3>
                        <label>QA status<select value={buildMissionQaStatusForm.qaStatus} onChange={event => updateBuildMissionQaStatusField("qaStatus", event.target.value)} disabled={!selectedQaChecklist || selectedQaChecklistTerminal}>{(selectedQaChecklistTerminal ? buildMissionQaChecklistStatuses : buildMissionQaChecklistStatuses.filter(status => !["APPROVED", "REJECTED", "ARCHIVED"].includes(status))).map(status => <option key={status} value={status}>{status}</option>)}</select></label>
                        <label>Note<textarea value={buildMissionQaStatusForm.note} onChange={event => updateBuildMissionQaStatusField("note", event.target.value)} disabled={!selectedQaChecklist || selectedQaChecklistTerminal} placeholder="Enter QA notes, fixes requested, or approval context" /></label>
                        <div className="project-prd-actions">
                          <button type="button" onClick={() => void handleUpdateBuildMissionQaChecklistStatus()} disabled={buildMissionQaSaving || !selectedQaChecklist || selectedQaChecklistTerminal || (buildMissionQaStatusForm.qaStatus === "FIXES_REQUESTED" && !buildMissionQaStatusForm.note.trim())}>Update QA Status</button>
                          <button type="button" onClick={() => void handleApproveBuildMissionQaChecklist()} disabled={buildMissionQaSaving || !selectedQaChecklist || selectedQaChecklist.qaStatus !== "READY_FOR_APPROVAL"}>Approve QA</button>
                          <button type="button" onClick={() => void handleRejectBuildMissionQaChecklist()} disabled={buildMissionQaSaving || !selectedQaChecklist || selectedQaChecklistTerminal || !buildMissionQaStatusForm.note.trim()}>Reject QA</button>
                          <button type="button" onClick={() => void handleArchiveBuildMissionQaChecklist()} disabled={buildMissionQaSaving || !selectedQaChecklist}>Archive Checklist</button>
                        </div>
                      </section>
                    </div>
                    <section className="qa-checklist-panel">
                      <div className="business-section-heading">
                        <span>Checklist item table</span>
                        <h2>Manual QA Items</h2>
                      </div>
                      {!selectedQaChecklist ? <p>QA checklist not created yet.</p> : null}
                      {selectedQaChecklist ? (
                        <div className="qa-checklist-table">
                          <div className="qa-checklist-table-header">
                            <span>Item</span>
                            <span>Status</span>
                            <span>Severity</span>
                            <span>Evidence / Blocker</span>
                            <span>Checked by / at</span>
                            <span>Action</span>
                          </div>
                          {selectedQaChecklist.items.map(item => {
                            const draft = buildMissionQaItemDrafts[item.id] ?? {
                              itemStatus: item.itemStatus,
                              severity: item.severity,
                              evidenceNote: item.evidenceNote ?? "",
                              blockerReason: item.blockerReason ?? ""
                            };
                            return (
                              <article className="qa-checklist-row" key={item.id}>
                                <div className="qa-checklist-item-info">
                                  <strong>{item.itemTitle}</strong>
                                  <span>{item.itemKey}</span>
                                  <p>{item.itemDescription ?? "No description provided."}</p>
                                </div>
                                <label>Status<select value={draft.itemStatus} onChange={event => updateBuildMissionQaItemDraftField(item.id, "itemStatus", event.target.value)} disabled={!selectedQaChecklist}>{buildMissionQaChecklistItemStatuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
                                <label>Severity<select value={draft.severity} onChange={event => updateBuildMissionQaItemDraftField(item.id, "severity", event.target.value)} disabled={!selectedQaChecklist}>{buildMissionQaChecklistSeverities.map(severity => <option key={severity} value={severity}>{severity}</option>)}</select></label>
                                <div className="qa-checklist-note-fields">
                                  <label>Evidence<textarea value={draft.evidenceNote} onChange={event => updateBuildMissionQaItemDraftField(item.id, "evidenceNote", event.target.value)} disabled={!selectedQaChecklist} placeholder="Enter evidence or validation detail" /></label>
                                  <label>Blocker<textarea value={draft.blockerReason} onChange={event => updateBuildMissionQaItemDraftField(item.id, "blockerReason", event.target.value)} disabled={!selectedQaChecklist} placeholder="Enter the blocker reason if the item fails" /></label>
                                </div>
                                <div className="qa-checklist-meta">
                                  <div><span>Checked by</span><strong>{displayAssignableUser(item.checkedByUserId)}</strong></div>
                                  <div><span>Checked at</span><strong>{item.checkedAt ?? "Not checked yet"}</strong></div>
                                </div>
                                <div className="qa-checklist-row-action">
                                  <button type="button" onClick={() => void handleUpdateBuildMissionQaChecklistItem(item.id)} disabled={buildMissionQaSaving || !selectedQaChecklist}>Save Item</button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          ) : null}

          {activeSection.id === "build-mission-production-readiness" ? (
          <section className="business-section build-mission-production-readiness-section" id="build-mission-production-readiness">
            <div className="business-section-heading">
              <span>Real production-readiness records only. No fake missions are shown.</span>
              <h2>Production Readiness Checklist</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>Production readiness boundary</strong>
              <p>Production readiness approval does not deploy. Deployment approval remains a separate Step 32 gate.</p>
            </div>
            {buildMissionProductionReadinessMessage ? <p className="success">{buildMissionProductionReadinessMessage}</p> : null}
            {buildMissionProductionReadinessError ? <p className="error">{buildMissionProductionReadinessError}</p> : null}
            {assignableUsersError ? <p className="error">{assignableUsersError}</p> : null}
            {buildMissionProductionReadinessLoading ? <p>Loading production readiness dashboard...</p> : null}
            {!buildMissionProductionReadinessLoading && !buildMissionProductionReadinessItems.length ? <p>No Build Missions are ready for production readiness review yet.</p> : null}
            {buildMissionProductionReadinessItems.length ? (
              <div className="build-mission-queue-layout">
                <div className="build-mission-queue-list">
                  {buildMissionProductionReadinessItems.map(item => (
                    <button type="button" className={item.buildMissionId === selectedBuildMissionProductionReadinessDetailResolved?.buildMissionId ? "active" : ""} key={item.buildMissionId} onClick={() => setSelectedBuildMissionProductionReadinessId(item.buildMissionId)}>
                      <strong>{item.intake.projectName}</strong>
                      <span>{item.targetModule} / {item.riskLevel}</span>
                      <small>{item.productionReadinessChecklist?.readinessStatus ?? "Production readiness checklist not created yet"} / {item.executionStatus?.currentStage ?? "Execution pending"}</small>
                    </button>
                  ))}
                </div>
                {selectedBuildMissionProductionReadinessDetailResolved ? (
                  <article className="build-mission-queue-detail">
                    <div className="build-mission-detail-header">
                      <div>
                        <span>Build Mission</span>
                        <h3>{selectedBuildMissionProductionReadinessDetailResolved.intake.projectName}</h3>
                      </div>
                      <strong className={`assignment-risk ${selectedBuildMissionProductionReadinessDetailResolved.riskLevel}`}>{selectedBuildMissionProductionReadinessDetailResolved.riskLevel} risk</strong>
                    </div>
                    <div className="recent-intake-meta">
                      <div><span>Mission status</span><strong>{selectedBuildMissionProductionReadinessDetailResolved.status}</strong></div>
                      <div><span>Execution status</span><strong>{selectedBuildMissionProductionReadinessDetailResolved.executionStatus?.executionStatus ?? "Not created"}</strong></div>
                      <div><span>Current stage</span><strong>{selectedBuildMissionProductionReadinessDetailResolved.executionStatus?.currentStage ?? "Pending record"}</strong></div>
                      <div><span>QA checklist</span><strong>{selectedBuildMissionProductionReadinessDetailResolved.qaChecklist?.qaStatus ?? "Not created"}</strong></div>
                      <div><span>Production readiness</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary?.readinessStatus ?? "Not created"}</strong></div>
                      <div><span>Readiness owner</span><strong>{displayAssignableUser(selectedBuildMissionProductionReadinessChecklistSummary?.readinessOwnerUserId ?? null)}</strong></div>
                      <div><span>Updated</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary?.updatedAt ?? selectedBuildMissionProductionReadinessDetailResolved.executionStatus?.updatedAt ?? "Not updated"}</strong></div>
                    </div>
                    <div className="execution-readiness-grid">
                      {([
                        ["Build Mission approved", selectedBuildMissionProductionReadinessDetailResolved.status === "APPROVED"],
                        ["Team assigned", ["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedBuildMissionProductionReadinessDetailResolved.assignment?.assignmentStatus ?? "")],
                        ["Development start approved", selectedBuildMissionProductionReadinessDetailResolved.developmentGate?.gateStatus === "APPROVED"],
                        ["Execution record exists", Boolean(selectedBuildMissionProductionReadinessDetailResolved.executionStatus)],
                        ["QA checklist approved", selectedBuildMissionProductionReadinessDetailResolved.qaChecklist?.qaStatus === "APPROVED"],
                        ["Production readiness checklist created", Boolean(selectedBuildMissionProductionReadinessChecklistSummary)],
                        ["Execution in readiness-ready stage", Boolean(selectedBuildMissionProductionReadinessDetailResolved.executionStatus && (["PRODUCTION_READINESS", "DEPLOYMENT_APPROVAL_PENDING", "COMPLETED"].includes(selectedBuildMissionProductionReadinessDetailResolved.executionStatus.currentStage) || ["PRODUCTION_READINESS_REVIEW", "COMPLETED"].includes(selectedBuildMissionProductionReadinessDetailResolved.executionStatus.executionStatus)))]
                      ] as Array<[string, boolean]>).map(([label, ready]) => (
                        <div className={ready ? "ready" : "pending"} key={String(label)}>
                          <span>{ready ? "Ready" : "Pending"}</span>
                          <strong>{label}</strong>
                        </div>
                      ))}
                    </div>
                    <section className="qa-summary-panel">
                      <div className="business-section-heading">
                        <span>Production readiness summary</span>
                        <h2>Release Readiness</h2>
                      </div>
                      {selectedBuildMissionProductionReadinessChecklistSummary ? (
                        <>
                          <div className="recent-intake-meta">
                            <div><span>Checklist items</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.itemCount}</strong></div>
                            <div><span>Passed</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.passCount}</strong></div>
                            <div><span>Failures</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.failCount}</strong></div>
                            <div><span>Blocked</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.blockedCount}</strong></div>
                            <div><span>Not applicable</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.notApplicableCount}</strong></div>
                            <div><span>Ready for approval</span><strong>{selectedBuildMissionProductionReadinessChecklistSummary.readyForApproval ? "Yes" : "No"}</strong></div>
                          </div>
                          <p>Production readiness approval does not deploy. Deployment approval remains a separate Step 32 gate.</p>
                        </>
                      ) : <p>Production readiness checklist not created yet.</p>}
                    </section>
                    <div className="queue-action-grid">
                      <section className="queue-action-card">
                        <h3>Create Production Readiness Checklist</h3>
                        <label>Readiness owner<select value={buildMissionProductionReadinessStatusForm.readinessOwnerUserId} onChange={event => updateBuildMissionProductionReadinessStatusField("readinessOwnerUserId", event.target.value)} disabled={assignableUsersLoading}><option value="">No owner selected</option>{assignableUsers.map(user => <option key={`production-readiness-owner-${user.id}`} value={user.id}>{assignableUserLabel(user)}</option>)}</select></label>
                        <button type="button" onClick={() => void handleCreateBuildMissionProductionReadinessChecklist()} disabled={buildMissionProductionReadinessSaving || Boolean(selectedBuildMissionProductionReadinessChecklistSummary) || selectedBuildMissionProductionReadinessDetailResolved.status !== "APPROVED" || !["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedBuildMissionProductionReadinessDetailResolved.assignment?.assignmentStatus ?? "") || selectedBuildMissionProductionReadinessDetailResolved.developmentGate?.gateStatus !== "APPROVED" || !selectedBuildMissionProductionReadinessDetailResolved.executionStatus || !(["PRODUCTION_READINESS", "DEPLOYMENT_APPROVAL_PENDING", "COMPLETED"].includes(selectedBuildMissionProductionReadinessDetailResolved.executionStatus.currentStage) || ["PRODUCTION_READINESS_REVIEW", "COMPLETED"].includes(selectedBuildMissionProductionReadinessDetailResolved.executionStatus.executionStatus)) || selectedBuildMissionProductionReadinessDetailResolved.qaChecklist?.qaStatus !== "APPROVED"}>Create Production Readiness Checklist</button>
                        <small>Checklist requirements are real production readiness controls. They do not deploy or create deployment approval.</small>
                      </section>
                      <section className="queue-action-card">
                        <h3>Production readiness status controls</h3>
                        <label>Readiness status<select value={buildMissionProductionReadinessStatusForm.readinessStatus} onChange={event => updateBuildMissionProductionReadinessStatusField("readinessStatus", event.target.value)} disabled={!selectedBuildMissionProductionReadinessChecklistSummary || selectedBuildMissionProductionReadinessChecklistTerminal}>{(selectedBuildMissionProductionReadinessChecklistTerminal ? buildMissionProductionReadinessChecklistStatuses : buildMissionProductionReadinessChecklistStatuses.filter(status => !["APPROVED", "REJECTED", "ARCHIVED"].includes(status))).map(status => <option key={status} value={status}>{status}</option>)}</select></label>
                        <label>Note<textarea value={buildMissionProductionReadinessStatusForm.note} onChange={event => updateBuildMissionProductionReadinessStatusField("note", event.target.value)} disabled={!selectedBuildMissionProductionReadinessChecklistSummary || selectedBuildMissionProductionReadinessChecklistTerminal} placeholder="Enter fixes required, approval context, or rejection notes" /></label>
                        <div className="project-prd-actions">
                          <button type="button" onClick={() => void handleUpdateBuildMissionProductionReadinessChecklistStatus()} disabled={buildMissionProductionReadinessSaving || !selectedBuildMissionProductionReadinessChecklistSummary || selectedBuildMissionProductionReadinessChecklistTerminal || (buildMissionProductionReadinessStatusForm.readinessStatus === "FIXES_REQUIRED" && !buildMissionProductionReadinessStatusForm.note.trim())}>Update Status</button>
                          <button type="button" onClick={() => void handleApproveBuildMissionProductionReadinessChecklist()} disabled={buildMissionProductionReadinessSaving || !selectedBuildMissionProductionReadinessChecklistSummary || selectedBuildMissionProductionReadinessChecklistSummary.readinessStatus !== "READY_FOR_APPROVAL"}>Approve Production Readiness</button>
                          <button type="button" onClick={() => void handleRejectBuildMissionProductionReadinessChecklist()} disabled={buildMissionProductionReadinessSaving || !selectedBuildMissionProductionReadinessChecklistSummary || selectedBuildMissionProductionReadinessChecklistTerminal || !buildMissionProductionReadinessStatusForm.note.trim()}>Reject Production Readiness</button>
                          <button type="button" onClick={() => void handleArchiveBuildMissionProductionReadinessChecklist()} disabled={buildMissionProductionReadinessSaving || !selectedBuildMissionProductionReadinessChecklistSummary}>Archive Checklist</button>
                        </div>
                      </section>
                    </div>
                    <section className="qa-checklist-panel">
                      <div className="business-section-heading">
                        <span>Checklist item table</span>
                        <h2>Manual Production Readiness Items</h2>
                      </div>
                      {selectedBuildMissionProductionReadinessChecklist ? (
                        <div className="qa-checklist-table">
                          <div className="qa-checklist-table-header">
                            <span>Item</span>
                            <span>Status</span>
                            <span>Severity</span>
                            <span>Notes</span>
                            <span>Checked</span>
                            <span>Action</span>
                          </div>
                          {selectedBuildMissionProductionReadinessChecklist.items.map(item => {
                            const draft = buildMissionProductionReadinessItemDrafts[item.id] ?? {
                              itemStatus: item.itemStatus,
                              severity: item.severity,
                              evidenceNote: item.evidenceNote ?? "",
                              blockerReason: item.blockerReason ?? ""
                            };
                            return (
                              <article className="qa-checklist-row" key={item.id}>
                                <div className="qa-checklist-item-info">
                                  <span>{item.itemKey}</span>
                                  <strong>{item.itemTitle}</strong>
                                  <p>{item.itemDescription ?? "Production readiness requirement."}</p>
                                </div>
                                <label>
                                  Status
                                  <select value={draft.itemStatus} onChange={event => updateBuildMissionProductionReadinessItemDraftField(item.id, "itemStatus", event.target.value)} disabled={buildMissionProductionReadinessSaving || selectedBuildMissionProductionReadinessChecklistTerminal}>{buildMissionProductionReadinessChecklistItemStatuses.map(status => <option key={status} value={status}>{status}</option>)}</select>
                                </label>
                                <label>
                                  Severity
                                  <select value={draft.severity} onChange={event => updateBuildMissionProductionReadinessItemDraftField(item.id, "severity", event.target.value)} disabled={buildMissionProductionReadinessSaving || selectedBuildMissionProductionReadinessChecklistTerminal}>{buildMissionProductionReadinessChecklistSeverities.map(severity => <option key={severity} value={severity}>{severity}</option>)}</select>
                                </label>
                                <div className="qa-checklist-note-fields">
                                  <label>
                                    Evidence note
                                    <textarea value={draft.evidenceNote} onChange={event => updateBuildMissionProductionReadinessItemDraftField(item.id, "evidenceNote", event.target.value)} disabled={buildMissionProductionReadinessSaving || selectedBuildMissionProductionReadinessChecklistTerminal} placeholder="Enter evidence or validation notes" />
                                  </label>
                                  <label>
                                    Blocker reason
                                    <textarea value={draft.blockerReason} onChange={event => updateBuildMissionProductionReadinessItemDraftField(item.id, "blockerReason", event.target.value)} disabled={buildMissionProductionReadinessSaving || selectedBuildMissionProductionReadinessChecklistTerminal} placeholder="Enter the blocker reason when needed" />
                                  </label>
                                </div>
                                <div className="qa-checklist-meta">
                                  <div><span>Checked by</span><strong>{displayAssignableUser(item.checkedByUserId)}</strong></div>
                                  <div><span>Checked at</span><strong>{item.checkedAt ?? "Not checked"}</strong></div>
                                </div>
                                <div className="qa-checklist-row-action">
                                  <button type="button" onClick={() => void handleUpdateBuildMissionProductionReadinessChecklistItem(item.id)} disabled={buildMissionProductionReadinessSaving || !selectedBuildMissionProductionReadinessChecklistSummary}>Save Item</button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : <p>Production readiness checklist not created yet.</p>}
                    </section>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          ) : null}

          {activeSection.id === "build-mission-deployment-approval" ? (
          <section className="business-section build-mission-deployment-approval-section" id="build-mission-deployment-approval">
            <div className="business-section-heading">
              <span>Real deployment approval records only. No deployment execution is connected.</span>
              <h2>Deployment Approval</h2>
            </div>
            <div className="business-boundary-notice">
              <strong>Deployment approval boundary</strong>
              <p>Approval does not deploy. Cloud deployment execution remains separate.</p>
            </div>
            {buildMissionDeploymentApprovalMessage ? <p className="success">{buildMissionDeploymentApprovalMessage}</p> : null}
            {buildMissionDeploymentApprovalError ? <p className="error">{buildMissionDeploymentApprovalError}</p> : null}
            {buildMissionDeploymentApprovalLoading ? <p>Loading deployment approval dashboard...</p> : null}
            {!buildMissionDeploymentApprovalLoading && !buildMissionDeploymentApprovalItems.length ? <p>No Build Missions are ready for deployment approval yet.</p> : null}
            {buildMissionDeploymentApprovalItems.length ? (
              <div className="build-mission-queue-layout">
                <div className="build-mission-queue-list">
                  {buildMissionDeploymentApprovalItems.map(item => (
                    <button type="button" className={item.buildMissionId === selectedBuildMissionDeploymentApprovalDetailResolved?.buildMissionId ? "active" : ""} key={item.buildMissionId} onClick={() => setSelectedBuildMissionDeploymentApprovalId(item.buildMissionId)}>
                      <strong>{item.intake.projectName}</strong>
                      <span>{item.targetModule} / {item.riskLevel}</span>
                      <small>{item.deploymentApproval?.approvalStatus ?? "Deployment approval not created yet"} / Production readiness {item.productionReadinessChecklist?.readinessStatus ?? "Not approved"}</small>
                    </button>
                  ))}
                </div>
                {selectedBuildMissionDeploymentApprovalDetailResolved ? (
                  <article className="build-mission-queue-detail">
                    <div className="build-mission-detail-header">
                      <div>
                        <span>Build Mission</span>
                        <h3>{selectedBuildMissionDeploymentApprovalDetailResolved.intake.projectName}</h3>
                      </div>
                      <strong className={`assignment-risk ${selectedBuildMissionDeploymentApprovalDetailResolved.riskLevel}`}>{selectedBuildMissionDeploymentApprovalDetailResolved.riskLevel} risk</strong>
                    </div>
                    <div className="recent-intake-meta">
                      <div><span>Mission status</span><strong>{selectedBuildMissionDeploymentApprovalDetailResolved.status}</strong></div>
                      <div><span>Execution stage</span><strong>{selectedBuildMissionDeploymentApprovalDetailResolved.executionStatus?.currentStage ?? "Not created"}</strong></div>
                      <div><span>QA checklist</span><strong>{selectedBuildMissionDeploymentApprovalDetailResolved.qaChecklist?.qaStatus ?? "Not created"}</strong></div>
                      <div><span>Production readiness</span><strong>{selectedBuildMissionDeploymentApprovalDetailResolved.productionReadinessChecklist?.readinessStatus ?? "Not created"}</strong></div>
                      <div><span>Deployment approval</span><strong>{selectedBuildMissionDeploymentApproval?.approvalStatus ?? "Not created"}</strong></div>
                      <div><span>Requested by</span><strong>{displayAssignableUser(selectedBuildMissionDeploymentApproval?.requestedByUserId)}</strong></div>
                      <div><span>Approved by</span><strong>{displayAssignableUser(selectedBuildMissionDeploymentApproval?.approvedByUserId)}</strong></div>
                      <div><span>Updated</span><strong>{selectedBuildMissionDeploymentApproval?.updatedAt ?? selectedBuildMissionDeploymentApprovalDetailResolved.productionReadinessChecklist?.updatedAt ?? "Not updated"}</strong></div>
                    </div>
                    <div className="execution-readiness-grid">
                      {([
                        ["Build Mission approved", selectedBuildMissionDeploymentApprovalDetailResolved.status === "APPROVED"],
                        ["Team assigned", ["ASSIGNED", "READY_FOR_DEVELOPMENT_APPROVAL"].includes(selectedBuildMissionDeploymentApprovalDetailResolved.assignment?.assignmentStatus ?? "")],
                        ["Development start approved", selectedBuildMissionDeploymentApprovalDetailResolved.developmentGate?.gateStatus === "APPROVED"],
                        ["Execution record exists", Boolean(selectedBuildMissionDeploymentApprovalDetailResolved.executionStatus)],
                        ["QA approved", selectedBuildMissionDeploymentApprovalDetailResolved.qaChecklist?.qaStatus === "APPROVED"],
                        ["Production readiness approved", selectedBuildMissionDeploymentApprovalDetailResolved.productionReadinessChecklist?.readinessStatus === "APPROVED"],
                        ["Deployment approval record created", Boolean(selectedBuildMissionDeploymentApproval)]
                      ] as Array<[string, boolean]>).map(([label, ready]) => (
                        <div className={ready ? "ready" : "pending"} key={String(label)}>
                          <span>{ready ? "Ready" : "Pending"}</span>
                          <strong>{label}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="queue-action-grid">
                      <section className="queue-action-card">
                        <h3>Deployment approval request</h3>
                        <label>Note<textarea value={buildMissionDeploymentApprovalNote} onChange={event => setBuildMissionDeploymentApprovalNote(event.target.value)} placeholder="Enter approval context, rejection reason, or archive note" /></label>
                        <button type="button" onClick={() => void handleCreateBuildMissionDeploymentApproval()} disabled={buildMissionDeploymentApprovalSaving || Boolean(selectedBuildMissionDeploymentApproval) || selectedBuildMissionDeploymentApprovalDetailResolved.productionReadinessChecklist?.readinessStatus !== "APPROVED"}>Create Deployment Approval</button>
                        <small>Deployment approval can be created only after production readiness is approved.</small>
                      </section>
                      <section className="queue-action-card">
                        <h3>Manual final approval</h3>
                        <div className="project-prd-actions">
                          <button type="button" onClick={() => void handleApproveBuildMissionDeploymentApproval()} disabled={buildMissionDeploymentApprovalSaving || !selectedBuildMissionDeploymentApproval || selectedBuildMissionDeploymentApprovalTerminal || !["REQUESTED", "DRAFT"].includes(selectedBuildMissionDeploymentApproval.approvalStatus)}>Approve Deployment</button>
                          <button type="button" onClick={() => void handleRejectBuildMissionDeploymentApproval()} disabled={buildMissionDeploymentApprovalSaving || !selectedBuildMissionDeploymentApproval || selectedBuildMissionDeploymentApprovalTerminal || !buildMissionDeploymentApprovalNote.trim()}>Reject Deployment Approval</button>
                          <button type="button" onClick={() => void handleArchiveBuildMissionDeploymentApproval()} disabled={buildMissionDeploymentApprovalSaving || !selectedBuildMissionDeploymentApproval}>Archive Approval</button>
                        </div>
                        <small>These controls update approval records only. They do not deploy, call cloud providers, run agents, create proposals, or apply code.</small>
                      </section>
                    </div>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          ) : null}

          {activeSection.id === "client-management" ? (
          <section className="business-section client-management-section" id="client-management">
            <div className="business-section-heading">
              <span>Customer-facing access is not enabled here.</span>
              <h2>Client Management</h2>
            </div>
            <div className="business-boundary-notice client-boundary-notice">
              <strong>Client Communication Boundary</strong>
              <p>Client Management backend is not connected yet. Customer communication remains outside Business Control Centre through website, email, support, payments, and future client portal.</p>
            </div>
            <EmptyStateSection id="client-management-empty" title="Client Management" description="No real records yet." />
          </section>
          ) : null}

          {activeSection.id === "approvals" ? <EmptyStateSection id="approvals" title="Approvals Control Centre" description="Use Build Mission Queue, QA Approval, Production Readiness, and Deployment Approval sections for real approval records." /> : null}

          {activeSection.id === "support-desk" ? (
          <section className="business-section support-desk-section" id="support-desk">
            <div className="business-section-heading">
              <span>Support queue backend is not connected here.</span>
              <h2>Support Desk</h2>
            </div>
            <div className="business-boundary-notice support-boundary-notice">
              <strong>Support Desk is internal</strong>
              <p>Support Desk backend is not connected yet. Customers do not access Business Control Centre. Customer updates must go through external support channels or future Client Portal.</p>
            </div>
            <EmptyStateSection id="support-desk-empty" title="Support Desk" description="No real ticket data yet." />
          </section>
          ) : null}

          {activeSection.id === "finance-billing" ? (
          <section className="business-section finance-billing-section" id="finance-billing">
            <div className="business-section-heading">
              <span>Commercial planning only. No billing backend is connected here.</span>
              <h2>Finance & Billing</h2>
            </div>
            <div className="business-boundary-notice finance-boundary-notice">
              <strong>Finance Boundary Notice</strong>
              <p>Finance/Billing backend is not connected yet. No quotation, invoice, payment, or agreement document is generated from this UI.</p>
            </div>
            <EmptyStateSection id="finance-billing-empty" title="Finance & Billing" description="This section is policy guidance only until backend integration is added." />
          </section>
          ) : null}

          {activeSection.id === "hrms" ? (
          <section className="business-section hrms-section" id="hrms">
            <div className="business-section-heading">
              <span>HRMS policy guidance only.</span>
              <h2>HRMS / Employee Management</h2>
            </div>
            <div className="business-boundary-notice hrms-boundary-notice">
              <strong>Employee Access Boundary</strong>
              <p>HRMS backend is not connected yet. Internal auth users and assignable users are handled separately by the backend identity system. Do not show fake employees.</p>
            </div>
            <EmptyStateSection id="hrms-empty" title="HRMS / Employee Management" description="HRMS backend is not connected yet. Internal auth users and assignable users are handled separately by the backend identity system. Do not show fake employees." />
          </section>
          ) : null}

          {activeSection.id === "agent-operations" ? (
          <section className="business-section agent-operations-section" id="agent-operations">
            <div className="business-section-heading">
              <span>Agent governance policy guidance only.</span>
              <h2>Agent Operations</h2>
            </div>
            <div className="business-boundary-notice governance-boundary-notice">
              <strong>Agent Operations Boundary</strong>
              <p>Agent Operations dashboard backend is not connected to live agent execution metrics yet. Agent production actions remain governed through Agent Core, approvals, sandboxing, Git checkpoints, tests, and human authority.</p>
            </div>
            <EmptyStateSection id="agent-operations-empty" title="Agent Operations" description="Agent production actions remain governed through Agent Core, approvals, sandboxing, Git checkpoints, tests, and human authority." />
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
            <EmptyStateSection id="agent-provider-empty" title="Provider Governance" description="No live provider health data is shown here yet." />
          </section>
          ) : null}

          {activeSection.id === "audit-compliance" ? (
          <section className="business-section audit-compliance-section" id="audit-compliance">
            <div className="business-section-heading">
              <span>Audit and compliance policy guidance only.</span>
              <h2>Audit & Compliance</h2>
            </div>
            <div className="business-boundary-notice governance-boundary-notice">
              <strong>Governance Dashboard Boundary</strong>
              <p>Agent Operations and Audit/Compliance are internal governance dashboards only. They are not customer-facing and must not expose secrets, API keys, private employee data, or sensitive customer data.</p>
            </div>
            <EmptyStateSection id="audit-compliance-empty" title="Audit & Compliance" description="No live audit events are connected yet." />
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
              <EmptyStateSection id="blocked-actions-empty" title="Safety Gate Queue" description="No live safety events are connected to this dashboard yet." />
            </div>
          </section>
          ) : null}

          {activeSection.id === "system-health" ? (
          <section className="business-section system-operations-section" id="system-health">
            <div className="business-section-heading">
              <span>Live infrastructure probes are not connected yet. Real deployment hardening and internal smoke-test readiness are shown below.</span>
              <h2>System Health</h2>
            </div>
            <div className="business-boundary-notice system-boundary-notice">
              <strong>System / Cloud Boundary Notice</strong>
              <p>System Health and Cloud Operations are internal-only dashboards. This UI must not execute deployments, expose secrets, call providers, change DNS, send emails, modify infrastructure, or perform production actions.</p>
            </div>
            <EmptyStateSection id="system-health-empty" title="System Health" description="Live infrastructure probes are not connected yet. Real deployment hardening and internal smoke-test readiness are shown below." />
          </section>
          ) : null}

          {activeSection.id === "deployment-cloud" ? (
          <section className="business-section deployment-cloud-section" id="deployment-cloud">
            <div className="business-section-heading">
              <span>Deployment and cloud operations are approval-gated and read-only here.</span>
              <h2>Deployment / Cloud Operations</h2>
            </div>
            <div className="business-boundary-notice system-boundary-notice">
              <strong>Deployment Approval Boundary</strong>
              <p>Deployment and cloud operations are approval-gated. No production deployment, rollback, domain change, provider change, secret change, or infrastructure change should bypass human approval, audit logging, Git checkpoints, tests, and security review.</p>
            </div>
            <div className="deployment-hardening-panel">
              <div className="business-section-heading">
                <span>Real internal API hardening status. Config values are never returned.</span>
                <h2>Cloud Deployment Config + Environment Hardening</h2>
              </div>
              {deploymentHardeningLoading ? <p>Loading deployment hardening status...</p> : null}
              {deploymentHardeningError ? <p className="error">{deploymentHardeningError}</p> : null}
              {!deploymentHardeningLoading && !deploymentHardeningError && !deploymentHardeningStatus ? <p>Live metric not connected yet.</p> : null}
              {deploymentHardeningStatus ? (
                <>
                  <div className="recent-intake-meta">
                    <div><span>Environment</span><strong>{deploymentHardeningStatus.environment}</strong></div>
                    <div><span>Missing production config names</span><strong>{deploymentHardeningStatus.missingConfigNames.length ? deploymentHardeningStatus.missingConfigNames.join(", ") : "None reported"}</strong></div>
                  </div>
                  <div className="deployment-hardening-grid">
                    {deploymentHardeningStatus.checks.map(check => (
                      <article className="system-ops-card" key={check.key}>
                        <div className="system-ops-card-header">
                          <div>
                            <span>{check.key}</span>
                            <h3>{check.label}</h3>
                          </div>
                          <span className={`system-ops-status-badge ${check.status.toLowerCase()}`}>{check.status}</span>
                        </div>
                        <p>{check.message}</p>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <div className="deployment-hardening-panel">
              <div className="business-section-heading">
                <span>Read-only final readiness smoke test. No deployment or provider action is executed from this UI.</span>
                <h2>Final Internal Smoke Test</h2>
              </div>
              <div className="recent-intake-meta">
                <div><span>Command</span><strong>npm run internal:smoke</strong></div>
                <div><span>Checklist doc</span><strong>docs/final-internal-deployment-smoke-test.md</strong></div>
              </div>
              {internalDeploymentSmokeLoading ? <p>Loading internal smoke test status...</p> : null}
              {internalDeploymentSmokeError ? <p className="error">{internalDeploymentSmokeError}</p> : null}
              {internalDeploymentSmokeStatus ? (
                <div className="deployment-hardening-grid">
                  <article className="system-ops-card">
                    <div className="system-ops-card-header">
                      <div>
                        <span>internal-smoke-test</span>
                        <h3>{internalDeploymentSmokeStatus.status}</h3>
                      </div>
                      <span className="system-ops-status-badge warning">Manual run required</span>
                    </div>
                    <p>{internalDeploymentSmokeStatus.summary}</p>
                    <div className="system-ops-detail-grid">
                      <div><span>Command</span><strong>{internalDeploymentSmokeStatus.command}</strong></div>
                      <div><span>Docs</span><strong>{internalDeploymentSmokeStatus.docsPath}</strong></div>
                      <div><span>Manual approval</span><strong>{internalDeploymentSmokeStatus.deploymentRequiresManualApproval ? "Required" : "Not reported"}</strong></div>
                    </div>
                  </article>
                </div>
              ) : null}
            </div>
            <EmptyStateSection id="deployment-overview-empty" title="Deployment / Cloud Operations" description="Deployment execution, rollback, DNS, provider, backup, and infrastructure actions are not executed from this UI." />
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
