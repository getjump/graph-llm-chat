# PLAN: AI SDK Tooling Integration (Browser-First)

## Objective
Integrate AI SDK tool-calling into the existing browser chat pipeline with practical controls:
1. Vendor-neutral OpenAI-compatible model access
2. Configurable tool registry (enable/disable + per-tool params)
3. Safe execution loop with fallback to current non-tool pipeline

## Phase 1 (In Progress)
1. Add global tooling settings in app state with persistence:
   - global toggle
   - max tool steps
   - per-tool toggles/config
2. Add `Tools` section in Settings modal for fine-grained configuration.
3. Introduce local browser tools:
   - `datetime_now`
   - `calculator`
   - `search_messages` (global app messages)
   - `search_context_chunks` (RAG chunks for active conversation/project)
4. Integrate AI SDK `streamText` tool loop into `useStreaming` when tooling is enabled.
5. Keep robust fallback:
   - if AI SDK/tool loop fails -> fallback to existing direct streaming path.

## Constraints
- Browser-only runtime
- No mandatory backend
- Keep current UX stable (streaming, retries, context, attachments)

## Acceptance Criteria (Phase 1)
- Tools can be enabled/disabled in UI and persisted across reloads.
- Tool config changes affect runtime behavior immediately after save.
- Tool-enabled chats stream normal assistant output.
- On tool-loop failure, chat still completes via fallback path.

## Phase 2 (In Progress)
1. Add MCP connector UI (URL, auth token, transport, tool discovery, enable/disable by tool). ✅
2. Add tool usage telemetry in Context tab (tool name, source, args preview, result, latency, status). ✅
3. Add confirmation workflow for sensitive tools (pattern-based, including `mcp:*`). ✅
4. Integrate external MCP tools into AI SDK tool loop with fallback to legacy streaming. ✅

## Next Iteration
1. Add explicit permission mode per sensitive tool (`always ask`, `allow once`, `allow always`).
2. Add per-project/per-conversation tool policies (override global settings).
3. Add richer tool trace timeline with request/response payload expanders.
4. Add optional server-side MCP proxy for CORS-restricted endpoints.
