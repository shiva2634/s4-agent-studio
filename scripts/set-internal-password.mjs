#!/usr/bin/env node
import { Writable } from "node:stream";
import readline from "node:readline";

const defaultPasswordEnvName = "INTERNAL_AUTH_PASSWORD";

function parseArgs(argv) {
  const args = { email: "", passwordEnv: defaultPasswordEnvName, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      args.help = true;
    } else if (item === "--email") {
      args.email = argv[index + 1] ?? "";
      index += 1;
    } else if (item.startsWith("--email=")) {
      args.email = item.slice("--email=".length);
    } else if (item === "--password-env") {
      args.passwordEnv = argv[index + 1] ?? defaultPasswordEnvName;
      index += 1;
    } else if (item.startsWith("--password-env=")) {
      args.passwordEnv = item.slice("--password-env=".length) || defaultPasswordEnvName;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    "Set an internal Business Control Centre password for a seeded internal user.",
    "",
    "Usage:",
    "  npm run internal-auth:set-password -- --email owner@shrinika.local",
    "  npm run internal-auth:set-password -- --email shiva@shrinika.local",
    "",
    "Non-interactive fallback:",
    "  INTERNAL_AUTH_PASSWORD='your local password' npm run internal-auth:set-password -- --email owner@shrinika.local",
    "",
    "The password is never printed and only a salted password hash is stored."
  ].join("\n"));
}

async function readHiddenLine(prompt) {
  if (!process.stdin.isTTY) {
    throw new Error(`Interactive password input requires a TTY. Set ${defaultPasswordEnvName} for non-interactive local setup.`);
  }
  const mutedOutput = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      if (text.includes(prompt)) process.stdout.write(prompt);
      callback();
    }
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutedOutput,
    terminal: true
  });
  try {
    return await new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        process.stdout.write("\n");
        resolve(answer);
      });
    });
  } finally {
    rl.close();
  }
}

async function readPassword(passwordEnvName) {
  const envPassword = process.env[passwordEnvName];
  if (envPassword) return envPassword;
  const password = await readHiddenLine("Password: ");
  const confirmation = await readHiddenLine("Confirm password: ");
  if (password !== confirmation) throw new Error("Password confirmation mismatch");
  return password;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.email) throw new Error("Missing required --email argument");

  const password = await readPassword(args.passwordEnv);
  const { db, formatInternalCredentialSetupSummary, initializeDatabase, setSeededInternalUserPassword } = await import("@s4/db");
  try {
    initializeDatabase();
    const summary = setSeededInternalUserPassword(db, {
      email: args.email,
      password,
      now: new Date().toISOString()
    });
    console.log(formatInternalCredentialSetupSummary(summary));
  } finally {
    db.close();
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unable to set internal password";
    console.error(`Internal credential setup failed: ${message}`);
    process.exitCode = 1;
  });
