# App Studio

Parent brand: Shrinika Automation Studio

Local-first conversational workspace for building websites, applications, APIs, tools, and specialist agents.

## Milestone 1 implemented

- Persistent SQLite database
- Local project registration
- Project-boundary path protection
- Developer Agent conversations
- Structured task planning
- Risk classification
- Approval inbox with approve/reject decisions
- Task history
- Natural-language specialist-agent creation
- Append-only audit events
- React workspace dashboard

## Windows setup

```powershell
cd C:\path	o\s4-agent-studio
Copy-Item .env.example .env
npm install
npm run db:init
npm run dev
```

Open: `http://localhost:5173`

The local API runs at `http://127.0.0.1:4310`.

## Important

Register only project folders that already exist. S4 currently inspects project trees and stores plans, tasks, agents, and approvals. It does not yet apply file patches or execute terminal commands.

## Next milestone

- OpenAI-compatible model provider
- Real project-context prompting
- Proposed patch generation and diff viewer
- Git checkpoints
- Controlled test/build runner
- Guardian policy checks before execution
