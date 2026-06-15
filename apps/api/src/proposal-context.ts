import type { CodeProposalInput } from "./ai-provider.js";
import type { ProjectInspection } from "./project-inspection.js";
import { collectProjectFiles } from "./project-inspection.js";
import { readProjectFile } from "./project-files.js";
import { validateProposalPath } from "./change-proposals.js";
import type { TaskAnalysis } from "./task-analysis.js";

const excluded = [
  /^\.env(?:\.|$)/i,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)(dist|build|coverage|\.next)(\/|$)/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /bun\.lockb?$/,
  /secret|credential|token|password/i
];

const textFile = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|sql|prisma|toml|yml|yaml)$/i;

function scoreFile(file: string, analysis: TaskAnalysis) {
  let score = 0;
  if (textFile.test(file)) score += 1;
  if (/package\.json$/.test(file)) score += 3;
  if (/app\/|pages\/|components\//.test(file) && analysis.featureCategory.includes("frontend")) score += 4;
  if (/api\/|server\/|route\.ts$/.test(file) && ["backend feature", "broker integration", "external API integration", "payment integration"].includes(analysis.featureCategory)) score += 4;
  if (/db\/|database\/|drizzle|prisma|schema/.test(file) && analysis.involved.database) score += 5;
  if (/auth|session|permission|role|admin/.test(file) && analysis.involved.authentication) score += 5;
  if (/test|spec/.test(file)) score += 2;
  return score;
}

export async function buildCodeProposalInput(
  rootPath: string,
  projectName: string,
  userObjective: string,
  inspection: ProjectInspection,
  analysis: TaskAnalysis,
  limits: { maximumFiles: number; maximumOutputBytes: number; maximumContextBytes?: number }
): Promise<CodeProposalInput> {
  const { files } = await collectProjectFiles(rootPath);
  const candidates = files
    .filter((file) => textFile.test(file))
    .filter((file) => !excluded.some((pattern) => pattern.test(file)))
    .filter((file) => {
      try {
        validateProposalPath(rootPath, file);
        return true;
      } catch {
        return false;
      }
    })
    .map((file) => ({ file, score: scoreFile(file, analysis) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((entry) => entry.file);

  const fileContents: Record<string, string> = {};
  let usedBytes = 0;
  const maxContextBytes = limits.maximumContextBytes ?? 36_000;
  for (const file of candidates) {
    const content = await readProjectFile(rootPath, file).catch(() => "");
    const bytes = new TextEncoder().encode(content).byteLength;
    if (!content || usedBytes + bytes > maxContextBytes) continue;
    fileContents[file] = content;
    usedBytes += bytes;
  }

  return {
    projectName,
    projectSummary: analysis.projectFindings.join("\n"),
    userObjective,
    taskCategory: analysis.featureCategory,
    riskLevel: analysis.riskLevel,
    relevantFiles: Object.keys(fileContents),
    fileContents,
    existingConventions: [
      `Frameworks: ${inspection.frameworks.join(", ") || "not detected"}`,
      `Languages: ${inspection.languages.join(", ") || "not detected"}`,
      `Important folders: ${inspection.importantFolders.join(", ") || "not detected"}`,
      `Configuration files: ${inspection.configurationFiles.join(", ") || "not detected"}`
    ],
    acceptanceCriteria: analysis.acceptanceCriteria,
    securityRequirements: analysis.securityRequirements,
    testingRequirements: analysis.testingRequirements,
    forbiddenPaths: [".env*", ".git/**", "node_modules/**", "dist/**", "build/**", "coverage/**", ".next/**", "*secret*", "*credential*", "*token*"],
    maximumFiles: limits.maximumFiles,
    maximumOutputBytes: limits.maximumOutputBytes
  };
}
