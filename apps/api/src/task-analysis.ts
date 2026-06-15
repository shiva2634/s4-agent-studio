import type { RiskLevel } from "@s4/shared";
import { collectProjectFiles, type ProjectInspection } from "./project-inspection.js";
import { loadProviderConfig } from "./ai-provider.js";

export type TaskCategory =
  | "frontend feature"
  | "backend feature"
  | "database feature"
  | "authentication/authorization"
  | "external API integration"
  | "broker integration"
  | "payment integration"
  | "reporting/analytics"
  | "research"
  | "testing/debugging"
  | "deployment/devops"
  | "agent creation"
  | "unknown";

export type TaskAnalysis = {
  mode: "PLANNING_ONLY" | "CODE_PROPOSAL";
  codeGenerated: boolean;
  featureCategory: TaskCategory;
  projectFindings: string[];
  implementationPlan: string[];
  likelyAffectedModules: string[];
  acceptanceCriteria: string[];
  securityRequirements: string[];
  testingRequirements: string[];
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  requiredPermissions: string[];
  involved: {
    database: boolean;
    authentication: boolean;
    secrets: boolean;
    network: boolean;
    deployment: boolean;
  };
};

function includesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

export function hasConfiguredAiProvider(env: NodeJS.ProcessEnv = process.env) {
  return loadProviderConfig(env).configured;
}

export function classifyTaskCategory(message: string): TaskCategory {
  const lower = message.toLowerCase();
  if (includesAny(lower, [/broker/, /zerodha/, /dhan/, /kite/])) return "broker integration";
  if (includesAny(lower, [/payment/, /checkout/, /invoice/, /stripe/, /razorpay/])) return "payment integration";
  if (includesAny(lower, [/auth/, /login/, /permission/, /role/, /admin/, /authorization/])) return "authentication/authorization";
  if (includesAny(lower, [/database/, /schema/, /migration/, /persist/, /table/, /drizzle/, /prisma/])) return "database feature";
  if (includesAny(lower, [/api/, /endpoint/, /route/, /webhook/, /server/])) return "backend feature";
  if (includesAny(lower, [/external api/, /integration/, /connect to/, /sync/])) return "external API integration";
  if (includesAny(lower, [/report/, /analytics/, /dashboard/, /metrics/, /chart/])) return "reporting/analytics";
  if (includesAny(lower, [/test/, /debug/, /bug/, /fix/])) return "testing/debugging";
  if (includesAny(lower, [/deploy/, /docker/, /ci/, /devops/, /production/])) return "deployment/devops";
  if (includesAny(lower, [/agent/, /specialist agent/])) return "agent creation";
  if (includesAny(lower, [/research/, /investigate/, /compare/])) return "research";
  if (includesAny(lower, [/page/, /ui/, /component/, /form/, /frontend/, /customer support/, /support/])) return "frontend feature";
  return "unknown";
}

function inferInvolvement(message: string, category: TaskCategory) {
  const lower = message.toLowerCase();
  return {
    database: category === "database feature" || category === "broker integration" || /database|schema|persist|table|migration|drizzle|prisma/.test(lower),
    authentication: category === "authentication/authorization" || category === "broker integration" || /auth|admin|permission|role|login|unauthorized/.test(lower),
    secrets: category === "broker integration" || category === "payment integration" || /secret|credential|token|api key|vault|broker/.test(lower),
    network: category === "external API integration" || category === "broker integration" || category === "payment integration" || /api|webhook|connect|broker|zerodha|dhan/.test(lower),
    deployment: category === "deployment/devops" || /deploy|production|docker|ci/.test(lower)
  };
}

function assignRisk(category: TaskCategory, involved: TaskAnalysis["involved"], message: string): RiskLevel {
  if (/production|deploy|credential|secret|payment|trading|trade|broker|zerodha|dhan/i.test(message)) return "critical";
  if (involved.database || involved.authentication || category === "payment integration") return "high";
  if (category === "frontend feature" || category === "backend feature" || category === "reporting/analytics" || category === "testing/debugging") return "medium";
  if (category === "research") return "low";
  return "medium";
}

function findFirst(files: string[], candidates: string[]) {
  return candidates.find((candidate) => files.some((file) => file === candidate || file.startsWith(`${candidate}/`)));
}

function projectFindings(inspection: ProjectInspection, files: string[]) {
  const findings = [
    `Frameworks: ${inspection.frameworks.join(", ") || "not detected"}`,
    `Languages: ${inspection.languages.join(", ") || "not detected"}`,
    `Package manager: ${inspection.packageManager.join(", ") || "not detected"}`,
    `Database drivers: ${inspection.databaseDrivers.join(", ") || "not detected"}`,
    `ORM: ${inspection.orm.join(", ") || "not detected"}`
  ];
  const appRoot = findFirst(files, ["src/app", "app", "src/pages", "pages"]);
  const apiRoot = findFirst(files, ["src/app/api", "app/api", "src/pages/api", "pages/api", "src/server", "server"]);
  const componentRoot = findFirst(files, ["src/components", "components"]);
  const libRoot = findFirst(files, ["src/lib", "lib"]);
  const dbRoot = findFirst(files, ["src/db", "db", "database", "drizzle", "prisma"]);
  const testRoot = findFirst(files, ["tests", "test", "__tests__", "src/__tests__"]);
  if (appRoot) findings.push(`App structure: ${appRoot}`);
  if (apiRoot) findings.push(`API structure: ${apiRoot}`);
  if (componentRoot) findings.push(`Components: ${componentRoot}`);
  if (libRoot) findings.push(`Shared library code: ${libRoot}`);
  if (dbRoot) findings.push(`Database/schema area: ${dbRoot}`);
  if (testRoot) findings.push(`Tests: ${testRoot}`);
  return findings;
}

function baseModules(category: TaskCategory, files: string[]) {
  const modules: string[] = [];
  const addIf = (label: string, candidates: string[]) => {
    const found = findFirst(files, candidates);
    modules.push(found ? `${label}: ${found}` : `${label}: not detected; choose a project-consistent location before code generation`);
  };
  if (category === "frontend feature" || category === "reporting/analytics") addIf("UI routes/components", ["src/app", "app", "src/pages", "pages", "src/components", "components"]);
  if (["backend feature", "external API integration", "broker integration", "payment integration"].includes(category)) addIf("API routes/server handlers", ["src/app/api", "app/api", "src/pages/api", "pages/api", "src/server", "server"]);
  if (["database feature", "broker integration", "payment integration", "reporting/analytics"].includes(category)) addIf("Database schema/persistence", ["src/db", "db", "database", "drizzle", "prisma"]);
  if (["authentication/authorization", "broker integration", "payment integration"].includes(category)) addIf("Auth and authorization helpers", ["src/lib/auth", "lib/auth", "src/auth", "auth"]);
  addIf("Tests", ["tests", "test", "__tests__", "src/__tests__"]);
  return modules;
}

function genericPlan(category: TaskCategory) {
  const plans: Record<TaskCategory, string[]> = {
    "frontend feature": ["Inspect route and component conventions.", "Design the user-facing state flow and validation.", "Plan UI, API contracts, and tests before proposing code."],
    "backend feature": ["Inspect API route conventions and request validation patterns.", "Define request/response contracts and persistence boundaries.", "Plan authorization, error handling, and tests."],
    "database feature": ["Inspect schema and migration conventions.", "Plan schema changes with rollback and data-safety checks.", "Plan persistence tests and migration validation."],
    "authentication/authorization": ["Inspect auth providers, session helpers, and role checks.", "Plan authorization boundaries and denied-access states.", "Plan tests for unauthorized and authorized access."],
    "external API integration": ["Inspect integration and server-side network patterns.", "Plan adapter boundaries, configuration, and failure handling.", "Plan mocked integration tests without storing secrets."],
    "broker integration": ["Inspect settings UI and existing broker/integration areas.", "Plan broker connection API, schema changes, and adapter boundaries.", "Plan auth checks, secret vault references, duplicate prevention, and tests."],
    "payment integration": ["Inspect checkout and server integration patterns.", "Plan provider adapter, webhook handling, and persistence.", "Plan secrets handling, idempotency, and payment-state tests."],
    "reporting/analytics": ["Inspect data sources and dashboard conventions.", "Plan aggregation/query boundaries and UI states.", "Plan tests for filters, empty states, and data access."],
    research: ["Define the research question and trusted sources.", "Plan source collection and citation requirements.", "Plan a factual report with uncertainty noted."],
    "testing/debugging": ["Reproduce or localize the failing behavior from existing tests/files.", "Plan the smallest code path to inspect.", "Plan regression tests before proposing code."],
    "deployment/devops": ["Inspect build, deployment, and environment configuration.", "Plan non-secret configuration changes and rollback.", "Plan validation without pushing or deploying."],
    "agent creation": ["Inspect existing agent definitions and workflow conventions.", "Plan agent purpose, constraints, and permissions.", "Plan tests or dry-run validation for the agent behavior."],
    unknown: ["Inspect project architecture and clarify the target outcome.", "Identify likely modules once the desired feature category is clear.", "Plan acceptance criteria before code generation."]
  };
  return plans[category];
}

function acceptanceCriteria(category: TaskCategory) {
  if (category === "broker integration") {
    return [
      "Settings UI lets an authenticated user start Zerodha or Dhan broker connection setup.",
      "Broker connection API validates provider, account label, and required callback/configuration fields.",
      "Database schema persists broker connection metadata without storing raw credentials in source code.",
      "Secret vault references are stored instead of plaintext API keys or access tokens.",
      "Zerodha and Dhan adapters isolate provider-specific connection behavior.",
      "Authorization checks prevent unauthorized users from reading or creating connections.",
      "Duplicate active connections for the same user/provider/account are rejected.",
      "Tests cover invalid input and unauthorized access."
    ];
  }
  if (category === "frontend feature") {
    return ["The UI follows existing route/component conventions.", "Required input is validated before submission.", "Loading, success, and error states are defined.", "No secrets are stored in source code.", "Relevant UI or route tests are planned."];
  }
  return ["Implementation follows existing project conventions.", "Inputs and failure cases are validated.", "Authorization is enforced where user data or privileged actions are involved.", "No secrets are stored in source code.", "Relevant tests are identified before code generation."];
}

function securityRequirements(category: TaskCategory, involved: TaskAnalysis["involved"]) {
  const requirements = ["Do not read or write .env files.", "Do not store secrets in source code.", "Do not install packages, push Git changes, or deploy automatically."];
  if (involved.authentication) requirements.push("Enforce authenticated access and explicit authorization checks.");
  if (involved.secrets) requirements.push("Use secret vault references or environment-managed secrets, never plaintext credentials.");
  if (category === "broker integration") requirements.push("Treat broker tokens as sensitive financial credentials and avoid logging them.");
  return requirements;
}

function testingRequirements(category: TaskCategory) {
  if (category === "broker integration") return ["Invalid provider/input validation tests", "Unauthorized access tests", "Duplicate connection prevention tests", "Adapter contract tests for Zerodha and Dhan using mocks"];
  if (category === "frontend feature") return ["Form validation tests", "Route render tests", "Submission success/error state tests"];
  if (category === "backend feature") return ["Request validation tests", "Authorization tests", "Success and failure response tests"];
  return ["Unit tests for validation and edge cases", "Integration tests for affected boundaries", "Regression tests for the requested behavior"];
}

export async function analyzeTask(rootPath: string, message: string, inspection: ProjectInspection, aiConfigured = hasConfiguredAiProvider()): Promise<TaskAnalysis> {
  const { files } = await collectProjectFiles(rootPath);
  const featureCategory = classifyTaskCategory(message);
  const involved = inferInvolvement(message, featureCategory);
  const riskLevel = assignRisk(featureCategory, involved, message);
  return {
    mode: aiConfigured ? "CODE_PROPOSAL" : "PLANNING_ONLY",
    codeGenerated: false,
    featureCategory,
    projectFindings: projectFindings(inspection, files),
    implementationPlan: genericPlan(featureCategory),
    likelyAffectedModules: baseModules(featureCategory, files),
    acceptanceCriteria: acceptanceCriteria(featureCategory),
    securityRequirements: securityRequirements(featureCategory, involved),
    testingRequirements: testingRequirements(featureCategory),
    riskLevel,
    approvalRequired: riskLevel !== "low",
    requiredPermissions: aiConfigured ? ["User approval before applying generated proposals"] : ["Configure an AI provider before source-code proposal generation", "User approval before any future file changes"],
    involved
  };
}

function section(title: string, items: string[]) {
  return [title, ...items.map((item) => `- ${item}`)].join("\n");
}

export function formatPlanningOnlyResponse(projectName: string, analysis: TaskAnalysis) {
  return [
    `Planning-only analysis prepared for ${projectName}.`,
    "",
    `Feature category: ${analysis.featureCategory}`,
    `Risk level: ${analysis.riskLevel}`,
    `Approval required: ${analysis.approvalRequired ? "Yes" : "No"}.`,
    "Capability: PLANNING_ONLY",
    "Code generated: No.",
    "No files were modified.",
    "",
    section("Project findings:", analysis.projectFindings),
    "",
    section("Implementation plan:", analysis.implementationPlan),
    "",
    section("Likely affected modules:", analysis.likelyAffectedModules),
    "",
    section("Acceptance criteria:", analysis.acceptanceCriteria),
    "",
    section("Security requirements:", analysis.securityRequirements),
    "",
    section("Testing requirements:", analysis.testingRequirements),
    "",
    section("Required permissions:", analysis.requiredPermissions)
  ].join("\n");
}
