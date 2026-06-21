import { getInternalAuthApiBase } from "./internal-auth";

export type InternalDeploymentSmokeStatus = {
  command: string;
  docsPath: string;
  status: "manual-run-required";
  summary: string;
  deploymentRequiresManualApproval: boolean;
};

type InternalDeploymentSmokeResponse = Partial<InternalDeploymentSmokeStatus> & {
  error?: string;
};

function smokeStatusUrl(path: string) {
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

export async function getInternalDeploymentSmokeStatus(): Promise<InternalDeploymentSmokeStatus> {
  const response = await fetch(smokeStatusUrl("/api/business-control-centre/internal-smoke-test-status"), {
    credentials: "include"
  });
  const body = await readJson(response) as InternalDeploymentSmokeResponse;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to load internal smoke test status");
  return {
    command: typeof body.command === "string" ? body.command : "npm run internal:smoke",
    docsPath: typeof body.docsPath === "string" ? body.docsPath : "docs/final-internal-deployment-smoke-test.md",
    status: body.status === "manual-run-required" ? "manual-run-required" : "manual-run-required",
    summary: typeof body.summary === "string" ? body.summary : "Read-only smoke validation is available. Deployment still requires explicit manual approval.",
    deploymentRequiresManualApproval: body.deploymentRequiresManualApproval === true
  };
}
