import fs from "node:fs";
import path from "node:path";

type PathEnv = {
  S4_DB_PATH?: string;
};

export function findWorkspaceRoot(startDirectory = process.cwd()): string {
  let current = path.resolve(startDirectory);
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: string; workspaces?: unknown };
        const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
        if (packageJson.name === "s4-agent-studio" || (workspaces.includes("apps/*") && workspaces.includes("packages/*"))) {
          return current;
        }
      } catch {
        // Continue walking if this package.json is unreadable or malformed.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDirectory);
    current = parent;
  }
}

export function getResolvedDatabasePath(options: { cwd?: string; env?: PathEnv } = {}): string {
  const env = options.env ?? process.env;
  if (env.S4_DB_PATH && env.S4_DB_PATH.trim()) {
    return path.resolve(options.cwd ?? process.cwd(), env.S4_DB_PATH);
  }
  const root = findWorkspaceRoot(options.cwd ?? process.cwd());
  return path.join(root, "data", "s4-agent-studio.db");
}
