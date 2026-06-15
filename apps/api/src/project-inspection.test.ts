import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { inspectProject } from "./project-inspection.js";

describe("package.json project inspection", () => {
  it("detects stack details from package.json and project folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-inspection-"));
    await fs.mkdir(path.join(root, "app"));
    await fs.mkdir(path.join(root, "components"));
    await fs.mkdir(path.join(root, "tests"));
    await fs.writeFile(path.join(root, "tsconfig.json"), "{}");
    await fs.writeFile(path.join(root, "package-lock.json"), "{}");
    await fs.writeFile(path.join(root, "app", "page.tsx"), "export default function Page() { return null; }");
    await fs.writeFile(path.join(root, "tests", "app.test.ts"), "test('ok', () => {});");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "sample-next-app",
      scripts: {
        dev: "next dev",
        build: "next build",
        test: "vitest",
        typecheck: "tsc --noEmit"
      },
      dependencies: {
        next: "latest",
        react: "latest",
        pg: "latest",
        "drizzle-orm": "latest"
      },
      devDependencies: {
        vitest: "latest",
        typescript: "latest"
      }
    }));

    const { inspection, report } = await inspectProject(root);

    assert.equal(inspection.projectName, "sample-next-app");
    assert.deepEqual(inspection.frameworks, ["Next.js", "React"]);
    assert.deepEqual(inspection.languages, ["TypeScript"]);
    assert.deepEqual(inspection.packageManager, ["npm"]);
    assert.deepEqual(inspection.databaseDrivers, ["PostgreSQL"]);
    assert.deepEqual(inspection.orm, ["Drizzle ORM"]);
    assert.deepEqual(inspection.testingFrameworks, ["Test files present", "Vitest"]);
    assert.deepEqual(Object.keys(inspection.packageJsonScripts).sort(), ["build", "dev", "test", "typecheck"]);
    assert.match(report, /Project inspection completed/);
    assert.match(report, /Approval required: No/);
  });
});
