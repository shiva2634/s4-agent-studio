import type Database from "better-sqlite3";
import { setBusinessUserPasswordCredential } from "./business-auth.js";

const allowedSeededInternalUserIds = new Set(["business-user-shrinika", "business-user-shiva"]);

export const INTERNAL_DEV_DEFAULT_CREDENTIALS = [
  { email: "owner@shrinika.local", password: "ShrinikaDev@2026!" },
  { email: "shiva@shrinika.local", password: "ShivaDev@2026!" }
] as const;

type SetupUserRow = {
  id: string;
  email: string;
  displayName: string;
  userType: string;
  status: string;
};

type SetupRoleRow = {
  roleKey: string;
  name: string;
};

type SetupCredentialRow = {
  id: string;
  passwordHash: string;
  passwordHashAlgorithm: string;
  isEnabled: number;
};

export type InternalCredentialSetupSummary = {
  userId: string;
  email: string;
  displayName: string;
  roleKeys: string[];
  roleNames: string[];
  credentialId: string;
  credentialStatus: "activated";
  updatedAt: string;
};

export function setSeededInternalUserPassword(database: Database.Database, input: { email: string; password: string; now?: string }): InternalCredentialSetupSummary {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("User email is required");

  const user = database.prepare(`SELECT id,email,display_name AS displayName,user_type AS userType,status
    FROM business_users
    WHERE email=? COLLATE NOCASE`).get(email) as SetupUserRow | undefined;
  if (!user) throw new Error("Business user not found");
  if (!allowedSeededInternalUserIds.has(user.id)) throw new Error("Only seeded Shrinika and Shiva internal users can be activated by this script");
  if (user.userType !== "INTERNAL") throw new Error("Business user is not internal");
  if (user.status !== "ACTIVE") throw new Error("Business user is not active");

  const updatedAt = input.now ?? new Date().toISOString();
  const credential = setBusinessUserPasswordCredential(database, user.id, input.password, updatedAt) as SetupCredentialRow;
  const roles = database.prepare(`SELECT r.role_key AS roleKey,r.name AS name
    FROM business_user_roles ur
    JOIN business_roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND ur.revoked_at IS NULL
    ORDER BY r.role_key`).all(user.id) as SetupRoleRow[];

  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    roleKeys: roles.map((role) => role.roleKey),
    roleNames: roles.map((role) => role.name),
    credentialId: credential.id,
    credentialStatus: "activated",
    updatedAt
  };
}

export function formatInternalCredentialSetupSummary(summary: InternalCredentialSetupSummary): string {
  return [
    "Internal credential updated.",
    `User: ${summary.displayName} <${summary.email}>`,
    `Roles: ${summary.roleKeys.join(", ") || "none"}`,
    `Status: ${summary.credentialStatus}`,
    `Updated at: ${summary.updatedAt}`
  ].join("\n");
}

export function setDevelopmentDefaultInternalPasswords(database: Database.Database, input: { nodeEnv?: string; now?: string } = {}): InternalCredentialSetupSummary[] {
  if ((input.nodeEnv ?? process.env.NODE_ENV) === "production") {
    throw new Error("Development default internal passwords cannot be set in production");
  }
  const now = input.now ?? new Date().toISOString();
  return INTERNAL_DEV_DEFAULT_CREDENTIALS.map((credential, index) => setSeededInternalUserPassword(database, {
    email: credential.email,
    password: credential.password,
    now: new Date(Date.parse(now) + index).toISOString()
  }));
}

export function formatDevelopmentDefaultCredentialSetupSummary(summaries: InternalCredentialSetupSummary[]): string {
  return [
    "Local development default internal credentials were activated.",
    "Use only for local development. Rotate these passwords after testing.",
    ...summaries.flatMap((summary) => [
      "",
      `User: ${summary.displayName} <${summary.email}>`,
      `Roles: ${summary.roleKeys.join(", ") || "none"}`,
      `Status: ${summary.credentialStatus}`,
      `Updated at: ${summary.updatedAt}`
    ])
  ].join("\n");
}
