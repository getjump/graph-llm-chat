# Graph LLM Chat

![CI](https://github.com/getjump/graph-llm-chat/actions/workflows/ci.yml/badge.svg)
![Vercel](https://vercel.com/api/v1/badges/YOUR_PROJECT_ID/deploy-status)

Graph LLM Chat is a local-first, graph-based chat UI for LLMs. It lets you branch conversations, visualize paths, and inspect the exact context sent to the model. The app runs fully in the browser and stores data in IndexedDB.

## WARNING: It's highly experimental and highly unstable - you are warned.

## Project Goal
The goal of this project is to push and validate the limits of building a full chat interface directly in the browser, while exploring and testing new interaction patterns and product ideas.

## Features
- Branching conversations with a graph view + branch chooser
- Context tab: see the exact prompt content sent to the model
- Projects with custom instructions and reusable attachments
- Custom instructions (profile + response style)
- Model picker + per-chat parameters (temperature, max tokens, reasoning effort when supported)
- Token usage widget + projected tokens after send
- Auto-summarization when context exceeds model limits
- File attachments with streaming summaries (File System Access API when available)
- Memory system (conversation/project/user scopes) with hybrid retrieval injection
- Global search across all messages (chats + projects)
- AI SDK tools + MCP integration (multiple MCP servers with per-server enable/disable)
- Daytona OSS tool (`daytona_exec`) for sandbox command execution
- Message editing (preserve or recompute) and delete
- Copy-on-hover for messages
- Light/Dark theme toggle

## Requirements
- Node.js 20+
- OpenRouter API key (or any OpenAI-compatible endpoint)

## Getting Started
```bash
npm install
npm run dev
```

Open the app at `http://localhost:5173`.

Open **Settings** (bottom-left) and set:
- **API Key** (OpenRouter key, or leave empty for local endpoints that don’t require a key)
- **API Base URL** (defaults to `https://openrouter.ai/api/v1`)

## Model Support
At runtime, models are fetched from the configured endpoint (`/models`) and embedding models from (`/embeddings/models`, with fallback to `/models` filtering).

For OpenRouter, the app also ships with a build-time snapshot fallback (`src/generated/openrouterFallbackModels.ts`) so model pickers still work if runtime fetch fails.

Reasoning effort controls appear only when a model advertises support (e.g. `reasoning` or `reasoning_effort`).

## File Attachments (Client-Only)
Attachments are stored as references to local files when the browser supports the File System Access API. This avoids loading large files into memory.

- If supported, files are stored as `FileSystemFileHandle` references in IndexedDB.
- If not supported, files are kept in memory (re-attach after refresh).
- Files are summarized in chunks and injected into the prompt as an attachment context.

## Context + Summarization
When the estimated input tokens exceed the model context window, the app auto-summarizes earlier messages and inserts a summary to preserve key facts while staying within limits.

## Memory
Memory can be enabled in `Settings -> Memory`.

- Extracts memory candidates from user messages (optionally assistant messages).
- Stores memory in IndexedDB by scope: conversation, project, global user.
- Retrieves top relevant memories per request with hybrid lexical + embedding scoring.
- Shows verbose retrieval trace and memory bank controls (pin/delete) in `Context`.

## Daytona OSS Tool
The app includes a dedicated local tool `daytona_exec` that can run shell commands inside Daytona sandboxes.

### 1) Install SDK dependency
```bash
npm install @daytonaio/sdk
```

### 2) Start Daytona OSS
Deploy or run Daytona OSS locally (see official Daytona OSS deployment docs), then copy your:
- Daytona API key
- Daytona API URL (if non-default)
- Optional target/environment

### 3) Configure in UI
Open `Settings -> Tools -> Tool: daytona_exec` and set:
- `Enabled`
- `Daytona API key`
- `API URL` / `Target` (optional if defaults are valid)
- Optional default `sandboxId`
- Default language, timeout, and sandbox lifecycle toggles

### 4) Use from chat
Ask the model to call `daytona_exec`, for example:
- "Run `python --version` in Daytona."
- "Execute `ls -la` in the sandbox and summarize output."

The tool result is visible in Context `Tool Trace` and follows the same permission confirmation rules as other sensitive tools.

## Scripts
```bash
npm run dev         # Start Vite dev server
npm run models:snapshot # Refresh bundled OpenRouter fallback model snapshot
npm run build       # Build production bundle
npm run lint        # Run ESLint
npm run preview     # Preview production build
npm run test        # Vitest in watch mode
npm run test:run    # Vitest run (CI)
npm run test:e2e    # Playwright E2E
npm run test:visual # Playwright visual snapshots (manual)
```

## Tech Stack
- React + TypeScript
- Vite
- Zustand
- Dexie (IndexedDB)
- React Flow (graph)
- Tailwind CSS

## CI
GitHub Actions runs `npm run lint`, `npm run test:run`, `npm run test:e2e`, and `npm run build` on push and PRs.

## Deployment (Vercel)
1. Production deployments are triggered on merges to `main`.
2. Preview deployments are created for PRs.

The repository includes `vercel.json` with the build command and SPA rewrite.

## Visual Testing
Visual tests are tagged with `@visual` and excluded from CI by default. To run locally:
```bash
npm run test:visual -- --update-snapshots
```

## Security Notes
This app is client-only. The API key is stored in `localStorage` and used directly from the browser.

## License
MIT (see `LICENSE`).

## Contributing
See `CONTRIBUTING.md`. Support is provided on a best-effort basis and the project is provided as-is.
