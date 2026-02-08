# Quickstart (Developers)

## 1. Setup

```bash
git clone <your-fork-url>
cd <your-repo-folder>
npm install
```

## 2. Run

```bash
npm start
```

## 3. Build

```bash
npm run build:win
```

## 4. Verify Core Flows

- Claude connect/disconnect
- Codex connect with:
  - auto connect
  - browser-assisted manual cookie/bearer mode
- Refresh behavior and timers
- Compact mode + settings window resizing

## 5. Debug

```bash
npm start -- --debug
```

Or:

```bash
DEBUG_LOG=1 npm start
```
