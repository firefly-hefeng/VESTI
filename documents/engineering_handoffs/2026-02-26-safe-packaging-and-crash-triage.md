# Safe Packaging and Crash Triage (2026-02-26)

Date: 2026-02-26  
Branch: release/v1.2.0-rc.2  
Scope: build/package stability and delivery process hardening

## 1) Confirmed Crash Evidence

Observed unstable windows (local laptop):
1. Kernel-Power ID 41 at `2026-02-26 11:01:20`, `11:23:16`, `13:47:51`.
2. EventLog ID 6008 at `2026-02-26 13:48:00` records unexpected shutdown time `13:28:25`.
3. Resource-Exhaustion-Detector ID 2004 at `2026-02-26 10:24:56`:
   - `node.exe`: ~9.68 GB virtual memory
   - `MSBuild.exe`: ~4.35 GB virtual memory
4. No new ID 2004 around the `13:28` incident window, so the latest reboot is not a direct repeat of the morning memory-warning signature.

Interpretation:
- Build can succeed under controlled settings.
- `plasmo package` remains the unstable path and can still end in system-level hang/reboot.

## 2) Artifact Baseline and Failure Signature

Baseline directory:
- `frontend/build/chrome-mv3-prod`

Observed state:
1. Directory remains valid and loadable.
2. Packaging attempts can leave `frontend/build/chrome-mv3-prod.zip` as `0 bytes`.
3. Current payload is large; top contributors are:
   - `SourceHanSansSC-UI-400/500/600` (each ~7.6 to ~7.9 MB)

## 3) Policy Decision (Implemented)

Local execution boundary:
1. Allow local `pnpm -C frontend build` (controlled environment).
2. Disallow local `pnpm -C frontend package` by default.

Engineering guardrails implemented:
1. `frontend/package.json`
   - `package` now hard-fails with guidance message.
   - `package:ci` is the official CI packaging command (`build + plasmo package`).
   - `package:safe` uses local safe zip flow (no plasmo package).
2. `scripts/release-rc.ps1`
   - local packaging blocked unless explicitly overridden by `-AllowLocalPackage`.
   - uses `package:ci` command when override is provided.

## 4) Safe Local Delivery Path (No plasmo package)

Script:
- `scripts/safe-package.ps1`

Default behavior:
1. Use existing `frontend/build/chrome-mv3-prod`.
2. Verify key entries:
   - `manifest.json`
   - `sidepanel*.js`
   - `capsule-ui*.js`
   - `static/background/index.js`
3. Create zip with built-in `tar`:
   - `dist/vesti-chrome-mv3-prod-<date>-safe.zip`
4. Emit delivery metadata:
   - `dist/manifest-<date>.json`
   - `dist/chrome-mv3-prod-files-<date>.txt`

## 5) Official Release Packaging Path (CI)

Workflow:
- `.github/workflows/extension-package.yml`

Flow:
1. Checkout + setup Node/pnpm.
2. `pnpm -C frontend install --frozen-lockfile`.
3. `pnpm -C frontend package:ci`.
4. Verify package outputs are non-zero.
5. Upload release artifacts:
   - `chrome-mv3-prod.zip`
   - `manifest.snapshot.json`
   - file list
   - sha256 checksum

## 6) Validation Checklist

Local:
1. Controlled build completes without reboot.
2. `package:safe` output zip is non-zero and extractable.
3. Chrome loads unpacked extension from `chrome-mv3-prod`.

Functional smoke:
1. Sidepanel opens.
2. Capsule injects and drag/click behavior works (at least ChatGPT or Claude).

CI:
1. `extension-package` workflow succeeds.
2. Artifact bundle contains zip + manifest snapshot + file list + sha256.

## 7) Scope and Contracts

No protocol/schema changes:
1. no change to `frontend/src/lib/messaging/protocol.ts`
2. no DB schema change
3. no parser contract change

This hardening round is process-only and delivery-only.

## 8) Font Compression Baseline (v1.2.0-rc.2 follow-up)

Goal:
1. Keep release artifact under 25 MB for GitHub upload constraints.
2. Preserve core UI typography stability.

Changes applied:
1. Removed `@fontsource/noto-serif-sc` import/dependency from frontend bundle path.
2. Kept CJK sans packaging at two weights only:
   - `SourceHanSansSC-UI-400`
   - `SourceHanSansSC-UI-500`
3. Mapped CJK `font-weight: 600` to `SourceHanSansSC-UI-500` to avoid extra 600 payload.
4. Removed `SourceHanSansSC-UI-600*.woff2` from manifest WAR list.

Guardrails:
1. `scripts/safe-package.ps1` enforces `-MaxArchiveMb` (default 25).
2. CI workflow `.github/workflows/extension-package.yml` now fails if zip exceeds 25 MB.

Expected artifact impact (from prior measured baseline):
1. Remove Noto Serif SC path (~20.85 MB).
2. Remove SourceHan 600 payload (~7.87 MB) by weight mapping.
3. Combined reduction should bring zip below 25 MB under current feature set.

Validation snapshot (2026-02-26 local run):
1. `frontend/build/chrome-mv3-prod`: `20.72 MB`
2. `dist/vesti-chrome-mv3-prod-2026-02-26-safe.zip`: `18.60 MB`
3. Size gate status: pass (`<= 25 MB`)
