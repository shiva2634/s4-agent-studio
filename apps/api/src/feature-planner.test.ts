import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { validateProposalPath } from "./change-proposals.js";
import { generateFeaturePlan, getUnsupportedProposalMessage } from "./feature-planner.js";
import { inspectProject } from "./project-inspection.js";

async function createNextFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-feature-plan-"));
  await fs.mkdir(path.join(root, "app", "api"), { recursive: true });
  await fs.mkdir(path.join(root, "app", "admin"), { recursive: true });
  await fs.mkdir(path.join(root, "components"), { recursive: true });
  await fs.mkdir(path.join(root, "lib"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "probability-quant-lab-fixture",
    dependencies: { next: "latest", react: "latest" },
    devDependencies: { typescript: "latest" },
    scripts: { test: "node --test" }
  }));
  await fs.writeFile(path.join(root, "app", "layout.tsx"), "export default function Layout({children}:{children:React.ReactNode}){return children;}");
  await fs.writeFile(path.join(root, "components", "navigation.tsx"), "export function Navigation(){return null;}");
  await fs.writeFile(path.join(root, "tests", "existing.test.ts"), "import assert from 'node:assert/strict'; assert.equal(true, true);");
  return root;
}

async function snapshotFiles(root: string) {
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

describe("customer-support deterministic feature planner", () => {
  it("never generates S4_CHANGE_PROPOSAL.md", async () => {
    const root = await createNextFixture();
    const { inspection } = await inspectProject(root);
    const plan = await generateFeaturePlan(root, "Create a customer support page for Probability Quant Lab", inspection);
    assert.ok(plan);
    assert.equal(plan.proposals.some((proposal) => proposal.filePath === "S4_CHANGE_PROPOSAL.md"), false);
  });

  it("produces real source-file proposals for customer-support requests", async () => {
    const root = await createNextFixture();
    const { inspection } = await inspectProject(root);
    const plan = await generateFeaturePlan(root, "Create a customer support page for Probability Quant Lab", inspection);
    assert.ok(plan);
    const paths = plan.proposals.map((proposal) => proposal.filePath);
    assert.ok(paths.includes("app/support/page.tsx"));
    assert.ok(paths.includes("app/api/support/tickets/route.ts"));
    assert.ok(paths.includes("lib/support/validation.ts"));
    assert.ok(paths.includes("tests/support.validation.test.ts"));
    assert.ok(plan.acceptanceCriteria.some((criterion) => /required field validation/i.test(criterion)));
  });

  it("keeps generated paths inside the registered root", async () => {
    const root = await createNextFixture();
    const { inspection } = await inspectProject(root);
    const plan = await generateFeaturePlan(root, "Create a customer support page", inspection);
    assert.ok(plan);
    for (const proposal of plan.proposals) {
      const validated = validateProposalPath(root, proposal.filePath);
      assert.ok(validated.absolutePath.startsWith(path.resolve(root) + path.sep));
    }
  });

  it("generates non-empty usable TypeScript and TSX content", async () => {
    const root = await createNextFixture();
    const { inspection } = await inspectProject(root);
    const plan = await generateFeaturePlan(root, "Create a customer support page", inspection);
    assert.ok(plan);
    for (const proposal of plan.proposals) {
      assert.ok(proposal.proposedContent.trim().length > 80);
      assert.match(proposal.filePath, /\.(ts|tsx)$/);
      assert.doesNotMatch(proposal.proposedContent, /future work|placeholder|S4_CHANGE_PROPOSAL/);
    }
  });

  it("does not modify fixture files during proposal generation", async () => {
    const root = await createNextFixture();
    const before = await snapshotFiles(root);
    const { inspection } = await inspectProject(root);
    await generateFeaturePlan(root, "Create a customer support page", inspection);
    const after = await snapshotFiles(root);
    assert.deepEqual(after, before);
  });

  it("fails safely for unsupported generic mutation requests", async () => {
    const root = await createNextFixture();
    const { inspection } = await inspectProject(root);
    const plan = await generateFeaturePlan(root, "Build a portfolio gallery", inspection);
    assert.equal(plan, null);
    assert.equal(getUnsupportedProposalMessage(), "Proposal generation requires either a supported feature template or a configured AI provider.");
  });
});
