# Bailu eval baseline

> **Status: baseline model still PARTIAL; docs sweep COMPLETE (secondary model).**
>
> - 2026-09-23: first capture, aborted mid-run when the machine's network (proxy/VPN)
>   degraded and `opencode.ai/zen/go` requests began aborting. The numbers below are
>   the `opencode-go`/`qwen3.6-plus` baseline.
> - 2026-09-24: the `opencode-go` (Go plan) quota was exhausted (`429
>   GoUsageLimitError`), so the remaining docs sweep was finished under a **different
>   model, `deepseek`/`deepseek-flash`** (pay-per-token). See "Docs audit completion"
>   — that column is **not** comparable to this baseline and does not replace it.
>
> This file is the regression reference for future changes: any prompt, tool,
> compaction, or model-routing change should re-run the same suite and compare
> against these numbers before/after.

## Default model selection

| Field     | Value                                                     |
|-----------|-----------------------------------------------------------|
| Provider  | `opencode-go` (`OPENCODE_API_KEY`)                        |
| Model     | `qwen3.6-plus` (openai-completions, `https://opencode.ai/zen/go/v1`) |
| Run       | `npm run eval -- --provider opencode-go --model qwen3.6-plus` |

## Run ledger

- Artifact run: `packages/evals/.eval/2026-09-23T04-08-36.095Z_1c85e3e9-2c7a-4c08-b426-d387d75fffe9`
- 17 runs recorded · ≈1.76M tokens · ≈ **$0.93** estimated cost (subscription model, no per-token billing out of pocket)
- Snapshot format: `runs.jsonl` + native session JSONL under `sessions/`, per `packages/evals/README.md`

---

## Results by suite

### smoke (`src/smoke.eval.ts`) — **PASS**
"runs a basic prompt end to end": passed (earlier dedicated run: 446 tok, 2.2 s).
Not included in the aborted ledger because vitest runs files in order and was
killed before reaching it.

### extensions (`src/extensions.eval.ts`) — **both arms score 0/1 (reps = 1)**

Comparative eval "Bailu extension authoring system prompt": candidate =
default system prompt (with guidelines + docs), baseline = prompt with that
section stripped.

| harness                  | verdict | tokens  | cost      | time  | what the agent actually did |
|--------------------------|---------|---------|-----------|-------|-----------------------------|
| system-prompt-without-docs | 0/1   | 10,252  | ~$0.007   | 32 s  | wrote `tools/hello.py` + `README.md` + `bailu-extension.json`; answered "Hello, Bob!" as prose; **no `hello` tool call**, no `.bailu/extensions/hello.ts` |
| default-system-prompt    | 0/1     | 35,373  | ~$0.020   | 27 s  | read example `hello.ts`, wrote `hello-extension.ts` at workspace root; **no `hello` tool call**, no `.bailu/extensions/hello.ts` |

Interpretation: with `qwen3.6-plus` the agent never produces a loadable
Bailu extension at `.bailu/extensions/hello.ts` nor actually invokes the
`hello` tool, despite a confident final reply. This is a **model-behavior
finding** (the eval was authored/validated upstream against other models), not a
harness defect — and it is exactly the kind of thing a baseline is meant to pin
down for later prompt/model comparison. reps = 1: directional, not a strong
statistic. Bump `repetitions` for a trustworthy lift number.

### docs (`src/docs.eval.ts`) — 1 match · 2 real mismatches · 12 network-aborted

"documentation ↔ implementation" audit, one agent run per page.

| page                 | verdict | tokens  | cost    | time     | evidence |
|----------------------|---------|---------|---------|----------|----------|
| containerization.md  | **match**  | 526,654 | ~$0.28 | 164 s | all concrete claims verified |
| development.md       | **mismatch** | 660,831 | ~$0.35 | 259 s | doc references `getThemeDir` in `src/config.ts`; function **does not exist** anywhere in `packages/coding-agent/src` |
| json.md              | **mismatch** | 530,495 | ~$0.28 | ~285 s | base-message type line refs are **288 lines stale**: doc says `UserMessage #L134` / `AssistantMessage #L140` / `ToolResultMessage #L152` in `packages/ai/src/types.ts`; actual lines are **422 / 428 / 452** (anchor URL points at the wrong line too) |
| (12 other pages)     | aborted   | —       | —       | —        | `Request aborted` / `Connection error` — inconclusive, not counted as matches or mismatches |

---

## Docs audit completion (2026-09-24 — `deepseek`/`deepseek-flash`, secondary model)

The 2026-09-23 `qwen3.6-plus` run never finished the docs sweep (12 pages aborted,
15 unreached). On 2026-09-24 the `opencode-go` Go-plan quota was exhausted
(`429 GoUsageLimitError`), so the remaining pages were audited with a **different
model, `deepseek`/`deepseek-flash`**, instead. Total: **29 runs · ≈$1.03 · ≈47.4M raw
tokens** (mostly cache reads).

- Artifacts: `.eval/2026-09-24T03-48-06.121Z_d0754cb8-…` (27-page sweep),
  `.eval/2026-09-24T03-45-24.923Z_a5af8042-…` (2-page probe re-verifying the two fixes)
- Command: `DEEPSEEK_API_KEY=… npm run eval -- --provider deepseek --model deepseek-flash src/docs.eval.ts -t "<page filter>"`
  — the harness runs with a throwaway `agentDir`, so it does **not** read
  `~/.bailu/agent/auth.json`; the key must be in the env.

**Result: 16 match · 11 mismatch.** All 30 pages now have a verdict. Every mismatch was
independently re-verified by hand against `main` (real doc↔code contradictions, no model
hallucination) — see "Open" below.

| verdict  | pages |
|----------|-------|
| match (16)    | index, keybindings, llama-cpp, prompt-templates, providers, quickstart, security, session-format, sessions, shell-aliases, terminal-setup, termux, tmux, tui, usage, windows |
| mismatch (11) | compaction, custom-provider, environment-variables, extensions, models, packages, rpc, sdk, settings, skills, themes |

> ⚠️ **Model caveat.** This is a *different* model from the baseline. In practice it was
> a stronger docs auditor than the aborted `qwen3.6-plus` run (11 real bugs on 27 pages).
> The *findings* are valid — verified by hand — but do **not** fold this column into the
> `qwen3.6-plus` baseline. A full green `qwen3.6-plus` sweep is still the regression
> reference.

## Verified documentation bugs (13 total — 2 fixed, 11 open)

Every entry was re-checked against `main` by hand, not taken on the auditor's word.

### Fixed (2026-09-24; both re-run and confirmed `match`)

1. **`development.md`** — referenced `getThemeDir`, which does not exist in
   `src/config.ts`; corrected to the real export `getThemesDir`.
2. **`json.md`** — base-message type line refs and the GitHub anchor drifted by 288
   lines (134/140/152 → 422/428/452).

### Open (found by the 2026-09-24 deepseek sweep)

| page | claim in doc | reality in code |
|------|--------------|-----------------|
| `compaction.md:23,219,244` | compaction and branch summarization "use the same structured format", incl. a `## Critical Context` section | `BRANCH_SUMMARY_PROMPT` (branch-summarization.ts) has **no** `## Critical Context`; only the compaction prompts do |
| `custom-provider.md:646` | lists `image-limits.test.ts` as an existing, copyable test | no such file in `packages/ai/test/` |
| `environment-variables.md:85` | `BAILU_SKIP_VERSION_CHECK` disables "the `pi.dev` latest-version request" | target is the npm registry entry `registry.npmjs.org/@bailu/coding-agent/latest` (`version-check.ts:14`); no pi.dev request exists |
| `extensions.md` | package.json manifest key is `"bailu"` | loader reads `pkg.pi` (`bailu-manifest.ts:20,26`) — a `bailu` key is silently ignored. Also: example factories are declared `(bailu: ExtensionAPI)` but bodies call `pi.*` |
| `models.md:386` | custom `models` merge *after* `modelOverrides` (custom wins on same id) | reversed — overrides apply **after** custom upserts, so the override wins (`provider-composer.ts:440`) |
| `packages.md:124,143,183,265` | package resources declared under the `"bailu"` key | same as `extensions.md`: the loader only reads `pi`, so a `bailu` manifest is ignored |
| `rpc.md:816+` | `get_commands` returns top-level `location` and `path` per command | returns a nested `sourceInfo` object; no `location`/`path` (`rpc-types.ts:89`) |
| `sdk.md:690,738` | `Skill` uses `source: "custom"`, `PromptTemplate` uses `source: "(custom)"` | neither interface has a `source` field; both use `sourceInfo` (`skills.ts:74`, `prompt-templates.ts:11`) |
| `settings.md:84` | install/update ping → `pi.dev/api/report-install`; update check → `pi.dev/api/latest-version` | `getInstallTelemetryEndpoint()` returns `BAILU_TELEMETRY_URL` and is off by default (`telemetry.ts:21`); the check hits the npm registry |
| `skills.md:83` | skill-command args are appended as `User: <args>` | args are appended raw after the `<skill>…</skill>` block, no prefix (`agent-session.ts:1377`) |
| `themes.md:164,170` | theme must define "all **53** required tokens"; scrollbar tokens not marked optional | only **51** required; `scrollbarTrack`/`scrollbarThumb` are `Type.Optional` with fallbacks (`theme-json.ts:36`, `theme.ts:270`) |

> Two entries (`environment-variables.md`, `settings.md`) are **`pi.dev` leftovers** from
> the rebrand: the code moved to npm/bailu channels, the docs did not. Same cleanup
> family as the other stray pi.dev references tracked outside this file.

Fixing these is optional editorial work, not required to keep the audit green — but a
re-run of the touched pages should confirm they flip to `match`.

## Round 2 (2026-09-24) — fixes verified, new issues surfaced

All 11 open issues above were fixed, plus a global rename of the extension-API references
from `pi.` to `bailu.` across the docs and `README.md`. Re-auditing the 13 touched pages
(`deepseek-flash`, 13 runs ≈ $0.63):

- **7 flipped to `match`** — the fixes hold: `compaction`, `environment-variables`,
  `packages`, `session-format`, `skills`, `themes`, `tui`. (`development.md` and `json.md`
  had already flipped in Round 1.)
- **6 still `mismatch`, but on _different_ issues** — none of the reasons mention a Round-1
  fix, so the fixes were correct; these are newly surfaced:

| page | new issue |
|------|-----------|
| `custom-provider.md:36` | imports `openAICompletionsApi` from `@bailu/ai` root, which does not export it |
| `extensions.md:2922` | `highlightCode(code, lang, theme)` — real signature is `highlightCode(code, lang?): string[]` |
| `models.md:475` | `{ "$var": "thinking.budget" }` — schema only allows `thinking.enabled` / `thinking.effort` |
| `rpc.md` (Types) | documents an `### Attachment` interface and an `"attachments": []` field that do not exist |
| `sdk.md` (tree API) | `sm.getPath()` does not exist; the method is `SessionManager.getBranch()` |
| `settings.md` | **not a doc issue** — the agent called `submit_documentation_audit` twice, failing the harness `toHaveLength(1)` assertion (model-discipline flake, same class as the extensions eval's 0/1) |

> **How to read a verdict.** The audit does a *bounded* exploration per run: it reports the
> contradiction(s) it finds, then returns its verdict. It does **not** enumerate every issue
> on a page. So a `match` means "no issue surfaced this run" — **not** "provably clean" — and
> fixing a reported issue tends to expose the next one on a later run. Convergence is
> iterative; treat each run as a sample, not an exhaustive check. This also means a single
> run is a weak gate: use `mismatch` as a strong "there is a real bug" signal, and `match` as
> "nothing found this time".

**Rounds 3–5 (2026-09-24): all six fixed and re-verified to `match`.** Some notes worth
keeping:

- The `sdk.md` item also uncovered `SettingsManager.create()` called with no args (its `cwd`
  is required) and a `type Tool` listed as a main-entry export that it is not.
- The `rpc.md` failure was a **self-inflicted regression**: a blanket `pi.` → `bailu.` rename
  rewrote the `pi.` inside `api.anthropic.com`, yielding `abailu.anthropic.com` (1 in `rpc.md`,
  5 in `custom-provider.md`). The audit caught it on the next run — a fair demonstration that
  the loop works.
- The `models.md` item exposed a **code** inconsistency, not just docs: `model-config.ts`'s
  `$var` schema allows only `thinking.enabled`/`thinking.effort`, while `types.ts:92` and
  `openai-completions.ts` also implement `thinking.budget`. The doc now matches the schema
  (which is the models.json validation gate); the schema/type gap is a code bug left unfixed.

Net: every one of the 13 touched pages audits as `match` after its fix — but by the caveat
above that is "nothing found in these runs", not a proof the corpus is clean.

## Round 6 (2026-09-24) — full 30-page sweep

One complete run of all 30 pages (`deepseek-flash`, 30 runs ≈ $1.04): **27 match · 3 mismatch.**

The 3 were new, previously-unreported issues — and tellingly, two were on pages an earlier run
had marked `match`, one was an *incomplete* fix of my own:

| page | issue |
|------|-------|
| `compaction.md` | entry-structure blocks declared `timestamp: number` / `parentId: string`; real is `timestamp: string` (ISO 8601) / `parentId: string \| null` |
| `packages.md` | the **intro sentence** still said the manifest key is `bailu` — an earlier pass had fixed the JSON examples but missed the prose |
| `providers.md` | login-menu labels documented as `Use a subscription` / `Use an API key`; the code renders `Sign in with an account` / `Sign in with an API key` |

All three fixed and re-verified to `match`.

> This is the clearest evidence for the sampling caveat: a full run surfaced three issues the
> targeted runs had missed, two on pages those runs had passed. "Fix until green" converges only
> because each round re-samples — never treat a `match` as exhaustive.

## Caveats

- Baseline is only meaningful for **opencode-go / qwen3.6-plus**. Changing the
  model invalidates it by design; compare *that* new lineup against this one.
- 12 of 30 docs pages are untested (network aborts). Their current status is
  **unknown**, not pass.
- Token/cost figures include the two completed audits plus setup; aborted pages
  cost little because requests died before generating much.

## Re-run to complete

On a healthy network:

```bash
OPENCODE_API_KEY=$OPENCODE_API_KEY npm run eval -- --provider opencode-go --model qwen3.6-plus
```

To resume only the docs sweep slice-by-slice (vitest `-t` filters by test name,
e.g. page file):

```bash
npm run eval -- --provider opencode-go --model qwen3.6-plus src/docs.eval.ts
```

Artifact dirs accumulate under `packages/evals/.eval/` (gitignored); keep the
ledger line of the newest one when updating this file.