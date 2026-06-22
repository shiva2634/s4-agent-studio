import { getInternalAuthApiBase } from "./internal-auth";

export type BusinessProjectIntake = {
  id: string;
  projectName: string;
  clientOrCompanyName: string;
  projectType: string;
  priority: string;
  projectSource: string;
  prdStatus: string;
  shortSummary: string;
  problemStatement: string;
  targetUsers: string | null;
  coreModulesRequired: string | null;
  keyFeatures: string | null;
  integrationsNeeded: string | null;
  designReferences: string | null;
  deliveryDeadline: string | null;
  estimatedBudgetRange: string | null;
  risksAssumptions: string | null;
  finalApprovalOwner: string;
  workflowStatus: string;
  appStudioBuildMissionId: string | null;
  handedOffAt: string | null;
  handedOffByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type BusinessProjectIntakePayload = Omit<BusinessProjectIntake,
  "id" | "appStudioBuildMissionId" | "handedOffAt" | "handedOffByUserId" | "createdAt" | "updatedAt" | "archivedAt"
>;

export const socialAutomationStudioPhase1MvpShellIntakePayload: BusinessProjectIntakePayload = {
  projectName: "Social Automation Studio \u2014 Phase 1 MVP Shell",
  clientOrCompanyName: "Shrinika Technologies",
  projectType: "Mobile App",
  priority: "High",
  projectSource: "Admin instruction",
  prdStatus: "Approved",
  shortSummary: "Create the Phase 1 MVP shell for Social Automation Studio with an Android customer app, internal website dashboard, and governed AI workflow placeholders using real empty states only.",
  problemStatement: "Shrinika needs a governed social automation product foundation that can intake content ideas, manage CRM, finance and credits, editing and compliance, publishing approvals, Meta Ads intake, marketplace intake, support, and analytics without live publishing or payment automation.",
  targetUsers: "Android customers, internal operators, approvers, support, finance, compliance, and admins.",
  coreModulesRequired: "Android customer app shell, internal website dashboard shell, CRM starter, finance and credits starter, content idea intake, AI generation job queue placeholder, editing and compliance queue, publishing approval queue, Meta Ads intake, third-party advertisement marketplace intake, support ticket starter, analytics starter",
  keyFeatures: "Governed intake and approval flow, OpenAI script and prompt workflow placeholder, real empty states only, internal and customer separation, no live platform calls, no payment automation",
  integrationsNeeded: "OpenAI API, Meta Ads intake only, analytics backend, support backend, future billing provider, mobile app shell, future iOS roadmap",
  designReferences: "Follow existing Business Control Centre and App Studio governed workflow patterns. Keep customer-facing surfaces separate from the internal operator dashboard.",
  deliveryDeadline: null,
  estimatedBudgetRange: null,
  risksAssumptions: "No unauthorized scraping, no copyrighted movie clips or music, no celebrity cloning, no live external platform API calls, no payment automation, and human approval remains required for publishing and high-cost actions.",
  finalApprovalOwner: "Shrinika",
  workflowStatus: "READY_FOR_APP_STUDIO"
};

type IntakeListResponse = {
  intakes?: BusinessProjectIntake[];
};

type IntakeResponse = {
  intake?: BusinessProjectIntake;
  error?: string;
};

type HandoffResponse = {
  intake?: BusinessProjectIntake;
  buildMission?: {
    id: string;
    status: string;
    targetModule: string;
    projectId: string;
    approvalRequired: boolean;
    nextAction: string;
  };
  buildMissionId?: string;
  error?: string;
};

function projectIntakeUrl(path: string) {
  return `${getInternalAuthApiBase()}${path}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function listBusinessProjectIntakes(): Promise<BusinessProjectIntake[]> {
  const response = await fetch(projectIntakeUrl("/api/business-control-centre/project-intakes"), {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to load project intakes");
  const body = await readJson(response) as IntakeListResponse;
  return Array.isArray(body.intakes) ? body.intakes : [];
}

export async function createBusinessProjectIntake(payload: BusinessProjectIntakePayload): Promise<BusinessProjectIntake> {
  const response = await fetch(projectIntakeUrl("/api/business-control-centre/project-intakes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const body = await readJson(response) as IntakeResponse;
  if (!response.ok || !body.intake) throw new Error(typeof body.error === "string" ? body.error : "Unable to create project intake");
  return body.intake;
}

export async function createBuildMissionFromProjectIntake(id: string): Promise<{ intake: BusinessProjectIntake; buildMission: NonNullable<HandoffResponse["buildMission"]> }> {
  const response = await fetch(projectIntakeUrl(`/api/business-control-centre/project-intakes/${encodeURIComponent(id)}/create-build-mission`), {
    method: "POST",
    credentials: "include"
  });
  const body = await readJson(response) as HandoffResponse;
  if (!response.ok || !body.intake || !body.buildMission) {
    throw new Error(typeof body.error === "string" ? body.error : "Unable to create App Studio Build Mission draft");
  }
  return { intake: body.intake, buildMission: body.buildMission };
}
