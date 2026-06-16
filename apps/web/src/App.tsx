import { useEffect, useMemo, useRef, useState } from "react";
import { getProjectManagementActions } from "./project-management.js";

type Project = { id: string; name: string; rootPath: string; status?: string };
type Agent = { id: string; name: string; status: string };
type Message = { id: string; sender: "user" | "agent"; text: string };
type Approval = { id: string; summary: string; riskLevel: string; status: string; projectName: string };
type Task = { id: string; projectId: string; title: string; status: string; riskLevel: string; projectName: string; attemptCount: number; correctionRounds: number; nextRequiredAction: string; currentRoundNumber: number | null; currentRoundStatus: string | null; recoveryAvailable: boolean };
type TaskHistoryRound = { id: string; roundNumber: number; roundType: string; status: string; summary: string; userMessage: string; proposalCount: number; approvalRequired: boolean; nextRequiredAction: string; recoveryAvailable: boolean; recoveryStatus: string | null; recoveryOutcome: string | null; createdAt: string; updatedAt: string; completedAt: string | null; proposals: Array<{ id: string; filePath: string; operation: string; status: string; reason: string }>; approvals: Array<{ id: string; actionType: string; summary: string; status: string }>; executions: Array<{ id: string; status: string; checkResultsJson: string | null; error: string | null }> };
type TaskHistory = { task: { id: string; projectId: string; projectName: string; title: string; objective: string; status: string; riskLevel: string; conversationId: string | null; attemptCount: number; correctionRounds: number; nextRequiredAction: string; currentRoundNumber: number | null; currentRoundStatus: string | null; recoveryAvailable: boolean; recoveryStatus: string | null }; rounds: TaskHistoryRound[] };
type Proposal = { id: string; taskId: string; filePath: string; operation: string; reason: string; status: string };
type ProviderStatus = { configured: boolean; provider: string; baseUrlHostname: string; model: string; status: string; lastTestedAt: string | null; sanitizedError: string | null };
type GitCheckpoint = { available: boolean; branch: string | null; head: string | null; checkpointRef: string | null; dirty: boolean; warning: string | null };
type CheckResult = { action: string; script: string; skipped: boolean; ok: boolean; exitCode: number | null; output: string };
type ExecutionRecord = { id: string; status: string; gitCheckpointJson: string | null; checkResultsJson: string | null; createdAt: string; updatedAt: string; gitCheckpoint: GitCheckpoint | null; rollbackAvailable: boolean; rollbackStatus: "AVAILABLE" | "UNAVAILABLE" | "ROLLED_BACK" };
type ExecutionState = { executions: ExecutionRecord[]; checkpointExecution: ExecutionRecord | null; latestExecution: ExecutionRecord | null; rollbackAvailable: boolean; rollbackStatus: "AVAILABLE" | "UNAVAILABLE" | "ROLLED_BACK"; recoveryAvailable: boolean; recoveryOutcome: string | null; appliedFiles: Array<{ filePath: string; operation: string; result: string }> };
type AuditEvent = { id: string; eventType: string; summary: string; projectId: string | null; taskId: string | null; createdAt: string };
type MediaProject = { id: string; name: string; description: string | null; aspectRatio: string; defaultBrandKitId: string | null; defaultPresenterProfileId: string | null; status: "ACTIVE" | "ARCHIVED"; createdAt: string; updatedAt: string };
type MediaMessage = { id: string; sender: "user" | "director"; content: string; createdAt: string };
type MediaBrief = { id: string; title: string; logline: string; audience: string; style: string; durationSeconds: number; constraintsJson: string; status: "DRAFT" | "APPROVED"; approvedAt: string | null };
type MediaSceneStatus = "DRAFT" | "APPROVED" | "GENERATING" | "ASSET_READY" | "REJECTED";
type MediaScene = { id: string; position: number; title: string; description: string; durationSeconds: number; dialogue: string; visualPrompt: string; aspectRatio: string; status: MediaSceneStatus; approvedAt: string | null };
type MediaAsset = { id: string; sceneId: string | null; kind: string; label: string; source: string; status: string; fileName: string | null; originalName: string | null; mimeType: string | null; sizeBytes: number | null; checksumSha256: string | null; localPath: string | null; inspectionJson: string | null; qcStatus: string; qcIssuesJson: string; previewPath: string | null; thumbnailPath: string | null; metadataJson: string | null; approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | null; approvalFeedback: string | null; approvedAt: string | null; approvedBy: string | null; rejectedAt: string | null; rejectedBy: string | null };
type AudioSettings = { audioRole: "NARRATION" | "MUSIC" | "SFX" | "SCENE_AUDIO"; volume: number; trimStartSeconds: number; trimEndSeconds: number | null; fadeInSeconds: number; fadeOutSeconds: number; muted: boolean; backgroundMusic: boolean };
type MediaGenerationJob = { id: string; providerKey: string; status: string; requestJson: string; resultJson: string | null };
type MediaGenerationStatusHistory = { id: string; generationJobId: string; status: string; progressPercent: number | null; message: string | null; providerStatus: string | null; createdAt: string };
type MediaSceneVersion = { id: string; sceneId: string; versionNumber: number; title: string; scriptText: string; visualDescription: string; durationSeconds: number; position: number; changeSummary: string | null; createdAt: string; createdBy: string };
type MediaPromptVersion = { id: string; sceneId: string; sceneVersionId: string; versionNumber: number; providerKey: string; taskType: string; positivePrompt: string; negativePrompt: string; settingsJson: string; referenceAssetIdsJson: string; createdAt: string; createdBy: string };
type MediaProvider = { key: string; name: string; capabilities: readonly string[]; status: string };
type RouterCapability = { key: string; name: string; supports: string[]; enabled: boolean; healthy: boolean; priority: number; paid: boolean; mode: string; reason: string };
type MediaProcessingJob = { id: string; assetId: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"; error: string | null; createdAt: string };
type MediaRenderJob = { id: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; progress: number; outputAssetId: string | null; requestJson: string; error: string | null; logText: string };
type ExportSettings = { preset: "9:16"|"16:9"|"1:1"; resolution: "720p"|"1080p"; fps: number; bitrateKbps: number; includeCaptions: boolean; includeLogo: boolean; includeDisclaimer: boolean; includeMusic: boolean };
type ComfyWorkflow = { id: string; workflowType: "WAN_T2V" | "WAN_I2V"; name: string; version: number; status: "VALID" | "INVALID"; isActive: 0 | 1; isBuiltin: 0 | 1; workflowJson: string; mappingJson: string; validationJson: string; createdAt: string; updatedAt: string };
type MediaBrandKit = { id: string; name: string; colorsJson: string; fontsJson: string; tagline: string; tone: string; disclaimer: string };
type MediaPresenterProfile = { id: string; name: string; appearancePrompt: string; voiceAccent: string; clothing: string; consistencyRules: string };
type MediaBundle = { project: MediaProject; messages: MediaMessage[]; brief: MediaBrief | null; scenes: MediaScene[]; assets: MediaAsset[]; brandKits: MediaBrandKit[]; presenterProfiles: MediaPresenterProfile[]; generationJobs: MediaGenerationJob[]; processingJobs?: MediaProcessingJob[]; renderJobs?: MediaRenderJob[]; comfyWorkflows?: ComfyWorkflow[]; providers: MediaProvider[] };
type ManagedProject = { id: string; name: string; rootPath: string; status: "ACTIVE" | "PAUSED" | "ARCHIVED" };
type MediaTemplate = { id: string; name: string; templateType: "PROMO"|"PRESENTER"|"EXPLAINER"|"INVESTOR_PITCH"|"REEL"|"YOUTUBE"; description: string; defaultDurationSeconds: number; aspectRatio: string; sceneStructureJson: string; promptRules: string; captionStyleJson: string; audioSettingsJson: string; brandRulesJson: string; isBuiltin: 0|1; archivedAt: string | null };
type FfmpegStatus = { available: boolean; ffmpegPath: string; ffprobePath: string; ffmpeg: { available: boolean }; ffprobe: { available: boolean } };
type ComfyStatus = { enabled: boolean; baseUrlHostname: string; timeoutMs: number; status?: string; lastTestedAt?: string; sanitizedError?: string };
type LongCatStatus = { enabled: boolean; baseUrlHostname: string; timeoutMs: number; status?: string; lastTestedAt?: string; sanitizedError?: string };
const API = "http://127.0.0.1:4310";

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };
  if (path.startsWith("/media-studio")) return <MediaStudio path={path} navigate={navigate} />;
  return <DeveloperWorkspace navigate={navigate} />;
}

function DeveloperWorkspace({navigate}:{navigate:(path:string)=>void}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [manageableProjects, setManageableProjects] = useState<ManagedProject[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projectId, setProjectId] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([{ id: "welcome", sender: "agent", text: "Hi Shiva. Register or select a project, then tell me what you want to build, fix, research, or automate." }]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>();
  const [execution, setExecution] = useState<ExecutionState>();
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskHistory, setTaskHistory] = useState<TaskHistory>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"project" | "agent" | "deregister" | null>(null);
  const [projectLifecycleDialog, setProjectLifecycleDialog] = useState<"pause" | "resume" | "archive" | "deregister" | null>(null);
  const [projectLifecycleTargetId, setProjectLifecycleTargetId] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    const [boot, approvalData, taskData, providerData, auditData] = await Promise.all([
      fetch(`${API}/api/bootstrap`).then(r => r.json()),
      fetch(`${API}/api/approvals`).then(r => r.json()),
      fetch(`${API}/api/tasks`).then(r => r.json()),
      fetch(`${API}/api/providers/status`).then(r => r.json()),
      fetch(`${API}/api/audit`).then(r => r.json())
    ]);
    setProjects(boot.projects); setManageableProjects(boot.manageableProjects ?? boot.projects); setAgents(boot.agents); setApprovals(approvalData.approvals); setTasks(taskData.tasks);
    setProviderStatus(providerData);
    setAuditEvents(auditData.events);
    const preferredProjectId = boot.projects.some((project: Project) => project.id === projectId) ? projectId : boot.projects[0]?.id ?? "";
    const scopedTasks = taskData.tasks.filter((task: Task) => task.projectId === preferredProjectId);
    const nextTask = scopedTasks.find((task: Task) => task.id === selectedTaskId) ?? scopedTasks.find((task: Task) => ["PLANNING", "AWAITING_APPROVAL", "APPROVED", "RUNNING", "TESTING"].includes(task.status)) ?? scopedTasks[0] ?? null;
    if (boot.projects.length === 0) {
      if (projectId) {
        setProjectId("");
        setConversationId(undefined);
        setProposals([]);
        setExecution(undefined);
        setSelectedTaskId(null);
        setTaskHistory(undefined);
      }
    } else if (!projectId || !boot.projects.some((project: Project) => project.id === projectId)) {
      setProjectId(boot.projects[0].id);
      setConversationId(undefined);
      setProposals([]);
      setExecution(undefined);
      setSelectedTaskId(nextTask?.id ?? null);
      setTaskHistory(undefined);
    } else if (!selectedTaskId || !scopedTasks.some((task: Task) => task.id === selectedTaskId)) {
      setSelectedTaskId(nextTask?.id ?? null);
    }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: "end" }); }, [messages]);
  useEffect(() => {
    if (!selectedTaskId) {
      setTaskHistory(undefined);
      setProposals([]);
      setExecution(undefined);
      return;
    }
    void loadTaskDetails(selectedTaskId);
  }, [selectedTaskId]);

  const pending = useMemo(() => approvals.filter(a => a.status === "PENDING"), [approvals]);
  const selectedProject = projects.find(project => project.id === projectId);
  const scopedTasks = tasks.filter(task => task.projectId === projectId);
  const activeTask = scopedTasks.find(t => ["PLANNING", "AWAITING_APPROVAL", "APPROVED", "RUNNING", "TESTING"].includes(t.status));
  const selectedTask = scopedTasks.find(t => t.id === selectedTaskId) ?? activeTask ?? scopedTasks[0] ?? null;
  const lifecycleTarget = manageableProjects.find(project => project.id === projectLifecycleTargetId) ?? selectedProject ?? null;
  const lifecycleAffectsSelectedProject = Boolean(lifecycleTarget && selectedProject && lifecycleTarget.id === selectedProject.id);

  async function refreshAndReselectProject() {
    await refresh();
    setConversationId(undefined);
    setProposals([]);
    setExecution(undefined);
  }

  async function loadTaskDetails(taskId: string) {
    const [proposalsResponse, executionResponse, historyResponse] = await Promise.all([
      fetch(`${API}/api/tasks/${taskId}/proposals`),
      fetch(`${API}/api/tasks/${taskId}/execution`),
      fetch(`${API}/api/tasks/${taskId}/history`)
    ]);
    if (proposalsResponse.ok) {
      const proposalData = await proposalsResponse.json();
      setProposals(proposalData.proposals ?? []);
    } else {
      setProposals([]);
    }
    if (executionResponse.ok) {
      setExecution(await executionResponse.json());
    } else {
      setExecution(undefined);
    }
    if (historyResponse.ok) {
      setTaskHistory(await historyResponse.json());
    } else {
      setTaskHistory(undefined);
    }
  }

  async function sendMessage() {
    const value = input.trim(); if (!value || !projectId || busy) return;
    setMessages(m => [...m, { id: crypto.randomUUID(), sender: "user", text: value }]); setInput(""); setBusy(true);
    try {
      const response = await fetch(`${API}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, taskId: selectedTask?.id ?? undefined, conversationId, message: value }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Developer Agent request failed");
      setConversationId(data.conversationId);
      setSelectedTaskId(data.taskId ?? selectedTask?.id ?? null);
      setMessages(m => [
        ...m,
        {
          id: crypto.randomUUID(),
          sender: "agent",
          text: data.plan.steps.length
            ? `${data.response}\n\n${data.plan.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`
            : data.response
        }
      ]);
      await refresh();
    } catch (e) { setMessages(m => [...m, { id: crypto.randomUUID(), sender: "agent", text: e instanceof Error ? e.message : "Unknown error" }]); }
    finally { setBusy(false); }
  }

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    await fetch(`${API}/api/approvals/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    await refresh();
  }

  async function loadDiff(id: string) {
    const data = await fetch(`${API}/api/proposals/${id}/diff`).then(r => r.json());
    setDiffs(current => ({ ...current, [id]: data.proposal.unifiedDiff }));
  }

  async function decideProposal(id: string, decision: "approve" | "reject") {
    await fetch(`${API}/api/proposals/${id}/${decision}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    await refresh();
  }

  async function applyApproved(taskId: string) {
    await fetch(`${API}/api/tasks/${taskId}/apply`, { method: "POST" });
    await refresh();
  }

  async function runChecks(taskId: string) {
    await fetch(`${API}/api/tasks/${taskId}/run-checks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    await refresh();
  }

  async function rollback(taskId: string) {
    await fetch(`${API}/api/tasks/${taskId}/rollback`, { method: "POST" });
    await refresh();
  }

  async function recover(taskId: string) {
    const response = await fetch(`${API}/api/tasks/${taskId}/recover`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Unable to recover task execution");
      return;
    }
    setNotice(`Task ${taskId} recovery completed.`);
    await refresh();
  }

  async function testProvider() {
    const data = await fetch(`${API}/api/providers/test`, { method: "POST" }).then(r => r.json());
    setProviderStatus(data);
  }

  const checkpointExecution = execution?.checkpointExecution ?? execution?.executions.find((entry) => entry.gitCheckpoint);
  const latestExecution = execution?.latestExecution ?? execution?.executions[0];
  const rollbackAvailable = execution?.rollbackAvailable ?? Boolean(checkpointExecution?.rollbackAvailable);
  const rollbackStatus = execution?.rollbackStatus ?? (latestExecution?.status === "ROLLED_BACK" ? "ROLLED_BACK" : rollbackAvailable ? "AVAILABLE" : "UNAVAILABLE");
  const checkResults = parseJsonArray<CheckResult>(latestExecution?.checkResultsJson ?? null);

  return <main className="app-shell">
    <header className="topbar"><div><h1>App Studio</h1><p>Shrinika Automation Studio</p></div><div className="top-actions"><button className="top-link" onClick={()=>navigate("/media-studio")}>Media Studio</button><span className="status-dot"/> Local API connected<select defaultValue="guided"><option value="guided">Guided mode</option><option value="balanced">Balanced mode</option><option value="autonomous">Autonomous mode</option></select></div></header>
    <div className="workspace-grid">
      <aside className="sidebar">
        <button className="primary" onClick={()=>setDialog("project")}>+ Register project</button>
        <h3>Projects</h3>
        {projects.length ? <div className="project-picker"><select value={projectId} onChange={e=>{const nextProjectId=e.target.value;const nextTask=tasks.find(task=>task.projectId===nextProjectId&&["PLANNING","AWAITING_APPROVAL","APPROVED","RUNNING","TESTING"].includes(task.status)) ?? tasks.find(task=>task.projectId===nextProjectId) ?? null;setProjectId(nextProjectId);setConversationId(undefined);setProposals([]);setExecution(undefined);setSelectedTaskId(nextTask?.id ?? null);setTaskHistory(undefined);setProjectMenuOpen(false);}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="project-actions"><button className="secondary" onClick={()=>setProjectMenuOpen(open=>!open)} disabled={!selectedProject}>Project actions</button>{projectMenuOpen&&selectedProject&&<div className="project-menu"><button onClick={()=>{setProjectLifecycleTargetId(selectedProject.id);setProjectLifecycleDialog(selectedProject.status==="PAUSED"?"resume":"pause");setProjectMenuOpen(false);}}>{selectedProject.status==="PAUSED"?"Resume Project":"Pause Project"}</button><button onClick={()=>{setProjectLifecycleTargetId(selectedProject.id);setProjectLifecycleDialog("archive");setProjectMenuOpen(false);}}>Archive Project</button><button onClick={()=>{setProjectLifecycleTargetId(selectedProject.id);setProjectLifecycleDialog("deregister");setProjectMenuOpen(false);}}>De-register Project</button></div>}</div></div> : <p className="muted">No projects registered.</p>}
        <h3>Project management</h3>
        {manageableProjects.length ? manageableProjects.map(project => <div key={project.id} className="mini"><span>{project.name}</span><small>{project.status}</small><div className="decision wrap">{getProjectManagementActions(project.status).map(action => <button key={action} onClick={()=>{setProjectLifecycleTargetId(project.id);setProjectLifecycleDialog(action==="Resume Project"?"resume":action==="Pause Project"?"pause":action==="Archive Project"?"archive":"deregister");}}>{action}</button>)}</div></div>) : <p className="muted">No manageable projects.</p>}
        {notice&&<p className="success">{notice}</p>}
        {error&&<p className="error">{error}</p>}
        <h3>Agents</h3>{agents.map(a=><button key={a.id} className={`nav ${a.id==="developer"?"active":""}`}><span>{a.name}</span><small>{a.status}</small></button>)}
        <button className="secondary" onClick={()=>setDialog("agent")}>+ Create agent</button>
        <h3>Provider</h3>{providerStatus&&<div className="provider-box"><strong>{providerStatus.configured?"Configured":"Not configured"}</strong><small>{providerStatus.provider} · {providerStatus.model||"no model"}</small><small>{providerStatus.baseUrlHostname}</small><span className={`risk ${providerStatus.status==="ok"?"low":providerStatus.status==="error"?"critical":"medium"}`}>{providerStatus.status}</span>{providerStatus.sanitizedError&&<p className="error">{providerStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testProvider()}>Test connection</button></div>}
        <h3>Navigation</h3><button className="nav">Tasks <small>{tasks.length}</small></button><button className="nav">Approvals <small>{pending.length}</small></button><button className="nav">Audit</button>
      </aside>
      <section className="chat-panel">
        <div className="chat-header"><div><h2>Developer Agent</h2><p>Describe outcomes in normal language. Technical planning happens automatically.</p></div><span className="badge">Guided</span></div>
        <div className="messages">{messages.map(m=><article key={m.id} className={`message ${m.sender}`}><strong>{m.sender==="user"?"You":"Developer Agent"}</strong><p>{m.text}</p></article>)}<div ref={messagesEndRef}/></div>
        <div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder={projectId?"Describe what you want to build, fix, research, or automate...":"Register a project first..."}/><button className="primary send" onClick={()=>void sendMessage()} disabled={busy||!projectId}>{busy?"Planning...":"Send"}</button></div>
      </section>
      <aside className="activity">
        <h3>Current task</h3>{selectedTask?<div className="card"><strong>{selectedTask.title}</strong><div className="row"><span className={`risk ${selectedTask.riskLevel}`}>{selectedTask.riskLevel}</span><span>{selectedTask.status.replaceAll("_"," ")}</span></div><p>{selectedTask.projectName}</p><div className="mini-grid"><div className="mini"><span>Attempts</span><strong>{selectedTask.attemptCount}</strong></div><div className="mini"><span>Correction rounds</span><strong>{selectedTask.correctionRounds}</strong></div><div className="mini"><span>Next action</span><strong>{selectedTask.nextRequiredAction.replaceAll("_"," ")}</strong></div><div className="mini"><span>Current round</span><strong>{selectedTask.currentRoundNumber ?? "n/a"}</strong><small>{selectedTask.currentRoundStatus ?? "unknown"}</small></div></div>{selectedTask.recoveryAvailable&&<p className="notice">Interrupted execution can be recovered safely.</p>}</div>:<div className="card"><strong>No active task</strong><p>Your plan, attempts, and execution history will appear here.</p></div>}
        <h3>Change proposals</h3>{proposals.length?proposals.map(p=><div className="card proposal" key={p.id}><strong>{p.filePath}</strong><div className="row"><span>{p.operation}</span><span>{p.status}</span></div><p>{p.reason}</p><button onClick={()=>void loadDiff(p.id)}>Diff preview</button>{diffs[p.id]&&<pre>{diffs[p.id]}</pre>}<div className="decision"><button onClick={()=>void decideProposal(p.id,"approve")} disabled={p.status!=="PENDING"}>Approve</button><button onClick={()=>void decideProposal(p.id,"reject")} disabled={p.status!=="PENDING"}>Reject</button></div></div>):<div className="card"><strong>No proposals</strong><p>Mutation requests will appear here for review before any file changes.</p></div>}
        {selectedTask&&<div className="card execution"><strong>Execution</strong><p>Approved files are revalidated before write. Checks run only package.json scripts.</p>{checkpointExecution&&<div className="execution-grid"><div className="execution-field"><span>Rollback status</span><strong>{rollbackStatus}</strong></div><div className="execution-field"><span>Rollback available</span><strong>{rollbackAvailable ? "Yes" : "No"}</strong></div><div className="execution-field"><span>Branch</span><strong>{checkpointExecution.gitCheckpoint?.branch ?? "Unknown"}</strong></div><div className="execution-field"><span>Checkpoint commit</span><strong>{checkpointExecution.gitCheckpoint?.head ?? "Unavailable"}</strong></div><div className="execution-field"><span>Checkpoint ref</span><strong>{checkpointExecution.gitCheckpoint?.checkpointRef ?? "Unavailable"}</strong></div><div className="execution-field"><span>Repository state</span><strong>{checkpointExecution.gitCheckpoint?.dirty ? "Dirty" : "Clean"}</strong></div><div className="execution-field"><span>Checkpoint created</span><strong>{checkpointExecution.createdAt}</strong></div>{checkpointExecution.gitCheckpoint?.warning&&<div className="execution-field wide"><span>Recovery note</span><strong>{checkpointExecution.gitCheckpoint.warning}</strong></div>}</div>}{latestExecution&&<div className="execution-summary"><div className="row"><span>Status</span><span>{latestExecution.status}</span></div><div className="row"><span>Recovery outcome</span><span>{execution?.recoveryOutcome ?? "No recovery required"}</span></div><div className="row"><span>Recovery action</span><span>{execution?.recoveryAvailable ? "Recover execution" : "Not available"}</span></div></div>}{checkResults.length>0&&<div className="check-results">{checkResults.map((result)=><article key={`${result.action}-${result.script}`} className={`check-result ${result.ok ? "ok" : "fail"}`}><div className="row"><strong>{result.action}</strong><span>{result.ok ? "Passed" : "Failed"}</span></div><small>Script: {result.script}</small><small>{result.skipped ? "Skipped" : `Exit code: ${result.exitCode ?? "n/a"}`}</small><pre>{result.output || "No output captured."}</pre></article>)}</div>}{checkResults.length===0&&<div className="muted">No check results yet.</div>}{execution?.appliedFiles.length ? <div className="files-changed">{execution.appliedFiles.map(f=><div className="mini" key={`${f.filePath}-${f.result}`}><span>{f.operation} {f.filePath}</span><small>{f.result}</small></div>)}</div> : <div className="muted">No files have been applied yet.</div>}<div className="decision"><button onClick={()=>void runChecks(selectedTask.id)}>Run checks</button><button onClick={()=>void rollback(selectedTask.id)} disabled={!rollbackAvailable}>Rollback</button><button onClick={()=>void recover(selectedTask.id)} disabled={!execution?.recoveryAvailable}>Recover</button></div></div>}
        {selectedTask&&proposals.some(p=>p.status==="APPROVED")&&<button className="primary" onClick={()=>void applyApproved(selectedTask.id)}>Apply approved changes</button>}
        {taskHistory&&<div className="card"><strong>Task history</strong><div className="row"><span>Attempts</span><span>{taskHistory.task.attemptCount}</span></div><div className="row"><span>Correction rounds</span><span>{taskHistory.task.correctionRounds}</span></div><div className="row"><span>Next required action</span><span>{taskHistory.task.nextRequiredAction.replaceAll("_"," ")}</span></div><div className="history-list">{taskHistory.rounds.map(round=><article key={round.id} className="mini history-round"><div className="row"><strong>Round {round.roundNumber}</strong><span>{round.roundType}</span></div><div className="row"><span>Status</span><span>{round.status}</span></div><div className="row"><span>Next action</span><span>{round.nextRequiredAction.replaceAll("_"," ")}</span></div><small>{round.summary}</small><small>{round.userMessage}</small><small>{round.proposalCount} proposals · {round.approvalRequired ? "approval required" : "no approval required"}</small>{round.recoveryAvailable&&<small>Recovery available</small>}{round.recoveryOutcome&&<small>Recovery outcome: {round.recoveryOutcome}</small>}</article>)}</div></div>}
        <h3>Pending approvals</h3>{pending.length?pending.slice(0,5).map(a=><div className="card approval" key={a.id}><strong>{a.summary}</strong><div className="row"><span className={`risk ${a.riskLevel}`}>{a.riskLevel}</span><span>{a.projectName}</span></div><div className="decision"><button onClick={()=>void decide(a.id,"APPROVED")}>Approve</button><button onClick={()=>void decide(a.id,"REJECTED")}>Reject</button></div></div>):<div className="card"><strong>No pending approvals</strong><p>Sensitive actions wait for your decision.</p></div>}
        <h3>Audit events</h3>{auditEvents.length?auditEvents.slice(0,6).map(event=><div className="mini" key={event.id}><span>{event.eventType}</span><small>{event.summary}</small></div>):<div className="card"><strong>No audit events</strong><p>Lifecycle and execution events will appear here.</p></div>}
        <h3>Recent tasks</h3>{scopedTasks.slice(0,4).map(t=><button className={`mini task-item ${t.id===selectedTask?.id?"active":""}`} key={t.id} onClick={()=>setSelectedTaskId(t.id)}><span>{t.title}</span><small>{t.status} · {t.attemptCount} attempts</small></button>)}
      </aside>
    </div>
    {dialog==="project"&&<ProjectDialog onClose={()=>setDialog(null)} onCreated={refresh}/>} {dialog==="agent"&&<AgentDialog projectId={projectId} onClose={()=>setDialog(null)} onCreated={refresh}/>} {projectLifecycleDialog&&lifecycleTarget&&<ProjectLifecycleDialog project={lifecycleTarget} action={projectLifecycleDialog} onClose={()=>{setProjectLifecycleDialog(null);setProjectLifecycleTargetId(null);}} onDone={async(message)=>{setNotice(message);if(projectLifecycleDialog==="resume"){await refresh();return;}if(lifecycleAffectsSelectedProject){await refreshAndReselectProject();return;}await refresh();}}/>}
  </main>;
}

function ProjectDialog({onClose,onCreated}:{onClose:()=>void;onCreated:()=>Promise<void>}){
  const [name,setName]=useState(""); const [rootPath,setRootPath]=useState(""); const [error,setError]=useState("");
  async function save(){const r=await fetch(`${API}/api/projects`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,rootPath})});const d=await r.json();if(!r.ok){setError(d.error);return;}await onCreated();onClose();}
  return <div className="overlay"><div className="dialog"><h2>Register local project</h2><p>The Developer Agent will be restricted to this directory.</p><label>Project name<input value={name} onChange={e=>setName(e.target.value)} placeholder="My Website"/></label><label>Windows folder path<input value={rootPath} onChange={e=>setRootPath(e.target.value)} placeholder="C:\Users\never\my-project"/></label>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={()=>void save()}>Register</button></div></div></div>
}
function AgentDialog({projectId,onClose,onCreated}:{projectId:string;onClose:()=>void;onCreated:()=>Promise<void>}){
  const [name,setName]=useState("");const [purpose,setPurpose]=useState("");const [error,setError]=useState("");
  async function save(){const r=await fetch(`${API}/api/agents`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,purpose,projectId:projectId||undefined})});const d=await r.json();if(!r.ok){setError(d.error);return;}await onCreated();onClose();}
  return <div className="overlay"><div className="dialog"><h2>Create specialist agent</h2><p>Describe what it should do. S4 creates its technical instructions and safety rules.</p><label>Agent name<input value={name} onChange={e=>setName(e.target.value)} placeholder="SEO Agent"/></label><label>What should it do?<textarea value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="Audit my websites, research keywords, and prepare recommended changes."/></label>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={()=>void save()}>Create draft</button></div></div></div>
}

function ProjectLifecycleDialog({project,action,onClose,onDone}:{project:Project;action:"pause"|"resume"|"archive"|"deregister";onClose:()=>void;onDone:(message:string)=>Promise<void>}) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const copy = {
    pause: {
      title: "Pause Project",
      description: "Pause the project to keep it available for later while removing it from the active list.",
      confirm: "Pause Project",
      endpoint: `/api/projects/${project.id}/pause`,
      success: `${project.name} was paused.`
    },
    resume: {
      title: "Resume Project",
      description: "Resume the project so it can appear in the active list again.",
      confirm: "Resume Project",
      endpoint: `/api/projects/${project.id}/resume`,
      success: `${project.name} was resumed.`
    },
    archive: {
      title: "Archive Project",
      description: "Archive the project to hide it from the active list while preserving project history.",
      confirm: "Archive Project",
      endpoint: `/api/projects/${project.id}/archive`,
      success: `${project.name} was archived.`,
      warning: "The repository folder and files will not be deleted."
    },
    deregister: {
      title: "De-register Project",
      description: "This removes the project from App Studio's active project list. It is not a file deletion action.",
      confirm: "De-register Project",
      endpoint: `/api/projects/${project.id}`,
      success: `${project.name} was de-registered.`,
      warning: "The repository folder and files will not be deleted."
    }
  }[action];
  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    const response = await fetch(`${API}${copy.endpoint}`, { method: action === "deregister" ? "DELETE" : "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? `Unable to ${action} project`);
      setBusy(false);
      return;
    }
    await onDone(copy.success);
    onClose();
  }
  return <div className="overlay"><div className="dialog"><h2>{copy.title}</h2><p>{copy.description}</p><div className="confirm-box"><strong>{project.name}</strong><small>{project.rootPath}</small></div>{copy.warning&&<p>{copy.warning}</p>}{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose} disabled={busy}>Cancel</button><button className={action==="deregister"||action==="archive"?"danger":"primary"} onClick={()=>void run()} disabled={busy}>{busy?`${copy.confirm}...`:copy.confirm}</button></div></div></div>;
}

function MediaStudio({path,navigate}:{path:string;navigate:(path:string)=>void}) {
  const selectedId = path.match(/^\/media-studio\/([^/]+)$/)?.[1];
  const [projects, setProjects] = useState<MediaProject[]>([]);
  const [providers, setProviders] = useState<MediaProvider[]>([]);
  const [routerCapabilities, setRouterCapabilities] = useState<RouterCapability[]>([]);
  const [directorStatus, setDirectorStatus] = useState<ProviderStatus>();
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>();
  const [comfyStatus, setComfyStatus] = useState<ComfyStatus>();
  const [longCatStatus, setLongCatStatus] = useState<LongCatStatus>();
  const [oviStatus, setOviStatus] = useState<LongCatStatus>();
  const [ltxStatus, setLtxStatus] = useState<LongCatStatus>();
  const [bundle, setBundle] = useState<MediaBundle>();
  const [templates, setTemplates] = useState<MediaTemplate[]>([]);
  const [dialog, setDialog] = useState<"create" | "archive" | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exportSettings,setExportSettings]=useState<ExportSettings>({preset:"16:9",resolution:"1080p",fps:30,bitrateKbps:8000,includeCaptions:true,includeLogo:true,includeDisclaimer:true,includeMusic:true});
  const [error, setError] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [selectedGenerationJobId, setSelectedGenerationJobId] = useState("");
  const [generationHistory, setGenerationHistory] = useState<MediaGenerationStatusHistory[]>([]);
  const [sceneVersions, setSceneVersions] = useState<MediaSceneVersion[]>([]);
  const [promptVersions, setPromptVersions] = useState<MediaPromptVersion[]>([]);
  const [referenceAssetIds,setReferenceAssetIds]=useState<string[]>([]);
  const [regenerationReason,setRegenerationReason]=useState("");
  const [notice, setNotice] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    const [projectData, providerData, templateData] = await Promise.all([
      fetch(`${API}/api/media/projects`).then(r => r.json()),
      fetch(`${API}/api/media/providers`).then(r => r.json()),
      fetch(`${API}/api/media/templates`).then(r => r.json())
    ]);
    setProjects(projectData.projects);
    setProviders(providerData.providers);
    setTemplates(templateData.templates ?? []);
    fetch(`${API}/api/media/provider-router`).then(r=>r.json()).then(data=>setRouterCapabilities(data.capabilities ?? [])).catch(()=>setRouterCapabilities([]));
    fetch(`${API}/api/media/director/status`).then(r=>r.json()).then(setDirectorStatus).catch(()=>setDirectorStatus(undefined));
    fetch(`${API}/api/media/ffmpeg/status`).then(r=>r.json()).then(setFfmpegStatus).catch(()=>setFfmpegStatus(undefined));
    fetch(`${API}/api/media/comfyui/status`).then(r=>r.json()).then(setComfyStatus).catch(()=>setComfyStatus(undefined));
    fetch(`${API}/api/media/longcat/status`).then(r=>r.json()).then(setLongCatStatus).catch(()=>setLongCatStatus(undefined));
    fetch(`${API}/api/media/ovi/status`).then(r=>r.json()).then(setOviStatus).catch(()=>setOviStatus(undefined));
    fetch(`${API}/api/media/ltx/status`).then(r=>r.json()).then(setLtxStatus).catch(()=>setLtxStatus(undefined));
    if (selectedId) {
      const response = await fetch(`${API}/api/media/projects/${selectedId}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Unable to load media project");
        setBundle(undefined);
      } else {
        setError("");
        setBundle(data);
        if (!selectedSceneId && data.scenes?.[0]) setSelectedSceneId(data.scenes[0].id);
      }
    } else {
      setBundle(undefined);
    }
  }

  useEffect(() => { void refresh(); }, [selectedId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: "end" }); }, [bundle?.messages.length]);
  useEffect(() => { void loadVersions(); }, [selectedId, selectedSceneId]);

  async function loadVersions() {
    if (!selectedId || !selectedSceneId) { setSceneVersions([]); setPromptVersions([]); return; }
    const [sceneResponse, promptResponse] = await Promise.all([
      fetch(`${API}/api/media/projects/${selectedId}/scenes/${selectedSceneId}/versions`),
      fetch(`${API}/api/media/projects/${selectedId}/scenes/${selectedSceneId}/prompt-versions`)
    ]);
    if (sceneResponse.ok) setSceneVersions((await sceneResponse.json()).versions ?? []);
    if (promptResponse.ok) setPromptVersions((await promptResponse.json()).versions ?? []);
  }

  async function sendMessage() {
    const value = input.trim();
    if (!selectedId || !value || busy) return;
    const replaceApproved = Boolean(bundle?.brief || bundle?.scenes.length) ? window.confirm("Replace the existing video brief and scenes?") : false;
    if ((bundle?.brief || bundle?.scenes.length) && !replaceApproved) return;
    setBusy(true); setInput(""); setError("");
    try {
      const response = await fetch(`${API}/api/media/projects/${selectedId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: value, replaceApproved }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save media chat");
      setBundle(data);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save media chat");
    } finally {
      setBusy(false);
    }
  }

  async function regeneratePlan() {
    if (!selectedId || !bundle) return;
    if (!window.confirm("Regenerate and replace the full video brief and scene list?")) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Regenerate the full video plan with improved structure, dialogue, and provider-ready prompts.", replaceApproved: true })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to regenerate plan"); return; }
    setBundle(data);
    setNotice("Video plan regenerated");
  }

  async function regenerateScene(sceneId: string) {
    if (!selectedId) return;
    if (!window.confirm("Regenerate this scene and replace its current fields?")) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Regenerate the selected scene with stronger dialogue and a provider-ready visual prompt.", replaceApproved: true, regenerateSceneId: sceneId })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to regenerate scene"); return; }
    setBundle(data);
    setNotice("Scene regenerated");
  }

  async function reloadBundle() {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load media project");
    setBundle(data);
  }

  async function saveBrief(next: MediaBrief, constraints: string[]) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/brief`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: next.title, logline: next.logline, audience: next.audience, style: next.style, durationSeconds: next.durationSeconds, constraints })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to save brief"); return; }
    setNotice("Brief saved");
    await reloadBundle();
  }

  async function approveBrief() {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/brief/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to approve brief"); return; }
    setNotice("Brief approved");
    await reloadBundle();
  }

  async function saveScene(scene: MediaScene) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: scene.title, durationSeconds: scene.durationSeconds, dialogue: scene.dialogue, visualPrompt: scene.visualPrompt, aspectRatio: scene.aspectRatio, status: scene.status })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to save scene"); return; }
    setNotice("Scene saved");
    await reloadBundle();
  }

  async function approveScene(sceneId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to approve scene"); return; }
    setNotice("Scene approved");
    await reloadBundle();
  }

  async function rejectScene(sceneId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/reject`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reject scene"); return; }
    setNotice("Scene rejected");
    await reloadBundle();
  }

  async function copyPrompt(sceneId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/flow-prompt`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to generate prompt"); return; }
    await navigator.clipboard.writeText(data.prompt);
    setNotice("Flow prompt copied");
  }

  async function exportPackage() {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/export`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to export package"); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${bundle?.project.name ?? "media-project"}-production-package.json`.replace(/[^a-z0-9._-]+/gi, "-");
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Production package exported");
  }

  async function importAsset(sceneId: string, file: File | undefined) {
    if (!selectedId || !file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      setError("Only image, video, and audio files can be imported");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/assets/upload`, {
      method: "POST",
      body: form
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to upload asset"); return; }
    setNotice("Asset uploaded");
    await reloadBundle();
  }

  async function importProjectAudio(file: File | undefined) {
    if (!selectedId || !file) return;
    if (!file.type.startsWith("audio/")) { setError("Only audio files can be uploaded as project music"); return; }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/upload?audioRole=MUSIC`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to upload project audio"); return; }
    setNotice("Project audio uploaded");
    await reloadBundle();
  }

  async function updateAudioSettings(assetId: string, settings: Partial<AudioSettings>) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}/audio`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: settings.audioRole, volume: settings.volume, trimStartSeconds: settings.trimStartSeconds, trimEndSeconds: settings.trimEndSeconds ?? undefined, fadeInSeconds: settings.fadeInSeconds, fadeOutSeconds: settings.fadeOutSeconds, muted: settings.muted })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to update audio settings"); return; }
    setNotice("Audio settings saved");
    await reloadBundle();
  }

  async function selectBackgroundMusic(assetId: string | null) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/background-music`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to select background music"); return; }
    setNotice(assetId ? "Background music selected" : "Background music cleared");
    await reloadBundle();
  }

  async function saveBrandKit(brand?: MediaBrandKit) {
    if (!selectedId) return;
    const payload = brand ? {
      name: brand.name,
      colors: parseJsonList(brand.colorsJson),
      fonts: parseJsonList(brand.fontsJson),
      tagline: brand.tagline,
      tone: brand.tone,
      disclaimer: brand.disclaimer
    } : { name: "Brand kit", colors: [], fonts: [], tagline: "", tone: "", disclaimer: "" };
    const response = await fetch(`${API}/api/media/projects/${selectedId}/brand-kits${brand ? `/${brand.id}` : ""}`, { method: brand ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to save brand kit"); return; }
    setNotice("Brand kit saved");
    await reloadBundle();
  }

  async function savePresenterProfile(profile?: MediaPresenterProfile) {
    if (!selectedId) return;
    const payload = profile ? {
      name: profile.name,
      appearancePrompt: profile.appearancePrompt,
      voiceAccent: profile.voiceAccent,
      clothing: profile.clothing,
      consistencyRules: profile.consistencyRules
    } : { name: "Presenter", appearancePrompt: "", voiceAccent: "", clothing: "", consistencyRules: "" };
    const response = await fetch(`${API}/api/media/projects/${selectedId}/presenter-profiles${profile ? `/${profile.id}` : ""}`, { method: profile ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to save presenter profile"); return; }
    setNotice("Presenter profile saved");
    await reloadBundle();
  }

  async function selectLibraryDefaults(brandKitId: string | null | undefined, presenterProfileId: string | null | undefined) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/library-defaults`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandKitId, presenterProfileId }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to select media defaults"); return; }
    setNotice("Media defaults updated");
    await reloadBundle();
  }

  async function uploadLibraryImage(path: string, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Only image files can be uploaded to the library"); return; }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(path, { method: path.includes("/library-assets/") ? "PUT" : "POST", body: form });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to upload library image"); return; }
    setNotice("Library image uploaded");
    await reloadBundle();
  }

  async function deleteLibraryAsset(assetId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/library-assets/${assetId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to delete library image"); return; }
    setNotice("Library image deleted");
    await reloadBundle();
  }

  async function duplicateTemplate(templateId: string) {
    const response = await fetch(`${API}/api/media/templates/${templateId}/duplicate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to duplicate template"); return; }
    setNotice("Template duplicated");
    await refresh();
  }

  async function archiveTemplate(templateId: string) {
    const response = await fetch(`${API}/api/media/templates/${templateId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to archive template"); return; }
    setNotice("Template archived");
    await refresh();
  }

  async function createProjectFromTemplate(template: MediaTemplate) {
    const name = window.prompt("Project name", `${template.name} Project`);
    if (!name) return;
    const response = await fetch(`${API}/api/media/templates/${template.id}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: template.description }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to create project from template"); return; }
    await refresh();
    navigate(`/media-studio/${data.project.id}`);
  }

  async function applyTemplate(template: MediaTemplate) {
    if (!selectedId) return;
    if (!window.confirm(`Apply ${template.name} to this project? Existing assets are preserved unless you choose replacement.`)) return;
    const replaceAssets = window.confirm("Replace existing scene assets with template placeholders?");
    const response = await fetch(`${API}/api/media/projects/${selectedId}/templates/${template.id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true, replaceAssets }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to apply template"); return; }
    setBundle(data);
    setNotice("Template applied");
    await refresh();
  }

  async function replaceAsset(sceneId: string, assetId: string, file: File | undefined) {
    if (!selectedId || !file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      setError("Only image, video, and audio files can replace an asset");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/assets/${assetId}`, {
      method: "PUT",
      body: form
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to replace asset"); return; }
    setNotice("Asset replaced");
    await reloadBundle();
  }

  async function deleteAsset(sceneId: string, assetId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/assets/${assetId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to delete asset"); return; }
    setNotice("Asset deleted");
    await reloadBundle();
  }

  async function reorderScenes(sceneId: string, direction: -1 | 1) {
    if (!selectedId || !bundle) return;
    const index = bundle.scenes.findIndex(scene=>scene.id===sceneId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= bundle.scenes.length) return;
    const sceneIds = bundle.scenes.map(scene=>scene.id);
    [sceneIds[index], sceneIds[nextIndex]] = [sceneIds[nextIndex], sceneIds[index]];
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/reorder`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneIds }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reorder scenes"); return; }
    setNotice("Scene order saved");
    await reloadBundle();
  }

  async function renderDraft() {
    if (!selectedId || rendering) return;
    setRendering(true); setError("");
    const response = await fetch(`${API}/api/media/projects/${selectedId}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ includeLogo: true }) });
    const data = await response.json();
    setRendering(false);
    if (!response.ok) { setError(data.error ?? "Unable to render draft"); return; }
    setBundle(data.bundle);
    setNotice("Draft render completed");
  }

  async function renderFinalExport() {
    if (!selectedId || rendering) return;
    setRendering(true); setError("");
    const preflight = await fetch(`${API}/api/media/projects/${selectedId}/exports/preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exportSettings) });
    const preflightData = await preflight.json();
    if (!preflight.ok) { setRendering(false); setError(preflightData.error ?? "Export preflight failed"); return; }
    const response = await fetch(`${API}/api/media/projects/${selectedId}/exports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exportSettings) });
    const data = await response.json();
    setRendering(false);
    if (!response.ok) { setError(data.error ?? "Unable to render final export"); return; }
    setBundle(data.bundle);
    setNotice("Final export completed");
  }

  async function retryExport(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/render-jobs/${jobId}/retry-export`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to retry export"); return; }
    setBundle(data.bundle);
    setNotice("Export retried");
  }

  async function renameAsset(assetId: string) {
    if (!selectedId) return;
    const label = window.prompt("Export name");
    if (!label) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to rename export"); return; }
    await reloadBundle();
  }

  async function deleteProjectAsset(assetId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to delete export"); return; }
    await reloadBundle();
  }

  async function approveAsset(assetId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to approve asset"); return; }
    setBundle(data.bundle);
    setNotice("Generated asset approved");
  }

  async function rejectAsset(assetId: string, feedback: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feedback }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reject asset"); return; }
    setBundle(data.bundle);
    setNotice("Generated asset rejected");
  }

  async function regenerateAsset(assetId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/assets/${assetId}/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "I2V", approved: true, referenceAssetIds, regenerationReason }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to regenerate asset"); return; }
    setSelectedGenerationJobId(data.job.id);
    setNotice("Asset variation queued");
    startGenerationPolling(data.job.id);
  }

  async function restoreSceneVersion(versionId: string) {
    if (!selectedId || !selectedSceneId) return;
    if (!window.confirm("Restore this historical scene version? This creates a new current version.")) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${selectedSceneId}/versions/${versionId}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true, changeSummary: "Restored from history" }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to restore scene version"); return; }
    setBundle(data.bundle);
    setSceneVersions(data.versions ?? []);
    setNotice("Scene version restored");
  }

  async function reusePromptVersion(versionId: string) {
    if (!selectedId || !selectedSceneId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${selectedSceneId}/prompt-versions/${versionId}/reuse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reuse prompt version"); return; }
    setSelectedGenerationJobId(data.job.id);
    setNotice("Generation queued from prompt version");
    await reloadBundle();
    await loadVersions();
  }

  async function cancelRender(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/render-jobs/${jobId}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to cancel render"); return; }
    setNotice("Render cancelled");
    await reloadBundle();
  }

  async function testComfy() {
    const response = await fetch(`${API}/api/media/comfyui/test`, { method: "POST" });
    const data = await response.json();
    setComfyStatus(data);
  }

  async function testDirectorProvider() {
    const response = await fetch(`${API}/api/media/director/test`, { method: "POST" });
    const data = await response.json();
    setDirectorStatus(data);
  }

  async function testLongCat() {
    const response = await fetch(`${API}/api/media/longcat/test`, { method: "POST" });
    const data = await response.json();
    setLongCatStatus(data);
  }

  async function testOvi() {
    const response = await fetch(`${API}/api/media/ovi/test`, { method: "POST" });
    const data = await response.json();
    setOviStatus(data);
  }

  async function testLtx() {
    const response = await fetch(`${API}/api/media/ltx/test`, { method: "POST" });
    const data = await response.json();
    setLtxStatus(data);
  }

  async function generateWan(sceneId: string, mode: "text-to-video" | "image-to-video") {
    if (!selectedId) return;
    const task = mode === "image-to-video" ? "I2V" : "T2V";
    setError(""); setNotice("Provider routing started");
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, providerKey: "wan-2.2", approved: true, maxAttempts: 1, referenceAssetIds, regenerationReason })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to route media generation"); return; }
    setBundle(data.bundle);
    setNotice(`Generation queued: ${data.job?.status ?? "QUEUED"}`);
    if (data.job?.id) startGenerationPolling(data.job.id);
  }

  async function generatePresenter(sceneId: string) {
    if (!selectedId) return;
    setError(""); setNotice("Presenter routing started");
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "PRESENTER", approved: true, paidProviderApproved: true, maxAttempts: 2, referenceAssetIds, regenerationReason })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to route presenter generation"); return; }
    setBundle(data.bundle);
    setNotice(`Presenter generation queued: ${data.job?.status ?? "QUEUED"}`);
    if (data.job?.id) startGenerationPolling(data.job.id);
  }

  async function generateAudioVideo(sceneId: string) {
    if (!selectedId) return;
    setError(""); setNotice("Audio video routing started");
    const response = await fetch(`${API}/api/media/projects/${selectedId}/scenes/${sceneId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "AUDIO_VIDEO", approved: true, paidProviderApproved: true, maxAttempts: 3, referenceAssetIds, regenerationReason })
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to route audio video generation"); return; }
    setBundle(data.bundle);
    setNotice(`Audio video generation queued: ${data.job?.status ?? "QUEUED"}`);
    if (data.job?.id) startGenerationPolling(data.job.id);
  }

  async function cancelGeneration(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to cancel generation"); return; }
    setNotice("Generation cancelled");
    await reloadBundle();
  }

  async function retryGeneration(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to retry generation"); return; }
    setBundle(data.bundle);
    setNotice("Generation retried");
    if (data.job?.id) startGenerationPolling(data.job.id);
  }

  async function loadGenerationHistory(jobId: string) {
    if (!selectedId) return;
    setSelectedGenerationJobId(jobId);
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/status-history`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to load generation timeline"); return; }
    setGenerationHistory(data.history ?? []);
  }

  function startGenerationPolling(jobId: string) {
    setSelectedGenerationJobId(jobId);
    void pollGenerationJob(jobId);
  }

  async function pollGenerationJob(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to poll generation job"); return; }
    await loadGenerationHistory(jobId);
    await reloadBundle();
    if (!["COMPLETED","FAILED","CANCELLED","WAITING_FOR_USER","IMPORTED"].includes(data.job.status)) {
      window.setTimeout(()=>void pollGenerationJob(jobId), 1500);
    }
  }

  async function markFlowGenerated(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/flow-generated`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to mark Flow job generated"); return; }
    setNotice("Flow job marked generated");
    await reloadBundle();
  }

  async function rejectFlow(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "Rejected in Media Studio" }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reject Flow job"); return; }
    setNotice("Flow job rejected");
    await reloadBundle();
  }

  async function fallbackFlowToWan(jobId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/fallback-wan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to fallback to Wan"); return; }
    setBundle(data.bundle);
    setNotice("Fallback to Wan completed");
  }

  async function importFlowAsset(jobId: string, file: File | undefined) {
    if (!selectedId || !file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API}/api/media/projects/${selectedId}/generation-jobs/${jobId}/import-flow`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to import Flow output"); return; }
    setBundle(data.bundle);
    setNotice("Flow output imported");
  }

  async function copyFlowPrompt(job: MediaGenerationJob) {
    const flowPackage = parseFlowPackage(job.resultJson);
    if (!flowPackage) { setError("Flow package is unavailable"); return; }
    await navigator.clipboard.writeText(flowPackage.prompt);
    setNotice("Flow prompt copied");
  }

  function exportFlowPackage(job: MediaGenerationJob) {
    const flowPackage = parseFlowPackage(job.resultJson);
    if (!flowPackage) { setError("Flow package is unavailable"); return; }
    const blob = new Blob([JSON.stringify(flowPackage, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${flowPackage.scene.title}-flow-package.json`.replace(/[^a-z0-9._-]+/gi, "-");
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Flow package exported");
  }

  async function importWorkflow(payload: { name: string; workflowType: "WAN_T2V" | "WAN_I2V"; workflowJson: unknown; mapping: WorkflowMapping; activate: boolean }) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/comfy-workflows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to import workflow"); return; }
    setNotice("Workflow imported");
    await reloadBundle();
  }

  async function updateWorkflow(workflowId: string, payload: { name: string; workflowJson: unknown; mapping: WorkflowMapping; activate: boolean }) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/comfy-workflows/${workflowId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to update workflow"); return; }
    setNotice("Workflow version saved");
    await reloadBundle();
  }

  async function activateWorkflow(workflowId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/comfy-workflows/${workflowId}/activate`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to activate workflow"); return; }
    setNotice("Workflow activated");
    await reloadBundle();
  }

  async function deleteWorkflow(workflowId: string) {
    if (!selectedId) return;
    const response = await fetch(`${API}/api/media/projects/${selectedId}/comfy-workflows/${workflowId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to delete workflow"); return; }
    setNotice("Workflow deleted");
    await reloadBundle();
  }

  async function previewWorkflow(payload: { workflowId?: string; workflowType?: "WAN_T2V" | "WAN_I2V"; sceneId: string; fps?: number; seed?: number }) {
    if (!selectedId) return "";
    const response = await fetch(`${API}/api/media/projects/${selectedId}/comfy-workflows/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to preview workflow"); return ""; }
    return JSON.stringify(data.compiledWorkflow, null, 2);
  }

  const selectedScene = bundle?.scenes.find(scene => scene.id === selectedSceneId) ?? bundle?.scenes[0];

  return <main className="app-shell media-shell">
    <header className="topbar"><div><h1>App Studio</h1><p>Shrinika Automation Studio</p></div><div className="top-actions"><button className="top-link" onClick={()=>navigate("/")}>Developer Studio</button><span className="status-dot"/> Local API connected</div></header>
    <div className="workspace-grid media-grid">
      <aside className="sidebar">
        <button className="primary" onClick={()=>setDialog("create")}>+ New media project</button>
        <h3>Projects</h3>
        {projects.length ? projects.map(project => <button key={project.id} className={`nav ${project.id===selectedId?"active":""}`} onClick={()=>navigate(`/media-studio/${project.id}`)}><span>{project.name}</span><small>{project.status}</small></button>) : <p className="muted">No media projects yet.</p>}
        <h3>Provider stubs</h3>
        {providers.map(provider => <div className="provider-box media-provider" key={provider.key}><strong>{provider.name}</strong><small>{provider.capabilities.join(", ")}</small><span className="risk medium">{provider.status}</span></div>)}
        <h3>Provider router</h3>
        {routerCapabilities.length ? routerCapabilities.map(provider => <div className="provider-box media-provider" key={provider.key}><strong>{provider.name}</strong><small>{provider.supports.join(", ")} · priority {provider.priority}</small><small>{provider.reason}</small><span className={`risk ${provider.enabled&&provider.healthy?"low":provider.enabled?"medium":"critical"}`}>{provider.mode} · {provider.enabled?"enabled":"disabled"}</span></div>) : <div className="provider-box media-provider"><strong>Checking</strong><small>Router status pending</small></div>}
        <h3>Video Director AI</h3>
        {directorStatus?<div className="provider-box media-provider"><strong>{directorStatus.configured?"Configured":"Fallback"}</strong><small>{directorStatus.provider} · {directorStatus.model || "deterministic"}</small><small>{directorStatus.baseUrlHostname}</small><span className={`risk ${directorStatus.status==="ok"?"low":directorStatus.status==="error"?"critical":"medium"}`}>{directorStatus.status}</span>{directorStatus.sanitizedError&&<p className="error">{directorStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testDirectorProvider()}>Test NVIDIA</button></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>Director provider status pending</small></div>}
        <h3>FFmpeg</h3>
        {ffmpegStatus?<div className="provider-box media-provider"><strong>{ffmpegStatus.available?"Available":"Unavailable"}</strong><small>{ffmpegStatus.ffmpegPath}</small><small>{ffmpegStatus.ffprobePath}</small><span className={`risk ${ffmpegStatus.available?"low":"medium"}`}>{ffmpegStatus.available?"ready":"uploads still work"}</span></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>Media processing status pending</small></div>}
        <h3>ComfyUI</h3>
        {comfyStatus?<div className="provider-box media-provider"><strong>{comfyStatus.enabled?"Enabled":"Disabled"}</strong><small>{comfyStatus.baseUrlHostname}</small><small>{comfyStatus.timeoutMs} ms timeout</small><span className={`risk ${comfyStatus.status==="ok"?"low":comfyStatus.status==="error"?"critical":"medium"}`}>{comfyStatus.status ?? "configured"}</span>{comfyStatus.sanitizedError&&<p className="error">{comfyStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testComfy()}>Test ComfyUI</button></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>ComfyUI status pending</small></div>}
        <h3>LongCat</h3>
        {longCatStatus?<div className="provider-box media-provider"><strong>{longCatStatus.enabled?"Enabled":"Disabled"}</strong><small>{longCatStatus.baseUrlHostname}</small><small>{longCatStatus.timeoutMs} ms timeout</small><span className={`risk ${longCatStatus.status==="ok"?"low":longCatStatus.status==="error"?"critical":"medium"}`}>{longCatStatus.status ?? "configured"}</span>{longCatStatus.sanitizedError&&<p className="error">{longCatStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testLongCat()}>Test LongCat</button></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>LongCat status pending</small></div>}
        <h3>Ovi</h3>
        {oviStatus?<div className="provider-box media-provider"><strong>{oviStatus.enabled?"Enabled":"Disabled"}</strong><small>{oviStatus.baseUrlHostname}</small><small>{oviStatus.timeoutMs} ms timeout</small><span className={`risk ${oviStatus.status==="ok"?"low":oviStatus.status==="error"?"critical":"medium"}`}>{oviStatus.status ?? "configured"}</span>{oviStatus.sanitizedError&&<p className="error">{oviStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testOvi()}>Test Ovi</button></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>Ovi status pending</small></div>}
        <h3>LTX</h3>
        {ltxStatus?<div className="provider-box media-provider"><strong>{ltxStatus.enabled?"Enabled":"Disabled"}</strong><small>{ltxStatus.baseUrlHostname}</small><small>{ltxStatus.timeoutMs} ms timeout</small><span className={`risk ${ltxStatus.status==="ok"?"low":ltxStatus.status==="error"?"critical":"medium"}`}>{ltxStatus.status ?? "configured"}</span>{ltxStatus.sanitizedError&&<p className="error">{ltxStatus.sanitizedError}</p>}<button className="secondary" onClick={()=>void testLtx()}>Test LTX</button></div>:<div className="provider-box media-provider"><strong>Checking</strong><small>LTX status pending</small></div>}
      </aside>
      {selectedId && bundle ? <section className="chat-panel">
        <div className="chat-header"><div><h2>{bundle.project.name}</h2><p>{bundle.project.description || "Director chat generates NVIDIA-backed briefs with deterministic fallback."}</p></div><div className="header-actions"><button className="secondary compact" onClick={()=>void regeneratePlan()}>Regenerate</button><button className="secondary compact" onClick={()=>void exportPackage()}>Export JSON</button><button className="secondary compact" onClick={()=>setDialog("archive")}>Archive</button></div></div>
        <div className="messages">
          {bundle.messages.length ? bundle.messages.map(message => <article key={message.id} className={`message ${message.sender==="user"?"user":"agent"}`}><strong>{message.sender==="user"?"You":"Video Director"}</strong><p>{message.content}</p></article>) : <article className="message agent"><strong>Video Director</strong><p>Describe the video you want. I will draft a brief and scene plan without calling external AI or rendering anything.</p></article>}
          <div ref={messagesEndRef}/>
        </div>
        <div className="composer"><textarea value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();void sendMessage();}}} placeholder="Describe the video brief, audience, tone, length, assets, or scenes..."/><button className="primary send" onClick={()=>void sendMessage()} disabled={busy}>{busy?"Saving...":"Send"}</button></div>
      </section> : <section className="chat-panel empty-state"><div><h2>Media projects</h2><p>Create or select a project to open the Video Director chat.</p></div></section>}
      <aside className="activity">
        {error&&<p className="error">{error}</p>}
        {notice&&<p className="success">{notice}</p>}
        <h3>Video brief</h3>
        {bundle?.brief ? <BriefEditor brief={bundle.brief} onSave={saveBrief} onApprove={approveBrief}/> : <div className="card"><strong>No brief yet</strong><p>Send a director chat message to create the first deterministic sample brief.</p></div>}
        <h3>ComfyUI workflows</h3>
        {bundle&&selectedScene?<ComfyWorkflowPanel workflows={bundle.comfyWorkflows ?? []} sceneId={selectedScene.id} onImport={importWorkflow} onUpdate={updateWorkflow} onActivate={activateWorkflow} onDelete={deleteWorkflow} onPreview={previewWorkflow}/>:<div className="card"><strong>No scene selected</strong><p>Select a scene before previewing compiled workflows.</p></div>}
        <h3>Render</h3>
        {bundle&&<RenderPanel projectId={selectedId ?? ""} scenes={bundle.scenes} assets={bundle.assets} jobs={bundle.renderJobs ?? []} settings={exportSettings} onSettings={setExportSettings} onRender={renderDraft} onExport={renderFinalExport} onCancel={cancelRender} onRetryExport={retryExport} onRenameAsset={renameAsset} onDeleteAsset={deleteProjectAsset} rendering={rendering}/>}
        <h3>Scenes</h3>
        {bundle?.scenes.length ? <div className="scene-list">{bundle.scenes.map((scene,index) => <div key={scene.id} className={`scene-tab ${scene.id===selectedScene?.id?"active":""}`}><button onClick={()=>setSelectedSceneId(scene.id)}><span>{scene.position}. {scene.title}</span><small>{scene.status}</small></button><div className="scene-order"><button onClick={()=>void reorderScenes(scene.id,-1)} disabled={index===0}>Up</button><button onClick={()=>void reorderScenes(scene.id,1)} disabled={index===bundle.scenes.length-1}>Down</button></div></div>)}</div> : <div className="card"><strong>No scenes</strong><p>Scene cards will appear after the first chat.</p></div>}
        {selectedId&&selectedScene&&<ReferencePicker assets={bundle?.assets ?? []} selectedIds={referenceAssetIds} reason={regenerationReason} onSelectedIds={setReferenceAssetIds} onReason={setRegenerationReason}/>}
        {selectedId&&selectedScene&&<SceneEditor projectId={selectedId} scene={selectedScene} assets={bundle?.assets.filter(asset=>asset.sceneId===selectedScene.id) ?? []} onSave={saveScene} onApprove={approveScene} onReject={rejectScene} onCopyPrompt={copyPrompt} onRegenerateScene={regenerateScene} onGenerateWan={generateWan} onGeneratePresenter={generatePresenter} onGenerateAudioVideo={generateAudioVideo} onImportAsset={importAsset} onReplaceAsset={replaceAsset} onDeleteAsset={deleteAsset} onUpdateAudio={updateAudioSettings} onSelectBackgroundMusic={selectBackgroundMusic} onApproveAsset={approveAsset} onRejectAsset={rejectAsset} onRegenerateAsset={regenerateAsset}/>}
        {selectedScene&&<VersionHistoryPanel sceneVersions={sceneVersions} promptVersions={promptVersions} onRestoreScene={restoreSceneVersion} onReusePrompt={reusePromptVersion}/>}
        <TemplatePanel templates={templates} hasProject={Boolean(selectedId)} onDuplicate={duplicateTemplate} onArchive={archiveTemplate} onCreateProject={createProjectFromTemplate} onApply={applyTemplate}/>
        {selectedId&&bundle&&<BrandPresenterPanel projectId={selectedId} bundle={bundle} onSaveBrand={saveBrandKit} onSavePresenter={savePresenterProfile} onSelectDefaults={selectLibraryDefaults} onUploadLibraryImage={uploadLibraryImage} onDeleteLibraryAsset={deleteLibraryAsset}/>}
        <h3>Assets</h3>
        {bundle&&<div className="mini"><span>Project music</span><label className="replace-button">Upload<input type="file" accept="audio/*" onChange={event=>void importProjectAudio(event.target.files?.[0])}/></label><button onClick={()=>void selectBackgroundMusic(null)}>Clear music</button></div>}
        {bundle?.assets.length ? bundle.assets.map(asset => <div className="mini" key={asset.id}><span>{asset.label}</span><small>{asset.mimeType ?? asset.status}</small>{asset.kind==="audio"&&<div className="decision wrap"><button onClick={()=>void selectBackgroundMusic(asset.id)}>Use as music</button></div>}</div>) : <div className="mini"><span>No planned assets</span><small>Waiting</small></div>}
        <h3>Generation jobs</h3>
        {bundle?.generationJobs.length ? bundle.generationJobs.map(job => {
          const routing=parseRouting(job.resultJson);
          const flow=parseFlowPackage(job.resultJson);
          const selected=selectedGenerationJobId===job.id;
          return <div className="mini" key={job.id}><span>{job.providerKey}</span><small>{job.status}</small>{routing&&<small>Route: {routing.selectedProvider} · {routing.reason}</small>}{job.providerKey==="google-flow"&&flow&&<small>{flow.scene.aspectRatio} · {flow.scene.durationSeconds}s</small>}<div className="decision wrap"><button onClick={()=>void loadGenerationHistory(job.id)}>{selected?"Refresh timeline":"Timeline"}</button></div>{selected&&generationHistory.length>0&&<ol className="status-timeline">{generationHistory.map(entry=><li key={entry.id}><small>{entry.status}{entry.progressPercent!==null?` · ${entry.progressPercent}%`:""}{entry.providerStatus?` · ${entry.providerStatus}`:""}</small>{entry.message&&<span>{entry.message}</span>}</li>)}</ol>}{job.providerKey==="google-flow"&&<div className="decision wrap"><button onClick={()=>void copyFlowPrompt(job)}>Copy prompt</button><button onClick={()=>exportFlowPackage(job)}>Export package</button><a className="button-link" href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Open Flow</a><button onClick={()=>void markFlowGenerated(job.id)} disabled={!["WAITING_FOR_USER","GENERATED"].includes(job.status)}>Generated</button><label className="replace-button">Import<input type="file" accept="image/*,video/*" onChange={event=>void importFlowAsset(job.id,event.target.files?.[0])}/></label><button onClick={()=>void rejectFlow(job.id)} disabled={["IMPORTED","FAILED","CANCELLED"].includes(job.status)}>Reject</button><button onClick={()=>void fallbackFlowToWan(job.id)} disabled={["IMPORTED","CANCELLED"].includes(job.status)}>Fallback Wan</button></div>}{["wan-2.2","longcat-avatar","ovi","ltx"].includes(job.providerKey)&&<div className="decision wrap"><button onClick={()=>void cancelGeneration(job.id)} disabled={["COMPLETED","FAILED","CANCELLED"].includes(job.status)}>Cancel</button><button onClick={()=>void retryGeneration(job.id)} disabled={!["FAILED","CANCELLED"].includes(job.status)}>Retry</button></div>}</div>;
        }) : <div className="mini"><span>Provider stubs</span><small>Not seeded</small></div>}
      </aside>
    </div>
    {dialog==="create"&&<MediaProjectDialog onClose={()=>setDialog(null)} onCreated={async(project)=>{await refresh();navigate(`/media-studio/${project.id}`);}}/>}
    {dialog==="archive"&&bundle&&<ArchiveMediaProjectDialog project={bundle.project} onClose={()=>setDialog(null)} onDone={async()=>{setDialog(null);navigate("/media-studio");await refresh();}}/>}
  </main>;
}

function MediaProjectDialog({onClose,onCreated}:{onClose:()=>void;onCreated:(project:MediaProject)=>Promise<void>}) {
  const [name,setName]=useState("");
  const [description,setDescription]=useState("");
  const [error,setError]=useState("");
  async function save() {
    const response = await fetch(`${API}/api/media/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to create media project"); return; }
    await onCreated(data.project); onClose();
  }
  return <div className="overlay"><div className="dialog"><h2>New media project</h2><p>Create a local planning workspace for a video idea.</p><label>Project name<input value={name} onChange={event=>setName(event.target.value)} placeholder="Launch explainer"/></label><label>Description<textarea value={description} onChange={event=>setDescription(event.target.value)} placeholder="Audience, channel, goal, or source material."/></label>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={()=>void save()}>Create</button></div></div></div>;
}

function ArchiveMediaProjectDialog({project,onClose,onDone}:{project:MediaProject;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [error,setError]=useState("");
  async function archiveProject() {
    const response = await fetch(`${API}/api/media/projects/${project.id}`, { method: "DELETE" });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) { setError(data.error ?? "Unable to archive media project"); return; }
    await onDone();
  }
  return <div className="overlay"><div className="dialog"><h2>Archive media project</h2><p>This hides the media project from the active list while keeping chat, brief, scene, asset, job, and audit history.</p><div className="confirm-box"><strong>{project.name}</strong><small>{project.description || "No description"}</small></div>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="danger" onClick={()=>void archiveProject()}>Archive</button></div></div></div>;
}

function BriefEditor({brief,onSave,onApprove}:{brief:MediaBrief;onSave:(brief:MediaBrief,constraints:string[])=>Promise<void>;onApprove:()=>Promise<void>}) {
  const [draft,setDraft]=useState(brief);
  const [constraints,setConstraints]=useState(parseJsonList(brief.constraintsJson).join("\n"));
  useEffect(()=>{setDraft(brief);setConstraints(parseJsonList(brief.constraintsJson).join("\n"));},[brief]);
  return <div className="card editor-card"><div className="row first-row"><strong>Brief</strong><span className={`scene-status ${brief.status.toLowerCase()}`}>{brief.status}</span></div><label>Title<input value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>Logline<textarea value={draft.logline} onChange={event=>setDraft({...draft,logline:event.target.value})}/></label><div className="split-fields"><label>Audience<input value={draft.audience} onChange={event=>setDraft({...draft,audience:event.target.value})}/></label><label>Style<input value={draft.style} onChange={event=>setDraft({...draft,style:event.target.value})}/></label></div><label>Duration seconds<input type="number" min="1" value={draft.durationSeconds} onChange={event=>setDraft({...draft,durationSeconds:Number(event.target.value)})}/></label><label>Constraints<textarea value={constraints} onChange={event=>setConstraints(event.target.value)}/></label><div className="decision"><button onClick={()=>void onSave(draft,constraints.split("\n").map(item=>item.trim()).filter(Boolean))}>Save brief</button><button onClick={()=>void onApprove()} disabled={brief.status==="APPROVED"}>Approve brief</button></div></div>;
}

function VersionHistoryPanel({sceneVersions,promptVersions,onRestoreScene,onReusePrompt}:{sceneVersions:MediaSceneVersion[];promptVersions:MediaPromptVersion[];onRestoreScene:(versionId:string)=>Promise<void>;onReusePrompt:(versionId:string)=>Promise<void>}) {
  const [preview,setPreview]=useState<{title:string;body:string}|null>(null);
  return <div className="card version-panel"><div className="row first-row"><strong>Versions</strong><small>{sceneVersions.length} scene / {promptVersions.length} prompt</small></div><div className="version-list">{sceneVersions.slice(0,5).map(version=><div className="mini" key={version.id}><span>Scene v{version.versionNumber}: {version.title}</span><small>{version.createdAt} | {version.createdBy} | {version.changeSummary ?? "No summary"}</small><div className="decision wrap"><button onClick={()=>setPreview({title:`Scene v${version.versionNumber}`,body:[version.title,version.scriptText,version.visualDescription].filter(Boolean).join("\n\n")})}>Preview</button><button onClick={()=>void onRestoreScene(version.id)}>Restore Scene</button></div></div>)}</div><div className="version-list">{promptVersions.slice(0,5).map(version=><div className="mini" key={version.id}><span>Prompt v{version.versionNumber}: {version.providerKey} {version.taskType}</span><small>{version.createdAt} | {version.createdBy}</small><div className="decision wrap"><button onClick={()=>setPreview({title:`Prompt v${version.versionNumber}`,body:version.positivePrompt})}>Preview</button><button onClick={()=>void onReusePrompt(version.id)}>Reuse Prompt</button></div></div>)}</div>{preview&&<div className="version-preview"><div className="row first-row"><strong>{preview.title}</strong><button onClick={()=>setPreview(null)}>Close</button></div><pre>{preview.body}</pre></div>}</div>;
}

function ReferencePicker({assets,selectedIds,reason,onSelectedIds,onReason}:{assets:MediaAsset[];selectedIds:string[];reason:string;onSelectedIds:(ids:string[])=>void;onReason:(reason:string)=>void}) {
  const candidates = assets.filter(asset=>asset.localPath && asset.qcStatus!=="FAILED" && (asset.mimeType?.startsWith("image/") || asset.mimeType?.startsWith("video/") || asset.mimeType?.startsWith("audio/")));
  const selected = new Set(selectedIds);
  function toggle(assetId: string) {
    onSelectedIds(selected.has(assetId) ? selectedIds.filter(id=>id!==assetId) : [...selectedIds, assetId]);
  }
  return <div className="card reference-picker"><div className="row first-row"><strong>Generation references</strong><button onClick={()=>onSelectedIds([])} disabled={!selectedIds.length}>Clear</button></div><label>Regeneration feedback<input value={reason} maxLength={500} onChange={event=>onReason(event.target.value)} placeholder="preserve character, change background, extend motion"/></label><div className="reference-list">{candidates.slice(0,12).map(asset=><label key={asset.id} className="checkbox-row"><input type="checkbox" checked={selected.has(asset.id)} onChange={()=>toggle(asset.id)}/><span>{asset.label}</span><small>{asset.mimeType} {isGeneratedAsset(asset)?`| ${asset.approvalStatus ?? "PENDING"}`:""}</small></label>)}</div>{selectedIds.length?<small>Selected: {selectedIds.length}</small>:<small>No references selected</small>}</div>;
}

function RenderPanel({projectId,scenes,assets,jobs,settings,onSettings,onRender,onExport,onCancel,onRetryExport,onRenameAsset,onDeleteAsset,rendering}:{projectId:string;scenes:MediaScene[];assets:MediaAsset[];jobs:MediaRenderJob[];settings:ExportSettings;onSettings:(settings:ExportSettings)=>void;onRender:()=>Promise<void>;onExport:()=>Promise<void>;onCancel:(jobId:string)=>Promise<void>;onRetryExport:(jobId:string)=>Promise<void>;onRenameAsset:(assetId:string)=>Promise<void>;onDeleteAsset:(assetId:string)=>Promise<void>;rendering:boolean}) {
  const latest = jobs[0];
  const finalJobs = jobs.filter(job=>parseRenderMode(job.requestJson)==="FINAL_EXPORT");
  const blockers = scenes.flatMap(scene => {
    const asset = assets.find(candidate=>candidate.sceneId===scene.id && ["image","video"].includes(candidate.kind) && candidate.localPath);
    if (!asset || !isGeneratedAsset(asset) || asset.approvalStatus==="APPROVED") return [];
    return [`${scene.title}: ${asset.label} is ${asset.approvalStatus ?? "PENDING"}`];
  });
  return <div className="card render-card"><div className="decision wrap"><button className="primary" onClick={()=>void onRender()} disabled={rendering}>{rendering?"Rendering...":"Render Draft MP4"}</button><button className="primary" onClick={()=>void onExport()} disabled={rendering || blockers.length>0}>{rendering?"Exporting...":"Final Export"}</button></div>{blockers.length?<div className="approval-blockers"><strong>Export blocked</strong>{blockers.map(blocker=><small key={blocker}>{blocker}</small>)}</div>:null}<div className="split-fields"><label>Preset<select value={settings.preset} onChange={event=>onSettings({...settings,preset:event.target.value as ExportSettings["preset"]})}><option>16:9</option><option>9:16</option><option>1:1</option></select></label><label>Resolution<select value={settings.resolution} onChange={event=>onSettings({...settings,resolution:event.target.value as ExportSettings["resolution"]})}><option>1080p</option><option>720p</option></select></label><label>FPS<input type="number" min="12" max="60" value={settings.fps} onChange={event=>onSettings({...settings,fps:Number(event.target.value)})}/></label><label>Bitrate<input type="number" min="500" max="50000" value={settings.bitrateKbps} onChange={event=>onSettings({...settings,bitrateKbps:Number(event.target.value)})}/></label></div><div className="decision wrap"><label><input type="checkbox" checked={settings.includeCaptions} onChange={event=>onSettings({...settings,includeCaptions:event.target.checked})}/> Captions</label><label><input type="checkbox" checked={settings.includeLogo} onChange={event=>onSettings({...settings,includeLogo:event.target.checked})}/> Logo</label><label><input type="checkbox" checked={settings.includeDisclaimer} onChange={event=>onSettings({...settings,includeDisclaimer:event.target.checked})}/> Disclaimer</label><label><input type="checkbox" checked={settings.includeMusic} onChange={event=>onSettings({...settings,includeMusic:event.target.checked})}/> Music</label></div>{latest?<div className="render-job"><div className="row"><strong>{parseRenderMode(latest.requestJson)==="FINAL_EXPORT"?"Export":"Draft"} {latest.status}</strong><span>{latest.progress}%</span></div><div className="progress-bar"><span style={{width:`${latest.progress}%`}}/></div>{latest.error&&<p className="error">{latest.error}</p>}{latest.status==="RUNNING"||latest.status==="QUEUED"?<button onClick={()=>void onCancel(latest.id)}>Cancel</button>:null}{latest.status==="FAILED"&&parseRenderMode(latest.requestJson)==="FINAL_EXPORT"?<button onClick={()=>void onRetryExport(latest.id)}>Retry export</button>:null}{latest.logText&&<pre>{latest.logText}</pre>}</div>:<p>Approved scenes with passing assets can be rendered into local draft or final export videos.</p>}<div className="workflow-list">{finalJobs.map(job=>{ const asset=assets.find(item=>item.id===job.outputAssetId); return <div className="mini" key={job.id}><span>{asset?.label ?? "Final export"}</span><small>{job.status} | {job.progress}%</small>{asset&&<div className="decision wrap"><a className="button-link" href={`${API}/api/media/projects/${projectId}/assets/${asset.id}/download`} download={asset.originalName ?? asset.fileName ?? "export.mp4"}>Download</a><button onClick={()=>void onRenameAsset(asset.id)}>Rename</button><button onClick={()=>void onDeleteAsset(asset.id)}>Delete</button></div>}{job.status==="FAILED"&&<button onClick={()=>void onRetryExport(job.id)}>Retry</button>}</div>; })}</div></div>;
}

type WorkflowMapping = { prompt: string; image?: string; width: string; height: string; frames: string; fps: string; seed: string; outputNodeId: string };

const defaultWorkflowMapping: WorkflowMapping = {
  prompt: "6.inputs.text",
  image: "7.inputs.image",
  width: "5.inputs.width",
  height: "5.inputs.height",
  frames: "5.inputs.frames",
  fps: "5.inputs.fps",
  seed: "3.inputs.seed",
  outputNodeId: "9"
};

function ComfyWorkflowPanel({workflows,sceneId,onImport,onUpdate,onActivate,onDelete,onPreview}:{workflows:ComfyWorkflow[];sceneId:string;onImport:(payload:{name:string;workflowType:"WAN_T2V"|"WAN_I2V";workflowJson:unknown;mapping:WorkflowMapping;activate:boolean})=>Promise<void>;onUpdate:(workflowId:string,payload:{name:string;workflowJson:unknown;mapping:WorkflowMapping;activate:boolean})=>Promise<void>;onActivate:(workflowId:string)=>Promise<void>;onDelete:(workflowId:string)=>Promise<void>;onPreview:(payload:{workflowId?:string;workflowType?:"WAN_T2V"|"WAN_I2V";sceneId:string;fps?:number;seed?:number})=>Promise<string>}) {
  const [editing,setEditing]=useState<ComfyWorkflow|null>(null);
  const [workflowType,setWorkflowType]=useState<"WAN_T2V"|"WAN_I2V">("WAN_T2V");
  const [name,setName]=useState("Wan workflow");
  const [jsonText,setJsonText]=useState("");
  const [mappingText,setMappingText]=useState(JSON.stringify(defaultWorkflowMapping,null,2));
  const [activate,setActivate]=useState(false);
  const [preview,setPreview]=useState("");
  const [error,setError]=useState("");

  function loadWorkflow(workflow: ComfyWorkflow) {
    setEditing(workflow);
    setWorkflowType(workflow.workflowType);
    setName(workflow.name);
    setJsonText(JSON.stringify(JSON.parse(workflow.workflowJson), null, 2));
    setMappingText(JSON.stringify(JSON.parse(workflow.mappingJson), null, 2));
    setActivate(Boolean(workflow.isActive));
    setPreview("");
    setError("");
  }

  async function save() {
    setError("");
    try {
      const workflowJson = JSON.parse(jsonText);
      const mapping = JSON.parse(mappingText) as WorkflowMapping;
      if (editing) await onUpdate(editing.id,{name,workflowJson,mapping,activate});
      else await onImport({name,workflowType,workflowJson,mapping,activate});
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow JSON is invalid");
    }
  }

  async function previewCurrent(workflow?: ComfyWorkflow) {
    setError("");
    setPreview(await onPreview({ workflowId: workflow?.id ?? editing?.id, workflowType: workflow ? undefined : workflowType, sceneId }));
  }

  return <div className="card editor-card workflow-card"><div className="row first-row"><strong>{editing?`Edit v${editing.version}`:"Import workflow"}</strong><button onClick={()=>{setEditing(null);setJsonText("");setMappingText(JSON.stringify(defaultWorkflowMapping,null,2));setPreview("");}}>New</button></div><div className="split-fields"><label>Type<select value={workflowType} onChange={event=>setWorkflowType(event.target.value as "WAN_T2V"|"WAN_I2V")} disabled={Boolean(editing)}><option>WAN_T2V</option><option>WAN_I2V</option></select></label><label>Name<input value={name} onChange={event=>setName(event.target.value)}/></label></div><label>Workflow JSON<textarea value={jsonText} onChange={event=>setJsonText(event.target.value)} placeholder='{"3":{"class_type":"KSampler","inputs":{"seed":1}}}'/></label><label>Mapping JSON<textarea value={mappingText} onChange={event=>setMappingText(event.target.value)}/></label><label className="checkbox-row"><input type="checkbox" checked={activate} onChange={event=>setActivate(event.target.checked)}/> Activate when valid</label>{error&&<p className="error">{error}</p>}<div className="decision wrap"><button onClick={()=>void save()}>{editing?"Save new version":"Import"}</button><button onClick={()=>void previewCurrent()} disabled={!editing}>Preview compiled</button></div>{preview&&<pre>{preview}</pre>}<div className="workflow-list">{workflows.map(workflow => <div className="mini" key={workflow.id}><span>{workflow.name} v{workflow.version}</span><small>{workflow.workflowType} · {workflow.status} · {workflow.isActive?"active":"inactive"}</small><div className="decision wrap"><button onClick={()=>loadWorkflow(workflow)}>Edit</button><button onClick={()=>void previewCurrent(workflow)} disabled={workflow.status!=="VALID"}>Preview</button><button onClick={()=>void onActivate(workflow.id)} disabled={workflow.status!=="VALID" || Boolean(workflow.isActive)}>Activate</button><button onClick={()=>void onDelete(workflow.id)}>Delete</button></div>{parseValidationIssues(workflow.validationJson).map(issue=><small className="error" key={`${workflow.id}-${issue.code}-${issue.message}`}>{issue.code}: {issue.message}</small>)}</div>)}</div></div>;
}

function BrandPresenterPanel({projectId,bundle,onSaveBrand,onSavePresenter,onSelectDefaults,onUploadLibraryImage,onDeleteLibraryAsset}:{projectId:string;bundle:MediaBundle;onSaveBrand:(brand?:MediaBrandKit)=>Promise<void>;onSavePresenter:(profile?:MediaPresenterProfile)=>Promise<void>;onSelectDefaults:(brandKitId:string|null|undefined,presenterProfileId:string|null|undefined)=>Promise<void>;onUploadLibraryImage:(path:string,file:File|undefined)=>Promise<void>;onDeleteLibraryAsset:(assetId:string)=>Promise<void>}) {
  const [brandDraft,setBrandDraft]=useState<MediaBrandKit|null>(bundle.brandKits[0] ?? null);
  const [presenterDraft,setPresenterDraft]=useState<MediaPresenterProfile|null>(bundle.presenterProfiles[0] ?? null);
  useEffect(()=>setBrandDraft(bundle.brandKits[0] ?? null),[bundle.brandKits]);
  useEffect(()=>setPresenterDraft(bundle.presenterProfiles[0] ?? null),[bundle.presenterProfiles]);
  const brandLogo = brandDraft ? bundle.assets.find(asset=>{ const metadata=parseAssetMetadata(asset.metadataJson); return metadata.libraryType==="brand" && metadata.ownerId===brandDraft.id && metadata.role==="logo"; }) : null;
  const presenterRef = presenterDraft ? bundle.assets.find(asset=>{ const metadata=parseAssetMetadata(asset.metadataJson); return metadata.libraryType==="presenter" && metadata.ownerId===presenterDraft.id; }) : null;
  return <div className="card editor-card"><div className="row first-row"><strong>Brand & presenter</strong><button onClick={()=>void onSaveBrand()}>New brand</button><button onClick={()=>void onSavePresenter()}>New presenter</button></div><div className="split-fields"><label>Default brand<select value={bundle.project.defaultBrandKitId ?? ""} onChange={event=>void onSelectDefaults(event.target.value || null, undefined)}><option value="">None</option>{bundle.brandKits.map(brand=><option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><label>Default presenter<select value={bundle.project.defaultPresenterProfileId ?? ""} onChange={event=>void onSelectDefaults(undefined, event.target.value || null)}><option value="">None</option>{bundle.presenterProfiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div>{brandDraft&&<div className="mini"><strong>{brandDraft.name}</strong><label>Name<input value={brandDraft.name} onChange={event=>setBrandDraft({...brandDraft,name:event.target.value})}/></label><label>Colours<input value={parseJsonList(brandDraft.colorsJson).join(", ")} onChange={event=>setBrandDraft({...brandDraft,colorsJson:JSON.stringify(event.target.value.split(",").map(item=>item.trim()).filter(Boolean))})}/></label><label>Fonts<input value={parseJsonList(brandDraft.fontsJson).join(", ")} onChange={event=>setBrandDraft({...brandDraft,fontsJson:JSON.stringify(event.target.value.split(",").map(item=>item.trim()).filter(Boolean))})}/></label><label>Tagline<input value={brandDraft.tagline} onChange={event=>setBrandDraft({...brandDraft,tagline:event.target.value})}/></label><label>Tone<textarea value={brandDraft.tone} onChange={event=>setBrandDraft({...brandDraft,tone:event.target.value})}/></label><label>Disclaimer<textarea value={brandDraft.disclaimer} onChange={event=>setBrandDraft({...brandDraft,disclaimer:event.target.value})}/></label><div className="decision wrap"><button onClick={()=>void onSaveBrand(brandDraft)}>Save brand</button><label className="replace-button">Logo<input type="file" accept="image/*" onChange={event=>void onUploadLibraryImage(brandLogo?`${API}/api/media/projects/${projectId}/library-assets/${brandLogo.id}`:`${API}/api/media/projects/${projectId}/brand-kits/${brandDraft.id}/assets/upload?role=logo`,event.target.files?.[0])}/></label>{brandLogo&&<a className="button-link" href={`${API}/api/media/projects/${projectId}/assets/${brandLogo.id}/download`} target="_blank" rel="noreferrer">Preview logo</a>}{brandLogo&&<button onClick={()=>void onDeleteLibraryAsset(brandLogo.id)}>Delete logo</button>}</div></div>}{presenterDraft&&<div className="mini"><strong>{presenterDraft.name}</strong><label>Name<input value={presenterDraft.name} onChange={event=>setPresenterDraft({...presenterDraft,name:event.target.value})}/></label><label>Appearance<textarea value={presenterDraft.appearancePrompt} onChange={event=>setPresenterDraft({...presenterDraft,appearancePrompt:event.target.value})}/></label><label>Voice/accent<input value={presenterDraft.voiceAccent} onChange={event=>setPresenterDraft({...presenterDraft,voiceAccent:event.target.value})}/></label><label>Clothing<input value={presenterDraft.clothing} onChange={event=>setPresenterDraft({...presenterDraft,clothing:event.target.value})}/></label><label>Consistency rules<textarea value={presenterDraft.consistencyRules} onChange={event=>setPresenterDraft({...presenterDraft,consistencyRules:event.target.value})}/></label><div className="decision wrap"><button onClick={()=>void onSavePresenter(presenterDraft)}>Save presenter</button><label className="replace-button">Reference<input type="file" accept="image/*" onChange={event=>void onUploadLibraryImage(presenterRef?`${API}/api/media/projects/${projectId}/library-assets/${presenterRef.id}`:`${API}/api/media/projects/${projectId}/presenter-profiles/${presenterDraft.id}/assets/upload?role=reference`,event.target.files?.[0])}/></label>{presenterRef&&<a className="button-link" href={`${API}/api/media/projects/${projectId}/assets/${presenterRef.id}/download`} target="_blank" rel="noreferrer">Preview reference</a>}{presenterRef&&<button onClick={()=>void onDeleteLibraryAsset(presenterRef.id)}>Delete reference</button>}</div></div>}</div>;
}

function TemplatePanel({templates,hasProject,onDuplicate,onArchive,onCreateProject,onApply}:{templates:MediaTemplate[];hasProject:boolean;onDuplicate:(templateId:string)=>Promise<void>;onArchive:(templateId:string)=>Promise<void>;onCreateProject:(template:MediaTemplate)=>Promise<void>;onApply:(template:MediaTemplate)=>Promise<void>}) {
  const [selectedId,setSelectedId]=useState("");
  useEffect(()=>{ if(!selectedId && templates[0]) setSelectedId(templates[0].id); },[templates,selectedId]);
  const selected = templates.find(template=>template.id===selectedId) ?? templates[0];
  return <div className="card editor-card"><div className="row first-row"><strong>Templates</strong><select value={selected?.id ?? ""} onChange={event=>setSelectedId(event.target.value)}>{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></div>{selected?<div className="mini"><span>{selected.templateType} | {selected.defaultDurationSeconds}s | {selected.aspectRatio}</span><small>{selected.description}</small><div className="metadata-grid"><span>Scenes</span><strong>{parseTemplateScenes(selected.sceneStructureJson).length}</strong><span>Captions</span><strong>{compactJson(selected.captionStyleJson)}</strong><span>Audio</span><strong>{compactJson(selected.audioSettingsJson)}</strong><span>Brand</span><strong>{compactJson(selected.brandRulesJson)}</strong></div><div className="qc-list">{parseTemplateScenes(selected.sceneStructureJson).map((scene,index)=><small key={`${selected.id}-${index}`}>{index+1}. {scene.title} ({scene.durationSeconds}s): {scene.prompt}</small>)}</div>{selected.promptRules&&<small>{selected.promptRules}</small>}<div className="decision wrap"><button onClick={()=>void onCreateProject(selected)}>New project</button><button onClick={()=>void onApply(selected)} disabled={!hasProject}>Apply</button><button onClick={()=>void onDuplicate(selected.id)}>Duplicate</button><button onClick={()=>void onArchive(selected.id)} disabled={Boolean(selected.isBuiltin)}>Archive</button></div></div>:<div className="mini"><span>No templates</span><small>Built-ins should appear after API startup.</small></div>}</div>;
}

function SceneEditor({projectId,scene,assets,onSave,onApprove,onReject,onCopyPrompt,onRegenerateScene,onGenerateWan,onGeneratePresenter,onGenerateAudioVideo,onImportAsset,onReplaceAsset,onDeleteAsset,onUpdateAudio,onSelectBackgroundMusic,onApproveAsset,onRejectAsset,onRegenerateAsset}:{projectId:string;scene:MediaScene;assets:MediaAsset[];onSave:(scene:MediaScene)=>Promise<void>;onApprove:(sceneId:string)=>Promise<void>;onReject:(sceneId:string)=>Promise<void>;onCopyPrompt:(sceneId:string)=>Promise<void>;onRegenerateScene:(sceneId:string)=>Promise<void>;onGenerateWan:(sceneId:string,mode:"text-to-video"|"image-to-video")=>Promise<void>;onGeneratePresenter:(sceneId:string)=>Promise<void>;onGenerateAudioVideo:(sceneId:string)=>Promise<void>;onImportAsset:(sceneId:string,file:File|undefined)=>Promise<void>;onReplaceAsset:(sceneId:string,assetId:string,file:File|undefined)=>Promise<void>;onDeleteAsset:(sceneId:string,assetId:string)=>Promise<void>;onUpdateAudio:(assetId:string,settings:Partial<AudioSettings>)=>Promise<void>;onSelectBackgroundMusic:(assetId:string|null)=>Promise<void>;onApproveAsset:(assetId:string)=>Promise<void>;onRejectAsset:(assetId:string,feedback:string)=>Promise<void>;onRegenerateAsset:(assetId:string)=>Promise<void>}) {
  const [draft,setDraft]=useState(scene);
  useEffect(()=>setDraft(scene),[scene]);
  const hasImage = assets.some(asset=>asset.kind==="image" && asset.localPath);
  const hasAudio = assets.some(asset=>asset.kind==="audio" && asset.localPath);
  return <div className="card editor-card scene-editor"><div className="row first-row"><strong>Scene {scene.position}</strong><span className={`scene-status ${scene.status.toLowerCase()}`}>{scene.status}</span></div><label>Title<input value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><div className="split-fields"><label>Duration<input type="number" min="1" value={draft.durationSeconds} onChange={event=>setDraft({...draft,durationSeconds:Number(event.target.value)})}/></label><label>Aspect ratio<select value={draft.aspectRatio} onChange={event=>setDraft({...draft,aspectRatio:event.target.value})}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label></div><label>Status<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as MediaSceneStatus})}><option>DRAFT</option><option>APPROVED</option><option>GENERATING</option><option>ASSET_READY</option><option>REJECTED</option></select></label><label>Dialogue<textarea value={draft.dialogue} onChange={event=>setDraft({...draft,dialogue:event.target.value})}/></label><label>Visual prompt<textarea value={draft.visualPrompt} onChange={event=>setDraft({...draft,visualPrompt:event.target.value})}/></label><div className="decision wrap"><button onClick={()=>void onSave(draft)}>Save scene</button><button onClick={()=>void onApprove(scene.id)} disabled={scene.status==="APPROVED"}>Approve</button><button onClick={()=>void onReject(scene.id)} disabled={scene.status==="REJECTED"}>Reject</button><button onClick={()=>void onCopyPrompt(scene.id)}>Copy prompt</button><button onClick={()=>void onRegenerateScene(scene.id)}>Regenerate Scene</button><button onClick={()=>void onGenerateWan(scene.id,"text-to-video")} disabled={scene.status!=="APPROVED"}>Generate Wan T2V</button><button onClick={()=>void onGenerateWan(scene.id,"image-to-video")} disabled={scene.status!=="APPROVED" || !hasImage}>Generate Wan I2V</button><button onClick={()=>void onGeneratePresenter(scene.id)} disabled={scene.status!=="APPROVED" || !hasImage || !hasAudio}>Generate Presenter</button><button onClick={()=>void onGenerateAudioVideo(scene.id)} disabled={scene.status!=="APPROVED" || !hasAudio}>Generate Audio Video</button></div><label className="file-import">Upload media<input type="file" accept="image/*,video/*,audio/*" onChange={event=>void onImportAsset(scene.id,event.target.files?.[0])}/></label>{assets.length?<div className="asset-stack">{assets.map(asset=><AssetItem key={asset.id} projectId={projectId} sceneId={scene.id} asset={asset} onReplaceAsset={onReplaceAsset} onDeleteAsset={onDeleteAsset} onUpdateAudio={onUpdateAudio} onSelectBackgroundMusic={onSelectBackgroundMusic} onApproveAsset={onApproveAsset} onRejectAsset={onRejectAsset} onRegenerateAsset={onRegenerateAsset}/>)}</div>:null}</div>;
}

function AssetItem({projectId,sceneId,asset,onReplaceAsset,onDeleteAsset,onUpdateAudio,onSelectBackgroundMusic,onApproveAsset,onRejectAsset,onRegenerateAsset}:{projectId:string;sceneId:string;asset:MediaAsset;onReplaceAsset:(sceneId:string,assetId:string,file:File|undefined)=>Promise<void>;onDeleteAsset:(sceneId:string,assetId:string)=>Promise<void>;onUpdateAudio:(assetId:string,settings:Partial<AudioSettings>)=>Promise<void>;onSelectBackgroundMusic:(assetId:string|null)=>Promise<void>;onApproveAsset:(assetId:string)=>Promise<void>;onRejectAsset:(assetId:string,feedback:string)=>Promise<void>;onRegenerateAsset:(assetId:string)=>Promise<void>}) {
  const [feedback,setFeedback]=useState("");
  const downloadUrl = `${API}/api/media/projects/${projectId}/assets/${asset.id}/download`;
  const thumbnailUrl = asset.thumbnailPath ? `${API}/api/media/projects/${projectId}/assets/${asset.id}/thumbnail` : downloadUrl;
  const previewUrl = asset.previewPath ? `${API}/api/media/projects/${projectId}/assets/${asset.id}/preview` : downloadUrl;
  const inspection = parseInspection(asset.inspectionJson);
  const issues = parseQcIssues(asset.qcIssuesJson);
  const audioSettings = asset.kind === "audio" ? parseAudioSettings(asset.metadataJson) : null;
  const generated = isGeneratedAsset(asset);
  const metadata = parseAssetMetadata(asset.metadataJson);
  const refs = Array.isArray(metadata.referenceAssetIds) ? metadata.referenceAssetIds.filter((item): item is string => typeof item === "string") : [];
  const lineage = refs.length ? `References: ${refs.length} | Previous: ${typeof metadata.previousGeneratedAssetId === "string" ? metadata.previousGeneratedAssetId.slice(0, 8) : "none"} | Reason: ${typeof metadata.regenerationReason === "string" ? metadata.regenerationReason : "none"}` : "";
  return (
    <div className="asset-item">
      <div className="asset-preview">
        {asset.mimeType?.startsWith("image/") ? <img src={thumbnailUrl} alt={asset.originalName ?? asset.label}/> : asset.mimeType?.startsWith("video/") ? <video poster={asset.thumbnailPath ? thumbnailUrl : undefined} src={previewUrl} controls/> : asset.mimeType?.startsWith("audio/") ? <audio src={downloadUrl} controls/> : <span>No preview</span>}
      </div>
      <div className="asset-meta">
        <strong>{asset.originalName ?? asset.fileName ?? asset.label}</strong>
        <small>{asset.mimeType ?? asset.status} | {formatBytes(asset.sizeBytes)} | {asset.checksumSha256?.slice(0,12) ?? "no checksum"}</small>
        <div className="decision wrap">
          <span className={`qc-pill ${asset.qcStatus.toLowerCase()}`}>QC {asset.qcStatus}</span>
          {generated ? <span className={`approval-pill ${(asset.approvalStatus ?? "PENDING").toLowerCase()}`}>{asset.approvalStatus ?? "PENDING"}</span> : null}
        </div>
        {generated && asset.approvalFeedback ? <small className="approval-feedback">Feedback: {asset.approvalFeedback}</small> : null}
        {generated && lineage ? <small>{lineage}</small> : null}
        {generated ? <div className="approval-actions"><button onClick={()=>void onApproveAsset(asset.id)} disabled={asset.approvalStatus==="APPROVED"}>Approve generated</button><input value={feedback} onChange={event=>setFeedback(event.target.value)} maxLength={2000} placeholder="Rejection feedback"/><button onClick={()=>{void onRejectAsset(asset.id,feedback);setFeedback("");}} disabled={!feedback.trim()}>Reject</button><button onClick={()=>void onRegenerateAsset(asset.id)}>Create Variation</button></div> : null}
        {inspection ? <div className="metadata-grid"><span>Duration</span><strong>{inspection.durationSeconds?.toFixed(2) ?? "n/a"}s</strong><span>Resolution</span><strong>{inspection.width&&inspection.height?`${inspection.width}x${inspection.height}`:"n/a"}</strong><span>FPS</span><strong>{inspection.fps ?? "n/a"}</strong><span>Codecs</span><strong>{[inspection.videoCodec,inspection.audioCodec].filter(Boolean).join(" / ") || "n/a"}</strong><span>Audio</span><strong>{inspection.hasAudio?"yes":"no"}</strong></div> : null}
        {audioSettings ? <AudioControls assetId={asset.id} settings={audioSettings} onUpdateAudio={onUpdateAudio} onSelectBackgroundMusic={onSelectBackgroundMusic}/> : null}
        {issues.length ? <div className="qc-list">{issues.map(issue=><small key={issue.code}>{issue.code}: {issue.message}</small>)}</div> : null}
        <div className="decision wrap"><a className="button-link" href={downloadUrl} download={asset.originalName ?? asset.fileName ?? "asset"}>Download</a><label className="replace-button">Replace<input type="file" accept="image/*,video/*,audio/*" onChange={event=>void onReplaceAsset(sceneId,asset.id,event.target.files?.[0])}/></label><button onClick={()=>void onDeleteAsset(sceneId,asset.id)}>Delete</button></div>
      </div>
    </div>
  );
}

function AudioControls({assetId,settings,onUpdateAudio,onSelectBackgroundMusic}:{assetId:string;settings:AudioSettings;onUpdateAudio:(assetId:string,settings:Partial<AudioSettings>)=>Promise<void>;onSelectBackgroundMusic:(assetId:string|null)=>Promise<void>}) {
  const update = (patch: Partial<AudioSettings>) => void onUpdateAudio(assetId, patch);
  return <div className="audio-controls"><div className="metadata-grid"><span>Role</span><select value={settings.audioRole} onChange={event=>update({audioRole:event.target.value as AudioSettings["audioRole"]})}><option>NARRATION</option><option>MUSIC</option><option>SFX</option><option>SCENE_AUDIO</option></select><span>Volume</span><input type="number" min="0" max="2" step="0.05" value={settings.volume} onChange={event=>update({volume:Number(event.target.value)})}/><span>Trim</span><div className="inline-inputs"><input type="number" min="0" step="0.1" value={settings.trimStartSeconds} onChange={event=>update({trimStartSeconds:Number(event.target.value)})}/><input type="number" min="0" step="0.1" value={settings.trimEndSeconds ?? ""} placeholder="end" onChange={event=>update({trimEndSeconds:event.target.value ? Number(event.target.value) : null})}/></div><span>Fade</span><div className="inline-inputs"><input type="number" min="0" max="60" step="0.1" value={settings.fadeInSeconds} onChange={event=>update({fadeInSeconds:Number(event.target.value)})}/><input type="number" min="0" max="60" step="0.1" value={settings.fadeOutSeconds} onChange={event=>update({fadeOutSeconds:Number(event.target.value)})}/></div><span>Muted</span><input type="checkbox" checked={settings.muted} onChange={event=>update({muted:event.target.checked})}/></div><div className="decision wrap"><button onClick={()=>void onSelectBackgroundMusic(assetId)} disabled={settings.backgroundMusic}>Use as music</button>{settings.backgroundMusic&&<button onClick={()=>void onSelectBackgroundMusic(null)}>Clear music</button>}</div></div>;
}

function parseJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function formatBytes(value: number | null): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function parseInspection(value: string | null): { durationSeconds: number | null; width: number | null; height: number | null; fps: number | null; videoCodec: string | null; audioCodec: string | null; hasAudio: boolean } | null {
  if (!value) return null;
  try { return JSON.parse(value) as { durationSeconds: number | null; width: number | null; height: number | null; fps: number | null; videoCodec: string | null; audioCodec: string | null; hasAudio: boolean }; }
  catch { return null; }
}

function parseAudioSettings(value: string | null): AudioSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AudioSettings>;
    const audioRole = parsed.audioRole === "MUSIC" || parsed.audioRole === "SFX" || parsed.audioRole === "SCENE_AUDIO" ? parsed.audioRole : "NARRATION";
    return {
      audioRole,
      volume: typeof parsed.volume === "number" ? parsed.volume : audioRole === "MUSIC" ? 0.25 : 1,
      trimStartSeconds: typeof parsed.trimStartSeconds === "number" ? parsed.trimStartSeconds : 0,
      trimEndSeconds: typeof parsed.trimEndSeconds === "number" ? parsed.trimEndSeconds : null,
      fadeInSeconds: typeof parsed.fadeInSeconds === "number" ? parsed.fadeInSeconds : 0,
      fadeOutSeconds: typeof parsed.fadeOutSeconds === "number" ? parsed.fadeOutSeconds : 0,
      muted: Boolean(parsed.muted),
      backgroundMusic: Boolean(parsed.backgroundMusic)
    };
  } catch {
    return null;
  }
}

function parseAssetMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isGeneratedAsset(asset: MediaAsset): boolean {
  return Boolean(asset.sceneId) && ["comfyui-wan","longcat-avatar","ovi","ltx","google-flow"].includes(asset.source);
}

function parseTemplateScenes(value: string): Array<{ title: string; durationSeconds: number; prompt: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { title: string; durationSeconds: number; prompt: string } => typeof item === "object" && item !== null && typeof (item as { title?: unknown }).title === "string" && typeof (item as { durationSeconds?: unknown }).durationSeconds === "number" && typeof (item as { prompt?: unknown }).prompt === "string") : [];
  } catch {
    return [];
  }
}

function compactJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) return "none";
    const keys = Object.keys(parsed);
    return keys.length ? keys.slice(0, 3).join(", ") : "none";
  } catch {
    return "none";
  }
}

function parseRenderMode(value: string): string {
  try {
    const parsed = JSON.parse(value) as { mode?: unknown };
    return typeof parsed.mode === "string" ? parsed.mode : "DRAFT_RENDER";
  } catch {
    return "DRAFT_RENDER";
  }
}

function parseQcIssues(value: string): Array<{ code: string; message: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { code: string; message: string } => typeof item === "object" && item !== null && "code" in item && "message" in item) : [];
  } catch {
    return [];
  }
}

function parseValidationIssues(value: string): Array<{ code: string; message: string }> {
  try {
    const parsed = JSON.parse(value) as { issues?: unknown };
    return Array.isArray(parsed.issues) ? parsed.issues.filter((item): item is { code: string; message: string } => typeof item === "object" && item !== null && "code" in item && "message" in item) : [];
  } catch {
    return [];
  }
}

function parseRouting(value: string | null): { selectedProvider: string; reason: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { routing?: { selectedProvider?: unknown; reason?: unknown } };
    return typeof parsed.routing?.selectedProvider === "string" && typeof parsed.routing.reason === "string"
      ? { selectedProvider: parsed.routing.selectedProvider, reason: parsed.routing.reason }
      : null;
  } catch {
    return null;
  }
}

function parseFlowPackage(value: string | null): { prompt: string; scene: { title: string; aspectRatio: string; durationSeconds: number } } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { flowPackage?: unknown };
    const flowPackage = parsed.flowPackage as { prompt?: unknown; scene?: { title?: unknown; aspectRatio?: unknown; durationSeconds?: unknown } } | undefined;
    if (typeof flowPackage?.prompt !== "string" || !flowPackage.scene) return null;
    if (typeof flowPackage.scene.title !== "string" || typeof flowPackage.scene.aspectRatio !== "string" || typeof flowPackage.scene.durationSeconds !== "number") return null;
    return { prompt: flowPackage.prompt, scene: { title: flowPackage.scene.title, aspectRatio: flowPackage.scene.aspectRatio, durationSeconds: flowPackage.scene.durationSeconds } };
  } catch {
    return null;
  }
}
