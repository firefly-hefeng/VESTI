# 2026-02-27 Proxy Embeddings Key Fallback Rollout Note

## Scope
- Repo: `vesti-proxy`
- Goal: align `/api/embeddings` API key strategy with contributor request.

## Implemented (code side)
- Branch: `release/embeddings-key-fallback-20260227`
- Base: `origin/main`
- Included commit: `0188ed8` (cherry-picked)
- Effective key resolution in `api/embeddings.js`:
  1. `DASHSCOPE_API_KEY`
  2. `EMBEDDINGS_API_KEY`
  3. `MODELSCOPE_API_KEY`

## Compatibility
- `/api/chat` remains on `MODELSCOPE_API_KEY` and is unchanged.
- `/api/embeddings` request/response contract unchanged.

## Runtime docs
- Added `E:/GT/DEV/vesti-proxy/README.md` with:
  - route list
  - env var policy
  - Vercel setup recommendation
  - verification curl command

## Release / Ops Checklist
1. Merge proxy branch into `vesti-proxy` `main`.
2. In Vercel project `vesti-proxy`, add `DASHSCOPE_API_KEY` (Production; optionally Preview).
3. Redeploy latest `main`.
4. Verify `POST /api/embeddings` succeeds without `Incorrect API key provided`.
5. Verify `/api/chat` still works with existing `MODELSCOPE_API_KEY`.
