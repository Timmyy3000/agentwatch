# Installation

## End Users

1. Download the latest `AgentWatch` Windows release from this repo's Releases page.
2. Run the installer.
3. Launch `AgentWatch` from Start Menu.

## Build From Source

```bash
git clone <your-fork-url>
cd <your-repo-folder>
npm install
npm run build:win
```

## First Launch

1. Connect Claude from the login screen.
2. Open Settings and connect Codex.
3. If Codex auto-connect fails, use `Open in Browser` + manual cookie/bearer input.

## Installed Paths (Default)

- App binaries: `%LOCALAPPDATA%\Programs\AgentWatch\`
- Local app data (config/logs): `%APPDATA%\AgentWatch\`

## Uninstall

1. Windows Settings -> Apps -> `AgentWatch` -> Uninstall
2. Optional manual cleanup:
   - `%APPDATA%\AgentWatch\`
   - `%LOCALAPPDATA%\Programs\AgentWatch\`
