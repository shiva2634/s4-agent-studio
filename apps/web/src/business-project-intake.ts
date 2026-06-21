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
