import type { RiskLevel } from "@s4/shared";

export function createPlan(message: string, riskLevel: RiskLevel) {
  const lower = message.toLowerCase();
  const steps = [
    "Inspect the selected project and identify its stack",
    "Translate the request into acceptance criteria",
    "Prepare the smallest safe implementation plan"
  ];
  if (/website|page|frontend|ui/.test(lower)) steps.push("Implement the user interface and responsive states");
  if (/api|backend|database|auth/.test(lower)) steps.push("Implement backend and data-layer changes");
  if (/agent/.test(lower)) steps.push("Create and validate the specialist agent definition");
  steps.push("Run available type checks, tests, and build commands", "Present file changes and results for review");
  return {
    summary: `Plan for: ${message.slice(0, 120)}`,
    steps,
    requiredApproval: riskLevel !== "low",
    rollback: "Create a Git checkpoint before applying approved changes.",
    acceptanceCriteria: ["Requested capability is implemented", "Existing project remains buildable", "All sensitive actions are recorded"]
  };
}
