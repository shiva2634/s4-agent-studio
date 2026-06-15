import type { RiskLevel } from "@s4/shared";

const criticalPatterns = [
  /\.env/i,
  /production/i,
  /delete/i,
  /drop\s+table/i,
  /push\s+to\s+github/i,
  /deploy/i,
  /credential/i,
  /secret/i,
  /trade/i,
  /payment/i
];

const mediumPatterns = [
  /\badd\b/i,
  /\bcreate\b/i,
  /\bbuild\b/i,
  /\bimplement\b/i,
  /\bfix\b/i,
  /\bupdate\b/i,
  /install/i,
  /\bmigrate\b/i,
  /migration/i,
  /docker/i,
  /modify/i,
  /create\s+file/i,
  /\bremove\b/i,
  /internet/i,
  /download/i
];

const readOnlyInspectionPatterns = [
  /\binspect\b/i,
  /\breview\b/i,
  /\bidentify\b/i,
  /\banalyse\b/i,
  /\banalyze\b/i,
  /\bexplain project structure\b/i,
  /\blist project files\b/i,
  /\bread-only\b/i,
  /\bread only\b/i,
  /\bdo not modify\b/i,
  /\bdon't modify\b/i,
  /\bno changes\b/i
];

export function isReadOnlyInspectionRequest(message: string): boolean {
  return readOnlyInspectionPatterns.some((pattern) => pattern.test(message));
}

export function isMutationRequest(message: string): boolean {
  return [...criticalPatterns, ...mediumPatterns].some((pattern) => pattern.test(message));
}

export function classifyRisk(message: string): RiskLevel {
  if (isReadOnlyInspectionRequest(message)) return "low";
  if (criticalPatterns.some((pattern) => pattern.test(message))) return "critical";
  if (mediumPatterns.some((pattern) => pattern.test(message))) return "medium";
  return "low";
}

export function requiresApproval(riskLevel: RiskLevel): boolean {
  return riskLevel !== "low";
}
