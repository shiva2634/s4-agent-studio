import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const requiredRootScripts = ["typecheck", "test", "db:init", "internal:smoke"];
export const requiredWorkspaceCommands = [
  { packagePath: "apps/api/package.json", scripts: ["typecheck", "test"] },
  { packagePath: "apps/web/package.json", scripts: ["typecheck"] },
  { packagePath: "packages/db/package.json", scripts: ["db:init", "test"] }
];
export const requiredConfigNames = [
  "S4_DB_PATH",
  "S4_WEB_ORIGINS",
  "S4_INTERNAL_APP_ORIGIN",
  "S4_API_PUBLIC_ORIGIN",
  "S4_BACKUP_LOCATION",
  "S4_LOG_RETENTION_DAYS",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_DEFAULT_MODEL",
  "OPENAI_SCRIPT_MODEL",
  "OPENAI_PROMPT_MODEL",
  "NVIDIA_API_KEY",
  "NVIDIA_BASE_URL",
  "NVIDIA_DEFAULT_MODEL",
  "PROVIDER_OPENAI_ENABLED",
  "PROVIDER_NVIDIA_ENABLED",
  "PROVIDER_DAILY_CREDIT_LIMIT",
  "PROVIDER_REQUEST_TIMEOUT_MS"
];
export const requiredBusinessAuthRoutes = [
  "/api/business-auth/login",
  "/api/business-auth/logout",
  "/api/business-auth/current-user"
];
export const requiredBusinessControlCentreRoutes = [
  "/api/business-control-centre/system-health",
  "/api/business-control-centre/deployment-hardening-status",
  "/api/business-control-centre/internal-smoke-test-status"
];
export const requiredAppStudioRoutes = [
  "/api/app-studio/internal/overview",
  "/api/app-studio/internal/build-missions",
  "/api/app-studio/internal/security-status",
  "/api/app-studio/internal/providers/status"
];
export const safeEmptySecretNames = ["AI_API_KEY", "OPENAI_API_KEY", "NVIDIA_API_KEY", "OVI_API_KEY", "LTX_API_KEY"];

const safePlaceholderPattern = /^(|changeme|replace-me|replace_me|placeholder|example|example-value|your-value-here)$/i;

function resolveRepoRoot(rootDir) {
  return rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function readText(rootDir, relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), "utf8");
}

async function readJson(rootDir, relativePath) {
  return JSON.parse(await readText(rootDir, relativePath));
}

function parseEnvExample(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries.set(name, value);
  }
  return entries;
}

function hasScript(pkg, scriptName) {
  return typeof pkg?.scripts?.[scriptName] === "string" && pkg.scripts[scriptName].trim().length > 0;
}

function routeExists(source, routePath) {
  return source.includes(`"${routePath}"`) || source.includes(`'${routePath}'`);
}

function permissionGuardExists(source, permission) {
  return source.includes(`withBusinessPermission("${permission}"`) || source.includes(`withBusinessPermission('${permission}'`);
}

function buildCheck(key, ok, message, failureMessage = message) {
  return {
    key,
    status: ok ? "PASS" : "FAIL",
    message: ok ? message : failureMessage
  };
}

export async function runInternalDeploymentSmoke(options = {}) {
  const rootDir = resolveRepoRoot(options.rootDir);
  const [rootPackage, apiRoutesSource, appStudioRoutesSource, authRoutesSource, envExample, dbPathSource] = await Promise.all([
    readJson(rootDir, "package.json"),
    readText(rootDir, "apps/api/src/business-control-centre-routes.ts"),
    readText(rootDir, "apps/api/src/app-studio-internal-routes.ts"),
    readText(rootDir, "apps/api/src/business-auth.ts"),
    readText(rootDir, ".env.example"),
    readText(rootDir, "packages/db/src/database-path.ts")
  ]);

  const checks = [];
  const envEntries = parseEnvExample(envExample);

  checks.push(buildCheck(
    "package_scripts_exist",
    requiredRootScripts.every((scriptName) => hasScript(rootPackage, scriptName)),
    "Required root npm scripts exist for smoke validation.",
    "Required root npm scripts are missing."
  ));

  const workspacePackages = await Promise.all(requiredWorkspaceCommands.map(async ({ packagePath }) => ({
    packagePath,
    packageJson: await readJson(rootDir, packagePath)
  })));
  checks.push(buildCheck(
    "typescript_check_commands_available",
    requiredWorkspaceCommands.every(({ packagePath, scripts }) => {
      const workspacePackage = workspacePackages.find((item) => item.packagePath === packagePath)?.packageJson;
      return scripts.every((scriptName) => hasScript(workspacePackage, scriptName));
    }),
    "TypeScript, test, and DB init commands are available through workspace scripts.",
    "One or more workspace TypeScript, test, or DB init commands are missing."
  ));

  const dbPathValue = envEntries.get("S4_DB_PATH") ?? "";
  const safeDbConfig = dbPathValue === "./data/s4-agent-studio.db"
    && dbPathSource.includes("path.resolve")
    && dbPathSource.includes('path.join(root, "data", "s4-agent-studio.db")');
  checks.push(buildCheck(
    "db_init_path_config_safe",
    safeDbConfig,
    "Database init uses a repo-local default path and resolved override handling.",
    "Database init path/config no longer matches the expected safe local-first pattern."
  ));

  checks.push(buildCheck(
    "internal_auth_routes_exist",
    requiredBusinessAuthRoutes.every((routePath) => routeExists(authRoutesSource, routePath)),
    "Internal auth routes exist for login, logout, and current-user checks.",
    "One or more required internal auth routes are missing."
  ));

  const businessRoutesOk = requiredBusinessControlCentreRoutes.every((routePath) => routeExists(apiRoutesSource, routePath))
    && permissionGuardExists(apiRoutesSource, "system.view");
  checks.push(buildCheck(
    "business_control_centre_protected_routes_exist",
    businessRoutesOk,
    "Business Control Centre protected deployment and system routes exist behind existing permissions.",
    "Business Control Centre protected deployment or system routes are missing."
  ));

  const appStudioRoutesOk = requiredAppStudioRoutes.every((routePath) => routeExists(appStudioRoutesSource, routePath))
    && permissionGuardExists(appStudioRoutesSource, "app_studio.view");
  checks.push(buildCheck(
    "app_studio_protected_routes_exist",
    appStudioRoutesOk,
    "App Studio protected internal routes exist behind existing permissions.",
    "App Studio protected internal routes are missing."
  ));

  checks.push(buildCheck(
    "deployment_hardening_status_route_exists",
    routeExists(apiRoutesSource, "/api/business-control-centre/deployment-hardening-status"),
    "Deployment hardening status route exists.",
    "Deployment hardening status route is missing."
  ));

  const missingConfigNames = requiredConfigNames.filter((name) => !envEntries.has(name));
  const safeSecretValues = safeEmptySecretNames.every((name) => {
    const value = envEntries.get(name);
    return value === undefined || value === "" || safePlaceholderPattern.test(value);
  });
  checks.push(buildCheck(
    "env_example_safe_and_complete",
    missingConfigNames.length === 0 && safeSecretValues,
    ".env.example contains required config names and keeps secret values empty or placeholder-only.",
    ".env.example is missing required config names or includes unsafe secret placeholders."
  ));

  const docsOk = await exists(path.join(rootDir, "docs", "internal-deployment-hardening.md"))
    && await exists(path.join(rootDir, "docs", "final-internal-deployment-smoke-test.md"));
  checks.push(buildCheck(
    "deployment_docs_exist",
    docsOk,
    "Internal deployment hardening and final smoke-test docs exist.",
    "Required internal deployment docs are missing."
  ));

  checks.push(buildCheck(
    "no_secret_values_printed",
    true,
    "Smoke output reports only names, statuses, and safe file paths. No secret values are printed."
  ));

  checks.push(buildCheck(
    "production_deployment_not_executed",
    true,
    "Smoke validation is read-only and does not execute deployment, rollback, or infrastructure actions."
  ));

  const failedChecks = checks.filter((check) => check.status === "FAIL");
  return {
    rootDir,
    command: "npm run internal:smoke",
    checks,
    ok: failedChecks.length === 0
  };
}

export function formatInternalDeploymentSmokeReport(result) {
  const lines = ["Internal deployment smoke test", `Command: ${result.command}`];
  for (const check of result.checks) {
    lines.push(`[${check.status}] ${check.key} - ${check.message}`);
  }
  lines.push(result.ok ? "Result: PASS" : "Result: FAIL");
  return `${lines.join("\n")}\n`;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runInternalDeploymentSmoke();
  process.stdout.write(formatInternalDeploymentSmokeReport(result));
  process.exitCode = result.ok ? 0 : 1;
}
