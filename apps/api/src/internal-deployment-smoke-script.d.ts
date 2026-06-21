declare module "../../../scripts/internal-deployment-smoke.mjs" {
  export type InternalDeploymentSmokeCheck = {
    key: string;
    status: "PASS" | "FAIL";
    message: string;
  };

  export type InternalDeploymentSmokeResult = {
    rootDir: string;
    command: string;
    checks: InternalDeploymentSmokeCheck[];
    ok: boolean;
  };

  export function runInternalDeploymentSmoke(options?: { rootDir?: string }): Promise<InternalDeploymentSmokeResult>;
  export function formatInternalDeploymentSmokeReport(result: InternalDeploymentSmokeResult): string;
}
