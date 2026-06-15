import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readProjectFile, resolveInsideProject } from "./project-files.js";

describe("project path boundary checks", () => {
  it("allows paths inside the registered project root", () => {
    const root = path.resolve("C:/workspace/project");
    assert.equal(resolveInsideProject(root, "src/index.ts"), path.join(root, "src", "index.ts"));
  });

  it("rejects directory traversal outside the registered project root", () => {
    const root = path.resolve("C:/workspace/project");
    assert.throws(() => resolveInsideProject(root, "../secret.txt"), /outside the approved project workspace/);
  });

  it("rejects sibling paths with a shared prefix", () => {
    const root = path.resolve("C:/workspace/project");
    assert.throws(() => resolveInsideProject(root, "../project-other/file.ts"), /outside the approved project workspace/);
  });

  it("rejects absolute paths outside the registered project root", () => {
    const root = path.resolve("C:/workspace/project");
    assert.throws(() => resolveInsideProject(root, "C:/workspace/other/file.ts"), /outside the approved project workspace/);
  });

  it("does not read files outside the registered project root", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "s4-boundary-"));
    const root = path.join(temp, "project");
    await fs.mkdir(root);
    await fs.writeFile(path.join(temp, "outside.txt"), "secret");

    await assert.rejects(() => readProjectFile(root, "../outside.txt"), /outside the approved project workspace/);
  });
});
