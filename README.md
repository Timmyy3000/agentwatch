# AgentWatch

AgentWatch is a Windows desktop widget for tracking both Claude and Codex usage in one place.

This project is a fork of the original Claude Usage Widget:
`https://github.com/SlavomirDurej/claude-usage-widget`

## Download for Windows (No Coding)

1. Open the Releases page: `https://github.com/Timmyy3000/agentwatch/releases`
2. Download the latest Windows asset (for now: `AgentWatch.exe`)
3. Run `AgentWatch.exe`

If Windows SmartScreen warns about an unsigned app, click `More info` -> `Run anyway`.

## What It Tracks

- Claude current-session usage and weekly usage
- Codex current-session usage and weekly usage
- Reset timers for each window
- Optional compact mode for quick-glance monitoring

## Requirements

- Windows 10/11
- Node.js 18+
- npm 9+

## Run Locally

```bash
git clone <your-fork-url>
cd <your-repo-folder>
npm install
npm start
```

## Build Windows Executable

```bash
npm run build:win
```

Build output goes to `dist/`.

App/product name is now `AgentWatch`, so generated artifacts should use that name.

## Authentication and Connection Strategies

AgentWatch supports separate auth flows for Claude and Codex.

### Claude

1. Use in-app Claude login first.
2. If auto-login fails, use manual session key mode from the UI.

### Codex

Codex auth can be trickier because embedded browser auth is sometimes blocked by Google/Cloudflare checks.

Use this order:

1. `Auto Connect (Non-Google)` in settings.
2. If blocked, click `Open in Browser`, sign in to ChatGPT in your normal browser, then use manual mode.
3. In manual mode, provide one or both:
- full `Cookie` header from a successful request to `/backend-api/wham/usage`
- `Authorization: Bearer ...` token
4. AgentWatch validates auth and falls back to page-context fetch when direct API fetch returns `Unauthorized`.

### Practical Notes for Codex

- Some sessions require both cookie context and bearer token.
- Google sign-in inside embedded Electron windows may fail with "browser/app may not be secure".
- Debug export is available in settings to inspect sanitized Codex auth/usage events.

## Debugging

- Run with `--debug`:

```bash
npm start -- --debug
```

- Or set env var:

```bash
DEBUG_LOG=1 npm start
```

- Codex logs can be copied from the settings UI via `Copy Codex Logs`.

## Open Source Collaboration

Contributions are welcome. If you open issues/PRs:

- include clear reproduction steps
- include platform details (Windows version, Node version)
- avoid posting raw auth secrets (cookies/tokens)

Project community files:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`

## Security and Privacy

- Credentials are stored locally via `electron-store`.
- Debug logs are sanitized for token/cookie fields.
- Never paste real session tokens into GitHub issues.

## Acknowledgements

- Original project/foundation: `SlavomirDurej/claude-usage-widget`
- Codex is used as a co-builder and maintainer assistant for planning, implementation, and refactors.

## License

MIT
