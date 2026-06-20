# Internal Auth Credential Setup

This local script activates password credentials for the seeded internal Shrinika Technologies users only:

- Shrinika: `owner@shrinika.local`
- Shiva: `shiva@shrinika.local`

The script does not create users, does not print passwords, and stores only salted password hashes.

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

## Login

After setting a password, use the internal login screen:

```text
/internal-login
```

Business Control Centre and App Studio remain internal-only. Customers must use the Client Portal, support, email, or payment pages instead.
