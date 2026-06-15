import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectInspection } from "./project-inspection.js";
import { collectProjectFiles } from "./project-inspection.js";
import { validateProposalPath } from "./change-proposals.js";

export type GeneratedProposal = {
  filePath: string;
  operation: "CREATE" | "UPDATE";
  proposedContent: string;
  reason: string;
};

export type GeneratedPlan = {
  summary: string;
  steps: string[];
  expectedFiles: string[];
  acceptanceCriteria: string[];
  rollback: string;
  proposals: GeneratedProposal[];
};

const unsupportedMessage = "Proposal generation requires either a supported feature template or a configured AI provider.";

export function getUnsupportedProposalMessage() {
  return unsupportedMessage;
}

function isCustomerSupportRequest(message: string) {
  return /\bcustomer support\b/i.test(message) || /\bsupport page\b/i.test(message) || /\bsupport ticket/i.test(message);
}

async function readIfExists(rootPath: string, filePath: string) {
  try {
    validateProposalPath(rootPath, filePath);
    return await fs.readFile(path.join(rootPath, filePath), "utf8");
  } catch {
    return null;
  }
}

function chooseRoots(files: string[]) {
  const hasSrcApp = files.some((file) => file.startsWith("src/app/"));
  const hasApp = files.some((file) => file.startsWith("app/"));
  const appRoot = hasSrcApp ? "src/app" : hasApp ? "app" : null;
  const hasSrc = files.some((file) => file.startsWith("src/"));
  const hasLib = files.some((file) => file.startsWith("lib/"));
  const libRoot = hasSrcApp || (hasSrc && !hasLib) ? "src/lib" : "lib";
  const testRoot = files.some((file) => file.startsWith("tests/")) ? "tests" : "__tests__";
  return { appRoot, libRoot, testRoot };
}

function validationContent() {
  return `export type SupportTicketInput = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export type SupportTicketValidation = {
  ok: boolean;
  errors: Partial<Record<keyof SupportTicketInput, string>>;
  value?: SupportTicketInput;
};

const emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

export function validateSupportTicket(input: Partial<SupportTicketInput>): SupportTicketValidation {
  const value = {
    name: String(input.name ?? "").trim(),
    email: String(input.email ?? "").trim().toLowerCase(),
    subject: String(input.subject ?? "").trim(),
    message: String(input.message ?? "").trim()
  };
  const errors: SupportTicketValidation["errors"] = {};

  if (value.name.length < 2) errors.name = "Name is required.";
  if (!emailPattern.test(value.email)) errors.email = "A valid email address is required.";
  if (value.subject.length < 4) errors.subject = "Subject must be at least 4 characters.";
  if (value.message.length < 20) errors.message = "Message must be at least 20 characters.";

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors, value };
}
`;
}

function accessContent() {
  return `export function isSupportAdminRequest(request: Request) {
  const roleHeader = request.headers.get("x-user-role") ?? "";
  return roleHeader.split(",").map((role) => role.trim().toLowerCase()).includes("admin");
}

export function supportAdminDeniedResponse() {
  return Response.json({ error: "Admin access is required." }, { status: 403 });
}
`;
}

function storeContent() {
  return `import fs from "node:fs/promises";
import path from "node:path";
import type { SupportTicketInput } from "./validation";

export type SupportTicket = SupportTicketInput & {
  id: string;
  status: "open" | "closed";
  customerMessages: Array<{ body: string; createdAt: string }>;
  internalNotes: Array<{ body: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
};

const storePath = path.join(process.cwd(), "data", "support-tickets.json");

async function readTickets(): Promise<SupportTicket[]> {
  try {
    return JSON.parse(await fs.readFile(storePath, "utf8")) as SupportTicket[];
  } catch {
    return [];
  }
}

async function writeTickets(tickets: SupportTicket[]) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(tickets, null, 2), "utf8");
}

export async function createSupportTicket(input: SupportTicketInput) {
  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    ...input,
    id: crypto.randomUUID(),
    status: "open",
    customerMessages: [{ body: input.message, createdAt: now }],
    internalNotes: [],
    createdAt: now,
    updatedAt: now
  };
  const tickets = await readTickets();
  tickets.unshift(ticket);
  await writeTickets(tickets);
  return ticket;
}

export async function listSupportTickets() {
  return readTickets();
}
`;
}

function supportApiContent() {
  const importRoot = "../../../../lib";
  return `import { NextResponse } from "next/server";
import { createSupportTicket } from "${importRoot}/support/store";
import { validateSupportTicket } from "${importRoot}/support/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const validation = validateSupportTicket(body);
  if (!validation.ok || !validation.value) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const ticket = await createSupportTicket(validation.value);
  return NextResponse.json({ ticket: { id: ticket.id, status: ticket.status } }, { status: 201 });
}
`;
}

function adminApiContent() {
  const importRoot = "../../../../../lib";
  return `import { NextResponse } from "next/server";
import { isSupportAdminRequest, supportAdminDeniedResponse } from "${importRoot}/support/access";
import { listSupportTickets } from "${importRoot}/support/store";

export async function GET(request: Request) {
  if (!isSupportAdminRequest(request)) return supportAdminDeniedResponse();
  const tickets = await listSupportTickets();
  return NextResponse.json({ tickets });
}
`;
}

function supportPageContent() {
  return `"use client";

import { FormEvent, useState } from "react";

type SubmitState = "idle" | "submitting" | "sent" | "error";

export default function SupportPage() {
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        subject: form.get("subject"),
        message: form.get("message")
      })
    });

    if (!response.ok) {
      setState("error");
      setError("Please check the required fields and try again.");
      return;
    }

    event.currentTarget.reset();
    setState("sent");
  }

  return (
    <main>
      <h1>Customer Support</h1>
      <p>Send the Probability Quant Lab team a support request. Required fields are validated before a ticket is created.</p>
      <form onSubmit={submitTicket}>
        <label>
          Name
          <input name="name" minLength={2} required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Subject
          <input name="subject" minLength={4} required />
        </label>
        <label>
          Message
          <textarea name="message" minLength={20} required />
        </label>
        <button type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Sending..." : "Submit ticket"}</button>
      </form>
      {state === "sent" && <p role="status">Your support ticket was submitted.</p>}
      {state === "error" && <p role="alert">{error}</p>}
    </main>
  );
}
`;
}

function adminPageContent() {
  return `export default async function AdminSupportPage() {
  return (
    <main>
      <h1>Support Tickets</h1>
      <p>Ticket data is available through the admin support API. Customer-visible messages and internal notes are stored separately.</p>
    </main>
  );
}
`;
}

function validationTestContent(libRoot: string) {
  const importPath = libRoot === "src/lib" ? "../src/lib/support/validation" : "../lib/support/validation";
  return `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSupportTicket } from "${importPath}";

describe("support ticket validation", () => {
  it("requires valid contact fields and a detailed message", () => {
    const result = validateSupportTicket({ name: "A", email: "invalid", subject: "Yo", message: "short" });
    assert.equal(result.ok, false);
    assert.equal(Boolean(result.errors.email), true);
    assert.equal(Boolean(result.errors.message), true);
  });

  it("accepts a complete support ticket", () => {
    const result = validateSupportTicket({
      name: "Customer",
      email: "customer@example.com",
      subject: "Billing question",
      message: "I need help understanding my latest Probability Quant Lab invoice."
    });
    assert.equal(result.ok, true);
  });
});
`;
}

export async function generateFeaturePlan(rootPath: string, message: string, inspection: ProjectInspection): Promise<GeneratedPlan | null> {
  if (!isCustomerSupportRequest(message)) return null;

  const { files } = await collectProjectFiles(rootPath);
  const { appRoot, libRoot, testRoot } = chooseRoots(files);
  const relevantReads = [
    appRoot ? `${appRoot}/layout.tsx` : null,
    appRoot ? `${appRoot}/page.tsx` : null,
    `${libRoot}/auth.ts`,
    `${libRoot}/auth/index.ts`,
    "drizzle/schema.ts",
    "src/db/schema.ts",
    "db/schema.ts",
    "components/navigation.tsx",
    "components/Nav.tsx"
  ].filter((file): file is string => Boolean(file));
  await Promise.all(relevantReads.map((file) => readIfExists(rootPath, file)));

  const isNextAppRouter = Boolean(appRoot) && inspection.frameworks.includes("Next.js");
  if (!isNextAppRouter) return null;

  const hasAdminArea = files.some((file) => appRoot !== null && file.startsWith(`${appRoot}/admin/`));
  const proposals: GeneratedProposal[] = [
    {
      filePath: `${libRoot}/support/validation.ts`,
      operation: "CREATE",
      proposedContent: validationContent(),
      reason: "Add deterministic support-ticket field validation shared by the form and API route."
    },
    {
      filePath: `${libRoot}/support/access.ts`,
      operation: "CREATE",
      proposedContent: accessContent(),
      reason: "Add an admin-only access check without storing secrets in source code."
    },
    {
      filePath: `${libRoot}/support/store.ts`,
      operation: "CREATE",
      proposedContent: storeContent(),
      reason: "Persist submitted tickets and keep internal notes separate from customer-visible messages."
    },
    {
      filePath: `${appRoot}/api/support/tickets/route.ts`,
      operation: "CREATE",
      proposedContent: supportApiContent(),
      reason: "Create the validated ticket-submission endpoint."
    },
    {
      filePath: `${appRoot}/api/admin/support/tickets/route.ts`,
      operation: "CREATE",
      proposedContent: adminApiContent(),
      reason: "Expose ticket listing only to admin requests."
    },
    {
      filePath: `${appRoot}/support/page.tsx`,
      operation: "CREATE",
      proposedContent: supportPageContent(),
      reason: "Add a customer-facing support form that posts to the ticket API."
    },
    {
      filePath: `${testRoot}/support.validation.test.ts`,
      operation: "CREATE",
      proposedContent: validationTestContent(libRoot),
      reason: "Cover required field validation and accepted support-ticket input."
    }
  ];

  if (hasAdminArea) {
    proposals.push({
      filePath: `${appRoot}/admin/support/page.tsx`,
      operation: "CREATE",
      proposedContent: adminPageContent(),
      reason: "Follow the existing admin route convention with a support-ticket review page."
    });
  }

  return {
    summary: "Customer support page and ticket workflow",
    steps: [
      "Add shared ticket validation and admin access helpers.",
      "Add ticket persistence with customer messages stored separately from internal notes.",
      "Add customer ticket submission and admin ticket-listing API routes.",
      "Add the customer support page using the existing App Router structure.",
      "Add validation tests for required fields and accepted submissions."
    ],
    expectedFiles: proposals.map((proposal) => proposal.filePath),
    acceptanceCriteria: [
      "Customers can submit a validated support ticket with name, email, subject, and message.",
      "Required field validation and email format checks reject incomplete tickets before persistence.",
      "Submitted tickets are persisted without storing secrets in source code.",
      "Admin ticket access is guarded by an admin-only request check.",
      "Internal notes are stored separately from customer-visible messages.",
      "Validation tests cover rejected invalid input and accepted complete input.",
      "No package installation, Git push, deployment, or project file mutation occurs before approval."
    ],
    rollback: "Reject the proposals before approval, or revert the approved file changes from the Git checkpoint after application.",
    proposals
  };
}
