# S4 Agent Studio Development Rules

## Product

S4 Agent Studio is a local-first conversational agent workspace.

## Current objective

Implement a real read-only project inspector and connect it to the Developer Agent chat.

## Safety rules

- Only modify files inside the S4 Agent Studio repository.
- Registered external projects may be inspected read-only.
- Never modify an inspected external project.
- Never reveal or modify `.env` secrets.
- Never delete files without explicit approval.
- Never push to GitHub or deploy.
- Reject path traversal and access outside a registered project root.
- Read-only inspection must require no approval.

## Engineering rules

- Use strict TypeScript.
- Keep routes thin and business logic in services.
- Validate all API input.
- Add tests for intent classification and path-boundary enforcement.
- Run `npm run typecheck`.
- Run all relevant tests.
- Avoid unrelated refactoring.