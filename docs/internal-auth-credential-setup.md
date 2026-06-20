# Internal Auth Credential Setup

This local script activates password credentials for the seeded internal Shrinika Technologies users only:

- Shrinika: `owner@shrinika.local`
- Shiva: `shiva@shrinika.local`

The script does not create users, does not print passwords, and stores only salted password hashes.

## Database Path

By default, the API and credential scripts use the same SQLite database:

```text
<repo-root>/data/s4-agent-studio.db
```

The DB package resolves `<repo-root>` by walking upward to the workspace `package.json` for `s4-agent-studio`. If `S4_DB_PATH` is set, that override is used instead.

## Interactive Setup

Set Shrinika's local password:

```bash
npm run internal-auth:set-password -- --email owner@shrinika.local
```

Set Shiva's local password:

```bash
npm run internal-auth:set-password -- --email shiva@shrinika.local
```

The terminal prompts for password and confirmation using hidden input.

## Non-Interactive Local Fallback

For local automation only, pass the password through an environment variable:

```bash
INTERNAL_AUTH_PASSWORD='use-a-local-password-here' npm run internal-auth:set-password -- --email owner@shrinika.local
```

PowerShell:

```powershell
$env:INTERNAL_AUTH_PASSWORD = 'use-a-local-password-here'
npm run internal-auth:set-password -- --email owner@shrinika.local
Remove-Item Env:INTERNAL_AUTH_PASSWORD
```

Do not commit passwords, paste passwords into chat, write passwords into `.env`, or include passwords in logs.

## Temporary Dev Defaults

For local development only, this command sets temporary default passwords for the seeded Shrinika and Shiva accounts:

```bash
npm run internal-auth:dev-default-passwords
```

It refuses to run when `NODE_ENV=production`.

Temporary local credentials:

```text
owner@shrinika.local / ShrinikaDev@2026!
shiva@shrinika.local / ShivaDev@2026!
```

Do not use these defaults in production. Rotate or change both passwords after testing with the normal password setup command.

Verify that the active local database has the seeded users and hashed credentials:

```bash
npm run internal-auth:verify-dev-login
```

The verifier prints the resolved database path and safe user status only. It does not print passwords, password hashes, credential IDs, tokens, or secrets.

## Local Login Fix Flow

Use this flow when the protected internal page still appears after setting credentials:

```bash
npm run internal-auth:dev-default-passwords
npm run internal-auth:verify-dev-login
npm run dev
```

Then open:

```text
http://localhost:5173/internal-login?returnTo=/business-control-centre
```

Login with the temporary local credentials above. Rotate or change both passwords after testing with the normal password setup command.

For local browser login, keep the web and API hostnames aligned. When the web app is opened at `http://localhost:5173`, the frontend calls `http://localhost:4310`; when opened at `http://127.0.0.1:5173`, it calls `http://127.0.0.1:4310`. This keeps the HttpOnly `SameSite=Lax` internal session cookie usable without weakening production cookie settings.

## Login

After setting a password, use the internal login screen:

```text
http://localhost:5173/internal-login
```

Business Control Centre and App Studio remain internal-only. Customers must use the Client Portal, support, email, or payment pages instead.
