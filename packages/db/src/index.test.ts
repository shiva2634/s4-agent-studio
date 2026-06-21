import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

async function loadInitializer() {
  return await import("./index.js");
}

function createOldProjectsDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      deregistered_at TEXT,
      deregistered_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES ('project-1','Legacy','/tmp/legacy','ACTIVE','created','created');
  `);
  return db;
}

function createLegacyTaskDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      agent_id TEXT,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNING',
      risk_level TEXT NOT NULL DEFAULT 'low',
      plan_json TEXT NOT NULL,
      acceptance_criteria TEXT,
      rollback_plan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      decision_note TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE change_proposals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      original_content TEXT,
      original_content_hash TEXT,
      proposed_content TEXT,
      unified_diff TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      git_checkpoint_json TEXT,
      safety_summary_json TEXT,
      check_results_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES ('project-legacy','Legacy Project','/tmp/legacy-task','ACTIVE','created','created');
    INSERT INTO tasks (id,project_id,conversation_id,agent_id,title,objective,status,risk_level,plan_json,created_at,updated_at)
      VALUES ('task-legacy','project-legacy',NULL,'developer','Legacy Task','Preserve this row','PLANNING','low','{}','created','created');
  `);
  return db;
}

describe("database initialization", () => {
  it("migrates project lifecycle columns without disturbing existing rows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s4-db-migrate-"));
    const dbPath = path.join(root, "projects.db");
    const db = createOldProjectsDb(dbPath);
    const dummyPath = path.join(root, "dummy.db");
    process.env.S4_DB_PATH = dummyPath;
    let importedDb: Database.Database | undefined;

    try {
      const loaded = await loadInitializer();
      importedDb = loaded.db;
      const { initializeDatabaseOn } = loaded;
      initializeDatabaseOn(db);

      const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      assert.ok(columns.some((column) => column.name === "paused_at"));
      assert.ok(columns.some((column) => column.name === "archived_at"));
      assert.ok(columns.some((column) => column.name === "deregistered_at"));

      const row = db.prepare("SELECT status,paused_at AS pausedAt,archived_at AS archivedAt,deregistered_at AS deregisteredAt FROM projects WHERE id='project-1'").get() as { status: string; pausedAt: string | null; archivedAt: string | null; deregisteredAt: string | null };
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.pausedAt, null);
      assert.equal(row.archivedAt, null);
      assert.equal(row.deregisteredAt, null);
    } finally {
      importedDb?.close();
      db.close();
      await fs.rm(root, { recursive: true, force: true });
      delete process.env.S4_DB_PATH;
    }
  });

  it("defaults new projects to active and accepts all lifecycle statuses", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      db.prepare("INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)").run("project-1", "Default", "/tmp/default", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,paused_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-2", "Paused", "/tmp/paused", "PAUSED", "paused-at", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-3", "Archived", "/tmp/archived", "ARCHIVED", "archived-at", "created", "created");
      db.prepare("INSERT INTO projects (id,name,root_path,status,deregistered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("project-4", "Removed", "/tmp/removed", "DEREGISTERED", "deregistered-at", "created", "created");

      const rows = db.prepare("SELECT id,status,paused_at AS pausedAt,archived_at AS archivedAt,deregistered_at AS deregisteredAt FROM projects ORDER BY id").all() as Array<{ id: string; status: string; pausedAt: string | null; archivedAt: string | null; deregisteredAt: string | null }>;
      assert.deepEqual(rows.map((row) => row.status), ["ACTIVE", "PAUSED", "ARCHIVED", "DEREGISTERED"]);
      assert.equal(rows[0]?.status, "ACTIVE");
      assert.equal(rows[1]?.pausedAt, "paused-at");
      assert.equal(rows[2]?.archivedAt, "archived-at");
      assert.equal(rows[3]?.deregisteredAt, "deregistered-at");
    } finally {
      db.close();
    }
  });

  it("adds task continuation and history columns without disturbing legacy task rows", async () => {
    const db = createLegacyTaskDb();
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      assert.ok(taskColumns.some((column) => column.name === "id"));

      const proposalColumns = db.prepare("PRAGMA table_info(change_proposals)").all() as Array<{ name: string }>;
      assert.ok(proposalColumns.some((column) => column.name === "task_round_id"));

      const approvalColumns = db.prepare("PRAGMA table_info(approvals)").all() as Array<{ name: string }>;
      assert.ok(approvalColumns.some((column) => column.name === "task_round_id"));

      const executionColumns = db.prepare("PRAGMA table_info(task_executions)").all() as Array<{ name: string }>;
      assert.ok(executionColumns.some((column) => column.name === "task_round_id"));

      const roundColumns = db.prepare("PRAGMA table_info(task_rounds)").all() as Array<{ name: string }>;
      assert.ok(roundColumns.some((column) => column.name === "round_number"));
      assert.ok(roundColumns.some((column) => column.name === "next_required_action"));

      const scaffoldJobColumns = db.prepare("PRAGMA table_info(scaffold_jobs)").all() as Array<{ name: string }>;
      assert.ok(scaffoldJobColumns.some((column) => column.name === "target_root_path"));
      assert.ok(scaffoldJobColumns.some((column) => column.name === "approval_id"));

      const templateCount = db.prepare("SELECT COUNT(*) AS count FROM scaffold_templates").get() as { count: number };
      assert.equal(templateCount.count, 6);

      const workspaceRoot = db.prepare("SELECT status FROM workspace_root_config WHERE id='default-local-workspace'").get() as { status: string };
      assert.equal(workspaceRoot.status, "ACTIVE");

      const legacyTask = db.prepare("SELECT title,status FROM tasks WHERE id='task-legacy'").get() as { title: string; status: string };
      assert.equal(legacyTask.title, "Legacy Task");
      assert.equal(legacyTask.status, "PLANNING");
    } finally {
      db.close();
    }
  });

  it("creates Business Control Centre identity/access tables and idempotent seed data", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, userHasBusinessPermission } = await loadInitializer();
      initializeDatabaseOn(db);

      for (const tableName of ["business_users", "internal_user_profiles", "business_roles", "business_permissions", "business_role_permissions", "business_user_roles", "denied_access_events"]) {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
        assert.ok(table, `${tableName} should exist`);
      }

      const roleCount = db.prepare("SELECT COUNT(*) AS count FROM business_roles").get() as { count: number };
      assert.equal(roleCount.count, 16);

      const permissionCount = db.prepare("SELECT COUNT(*) AS count FROM business_permissions").get() as { count: number };
      assert.equal(permissionCount.count, 132);

      const ownerRole = db.prepare(`SELECT r.role_key AS roleKey
        FROM business_users u
        JOIN business_user_roles ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
        JOIN business_roles r ON r.id=ur.role_id
        WHERE u.id='business-user-shrinika'`).get() as { roleKey: string };
      assert.equal(ownerRole.roleKey, "main_admin_owner");

      const shiva = db.prepare(`SELECT r.role_key AS roleKey,p.is_system_guardian AS isSystemGuardian
        FROM business_users u
        JOIN internal_user_profiles p ON p.user_id=u.id
        JOIN business_user_roles ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
        JOIN business_roles r ON r.id=ur.role_id
        WHERE u.id='business-user-shiva'`).get() as { roleKey: string; isSystemGuardian: number };
      assert.equal(shiva.roleKey, "system_guardian");
      assert.equal(shiva.isSystemGuardian, 1);

      assert.equal(userHasBusinessPermission(db, "business-user-shrinika", "deployment.deploy"), true);
      assert.equal(userHasBusinessPermission(db, "business-user-shiva", "app_studio.view"), true);
      assert.equal(userHasBusinessPermission(db, "business-user-shiva", "audit.view"), true);
      assert.equal(userHasBusinessPermission(db, "business-user-shiva", "system.configure"), true);

      const countsBefore = {
        users: (db.prepare("SELECT COUNT(*) AS count FROM business_users").get() as { count: number }).count,
        roles: (db.prepare("SELECT COUNT(*) AS count FROM business_roles").get() as { count: number }).count,
        permissions: (db.prepare("SELECT COUNT(*) AS count FROM business_permissions").get() as { count: number }).count,
        rolePermissions: (db.prepare("SELECT COUNT(*) AS count FROM business_role_permissions").get() as { count: number }).count,
        userRoles: (db.prepare("SELECT COUNT(*) AS count FROM business_user_roles").get() as { count: number }).count
      };
      initializeDatabaseOn(db);
      const countsAfter = {
        users: (db.prepare("SELECT COUNT(*) AS count FROM business_users").get() as { count: number }).count,
        roles: (db.prepare("SELECT COUNT(*) AS count FROM business_roles").get() as { count: number }).count,
        permissions: (db.prepare("SELECT COUNT(*) AS count FROM business_permissions").get() as { count: number }).count,
        rolePermissions: (db.prepare("SELECT COUNT(*) AS count FROM business_role_permissions").get() as { count: number }).count,
        userRoles: (db.prepare("SELECT COUNT(*) AS count FROM business_user_roles").get() as { count: number }).count
      };
      assert.deepEqual(countsAfter, countsBefore);
    } finally {
      db.close();
    }
  });

  it("keeps external client users separate from internal permissions", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, assignBusinessRoleToUser, userHasBusinessPermission } = await loadInitializer();
      initializeDatabaseOn(db);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-client-fixture','client@example.local','Client Fixture','EXTERNAL_CLIENT','ACTIVE','created','created')`).run();

      assert.doesNotThrow(() => assignBusinessRoleToUser(db, { userId: "business-user-client-fixture", roleKey: "external_client_user", now: "2026-01-01T00:00:00.000Z" }));
      assert.throws(() => assignBusinessRoleToUser(db, { userId: "business-user-client-fixture", roleKey: "company_admin", now: "2026-01-01T00:00:01.000Z" }), /External client users cannot receive internal roles/);

      assert.equal(userHasBusinessPermission(db, "business-user-client-fixture", "client_portal.view"), true);
      assert.equal(userHasBusinessPermission(db, "business-user-client-fixture", "app_studio.view"), false);
      assert.equal(userHasBusinessPermission(db, "business-user-client-fixture", "company.view"), false);
    } finally {
      db.close();
    }
  });

  it("denies unsafe or inactive permission checks and honors revoked assignments", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, assignBusinessRoleToUser, userHasBusinessPermission } = await loadInitializer();
      initializeDatabaseOn(db);

      assert.equal(userHasBusinessPermission(db, "missing-user", "projects.view"), false);
      assert.equal(userHasBusinessPermission(db, "business-user-shrinika", "missing.permission"), false);

      db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shrinika'").run();
      assert.equal(userHasBusinessPermission(db, "business-user-shrinika", "projects.view"), false);
      db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shrinika'").run();

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-manager-fixture','manager@example.local','Manager Fixture','INTERNAL','ACTIVE','created','created')`).run();
      assignBusinessRoleToUser(db, { userId: "business-user-manager-fixture", roleKey: "manager", now: "2026-01-01T00:00:00.000Z" });
      assert.equal(userHasBusinessPermission(db, "business-user-manager-fixture", "projects.assign"), true);
      db.prepare("UPDATE business_user_roles SET revoked_at='2026-01-01T01:00:00.000Z' WHERE user_id='business-user-manager-fixture'").run();
      assert.equal(userHasBusinessPermission(db, "business-user-manager-fixture", "projects.assign"), false);
    } finally {
      db.close();
    }
  });

  it("prevents duplicate active mappings for roles and permissions", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, assignBusinessRoleToUser } = await loadInitializer();
      initializeDatabaseOn(db);

      const ownerRole = db.prepare("SELECT id FROM business_roles WHERE role_key='main_admin_owner'").get() as { id: string };
      const projectView = db.prepare("SELECT id FROM business_permissions WHERE permission_key='projects.view'").get() as { id: string };
      assert.throws(() => {
        db.prepare("INSERT INTO business_role_permissions (id,role_id,permission_id,created_at) VALUES (?,?,?,?)")
          .run("duplicate-role-permission", ownerRole.id, projectView.id, "created");
      });

      const first = assignBusinessRoleToUser(db, { userId: "business-user-shrinika", roleKey: "main_admin_owner", now: "2026-01-01T00:00:00.000Z" }) as { id: string };
      const second = assignBusinessRoleToUser(db, { userId: "business-user-shrinika", roleKey: "main_admin_owner", now: "2026-01-01T00:00:01.000Z" }) as { id: string };
      assert.equal(second.id, first.id);
      assert.throws(() => {
        db.prepare("INSERT INTO business_user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)")
          .run("duplicate-active-user-role", "business-user-shrinika", ownerRole.id, "created");
      });
    } finally {
      db.close();
    }
  });

  it("records denied access events with redacted metadata", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, recordDeniedAccessEvent } = await loadInitializer();
      initializeDatabaseOn(db);

      const event = recordDeniedAccessEvent(db, {
        userId: "business-user-shiva",
        userType: "INTERNAL",
        attemptedModule: "deployment",
        attemptedAction: "deploy",
        reason: "Production deployment requires approval",
        metadata: {
          route: "/api/business-control/deployments/release",
          apiKey: "sk-test-secret-value",
          authorization: "Bearer hidden-token",
          note: "safe operational note"
        },
        now: "2026-01-01T00:00:00.000Z"
      }) as { metadataJson: string };

      assert.ok(event.metadataJson.includes("safe operational note"));
      assert.ok(!event.metadataJson.includes("sk-test-secret-value"));
      assert.ok(!event.metadataJson.includes("hidden-token"));
      const count = db.prepare("SELECT COUNT(*) AS count FROM denied_access_events").get() as { count: number };
      assert.equal(count.count, 1);
    } finally {
      db.close();
    }
  });

  it("creates Business Control Centre auth/session tables and idempotent placeholder credentials", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      initializeDatabaseOn(db);

      for (const tableName of ["business_auth_credentials", "business_auth_sessions", "business_login_events", "business_password_reset_tokens", "business_auth_security_events"]) {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
        assert.ok(table, `${tableName} should exist`);
      }

      for (const indexName of [
        "idx_business_auth_credentials_user_type",
        "idx_business_auth_credentials_active_unique",
        "idx_business_auth_sessions_user_status_expires",
        "idx_business_auth_sessions_token_hash",
        "idx_business_login_events_email_created",
        "idx_business_login_events_user_created",
        "idx_business_password_reset_tokens_user_status_expires",
        "idx_business_password_reset_tokens_hash",
        "idx_business_auth_security_events_user_created",
        "idx_business_auth_security_events_type_severity_created"
      ]) {
        const index = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
        assert.ok(index, `${indexName} should exist`);
      }

      const placeholdersBefore = db.prepare(`SELECT COUNT(*) AS count
        FROM business_auth_credentials
        WHERE credential_type='PASSWORD_HASH' AND password_hash IS NULL AND is_enabled=0`).get() as { count: number };
      assert.equal(placeholdersBefore.count, 2);

      initializeDatabaseOn(db);
      const placeholdersAfter = db.prepare(`SELECT COUNT(*) AS count
        FROM business_auth_credentials
        WHERE credential_type='PASSWORD_HASH' AND password_hash IS NULL AND is_enabled=0`).get() as { count: number };
      assert.equal(placeholdersAfter.count, 2);

      db.prepare(`INSERT INTO business_auth_credentials
        (id,user_id,credential_type,password_hash,password_hash_algorithm,password_updated_at,must_rotate_password,is_enabled,created_at,updated_at)
        VALUES ('enabled-credential-1','business-user-shrinika','PASSWORD_HASH','hash-1','test-hash','created',0,1,'created','created')`).run();
      assert.throws(() => {
        db.prepare(`INSERT INTO business_auth_credentials
          (id,user_id,credential_type,password_hash,password_hash_algorithm,password_updated_at,must_rotate_password,is_enabled,created_at,updated_at)
          VALUES ('enabled-credential-2','business-user-shrinika','PASSWORD_HASH','hash-2','test-hash','created',0,1,'created','created')`).run();
      });
    } finally {
      db.close();
    }
  });

  it("creates and validates only active internal auth sessions", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, createBusinessAuthSession, getActiveBusinessAuthSession } = await loadInitializer();
      initializeDatabaseOn(db);

      const session = createBusinessAuthSession(db, {
        userId: "business-user-shrinika",
        sessionTokenHash: "sha256-session-token-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        ipAddressHash: "ip-hash",
        userAgentHash: "ua-hash",
        metadata: {
          route: "/business-control-centre",
          session: "raw-session-secret",
          note: "internal login placeholder"
        },
        now: "2026-01-01T00:00:00.000Z"
      }) as { id: string; sessionTokenHash: string; metadataJson: string | null };

      assert.equal(session.sessionTokenHash, "sha256-session-token-hash");
      assert.ok(session.metadataJson?.includes("internal login placeholder"));
      assert.ok(!session.metadataJson?.includes("raw-session-secret"));

      const active = getActiveBusinessAuthSession(db, "sha256-session-token-hash", "2026-01-01T00:10:00.000Z") as { id: string; lastSeenAt: string } | undefined;
      assert.equal(active?.id, session.id);
      assert.equal(active?.lastSeenAt, "2026-01-01T00:10:00.000Z");

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-client-session','client-session@example.local','Client Session','EXTERNAL_CLIENT','ACTIVE','created','created')`).run();
      assert.throws(() => createBusinessAuthSession(db, {
        userId: "business-user-client-session",
        sessionTokenHash: "external-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      }), /External client users cannot create internal auth sessions/);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-suspended-session','suspended-session@example.local','Suspended Session','INTERNAL','SUSPENDED','created','created')`).run();
      assert.throws(() => createBusinessAuthSession(db, {
        userId: "business-user-suspended-session",
        sessionTokenHash: "suspended-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      }), /Business user is not active/);

      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at)
        VALUES ('business-user-archived-session','archived-session@example.local','Archived Session','INTERNAL','ARCHIVED','created','created')`).run();
      assert.throws(() => createBusinessAuthSession(db, {
        userId: "business-user-archived-session",
        sessionTokenHash: "archived-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      }), /Business user is not active/);
    } finally {
      db.close();
    }
  });

  it("rejects revoked, expired, and inactive-user auth sessions", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, createBusinessAuthSession, getActiveBusinessAuthSession, revokeBusinessAuthSession } = await loadInitializer();
      initializeDatabaseOn(db);

      const session = createBusinessAuthSession(db, {
        userId: "business-user-shiva",
        sessionTokenHash: "sha256-active-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      }) as { id: string };

      const revoked = revokeBusinessAuthSession(db, session.id, "manual logout", "2026-01-01T00:05:00.000Z") as { status: string; revokedAt: string; revokedReason: string };
      assert.equal(revoked.status, "REVOKED");
      assert.equal(revoked.revokedAt, "2026-01-01T00:05:00.000Z");
      assert.equal(revoked.revokedReason, "manual logout");

      const revokedAgain = revokeBusinessAuthSession(db, session.id, "second logout", "2026-01-01T00:06:00.000Z") as { status: string; revokedAt: string; revokedReason: string };
      assert.equal(revokedAgain.status, "REVOKED");
      assert.equal(revokedAgain.revokedAt, "2026-01-01T00:05:00.000Z");
      assert.equal(revokedAgain.revokedReason, "manual logout");
      assert.equal(getActiveBusinessAuthSession(db, "sha256-active-session-hash", "2026-01-01T00:10:00.000Z"), undefined);

      createBusinessAuthSession(db, {
        userId: "business-user-shiva",
        sessionTokenHash: "sha256-expired-session-hash",
        expiresAt: "2026-01-01T00:01:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      });
      assert.equal(getActiveBusinessAuthSession(db, "sha256-expired-session-hash", "2026-01-01T00:02:00.000Z"), undefined);

      createBusinessAuthSession(db, {
        userId: "business-user-shiva",
        sessionTokenHash: "sha256-suspended-user-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      });
      db.prepare("UPDATE business_users SET status='SUSPENDED' WHERE id='business-user-shiva'").run();
      assert.equal(getActiveBusinessAuthSession(db, "sha256-suspended-user-session-hash", "2026-01-01T00:10:00.000Z"), undefined);

      db.prepare("UPDATE business_users SET status='ACTIVE' WHERE id='business-user-shiva'").run();
      createBusinessAuthSession(db, {
        userId: "business-user-shiva",
        sessionTokenHash: "sha256-archived-user-session-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:00:00.000Z"
      });
      db.prepare("UPDATE business_users SET status='ARCHIVED' WHERE id='business-user-shiva'").run();
      assert.equal(getActiveBusinessAuthSession(db, "sha256-archived-user-session-hash", "2026-01-01T00:10:00.000Z"), undefined);
    } finally {
      db.close();
    }
  });

  it("records auth events and reset placeholders with sanitized metadata only", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, recordBusinessLoginEvent, recordBusinessAuthSecurityEvent, createBusinessPasswordResetTokenPlaceholder } = await loadInitializer();
      initializeDatabaseOn(db);

      const loginEvent = recordBusinessLoginEvent(db, {
        userId: "business-user-shrinika",
        email: "owner@shrinika.local",
        userType: "INTERNAL",
        result: "BLOCKED",
        reason: "rate limit placeholder",
        metadata: {
          password: "plain-password-secret",
          token: "reset-token-secret",
          cookie: "session-cookie-secret",
          authorization: "Bearer hidden-auth-token",
          note: "safe login note"
        },
        now: "2026-01-01T00:00:00.000Z"
      }) as { metadataJson: string | null };
      assert.ok(loginEvent.metadataJson?.includes("safe login note"));
      assert.ok(!loginEvent.metadataJson?.includes("plain-password-secret"));
      assert.ok(!loginEvent.metadataJson?.includes("reset-token-secret"));
      assert.ok(!loginEvent.metadataJson?.includes("session-cookie-secret"));
      assert.ok(!loginEvent.metadataJson?.includes("hidden-auth-token"));

      const securityEvent = recordBusinessAuthSecurityEvent(db, {
        userId: "business-user-shiva",
        eventType: "suspicious_login",
        severity: "high",
        description: "Repeated failed attempts",
        metadata: {
          apiKey: "sk-test-auth-security-secret",
          route: "/api/auth/login"
        },
        now: "2026-01-01T00:01:00.000Z"
      }) as { metadataJson: string | null };
      assert.ok(securityEvent.metadataJson?.includes("/api/auth/login"));
      assert.ok(!securityEvent.metadataJson?.includes("sk-test-auth-security-secret"));

      const resetToken = createBusinessPasswordResetTokenPlaceholder(db, {
        userId: "business-user-shiva",
        tokenHash: "sha256-reset-token-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        metadata: {
          token: "raw-reset-token-secret",
          note: "owner recovery approval still required"
        },
        now: "2026-01-01T00:02:00.000Z"
      }) as { tokenHash: string; metadataJson: string | null };
      assert.equal(resetToken.tokenHash, "sha256-reset-token-hash");
      assert.ok(resetToken.metadataJson?.includes("owner recovery approval still required"));
      assert.ok(!resetToken.metadataJson?.includes("raw-reset-token-secret"));

      assert.throws(() => createBusinessPasswordResetTokenPlaceholder(db, {
        userId: "missing-business-user",
        tokenHash: "sha256-missing-user-token-hash",
        expiresAt: "2026-01-01T01:00:00.000Z",
        now: "2026-01-01T00:02:00.000Z"
      }), /Business user not found/);
    } finally {
      db.close();
    }
  });

  it("creates and manages Business Control Centre project PRD intake records", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        listBusinessProjectIntakes,
        getBusinessProjectIntakeById,
        updateBusinessProjectIntake,
        archiveBusinessProjectIntake,
        listBusinessProjectPrdEvents
      } = await loadInitializer();
      initializeDatabaseOn(db);

      for (const tableName of ["business_project_intakes", "business_project_prd_events"]) {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
        assert.ok(table, `${tableName} should exist`);
      }

      const created = createBusinessProjectIntake(db, {
        projectName: " Client Portal Foundation ",
        clientOrCompanyName: "Shrinika Technologies",
        projectType: "SaaS",
        priority: "High",
        projectSource: "Admin instruction",
        prdStatus: "Drafting",
        shortSummary: "Build the internal planning intake.",
        problemStatement: "Project details need structured PRD review.",
        targetUsers: "Managers\nAdmins",
        coreModulesRequired: "Dashboard, approvals",
        keyFeatures: "PRD intake and review",
        integrationsNeeded: "None yet",
        designReferences: "Business Control Centre",
        deliveryDeadline: "2026-07-01",
        estimatedBudgetRange: "Placeholder",
        risksAssumptions: "Approval flow pending",
        finalApprovalOwner: "Manager",
        actorUserId: "business-user-shrinika",
        now: "2026-01-01T00:00:00.000Z"
      }) as { id: string; projectName: string; workflowStatus: string; archivedAt: string | null };

      assert.equal(created.projectName, "Client Portal Foundation");
      assert.equal(created.workflowStatus, "PROJECT_CREATED");
      assert.equal(created.archivedAt, null);

      const list = listBusinessProjectIntakes(db) as Array<{ id: string; projectName: string }>;
      assert.deepEqual(list.map((item) => item.id), [created.id]);

      const updated = updateBusinessProjectIntake(db, created.id, {
        prdStatus: "Under review",
        workflowStatus: "PRD_REVIEW",
        keyFeatures: "PRD intake, review, approval"
      }, "business-user-shiva", "2026-01-01T00:10:00.000Z") as { prdStatus: string; workflowStatus: string; updatedByUserId: string };
      assert.equal(updated.prdStatus, "Under review");
      assert.equal(updated.workflowStatus, "PRD_REVIEW");
      assert.equal(updated.updatedByUserId, "business-user-shiva");

      const archived = archiveBusinessProjectIntake(db, created.id, "business-user-shrinika", "2026-01-01T00:20:00.000Z") as { id: string; archivedAt: string | null };
      assert.equal(archived.id, created.id);
      assert.equal(archived.archivedAt, "2026-01-01T00:20:00.000Z");
      assert.equal(getBusinessProjectIntakeById(db, created.id), undefined);
      assert.equal((listBusinessProjectIntakes(db) as unknown[]).length, 0);
      assert.equal((listBusinessProjectIntakes(db, { includeArchived: true }) as unknown[]).length, 1);

      const events = listBusinessProjectPrdEvents(db, created.id) as Array<{ eventType: string }>;
      assert.deepEqual(events.map((event) => event.eventType), ["PROJECT_INTAKE_CREATED", "PROJECT_INTAKE_UPDATED", "PROJECT_INTAKE_ARCHIVED"]);
    } finally {
      db.close();
    }
  });

  it("validates project PRD intake fields and redacts event metadata", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, createBusinessProjectIntake, recordBusinessProjectPrdEvent, listBusinessProjectPrdEvents } = await loadInitializer();
      initializeDatabaseOn(db);

      const validInput = {
        projectName: "Automation Intake",
        clientOrCompanyName: "Shrinika Technologies",
        projectType: "Automation",
        priority: "Medium",
        projectSource: "Internal product idea",
        prdStatus: "Not started",
        shortSummary: "Create project intake.",
        problemStatement: "Need persistent intake data.",
        finalApprovalOwner: "Shrinika",
        actorUserId: "business-user-shrinika",
        now: "2026-01-01T01:00:00.000Z"
      } as const;

      assert.throws(() => createBusinessProjectIntake(db, { ...validInput, projectName: " " }), /projectName is required/);
      assert.throws(() => createBusinessProjectIntake(db, { ...validInput, projectType: "Invalid" as any }), /projectType is invalid/);
      assert.throws(() => createBusinessProjectIntake(db, { ...validInput, priority: "Critical" as any }), /priority is invalid/);

      const created = createBusinessProjectIntake(db, validInput) as { id: string };
      recordBusinessProjectPrdEvent(db, {
        projectIntakeId: created.id,
        eventType: "SAFE_METADATA_CHECK",
        actorUserId: "business-user-shrinika",
        message: "Metadata redaction check",
        metadata: {
          route: "/api/business-control-centre/project-intakes",
          password: "NeverStoreThisPassword",
          token: "NeverStoreThisToken",
          note: "Safe note"
        },
        now: "2026-01-01T01:01:00.000Z"
      });
      const events = listBusinessProjectPrdEvents(db, created.id) as Array<{ metadataJson: string | null }>;
      const metadata = events.map((event) => event.metadataJson ?? "").join("\n");
      assert.ok(metadata.includes("Safe note"));
      assert.ok(!metadata.includes("NeverStoreThisPassword"));
      assert.ok(!metadata.includes("NeverStoreThisToken"));
      assert.ok(metadata.includes("[redacted]"));
    } finally {
      db.close();
    }
  });

  it("adds and manages App Studio Build Mission handoff fields for project intakes", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        getBusinessProjectIntakeById,
        markBusinessProjectIntakeBuildMissionHandoff,
        listBusinessProjectPrdEvents
      } = await loadInitializer();
      initializeDatabaseOn(db);

      const created = createBusinessProjectIntake(db, {
        projectName: "Client Portal Build Mission",
        clientOrCompanyName: "Shrinika Technologies",
        projectType: "SaaS",
        priority: "High",
        projectSource: "Admin instruction",
        prdStatus: "Approved",
        shortSummary: "Prepare a governed client portal mission.",
        problemStatement: "The approved PRD needs a build mission draft.",
        coreModulesRequired: "Authentication, dashboard, support",
        keyFeatures: "Client login, ticket view, notifications",
        finalApprovalOwner: "Shrinika",
        workflowStatus: "READY_FOR_APP_STUDIO",
        actorUserId: "business-user-shrinika",
        now: "2026-01-02T00:00:00.000Z"
      }) as { id: string; appStudioBuildMissionId: string | null };
      assert.equal(created.appStudioBuildMissionId, null);

      const handedOff = markBusinessProjectIntakeBuildMissionHandoff(db, {
        intakeId: created.id,
        buildMissionId: "mission-client-portal",
        actorUserId: "business-user-shiva",
        now: "2026-01-02T00:05:00.000Z"
      }) as { appStudioBuildMissionId: string; handedOffAt: string; handedOffByUserId: string; workflowStatus: string };
      assert.equal(handedOff.appStudioBuildMissionId, "mission-client-portal");
      assert.equal(handedOff.handedOffAt, "2026-01-02T00:05:00.000Z");
      assert.equal(handedOff.handedOffByUserId, "business-user-shiva");
      assert.equal(handedOff.workflowStatus, "TEAM_ASSIGNMENT_PENDING");

      const fetched = getBusinessProjectIntakeById(db, created.id) as { appStudioBuildMissionId: string };
      assert.equal(fetched.appStudioBuildMissionId, "mission-client-portal");
      assert.throws(() => markBusinessProjectIntakeBuildMissionHandoff(db, {
        intakeId: created.id,
        buildMissionId: "mission-duplicate",
        actorUserId: "business-user-shiva",
        now: "2026-01-02T00:06:00.000Z"
      }), /already exists/);

      const events = listBusinessProjectPrdEvents(db, created.id) as Array<{ eventType: string; metadataJson: string | null }>;
      assert.ok(events.some((event) => event.eventType === "APP_STUDIO_BUILD_MISSION_DRAFT_CREATED"));
      assert.ok(events.some((event) => event.metadataJson?.includes("mission-client-portal")));
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM business_project_intakes WHERE id=?").get(created.id) as { count: number }).count, 1);
    } finally {
      db.close();
    }
  });

  it("migrates legacy project intake rows with nullable handoff fields", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn, getBusinessProjectIntakeById } = await loadInitializer();
      db.exec(`CREATE TABLE business_project_intakes (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        client_or_company_name TEXT NOT NULL,
        project_type TEXT NOT NULL,
        priority TEXT NOT NULL,
        project_source TEXT NOT NULL,
        prd_status TEXT NOT NULL,
        short_summary TEXT NOT NULL,
        problem_statement TEXT NOT NULL,
        target_users TEXT,
        core_modules_required TEXT,
        key_features TEXT,
        integrations_needed TEXT,
        design_references TEXT,
        delivery_deadline TEXT,
        estimated_budget_range TEXT,
        risks_assumptions TEXT,
        final_approval_owner TEXT NOT NULL,
        workflow_status TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        updated_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      )`);
      db.prepare(`INSERT INTO business_project_intakes
        (id,project_name,client_or_company_name,project_type,priority,project_source,prd_status,short_summary,problem_statement,
          final_approval_owner,workflow_status,created_by_user_id,updated_by_user_id,created_at,updated_at,archived_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
        "legacy-intake",
        "Legacy Intake",
        "Shrinika Technologies",
        "SaaS",
        "Medium",
        "Admin instruction",
        "Approved",
        "Legacy summary",
        "Legacy problem",
        "Manager",
        "READY_FOR_APP_STUDIO",
        "business-user-shrinika",
        "business-user-shrinika",
        "created",
        "created"
      );

      initializeDatabaseOn(db);
      const columns = db.prepare("PRAGMA table_info(business_project_intakes)").all() as Array<{ name: string }>;
      assert.ok(columns.some((column) => column.name === "app_studio_build_mission_id"));
      assert.ok(columns.some((column) => column.name === "handed_off_at"));
      assert.ok(columns.some((column) => column.name === "handed_off_by_user_id"));
      const legacy = getBusinessProjectIntakeById(db, "legacy-intake") as { id: string; appStudioBuildMissionId: string | null; handedOffAt: string | null };
      assert.equal(legacy.id, "legacy-intake");
      assert.equal(legacy.appStudioBuildMissionId, null);
      assert.equal(legacy.handedOffAt, null);
    } finally {
      db.close();
    }
  });

  it("creates, updates, lists, and archives Build Mission team assignments", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        markBusinessProjectIntakeBuildMissionHandoff,
        createOrUpdateBuildMissionTeamAssignment,
        getBuildMissionTeamAssignment,
        listBuildMissionQueueItems,
        getBuildMissionQueueItem,
        archiveBuildMissionTeamAssignment,
        recordBuildMissionQueueEvent
      } = await loadInitializer();
      initializeDatabaseOn(db);
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run("queue-project", "S4 Agent Studio", "/tmp/queue-project", "ACTIVE", "created", "created");
      db.prepare(`INSERT INTO build_missions
        (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,
          scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,approval_id,plan_json,created_at,updated_at,approved_at,converted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "mission-queue-1",
        "queue-project",
        null,
        null,
        "Client Portal",
        "Plan a governed client portal build mission.",
        "[]",
        "high",
        "[]",
        "{}",
        "WORKTREE",
        "[]",
        "Rollback via App Studio governance.",
        "DRAFT",
        null,
        "{}",
        "created",
        "created",
        null,
        null
      );
      const intake = createBusinessProjectIntake(db, {
        projectName: "Client Portal Queue",
        clientOrCompanyName: "Shrinika Technologies",
        projectType: "SaaS",
        priority: "High",
        projectSource: "Admin instruction",
        prdStatus: "Approved",
        shortSummary: "Queue intake summary.",
        problemStatement: "Mission needs assignment.",
        coreModulesRequired: "Portal, support",
        keyFeatures: "Login, dashboard",
        finalApprovalOwner: "Manager",
        workflowStatus: "READY_FOR_APP_STUDIO",
        actorUserId: "business-user-shrinika",
        now: "2026-01-03T00:00:00.000Z"
      }) as { id: string };
      markBusinessProjectIntakeBuildMissionHandoff(db, {
        intakeId: intake.id,
        buildMissionId: "mission-queue-1",
        actorUserId: "business-user-shrinika",
        now: "2026-01-03T00:01:00.000Z"
      });

      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_build_mission_team_assignments'").get());
      const draft = createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-queue-1",
        assignmentStatus: "DRAFT",
        teamLeaderUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        notes: "Short-staffing draft",
        actorUserId: "business-user-shrinika",
        now: "2026-01-03T00:02:00.000Z"
      }) as { id: string; assignmentStatus: string; notes: string | null };
      assert.equal(draft.assignmentStatus, "DRAFT");
      assert.ok(draft.notes?.includes("Short-staffing draft"));
      assert.ok(draft.notes?.includes("Short-staffing warning"));

      assert.throws(() => createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-queue-1",
        assignmentStatus: "ASSIGNED",
        actorUserId: "business-user-shrinika",
        now: "2026-01-03T00:03:00.000Z"
      }), /managerUserId is required/);
      assert.throws(() => createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-queue-1",
        assignmentStatus: "INVALID" as any,
        actorUserId: "business-user-shrinika",
        now: "2026-01-03T00:03:00.000Z"
      }), /assignmentStatus is invalid/);

      const assigned = createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-queue-1",
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        teamLeaderUserId: "business-user-shiva",
        frontendDeveloperUserId: "business-user-shiva",
        backendDeveloperUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        actorUserId: "business-user-shiva",
        now: "2026-01-03T00:04:00.000Z"
      }) as { id: string; assignmentStatus: string; managerUserId: string; updatedByUserId: string };
      assert.equal(assigned.id, draft.id);
      assert.equal(assigned.assignmentStatus, "ASSIGNED");
      assert.equal(assigned.managerUserId, "business-user-shrinika");
      assert.equal(assigned.updatedByUserId, "business-user-shiva");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM business_build_mission_team_assignments WHERE build_mission_id='mission-queue-1'").get() as { count: number }).count, 1);

      const queue = listBuildMissionQueueItems(db) as Array<{ buildMissionId: string; intake: { id: string }; assignment: { assignmentStatus: string } | null }>;
      assert.equal(queue.length, 1);
      assert.equal(queue[0].buildMissionId, "mission-queue-1");
      assert.equal(queue[0].intake.id, intake.id);
      assert.equal(queue[0].assignment?.assignmentStatus, "ASSIGNED");
      assert.equal((getBuildMissionQueueItem(db, "mission-queue-1") as { buildMissionId: string }).buildMissionId, "mission-queue-1");

      recordBuildMissionQueueEvent(db, {
        buildMissionId: "mission-queue-1",
        eventType: "BUILD_MISSION_APPROVED_FROM_BUSINESS_QUEUE",
        actorUserId: "business-user-shrinika",
        summary: "Mission approved from queue",
        payload: { password: "do-not-store", note: "safe note" },
        now: "2026-01-03T00:05:00.000Z"
      });
      const event = db.prepare("SELECT payload_json AS payloadJson FROM build_mission_events WHERE event_type='BUILD_MISSION_APPROVED_FROM_BUSINESS_QUEUE'").get() as { payloadJson: string };
      assert.ok(event.payloadJson.includes("safe note"));
      assert.ok(!event.payloadJson.includes("do-not-store"));

      const archived = archiveBuildMissionTeamAssignment(db, "mission-queue-1", "business-user-shrinika", "2026-01-03T00:06:00.000Z") as { archivedAt: string | null; assignmentStatus: string };
      assert.equal(archived.assignmentStatus, "ARCHIVED");
      assert.equal(archived.archivedAt, "2026-01-03T00:06:00.000Z");
      assert.equal(getBuildMissionTeamAssignment(db, "mission-queue-1"), undefined);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM business_build_mission_team_assignments WHERE build_mission_id='mission-queue-1'").get() as { count: number }).count, 1);
    } finally {
      db.close();
    }
  });

  it("creates Build Mission assignment table without disturbing existing mission rows", async () => {
    const db = new Database(":memory:");
    try {
      const { initializeDatabaseOn } = await loadInitializer();
      db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,root_path TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
      db.exec(`CREATE TABLE build_missions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_module TEXT NOT NULL,
        scope TEXT NOT NULL,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        risk_level TEXT NOT NULL,
        required_specialists_json TEXT NOT NULL DEFAULT '[]',
        scaffold_needs_json TEXT NOT NULL DEFAULT '{}',
        git_mode TEXT NOT NULL,
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
        rollback_plan TEXT NOT NULL,
        status TEXT NOT NULL,
        plan_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("legacy-queue-project", "Legacy", "/tmp/legacy-queue", "ACTIVE", "created", "created");
      db.prepare(`INSERT INTO build_missions
        (id,project_id,target_module,scope,risk_level,git_mode,rollback_plan,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run("legacy-mission", "legacy-queue-project", "CRM", "Legacy scope", "medium", "WORKTREE", "Rollback", "DRAFT", "created", "created");
      initializeDatabaseOn(db);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_build_mission_team_assignments'").get());
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM build_missions WHERE id='legacy-mission'").get() as { count: number }).count, 1);
    } finally {
      db.close();
    }
  });

  it("lists assignable internal users and validates Build Mission assignment user fit", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        assignBusinessRoleToUser,
        listInternalAssignableUsers,
        getInternalAssignableUser,
        validateBuildMissionAssignmentUsers,
        validateBuildMissionAssignmentRoleFit
      } = await loadInitializer();
      initializeDatabaseOn(db);
      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at,archived_at)
        VALUES (?,?,?,?,?,?,?,NULL)`).run("business-user-support-fit", "support-fit@example.local", "Support Fit", "INTERNAL", "ACTIVE", "created", "created");
      assignBusinessRoleToUser(db, { userId: "business-user-support-fit", roleKey: "support_manager", now: "2026-01-05T00:00:00.000Z" });
      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at,archived_at)
        VALUES (?,?,?,?,?,?,?,NULL)`).run("business-user-external-assignment", "external-assignment@example.local", "External Assignment", "EXTERNAL_CLIENT", "ACTIVE", "created", "created");
      db.prepare(`INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at,archived_at)
        VALUES (?,?,?,?,?,?,?,NULL)`).run("business-user-suspended-assignment", "suspended-assignment@example.local", "Suspended Assignment", "INTERNAL", "SUSPENDED", "created", "created");

      const users = listInternalAssignableUsers(db) as Array<{ id: string; email: string; roleKeys: string[] }>;
      assert.ok(users.some(user => user.id === "business-user-shrinika" && user.roleKeys.includes("main_admin_owner")));
      assert.ok(users.some(user => user.id === "business-user-shiva" && user.roleKeys.includes("system_guardian")));
      assert.ok(users.some(user => user.id === "business-user-support-fit" && user.email === "support-fit@example.local"));
      assert.ok(!users.some(user => user.id === "business-user-external-assignment"));
      assert.ok(!users.some(user => user.id === "business-user-suspended-assignment"));
      assert.equal((getInternalAssignableUser(db, "business-user-shrinika") as { displayName: string }).displayName, "Shrinika");
      assert.equal(getInternalAssignableUser(db, "business-user-external-assignment"), undefined);

      assert.throws(() => validateBuildMissionAssignmentUsers(db, {
        assignmentStatus: "DRAFT",
        frontendDeveloperUserId: "missing-user"
      } as any), /Frontend Developer user not found/);
      assert.throws(() => validateBuildMissionAssignmentUsers(db, {
        assignmentStatus: "DRAFT",
        frontendDeveloperUserId: "business-user-external-assignment"
      } as any), /Frontend Developer must be an internal user/);
      assert.throws(() => validateBuildMissionAssignmentUsers(db, {
        assignmentStatus: "DRAFT",
        frontendDeveloperUserId: "business-user-suspended-assignment"
      } as any), /Frontend Developer must be an active internal user/);
      assert.throws(() => validateBuildMissionAssignmentUsers(db, {
        assignmentStatus: "ASSIGNED"
      } as any), /managerUserId is required/);

      const duplicateWarnings = validateBuildMissionAssignmentUsers(db, {
        assignmentStatus: "DRAFT",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva"
      } as any) as { assignmentWarnings: string[] };
      assert.ok(duplicateWarnings.assignmentWarnings.some(warning => warning.includes("Short-staffing warning")));

      const roleFit = validateBuildMissionAssignmentRoleFit(db, {
        assignmentStatus: "DRAFT",
        frontendDeveloperUserId: "business-user-support-fit"
      } as any) as { roleFitWarnings: string[] };
      assert.ok(roleFit.roleFitWarnings.some(warning => warning.includes("Role-fit warning")));
    } finally {
      db.close();
    }
  });

  it("gates development start after Build Mission approval and finalized assignment", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        markBusinessProjectIntakeBuildMissionHandoff,
        createOrUpdateBuildMissionTeamAssignment,
        requestBuildMissionDevelopmentStart,
        approveBuildMissionDevelopmentStart,
        blockBuildMissionDevelopmentStart,
        getBuildMissionDevelopmentGate,
        listBuildMissionQueueItems
      } = await loadInitializer();
      initializeDatabaseOn(db);
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run("dev-gate-project", "S4 Agent Studio", "/tmp/dev-gate-project", "ACTIVE", "created", "created");
      const createMission = (id: string, status: string) => {
        db.prepare(`INSERT INTO build_missions
          (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,
            scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,approval_id,plan_json,created_at,updated_at,approved_at,converted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id,
          "dev-gate-project",
          null,
          null,
          "Client Portal",
          `Scope for ${id}`,
          "[]",
          "high",
          "[]",
          "{}",
          "WORKTREE",
          "[]",
          "Rollback via App Studio governance.",
          status,
          null,
          "{}",
          "created",
          "created",
          status === "APPROVED" ? "approved" : null,
          null
        );
        const intake = createBusinessProjectIntake(db, {
          projectName: `Gate Intake ${id}`,
          clientOrCompanyName: "Shrinika Technologies",
          projectType: "SaaS",
          priority: "High",
          projectSource: "Admin instruction",
          prdStatus: "Approved",
          shortSummary: "Development gate intake summary.",
          problemStatement: "Mission needs development-start approval.",
          coreModulesRequired: "Portal, support",
          keyFeatures: "Login, dashboard",
          finalApprovalOwner: "Manager",
          workflowStatus: "READY_FOR_APP_STUDIO",
          actorUserId: "business-user-shrinika",
          now: `2026-01-04T00:00:0${id.endsWith("1") ? "1" : "2"}.000Z`
        }) as { id: string };
        markBusinessProjectIntakeBuildMissionHandoff(db, {
          intakeId: intake.id,
          buildMissionId: id,
          actorUserId: "business-user-shrinika",
          now: "2026-01-04T00:01:00.000Z"
        });
        return intake;
      };

      createMission("mission-dev-gate-draft", "DRAFT");
      assert.throws(() => requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-draft",
        actorUserId: "business-user-shrinika",
        note: "not approved",
        now: "2026-01-04T00:02:00.000Z"
      }), /must be approved/);

      createMission("mission-dev-gate-1", "APPROVED");
      assert.throws(() => requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-1",
        actorUserId: "business-user-shrinika",
        note: "missing assignment",
        now: "2026-01-04T00:03:00.000Z"
      }), /Finalized team assignment/);
      createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-dev-gate-1",
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        actorUserId: "business-user-shrinika",
        now: "2026-01-04T00:04:00.000Z"
      });
      const requested = requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-1",
        actorUserId: "business-user-shrinika",
        note: "Start planning after approval. password=do-not-store",
        now: "2026-01-04T00:05:00.000Z"
      }) as { gateStatus: string; requestNote: string | null };
      assert.equal(requested.gateStatus, "REQUESTED");
      assert.ok(!requested.requestNote?.includes("do-not-store"));
      assert.throws(() => requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-1",
        actorUserId: "business-user-shrinika",
        note: "duplicate",
        now: "2026-01-04T00:06:00.000Z"
      }), /already exists/);
      const approved = approveBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-1",
        actorUserId: "business-user-shiva",
        note: "Approved to begin development planning.",
        now: "2026-01-04T00:07:00.000Z"
      }) as { gateStatus: string; approvedByUserId: string; approvedAt: string };
      assert.equal(approved.gateStatus, "APPROVED");
      assert.equal(approved.approvedByUserId, "business-user-shiva");
      assert.equal(approved.approvedAt, "2026-01-04T00:07:00.000Z");
      const assignment = db.prepare("SELECT assignment_status AS assignmentStatus FROM business_build_mission_team_assignments WHERE build_mission_id='mission-dev-gate-1'").get() as { assignmentStatus: string };
      assert.equal(assignment.assignmentStatus, "READY_FOR_DEVELOPMENT_APPROVAL");
      const queue = listBuildMissionQueueItems(db) as Array<{ buildMissionId: string; developmentGate: { gateStatus: string } | null }>;
      assert.ok(queue.some(item => item.buildMissionId === "mission-dev-gate-1" && item.developmentGate?.gateStatus === "APPROVED"));

      createMission("mission-dev-gate-2", "APPROVED");
      createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-dev-gate-2",
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        actorUserId: "business-user-shrinika",
        now: "2026-01-04T00:08:00.000Z"
      });
      requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-2",
        actorUserId: "business-user-shrinika",
        note: "Second request",
        now: "2026-01-04T00:09:00.000Z"
      });
      assert.throws(() => blockBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-2",
        actorUserId: "business-user-shiva",
        reason: " ",
        now: "2026-01-04T00:10:00.000Z"
      }), /reason is required/);
      const blocked = blockBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-dev-gate-2",
        actorUserId: "business-user-shiva",
        reason: "Testing plan missing",
        now: "2026-01-04T00:11:00.000Z"
      }) as { gateStatus: string; blockedByUserId: string; blockReason: string };
      assert.equal(blocked.gateStatus, "BLOCKED");
      assert.equal(blocked.blockedByUserId, "business-user-shiva");
      assert.equal(blocked.blockReason, "Testing plan missing");
      assert.equal((getBuildMissionDevelopmentGate(db, "mission-dev-gate-2") as { gateStatus: string }).gateStatus, "BLOCKED");
      assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE event_type='DEVELOPMENT_START_REQUESTED'").get());
      assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE event_type='DEVELOPMENT_START_APPROVED'").get());
      assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE event_type='DEVELOPMENT_START_BLOCKED'").get());
    } finally {
      db.close();
    }
  });

  it("tracks Build Mission execution only after all governance gates are satisfied", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        markBusinessProjectIntakeBuildMissionHandoff,
        createOrUpdateBuildMissionTeamAssignment,
        requestBuildMissionDevelopmentStart,
        approveBuildMissionDevelopmentStart,
        createBuildMissionExecutionStatus,
        updateBuildMissionExecutionStatus,
        archiveBuildMissionExecutionStatus,
        getBuildMissionExecutionStatus,
        listBuildMissionExecutionDashboardItems
      } = await loadInitializer();
      initializeDatabaseOn(db);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_build_mission_execution_statuses'").get());
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run("execution-project", "S4 Agent Studio", "/tmp/execution-project", "ACTIVE", "created", "created");
      const createMission = (id: string, status: string) => {
        db.prepare(`INSERT INTO build_missions
          (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,
            scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,approval_id,plan_json,created_at,updated_at,approved_at,converted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id,
          "execution-project",
          null,
          null,
          "Execution Dashboard",
          `Execution scope for ${id}`,
          "[]",
          "high",
          "[]",
          "{}",
          "WORKTREE",
          "[]",
          "Rollback via App Studio governance.",
          status,
          null,
          "{}",
          "created",
          "created",
          status === "APPROVED" ? "approved" : null,
          null
        );
        const intake = createBusinessProjectIntake(db, {
          projectName: `Execution Intake ${id}`,
          clientOrCompanyName: "Shrinika Technologies",
          projectType: "SaaS",
          priority: "High",
          projectSource: "Admin instruction",
          prdStatus: "Approved",
          shortSummary: "Execution dashboard intake summary.",
          problemStatement: "Mission needs execution visibility.",
          coreModulesRequired: "Dashboard, status tracking",
          keyFeatures: "Manual status controls",
          finalApprovalOwner: "Manager",
          workflowStatus: "READY_FOR_APP_STUDIO",
          actorUserId: "business-user-shrinika",
          now: "2026-01-06T00:00:00.000Z"
        }) as { id: string };
        markBusinessProjectIntakeBuildMissionHandoff(db, {
          intakeId: intake.id,
          buildMissionId: id,
          actorUserId: "business-user-shrinika",
          now: "2026-01-06T00:01:00.000Z"
        });
      };

      createMission("mission-execution-draft", "DRAFT");
      assert.throws(() => createBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-draft",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:02:00.000Z"
      }), /must be approved/);

      createMission("mission-execution-ready", "APPROVED");
      assert.throws(() => createBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:03:00.000Z"
      }), /Finalized team assignment/);
      createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "mission-execution-ready",
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:04:00.000Z"
      });
      assert.throws(() => createBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:05:00.000Z"
      }), /Approved development-start gate/);
      requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        note: "Request development start before execution dashboard.",
        now: "2026-01-06T00:06:00.000Z"
      });
      approveBuildMissionDevelopmentStart(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shiva",
        note: "Approved for execution tracking visibility.",
        now: "2026-01-06T00:07:00.000Z"
      });

      const created = createBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        ownerUserId: "business-user-shiva",
        now: "2026-01-06T00:08:00.000Z"
      }) as { executionStatus: string; currentStage: string; progressPercent: number; ownerUserId: string };
      assert.equal(created.executionStatus, "READY_TO_START");
      assert.equal(created.currentStage, "DEVELOPMENT_START_APPROVED");
      assert.equal(created.progressPercent, 0);
      assert.equal(created.ownerUserId, "business-user-shiva");
      assert.throws(() => createBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:09:00.000Z"
      }), /already exists/);
      assert.throws(() => updateBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        executionStatus: "IN_PROGRESS",
        currentStage: "FRONTEND_BUILD",
        progressPercent: 101,
        now: "2026-01-06T00:10:00.000Z"
      }), /progressPercent/);
      assert.throws(() => updateBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        executionStatus: "BLOCKED",
        currentStage: "FRONTEND_BUILD",
        progressPercent: 20,
        now: "2026-01-06T00:11:00.000Z"
      }), /blockerSummary/);
      assert.throws(() => updateBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        executionStatus: "COMPLETED",
        currentStage: "PRODUCTION_READINESS",
        progressPercent: 100,
        now: "2026-01-06T00:12:00.000Z"
      }), /COMPLETED/);
      assert.throws(() => updateBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        executionStatus: "IN_PROGRESS",
        currentStage: "FRONTEND_BUILD",
        progressPercent: 25,
        ownerUserId: "missing-user",
        now: "2026-01-06T00:13:00.000Z"
      }), /ownerUserId/);

      const blocked = updateBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shiva",
        executionStatus: "BLOCKED",
        currentStage: "INTEGRATION",
        progressPercent: 45,
        blockerSummary: "API contract review pending",
        nextAction: "Manager to review integration blocker",
        ownerUserId: "business-user-shrinika",
        now: "2026-01-06T00:14:00.000Z"
      }) as { executionStatus: string; blockerSummary: string; nextAction: string; updatedByUserId: string };
      assert.equal(blocked.executionStatus, "BLOCKED");
      assert.equal(blocked.blockerSummary, "API contract review pending");
      assert.equal(blocked.updatedByUserId, "business-user-shiva");

      const dashboard = listBuildMissionExecutionDashboardItems(db) as Array<{ buildMissionId: string; executionStatus: { executionStatus: string } | null }>;
      assert.ok(dashboard.some(item => item.buildMissionId === "mission-execution-ready" && item.executionStatus?.executionStatus === "BLOCKED"));
      const archived = archiveBuildMissionExecutionStatus(db, {
        buildMissionId: "mission-execution-ready",
        actorUserId: "business-user-shrinika",
        now: "2026-01-06T00:15:00.000Z"
      }) as { executionStatus: string; archivedAt: string | null };
      assert.equal(archived.executionStatus, "ARCHIVED");
      assert.equal(archived.archivedAt, "2026-01-06T00:15:00.000Z");
      assert.equal(getBuildMissionExecutionStatus(db, "mission-execution-ready"), undefined);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM business_build_mission_execution_statuses WHERE build_mission_id='mission-execution-ready'").get() as { count: number }).count, 1);
      assert.ok(db.prepare("SELECT id FROM build_mission_events WHERE build_mission_id='mission-execution-ready' AND event_type='BUILD_MISSION_EXECUTION_STATUS_UPDATED'").get());
    } finally {
      db.close();
    }
  });

  it("creates and governs Build Mission QA checklists without mock data", async () => {
    const db = new Database(":memory:");
    try {
      const {
        initializeDatabaseOn,
        createBusinessProjectIntake,
        markBusinessProjectIntakeBuildMissionHandoff,
        createOrUpdateBuildMissionTeamAssignment,
        requestBuildMissionDevelopmentStart,
        approveBuildMissionDevelopmentStart,
        createBuildMissionExecutionStatus,
        updateBuildMissionExecutionStatus,
        createBuildMissionQaChecklist,
        updateBuildMissionQaChecklistItem,
        updateBuildMissionQaChecklistStatus,
        approveBuildMissionQaChecklist,
        rejectBuildMissionQaChecklist,
        archiveBuildMissionQaChecklist,
        listBuildMissionQaDashboardItems,
        getBuildMissionQaChecklist,
        getBuildMissionExecutionDashboardItem
      } = await loadInitializer();
      initializeDatabaseOn(db);
      db.prepare("INSERT INTO projects (id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run("project-qa-flow", "QA Flow Project", "/tmp/project-qa-flow", "ACTIVE", "2026-01-07T00:00:00.000Z", "2026-01-07T00:00:00.000Z");
      db.prepare(`INSERT INTO build_missions
        (id,project_id,task_id,readiness_run_id,target_module,scope,dependencies_json,risk_level,required_specialists_json,
          scaffold_needs_json,git_mode,acceptance_criteria_json,rollback_plan,status,approval_id,plan_json,created_at,updated_at,approved_at,converted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "build-mission-qa-flow",
        "project-qa-flow",
        null,
        null,
        "QA Flow Module",
        "QA flow scope",
        "[]",
        "high",
        "[]",
        "{}",
        "WORKTREE",
        "[]",
        "Rollback QA changes",
        "DRAFT",
        null,
        "{}",
        "2026-01-07T00:00:00.000Z",
        "2026-01-07T00:00:00.000Z",
        null,
        null
      );
      const intake = createBusinessProjectIntake(db, {
        projectName: "QA Flow Intake",
        clientOrCompanyName: "Shrinika Technologies",
        projectType: "Internal Tool",
        priority: "High",
        projectSource: "Admin instruction",
        prdStatus: "Approved",
        shortSummary: "QA flow intake for governed checklist testing.",
        problemStatement: "Need a governed QA checklist after execution becomes QA-ready.",
        targetUsers: "Internal QA and delivery team",
        coreModulesRequired: "Auth, execution, QA approval",
        keyFeatures: "Checklist, approvals, archive",
        integrationsNeeded: "None",
        designReferences: "Business Control Centre",
        deliveryDeadline: "2026-07-15",
        estimatedBudgetRange: "Placeholder",
        risksAssumptions: "Governed approval required",
        finalApprovalOwner: "Manager",
        workflowStatus: "READY_FOR_APP_STUDIO",
        actorUserId: "business-user-shrinika",
        now: "2026-01-07T00:01:00.000Z"
      }) as { id: string };
      markBusinessProjectIntakeBuildMissionHandoff(db, {
        intakeId: intake.id,
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        now: "2026-01-07T00:02:00.000Z"
      });
      db.prepare("UPDATE build_missions SET status='APPROVED',approval_id='approval-qa-flow',approved_at=?,updated_at=? WHERE id=?")
        .run("2026-01-07T00:02:30.000Z", "2026-01-07T00:02:30.000Z", "build-mission-qa-flow");
      createOrUpdateBuildMissionTeamAssignment(db, {
        buildMissionId: "build-mission-qa-flow",
        assignmentStatus: "ASSIGNED",
        managerUserId: "business-user-shrinika",
        teamLeaderUserId: "business-user-shiva",
        frontendDeveloperUserId: "business-user-shiva",
        backendDeveloperUserId: "business-user-shiva",
        qaUserId: "business-user-shiva",
        productionReadinessUserId: "business-user-shiva",
        actorUserId: "business-user-shrinika",
        now: "2026-01-07T00:03:00.000Z"
      });
      requestBuildMissionDevelopmentStart(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        note: "Request QA-ready execution tracking.",
        now: "2026-01-07T00:04:00.000Z"
      });
      approveBuildMissionDevelopmentStart(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shiva",
        note: "Approve governed development start.",
        now: "2026-01-07T00:05:00.000Z"
      });
      createBuildMissionExecutionStatus(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        ownerUserId: "business-user-shiva",
        now: "2026-01-07T00:06:00.000Z"
      });
      updateBuildMissionExecutionStatus(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shiva",
        executionStatus: "QA_REVIEW",
        currentStage: "TESTING_QA",
        progressPercent: 82,
        qaStatus: "QA_REVIEW",
        ownerUserId: "business-user-shiva",
        now: "2026-01-07T00:07:00.000Z"
      });

      assert.throws(() => createBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        qaOwnerUserId: "missing-user",
        now: "2026-01-07T00:08:00.000Z"
      }), /active internal assignable user/);

      db.prepare("INSERT INTO business_users (id,email,display_name,user_type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("business-user-qa-suspended", "qa-suspended@example.local", "QA Suspended", "INTERNAL", "SUSPENDED", "2026-01-07T00:08:30.000Z", "2026-01-07T00:08:30.000Z");
      assert.throws(() => createBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        qaOwnerUserId: "business-user-qa-suspended",
        now: "2026-01-07T00:08:40.000Z"
      }), /active internal assignable user/);
      const checklist = createBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        qaOwnerUserId: "business-user-shiva",
        now: "2026-01-07T00:09:00.000Z"
      });
      assert.ok(checklist);
      assert.equal(checklist?.qaStatus, "DRAFT");
      assert.equal(checklist?.items.length, 10);
      assert.ok(checklist?.items.some((item) => item.itemKey === "security_no_secret_exposure"));
      assert.throws(() => rejectBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        reason: "",
        now: "2026-01-07T00:09:10.000Z"
      }), /reason is required/);
      assert.throws(() => updateBuildMissionQaChecklistStatus(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shiva",
        qaStatus: "READY_FOR_APPROVAL",
        now: "2026-01-07T00:09:20.000Z"
      }), /ready for approval/);

      const queueItems = listBuildMissionQaDashboardItems(db) as Array<{ buildMissionId: string; qaChecklist: { id: string; qaStatus: string; readyForApproval: boolean; itemCount: number } | null }>;
      assert.ok(queueItems.some((item) => item.buildMissionId === "build-mission-qa-flow" && item.qaChecklist?.itemCount === 10));
      const dashboardItem = getBuildMissionExecutionDashboardItem(db, "build-mission-qa-flow") as { qaChecklist: { id: string; qaStatus: string } | null } | undefined;
      assert.equal(dashboardItem?.qaChecklist?.qaStatus, "DRAFT");

      const firstItem = checklist!.items[0]!;
      assert.throws(() => updateBuildMissionQaChecklistItem(db, {
        buildMissionId: "build-mission-qa-flow",
        itemId: firstItem.id,
        actorUserId: "business-user-shrinika",
        itemStatus: "FAIL",
        severity: "HIGH",
        now: "2026-01-07T00:09:30.000Z"
      }), /evidenceNote or blockerReason is required/);

      for (const item of checklist!.items) {
        updateBuildMissionQaChecklistItem(db, {
          buildMissionId: "build-mission-qa-flow",
          itemId: item.id,
          actorUserId: "business-user-shiva",
          itemStatus: "PASS",
          severity: item.severity,
          evidenceNote: `Checked ${item.itemKey}`,
          now: "2026-01-07T00:09:40.000Z"
        });
      }

      const readyChecklist = updateBuildMissionQaChecklistStatus(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        qaStatus: "READY_FOR_APPROVAL",
        note: "QA items complete",
        now: "2026-01-07T00:10:00.000Z"
      });
      assert.equal(readyChecklist?.qaStatus, "READY_FOR_APPROVAL");

      const approved = approveBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shiva",
        note: "QA approved without deployment",
        now: "2026-01-07T00:10:30.000Z"
      });
      assert.equal(approved?.qaStatus, "APPROVED");

      const execution = getBuildMissionExecutionDashboardItem(db, "build-mission-qa-flow") as { executionStatus: { qaStatus: string } | null } | undefined;
      assert.equal(execution?.executionStatus?.qaStatus, "QA_APPROVED");

      const archived = archiveBuildMissionQaChecklist(db, {
        buildMissionId: "build-mission-qa-flow",
        actorUserId: "business-user-shrinika",
        now: "2026-01-07T00:11:00.000Z"
      });
      assert.equal(archived?.qaStatus, "ARCHIVED");
      const archivedChecklist = getBuildMissionQaChecklist(db, "build-mission-qa-flow", { includeArchived: true });
      assert.equal(archivedChecklist?.archivedAt, "2026-01-07T00:11:00.000Z");
      assert.equal(archivedChecklist?.items.every((item) => item.archivedAt), true);
    } finally {
      db.close();
    }
  });
});
