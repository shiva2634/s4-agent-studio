import { useEffect, useState } from "react";

type AppTheme = "dark" | "midnight" | "purple" | "emerald" | "sunset" | "light" | "contrast";

type MetricCard = {
  label: string;
  value: string;
  note: string;
  tone: "neutral" | "success" | "warning" | "danger";
};

type TableSection = {
  id: string;
  title: string;
  description: string;
  columns: string[];
  rows: string[][];
};

const appThemeOptions: Array<{ id: AppTheme; label: string }> = [
  { id: "dark", label: "Dark / Default" },
  { id: "midnight", label: "Midnight Blue" },
  { id: "purple", label: "Royal Purple" },
  { id: "emerald", label: "Emerald" },
  { id: "sunset", label: "Sunset" },
  { id: "light", label: "Light" },
  { id: "contrast", label: "High Contrast" }
];

const sidebarSections = [
  { id: "company-dashboard", label: "Company Dashboard" },
  { id: "project-operations", label: "Project Operations" },
  { id: "client-management", label: "Client Management" },
  { id: "approvals", label: "Approvals Control Centre" },
  { id: "support-desk", label: "Support Desk" },
  { id: "finance-billing", label: "Finance & Billing" },
  { id: "hrms", label: "HRMS / Employee Management" },
  { id: "agent-operations", label: "Agent Operations" },
  { id: "audit-compliance", label: "Audit & Compliance" },
  { id: "system-health", label: "System Health" }
];

const dashboardCards: MetricCard[] = [
  { label: "Active projects", value: "12", note: "Placeholder portfolio count", tone: "neutral" },
  { label: "Active clients", value: "8", note: "Mock client visibility only", tone: "neutral" },
  { label: "Pending approvals", value: "5", note: "Awaiting internal review", tone: "warning" },
  { label: "Open support tickets", value: "17", note: "Sample support queue", tone: "warning" },
  { label: "Active employees", value: "42", note: "HRMS placeholder", tone: "success" },
  { label: "Running agent tasks", value: "9", note: "Agent operations sample", tone: "neutral" },
  { label: "System health", value: "Stable", note: "No live probes connected", tone: "success" },
  { label: "Monthly revenue", value: "TBD", note: "Finance placeholder only", tone: "neutral" }
];

const workflowSteps = [
  "Admin",
  "Manager",
  "Team Leader",
  "Frontend Developer",
  "Backend Developer",
  "Testing / QA Developer",
  "Final Production Readiness Developer",
  "Manager final deployment approval"
];

const tableSections: TableSection[] = [
  {
    id: "project-operations",
    title: "Project Operations",
    description: "Mock project assignment visibility for the internal workflow.",
    columns: ["Project", "Manager", "Team Leader", "Frontend", "Backend", "QA", "Production Readiness", "Status", "Next Approval"],
    rows: [
      ["Automation Studio", "Aarav", "Meera", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "In Review", "Manager"],
      ["Client Portal", "Nisha", "Karan", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "Planning", "Admin"],
      ["Support Desk", "Rohan", "Isha", "Dev 1", "Dev 2", "Dev 3", "Dev 4", "QA", "Final Readiness"]
    ]
  },
  {
    id: "client-management",
    title: "Client Management",
    description: "Placeholder client records. No customer-facing access is enabled.",
    columns: ["Client", "Company", "Active Projects", "Support Status", "Billing Status"],
    rows: [
      ["Client Alpha", "Alpha Industries", "2", "Open follow-up", "Placeholder"],
      ["Client Beta", "Beta Retail", "1", "Stable", "Placeholder"],
      ["Client Gamma", "Gamma Services", "3", "Priority watch", "Placeholder"]
    ]
  },
  {
    id: "approvals",
    title: "Approvals Control Centre",
    description: "Static approval queue for future governance integration.",
    columns: ["Approval", "Requested By", "Current Owner", "Risk", "Status", "Due Date"],
    rows: [
      ["Deployment approval", "Manager", "Shrinika", "High", "Pending", "Sample"],
      ["Project assignment", "Admin Operator", "Manager", "Medium", "Pending", "Sample"],
      ["Final readiness", "QA Lead", "Manager", "High", "Reviewing", "Sample"]
    ]
  },
  {
    id: "support-desk",
    title: "Support Tickets",
    description: "Sample support queue. Customer intake remains outside App Studio.",
    columns: ["Ticket", "Source", "Assigned Team", "Priority", "Status"],
    rows: [
      ["SUP-1042", "Support email", "Support Ops", "High", "Triage"],
      ["SUP-1043", "Website form", "Client Success", "Medium", "Open"],
      ["SUP-1044", "Internal escalation", "Engineering", "High", "Investigating"]
    ]
  },
  {
    id: "agent-operations",
    title: "Agent Activity",
    description: "Placeholder visibility into internal agent tasks.",
    columns: ["Agent", "Task", "Current State", "Last Activity", "Requires Approval"],
    rows: [
      ["Developer Agent", "Plan dashboard shell", "Complete", "Sample", "No"],
      ["Security Review Agent", "Review access boundary", "Queued", "Sample", "No"],
      ["Final Review Agent", "Readiness checklist", "Waiting", "Sample", "Yes"]
    ]
  },
  {
    id: "audit-compliance",
    title: "Audit Events",
    description: "Static audit trail preview for future compliance reporting.",
    columns: ["Event", "Actor", "Area", "Severity", "Timestamp"],
    rows: [
      ["Approval viewed", "Shrinika", "Approvals", "Medium", "Placeholder"],
      ["Project assigned", "Admin Operator", "Projects", "Medium", "Placeholder"],
      ["Access boundary notice displayed", "System", "Compliance", "Low", "Placeholder"]
    ]
  }
];

const systemHealthCards = [
  { label: "App Studio", value: "Online placeholder", tone: "success" },
  { label: "API", value: "Not connected on this shell", tone: "neutral" },
  { label: "Database", value: "No reads in MVP shell", tone: "neutral" },
  { label: "Agent queue", value: "Static preview", tone: "warning" },
  { label: "Audit logging", value: "Future integration", tone: "warning" }
];

const financePlaceholders = [
  "Current month billing placeholder",
  "Pending invoices placeholder",
  "Payment follow-ups placeholder",
  "Finance alerts placeholder"
];

const hrmsPlaceholders = [
  "Employee count placeholder",
  "Active managers placeholder",
  "Team leaders placeholder",
  "Developer allocation placeholder",
  "HR alerts placeholder"
];

function isAppTheme(value: string | null): value is AppTheme {
  return appThemeOptions.some(theme => theme.id === value);
}

function useStoredAppTheme() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const storedTheme = window.localStorage.getItem("app-studio-theme");
      return isAppTheme(storedTheme) ? storedTheme : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("app-studio-theme", theme);
    } catch {
      // Theme persistence should never block internal dashboard access.
    }
  }, [theme]);

  return { theme, setTheme };
}

export function BusinessControlCentre({ navigate }: { navigate: (path: string) => void }) {
  const { theme, setTheme } = useStoredAppTheme();

  return (
    <main className="app-shell app-studio-shell business-control-shell" data-theme={theme}>
      <header className="topbar business-topbar">
        <div className="business-title-block">
          <span>Internal Admin Portal</span>
          <h1>Business Control Centre</h1>
          <p>Parent company: Shrinika Technologies</p>
        </div>
        <div className="business-header-meta">
          <div><span>Main Admin / Owner</span><strong>Shrinika</strong></div>
          <div><span>Operator</span><strong>Shiva / Internal Operator</strong></div>
          <div><span>System status</span><strong className="success">Placeholder stable</strong></div>
        </div>
        <div className="top-actions business-actions">
          <button className="top-link" onClick={() => navigate("/")}>App Studio</button>
          <label className="theme-select">Theme<select value={theme} onChange={event => setTheme(event.target.value as AppTheme)} aria-label="Business Control Centre theme">{appThemeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </div>
      </header>

      <div className="business-layout">
        <aside className="business-sidebar">
          <strong>Business Control</strong>
          <p>Internal sections</p>
          <nav aria-label="Business Control Centre sections">
            {sidebarSections.map(section => (
              <a key={section.id} href={`#${section.id}`} className="business-nav-item">{section.label}</a>
            ))}
          </nav>
        </aside>

        <section className="business-content">
          <section className="business-hero" id="company-dashboard">
            <div>
              <span className="business-kicker">Shrinika Technologies</span>
              <h2>Company Dashboard</h2>
              <p>Static MVP shell for internal business oversight. All data shown here is placeholder/mock data until approved database and API integrations are built.</p>
            </div>
            <div className="business-status-card">
              <span>Access boundary</span>
              <strong>Internal only</strong>
              <p>Customers must use the separate website, email, support channels, and future client portal.</p>
            </div>
          </section>

          <section className="business-boundary-notice">
            <strong>Internal-only notice</strong>
            <p>App Studio and Business Control Centre are restricted to Shrinika Technologies employees, developers, managers, team leaders, HR, and approved internal operators. Customers use the separate website, email, support, and future client portal.</p>
          </section>

          <section className="business-card-grid" aria-label="Company dashboard overview cards">
            {dashboardCards.map(card => (
              <article className={`business-metric-card ${card.tone}`} key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </article>
            ))}
          </section>

          <section className="business-section workflow-section">
            <div className="business-section-heading">
              <span>Project assignment workflow</span>
              <h2>Internal Delivery Chain</h2>
            </div>
            <div className="workflow-chain" aria-label="Internal project assignment chain">
              {workflowSteps.map((step, index) => (
                <div className="workflow-step" key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
          </section>

          {tableSections.map(section => (
            <section className="business-section" id={section.id} key={section.id}>
              <div className="business-section-heading">
                <span>{section.description}</span>
                <h2>{section.title}</h2>
              </div>
              <div className="business-table-wrap">
                <table className="business-table">
                  <thead>
                    <tr>{section.columns.map(column => <th key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {section.rows.map(row => (
                      <tr key={row.join("-")}>{row.map((cell, index) => <td key={`${cell}-${index}`}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="business-section split-business-section" id="finance-billing">
            <div>
              <div className="business-section-heading">
                <span>Placeholder section only</span>
                <h2>Finance & Billing</h2>
              </div>
              <div className="placeholder-list">{financePlaceholders.map(item => <span key={item}>{item}</span>)}</div>
            </div>
            <div id="hrms">
              <div className="business-section-heading">
                <span>Placeholder section only</span>
                <h2>HRMS / Employee Management</h2>
              </div>
              <div className="placeholder-list">{hrmsPlaceholders.map(item => <span key={item}>{item}</span>)}</div>
            </div>
          </section>

          <section className="business-section" id="system-health">
            <div className="business-section-heading">
              <span>Static system health cards. No backend probes in this slice.</span>
              <h2>System Health</h2>
            </div>
            <div className="system-health-grid">
              {systemHealthCards.map(card => (
                <article className={`system-health-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
