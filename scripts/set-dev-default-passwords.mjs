#!/usr/bin/env node
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to set development default internal passwords in production");
  }
  const {
    db,
    formatDevelopmentDefaultCredentialSetupSummary,
    getResolvedDatabasePath,
    initializeDatabase,
    setDevelopmentDefaultInternalPasswords
  } = await import("@s4/db");
  try {
    initializeDatabase();
    console.log("Local development only: setting temporary internal default passwords.");
    console.log(`Using database: ${getResolvedDatabasePath()}`);
    const summaries = setDevelopmentDefaultInternalPasswords(db, {
      nodeEnv: process.env.NODE_ENV,
      now: new Date().toISOString()
    });
    console.log(formatDevelopmentDefaultCredentialSetupSummary(summaries));
    console.log("Temporary login URL: http://localhost:5173/internal-login");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unable to set development default passwords";
  console.error(`Development credential setup failed: ${message}`);
  process.exitCode = 1;
});
