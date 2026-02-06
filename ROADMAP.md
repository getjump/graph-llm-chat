# ROADMAP

## Near Term
- Stabilize Hybrid RAG UX and error handling.
- Add dedicated Knowledge Base screen with per-source actions.
- Add ingestion telemetry: indexed chunks, embedding failures, latency.

## Mid Term
- Introduce approximate nearest neighbor indexing for fast high-dimensional search.
- Incremental indexing and invalidation by file hash/version.
- Better retrieval controls (topK, max context budget, rerank toggle).

## Fully Local Mode (Embeddings + RAG)
Goal: run RAG without external embedding API.

### Capabilities
- Local embedding inference in browser (WebGPU/WASM runtime).
- Local vector index persisted in IndexedDB.
- Hybrid retrieval fully on-device.

### Technical work
- Add local embedding provider abstraction:
  - `remote` (OpenAI-compatible)
  - `local` (WebGPU/WASM)
- Model asset management:
  - download/cache
  - versioning
  - memory guards
- Index strategy:
  - small corpora: brute-force cosine
  - larger corpora: ANN structure persisted in browser

### Constraints
- Device-dependent performance and memory limits
- Browser quota limits for IndexedDB
- Warm-up time for local models

### Milestones
1. POC local embeddings for small corpora.
2. Hybrid provider switch in settings.
3. ANN + persistent local index.
4. Production hardening (fallbacks, telemetry, quotas).
