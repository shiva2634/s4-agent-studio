import { getInternalAuthApiBase } from "./internal-auth";

export type DeploymentHardeningCheckStatus = "PASS" | "WARN" | "FAIL";

export type DeploymentHardeningCheck = {
  key: string;
  label: string;
  status: DeploymentHardeningCheckStatus;
  message: string;
};

export type DeploymentHardeningStatus = {
  environment: "production" | "non-production";
  checks: DeploymentHardeningCheck[];
  missingConfigNames: string[];
};

type DeploymentHardeningResponse = Partial<DeploymentHardeningStatus> & {
  error?: string;
};

function hardeningUrl(path: string) {
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

export async function getDeploymentHardeningStatus(): Promise<DeploymentHardeningStatus> {
  const response = await fetch(hardeningUrl("/api/business-control-centre/deployment-hardening-status"), {
    credentials: "include"
  });
  const body = await readJson(response) as DeploymentHardeningResponse;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to load deployment hardening status");
  return {
    environment: body.environment === "production" ? "production" : "non-production",
    checks: Array.isArray(body.checks) ? body.checks.filter(isHardeningCheck) : [],
    missingConfigNames: Array.isArray(body.missingConfigNames) ? body.missingConfigNames.filter((item): item is string => typeof item === "string") : []
  };
}

function isHardeningCheck(value: unknown): value is DeploymentHardeningCheck {
  const check = value as DeploymentHardeningCheck;
  return Boolean(check) &&
    typeof check.key === "string" &&
    typeof check.label === "string" &&
    (check.status === "PASS" || check.status === "WARN" || check.status === "FAIL") &&
    typeof check.message === "string";
}
