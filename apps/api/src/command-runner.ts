import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateProposalPath } from "./change-proposals.js";
import { assertCommandAllowed, sanitizeForPolicy, type PolicyAuditWriter } from "./security-policy.js";
import type Database from "better-sqlite3";

const execFileAsync = promisify(execFile);

export type CheckAction = "TYPECHECK" | "LINT" | "TEST" | "BUILD";

const actionScripts: Record<CheckAction, string> = {
  TYPECHECK: "typecheck",
  LINT: "lint",
  TEST: "test",
  BUILD: "build"
};

export type CommandResult = {
  action: CheckAction;
  script: string;
  skipped: boolean;
  ok: boolean;
  exitCode: number | null;
  output: string;
};

type CheckOptions = {
  timeoutMs?: number;
  outputLimit?: number;
  db?: Database.Database;
  projectId?: string;
  taskId?: string;
  now?: string;
  audit?: PolicyAuditWriter;
};

function sanitizeOutput(output: string, limit: number) {
  return output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, "api_key=[redacted]")
    .slice(0, limit);
}

async function readPackageScripts(rootPath: string) {
  const packagePath = path.join(rootPath, "package.json");
  validateProposalPath(rootPath, "package.json");
  const parsed = JSON.parse(await fs.readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

export async function runProjectCheck(rootPath: string, action: CheckAction, options: CheckOptions = {}): Promise<CommandResult> {
  const scripts: Record<string, string> = await readPackageScripts(rootPath).catch(() => ({}));
  const script = actionScripts[action];
  if (!script) throw new Error("Unsupported check action");
  if (!scripts[script]) return { action, script, skipped: true, ok: true, exitCode: null, output: `No ${script} script defined.` };
  const db = options.db;
  const projectId = options.projectId;
  if (db && projectId) {
    assertCommandAllowed(db, { projectId, taskId: options.taskId, action, script, command: scripts[script] ?? "", now: options.now ?? new Date().toISOString(), audit: options.audit });
  }

  const npmCommand = process.platform === "win32" ? "cmd.exe" : "npm";
  const npmArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd", "run", script] : ["run", script];
  try {
    const result = await execFileAsync(npmCommand, npmArgs, {
      cwd: rootPath,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: Math.max(options.outputLimit ?? 20_000, 20_000),
      windowsHide: true
    });
    return {
      action,
      script,
      skipped: false,
      ok: true,
      exitCode: 0,
      output: sanitizeForPolicy(db ?? null, sanitizeOutput(`${result.stdout}${result.stderr}`, options.outputLimit ?? 20_000), { projectId, taskId: options.taskId, source: `check:${script}`, now: options.now, audit: options.audit })
    };
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string; code?: number | string; signal?: string };
    const code = typeof maybe.code === "number" ? maybe.code : 1;
    return {
      action,
      script,
      skipped: false,
      ok: false,
      exitCode: code,
      output: sanitizeForPolicy(db ?? null, sanitizeOutput(`${maybe.stdout ?? ""}${maybe.stderr ?? ""}${maybe.signal ? `\nSignal: ${maybe.signal}` : ""}`, options.outputLimit ?? 20_000), { projectId, taskId: options.taskId, source: `check:${script}`, now: options.now, audit: options.audit })
    };
  }
}

export async function runAvailableChecks(rootPath: string, actions: CheckAction[] = ["TYPECHECK", "LINT", "TEST", "BUILD"], options: CheckOptions = {}) {
  const results: CommandResult[] = [];
  for (const action of actions) {
    results.push(await runProjectCheck(rootPath, action, options));
  }
  return results;
}
