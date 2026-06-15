import fs from "node:fs/promises";
import path from "node:path";

const ignored = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".turbo"]);

export function resolveInsideProject(rootPath: string, requested = ".") {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, requested);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Requested path is outside the approved project workspace");
  }
  return target;
}

export async function resolveRealPathInsideProject(rootPath: string, requested = ".") {
  const target = resolveInsideProject(rootPath, requested);
  const [realRoot, realTarget] = await Promise.all([fs.realpath(path.resolve(rootPath)), fs.realpath(target)]);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error("Requested path resolves outside the approved project workspace");
  }
  return realTarget;
}

export async function listProjectTree(rootPath: string, requested = ".", depth = 2) {
  const root = await resolveRealPathInsideProject(rootPath, requested);
  const realProjectRoot = await fs.realpath(path.resolve(rootPath));
  const output: Array<{ path: string; type: "file" | "directory" }> = [];
  async function walk(current: string, level: number) {
    if (level > depth) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      let realAbsolute: string;
      try {
        realAbsolute = await fs.realpath(absolute);
      } catch {
        continue;
      }
      if (realAbsolute !== realProjectRoot && !realAbsolute.startsWith(realProjectRoot + path.sep)) continue;
      const relative = path.relative(realProjectRoot, realAbsolute).replaceAll(path.sep, "/");
      output.push({ path: relative || ".", type: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory()) await walk(absolute, level + 1);
      if (output.length >= 500) return;
    }
  }
  await walk(root, 0);
  return output;
}

export async function readProjectFile(rootPath: string, requested: string) {
  const target = await resolveRealPathInsideProject(rootPath, requested);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size > 250_000) throw new Error("File exceeds the 250 KB inspection limit");
  return fs.readFile(target, "utf8");
}
