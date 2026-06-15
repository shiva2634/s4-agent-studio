import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { analyzeTask, formatPlanningOnlyResponse } from "./task-analysis.js";
import { inspectProject } from "./project-inspection.js";

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-task-analysis-"));
  await fs.mkdir(path.join(root, "app", "api", "health"), { recursive: true });
  await fs.mkdir(path.join(root, "app", "settings"), { recursive: true });
  await fs.mkdir(path.join(root, "components"), { recursive: true });
  await fs.mkdir(path.join(root, "lib", "auth"), { recursive: true });
  await fs.mkdir(path.join(root, "db"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "analysis-fixture",
    dependencies: { next: "latest", react: "latest", "drizzle-orm": "latest", pg: "latest" },
    devDependencies: { typescript: "latest", vitest: "latest" }
  }));
  await fs.writeFile(path.join(root, "app", "page.tsx"), "export default function Page(){return null;}");
  await fs.writeFile(path.join(root, "app", "settings", "page.tsx"), "export default function Settings(){return null;}");
  await fs.writeFile(path.join(root, "app", "api", "health", "route.ts"), "export function GET(){return Response.json({ok:true});}");
  await fs.writeFile(path.join(root, "components", "navigation.tsx"), "export function Navigation(){return null;}");
  await fs.writeFile(path.join(root, "lib", "auth", "index.ts"), "export function requireUser(){return {id:'u1'};}");
  await fs.writeFile(path.join(root, "db", "schema.ts"), "export const schema = {};");
  await fs.writeFile(path.join(root, "tests", "existing.test.ts"), "import { describe } from 'vitest';");
  return root;
}

async function snapshot(root: string) {
  const files = new Map<string, string>();
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.set(path.relative(root, absolute).replaceAll(path.sep, "/"), await fs.readFile(absolute, "utf8"));
    }
  }
  await walk(root);
  return files;
}

describe("generic planning-only task analysis", () => {
  it("gives broker tasks useful architecture-aware planning output", async () => {
    const root = await createFixture();
    const { inspection } = await inspectProject(root);
    const analysis = await analyzeTask(root, "Build broker connections for Zerodha and Dhan in settings", inspection, false);
    const response = formatPlanningOnlyResponse("Fixture", analysis);

    assert.equal(analysis.mode, "PLANNING_ONLY");
    assert.equal(analysis.featureCategory, "broker integration");
    assert.equal(analysis.riskLevel, "critical");
    assert.match(response, /settings UI/i);
    assert.match(response, /broker connection API/i);
    assert.match(response, /Database schema/i);
    assert.match(response, /Secret vault/i);
    assert.match(response, /Zerodha and Dhan adapters/i);
    assert.match(response, /Authorization checks/i);
    assert.match(response, /Duplicate active connections/i);
    assert.match(response, /Invalid provider\/input validation tests/i);
    assert.match(response, /Unauthorized access tests/i);
  });

  it("routes customer-support through the same generic planning output", async () => {
    const root = await createFixture();
    const { inspection } = await inspectProject(root);
    const analysis = await analyzeTask(root, "Create a customer support page", inspection, false);

    assert.equal(analysis.mode, "PLANNING_ONLY");
    assert.equal(analysis.featureCategory, "frontend feature");
    assert.equal(analysis.codeGenerated, false);
    assert.deepEqual((analysis as { proposals?: unknown[] }).proposals, undefined);
  });

  it("returns structured planning for unknown tasks", async () => {
    const root = await createFixture();
    const { inspection } = await inspectProject(root);
    const analysis = await analyzeTask(root, "Make it better somehow", inspection, false);
    const response = formatPlanningOnlyResponse("Fixture", analysis);

    assert.equal(analysis.featureCategory, "unknown");
    assert.ok(analysis.projectFindings.length > 0);
    assert.ok(analysis.implementationPlan.length > 0);
    assert.match(response, /Feature category: unknown/);
  });

  it("does not create placeholder files or source proposals in planning-only mode", async () => {
    const root = await createFixture();
    const { inspection } = await inspectProject(root);
    const analysis = await analyzeTask(root, "Build a reporting dashboard", inspection, false);
    const response = formatPlanningOnlyResponse("Fixture", analysis);

    assert.equal(analysis.codeGenerated, false);
    assert.doesNotMatch(response, /S4_CHANGE_PROPOSAL\.md/);
    assert.doesNotMatch(response, /Affected files:/);
  });

  it("does not modify external project files during planning", async () => {
    const root = await createFixture();
    const before = await snapshot(root);
    const { inspection } = await inspectProject(root);
    await analyzeTask(root, "Build broker connections for Zerodha and Dhan", inspection, false);
    const after = await snapshot(root);
    assert.deepEqual(after, before);
  });

  it("clearly states code was not generated", async () => {
    const root = await createFixture();
    const { inspection } = await inspectProject(root);
    const analysis = await analyzeTask(root, "Create a customer support page", inspection, false);
    const response = formatPlanningOnlyResponse("Fixture", analysis);

    assert.match(response, /Capability: PLANNING_ONLY/);
    assert.match(response, /Code generated: No\./);
    assert.match(response, /No files were modified\./);
  });
});
