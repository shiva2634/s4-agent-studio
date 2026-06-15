import fs from "node:fs/promises";
import path from "node:path";
import { readProjectFile, resolveRealPathInsideProject } from "./project-files.js";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Inspection = {
  projectName: string;
  frameworks: string[];
  languages: string[];
  packageManager: string[];
  databaseDrivers: string[];
  orm: string[];
  testingFrameworks: string[];
  importantFolders: string[];
  configurationFiles: string[];
  packageJsonScripts: Record<string, string>;
};

export type ProjectInspection = Inspection;

const ignored = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"]);
const configFiles = [
  "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
  "svelte.config.js", "astro.config.mjs", "tailwind.config.js", "postcss.config.js", "eslint.config.js",
  ".eslintrc", ".eslintrc.json", "prettier.config.js", ".prettierrc", "pyproject.toml", "requirements.txt",
  "poetry.lock", "Pipfile", "Cargo.toml", "go.mod", "Dockerfile", "docker-compose.yml", ".env.example",
  "prisma/schema.prisma", "drizzle.config.ts", "drizzle.config.js", "knexfile.js", "sequelize.config.js",
  "jest.config.js", "vitest.config.ts", "playwright.config.ts"
];

const importantFolderNames = new Set([
  "src", "app", "pages", "components", "lib", "server", "api", "routes", "controllers", "models",
  "prisma", "drizzle", "migrations", "db", "database", "tests", "test", "__tests__", "spec",
  "public", "static", "assets", "styles", "config", "scripts"
]);

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function detectFromDependencies(pkg: PackageJson) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const names = new Set(Object.keys(deps));
  const has = (name: string) => names.has(name);
  const framework: string[] = [];
  const database: string[] = [];
  const orm: string[] = [];
  const tests: string[] = [];

  if (has("next")) framework.push("Next.js");
  if (has("react")) framework.push("React");
  if (has("vite")) framework.push("Vite");
  if (has("vue")) framework.push("Vue");
  if (has("svelte")) framework.push("Svelte");
  if (has("astro")) framework.push("Astro");
  if (has("express")) framework.push("Express");
  if (has("fastify")) framework.push("Fastify");
  if (has("@nestjs/core")) framework.push("NestJS");

  if (has("pg") || has("postgres") || has("postgres.js")) database.push("PostgreSQL");
  if (has("mysql2") || has("mysql")) database.push("MySQL");
  if (has("sqlite3") || has("better-sqlite3")) database.push("SQLite");
  if (has("mongodb") || has("mongoose")) database.push("MongoDB");
  if (has("@supabase/supabase-js")) database.push("Supabase");
  if (has("@planetscale/database")) database.push("PlanetScale");

  if (has("prisma") || has("@prisma/client")) orm.push("Prisma");
  if (has("drizzle-orm")) orm.push("Drizzle ORM");
  if (has("typeorm")) orm.push("TypeORM");
  if (has("sequelize")) orm.push("Sequelize");
  if (has("mongoose")) orm.push("Mongoose");
  if (has("knex")) orm.push("Knex");

  if (has("vitest")) tests.push("Vitest");
  if (has("jest")) tests.push("Jest");
  if (has("@playwright/test")) tests.push("Playwright");
  if (has("cypress")) tests.push("Cypress");
  if (has("mocha")) tests.push("Mocha");

  return { framework, database, orm, tests };
}

function detectLanguages(files: string[]) {
  const language: string[] = [];
  if (files.some((file) => /\.(ts|tsx|mts|cts)$/.test(file))) language.push("TypeScript");
  if (files.some((file) => /\.(js|jsx|mjs|cjs)$/.test(file))) language.push("JavaScript");
  if (files.some((file) => /\.py$/.test(file))) language.push("Python");
  if (files.some((file) => /\.go$/.test(file))) language.push("Go");
  if (files.some((file) => /\.rs$/.test(file))) language.push("Rust");
  if (files.some((file) => /\.java$/.test(file))) language.push("Java");
  if (files.some((file) => /\.cs$/.test(file))) language.push("C#");
  return language;
}

export async function collectProjectFiles(rootPath: string, maxFiles = 800) {
  const root = await resolveRealPathInsideProject(rootPath);
  const files: string[] = [];
  const folders: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > 4 || files.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      let realAbsolute: string;
      try {
        realAbsolute = await resolveRealPathInsideProject(root, path.relative(root, absolute));
      } catch {
        continue;
      }
      const relative = path.relative(root, realAbsolute).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        if (importantFolderNames.has(entry.name)) folders.push(relative);
        await walk(realAbsolute, depth + 1);
      } else {
        files.push(relative);
      }
      if (files.length >= maxFiles) return;
    }
  }

  await walk(root, 0);
  return { files, folders };
}

async function readPackageJson(rootPath: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readProjectFile(rootPath, "package.json")) as PackageJson;
  } catch {
    return null;
  }
}

function detectPackageManager(files: string[]) {
  const managers: string[] = [];
  if (files.includes("package-lock.json")) managers.push("npm");
  if (files.includes("pnpm-lock.yaml")) managers.push("pnpm");
  if (files.includes("yarn.lock")) managers.push("Yarn");
  if (files.includes("bun.lockb") || files.includes("bun.lock")) managers.push("Bun");
  if (!managers.length && files.includes("package.json")) managers.push("npm-compatible");
  if (files.includes("poetry.lock")) managers.push("Poetry");
  if (files.includes("requirements.txt")) managers.push("pip");
  if (files.includes("Cargo.lock")) managers.push("Cargo");
  if (files.includes("go.mod")) managers.push("Go modules");
  return managers;
}

function formatList(values: string[]) {
  return values.length ? values.join(", ") : "Not detected";
}

function formatBulletSection(title: string, values: string[]) {
  return [title, ...(values.length ? values.map((value) => `- ${value}`) : ["- Not detected"])].join("\n");
}

export async function inspectProject(rootPath: string) {
  await resolveRealPathInsideProject(rootPath);
  const [{ files, folders }, pkg] = await Promise.all([collectProjectFiles(rootPath), readPackageJson(rootPath)]);
  const dependencySignals = pkg ? detectFromDependencies(pkg) : { framework: [], database: [], orm: [], tests: [] };
  const inspection: Inspection = {
    projectName: pkg?.name ?? path.basename(path.resolve(rootPath)),
    frameworks: unique(dependencySignals.framework),
    languages: unique(detectLanguages(files)),
    packageManager: unique(detectPackageManager(files)),
    databaseDrivers: unique(dependencySignals.database),
    orm: unique(dependencySignals.orm),
    testingFrameworks: unique([
      ...dependencySignals.tests,
      ...(files.some((file) => /(^|\/)(__tests__|tests?|spec)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) ? ["Test files present"] : [])
    ]),
    importantFolders: unique(folders),
    configurationFiles: unique(configFiles.filter((file) => files.includes(file))),
    packageJsonScripts: pkg?.scripts ?? {}
  };

  const npmScripts = Object.keys(inspection.packageJsonScripts).sort((a, b) => a.localeCompare(b));
  const report = [
    "Project inspection completed.",
    "",
    `Project name: ${inspection.projectName}`,
    "",
    formatBulletSection("Framework:", inspection.frameworks),
    "",
    formatBulletSection("Languages:", inspection.languages),
    "",
    formatBulletSection("Package manager:", inspection.packageManager),
    "",
    formatBulletSection("Database:", inspection.databaseDrivers),
    "",
    formatBulletSection("ORM:", inspection.orm),
    "",
    formatBulletSection("Testing:", inspection.testingFrameworks),
    "",
    formatBulletSection("Important folders:", inspection.importantFolders),
    "",
    formatBulletSection("Important configuration files:", inspection.configurationFiles),
    "",
    formatBulletSection("Available scripts:", npmScripts),
    "",
    `Summary: frameworks=${formatList(inspection.frameworks)}; languages=${formatList(inspection.languages)}.`,
    "",
    "No project files were modified.",
    "Approval required: No."
  ].join("\n");

  return { inspection, report };
}
