# claude-muse Setup & Operations Guide

This guide walks through configuring **`claude-muse`** (Claude Code powered by Meta Model API with Muse Spark models) and the **`/talk`** cross-terminal bridge between Claude Code and Muse Code.

---

## Architecture Overview

```
┌──────────────────────────────────────┐     ┌──────────────────────────────────────┐
│             Claude Code              │     │              Muse Code               │
│     (claude-muse launcher)           │     │          (native binary)             │
│  - Meta Model API key, or Muse Code  │     │  - Muse Code subscription            │
│    subscription (in progress)        │     │                                      │
│  - Model: muse-spark-1.3             │     │  - Native Spark model                │
└──────────────────┬───────────────────┘     └──────────────────┬───────────────────┘
                   │                                            │
                   │ stdio MCP (talk_*)                         │ stdio MCP (talk_*)
                   ▼                                            ▼
           ┌──────────────┐                             ┌──────────────┐
           │ talk-adapter │                             │ talk-adapter │
           └──────┬───────┘                             └──────┬───────┘
                  │                                            │
                  └──────────────► Unix Domain Socket ◄────────┘
                                 (~/.claude-muse/talk.sock)
                                           │
                                           ▼
                                 ┌──────────────────┐
                                 │  /talk Broker    │
                                 │ - Room State     │
                                 │ - SQLite Journal │
                                 │ - Max 6 stages   │
                                 │ - 8 KiB message  │
                                 └──────────────────┘
```

---

## Prerequisites

1. **Node.js >= 26.0.0** (`node -v`)
2. **Claude Code CLI** installed (`claude`)
3. **Muse Code CLI** installed (`muse`)
4. **Meta credentials**, either:
   - a **Muse Code subscription** login (run `muse` once and sign in), or
   - a **Meta Model API key** from [dev.meta.ai](https://dev.meta.ai)
5. **Xcode License Accepted**: If using Git worktrees, ensure you have run:
   ```bash
   sudo xcodebuild -license accept
   ```

---

## 1. Installation

Run the automated installer script from the repository root:

```bash
./scripts/install.sh
```

This compiles TypeScript, links `claude-muse` globally, and installs skill definitions to:
- `~/.claude/skills/talk.md`
- `~/.muse/skills/talk.md`

---

## 2. Configuration (`claude-muse setup`)

Run the setup wizard:

```bash
claude-muse setup
```

The wizard will:
1. Pick a credential, in this order:
   - If you're signed in to Muse Code, offer your **Muse Code subscription**. No API key needed; the token is read live from Muse's own Keychain entry and never copied.
   - Otherwise (or if you decline), offer to reuse the API key already stored in Muse (`muse auth set`), so you never enter it twice.
   - Otherwise, prompt for your Meta Model API key.
2. Store a newly entered key in macOS Keychain under service `com.claude-muse.meta-api-key` (skipped when using the subscription or Muse's stored key).
3. Test authentication against `https://api.meta.ai/v1/models`.
4. List available Spark models (e.g. `muse-spark-1.3`, `muse-spark-1.3-contributor`).
5. Configure model alias mappings and the credential source (`muse-subscription`, `keychain` or `muse`) in `~/.claude-muse/config.json`.
6. Verify local tool dependencies.

> [!NOTE]
> When no claude-muse Keychain entry exists, `launch` and `models` automatically fall back to the API key in Muse's credential store (with a notice). Pass `--muse` to force Muse's stored API key for a single run, e.g. `claude-muse launch --muse`.
> Pass `--subscription` to force the Muse Code subscription for a single run. `--muse` and `--subscription` can't be combined.
> The subscription never falls back to an API key: if your Muse login is missing or expired, the command stops and tells you to run `muse` to sign in again, rather than silently switching you onto pay-as-you-go billing.

> [!IMPORTANT]
> Subscription mode is in progress. The developer Model API (`https://api.meta.ai/v1`) rejects the subscription token (401), so `launch` on the subscription currently exits with "not supported yet". `setup`, `models --subscription` and `doctor --subscription` accept the setting but their API checks fail for the same reason. Launch with an API key until Muse's subscription endpoint is wired up.

---

## 3. Diagnostics (`claude-muse doctor`)

Run diagnostics at any time to verify system health:

```bash
claude-muse doctor
# or check the subscription login for this run:
claude-muse doctor --subscription
```

Checks performed:
- Node.js runtime version
- Credential status (Keychain entry, Muse API key, or Muse Code subscription login and expiry)
- Meta API authentication & connectivity
- Model availability
- Messages API streaming latency
- Claude Code & Muse Code binary detection
- Git readiness & Xcode license status
- Native Muse login status (stored API key and subscription token present or not)

---

## 4. Launching Claude Code with Muse Spark

To launch Claude Code using Meta Model API:

```bash
claude-muse launch
```

Or pass a specific model:

```bash
claude-muse launch --model muse-spark-1.3
```

> [!NOTE]
> With an API key, `claude-muse` launches Claude with:
> - `ANTHROPIC_BASE_URL=https://api.meta.ai` (Claude Code adds `/v1/messages` itself)
> - `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` set to the selected Spark model, so background requests don't ask Meta for Claude model names
> - `ANTHROPIC_AUTH_TOKEN=<key retrieved from Keychain or Muse>`, sent as `Authorization: Bearer`
>
> `ANTHROPIC_AUTH_TOKEN` is used rather than `ANTHROPIC_API_KEY` because Claude Code ranks it above a claude.ai login without an approval prompt. With `ANTHROPIC_API_KEY`, a Claude Pro/Max login could be used instead and sent to the Meta endpoint, failing with 401. Any `ANTHROPIC_API_KEY` in your shell is removed for the launched session.
>
> `claude-muse launch --subscription` (or a `muse-subscription` config) is not available yet and exits with an error.
>
> Your standard `claude` and `muse` binaries remain completely untouched.

---

## 5. Using the `/talk` Cross-Terminal Bridge

The `/talk` bridge allows Claude Code and Muse Code to collaborate on a shared task in a structured 6-stage protocol.

### Step 1: Start the Broker
In a dedicated terminal or background process:

```bash
claude-muse talk broker
```

### Step 2: Join the Room from Terminal 1 (Claude Code)
In your Claude Code session:
```
/talk join feature-auth claude-dev
```

### Step 3: Join the Room from Terminal 2 (Muse Code)
In your Muse Code session:
```
/talk join feature-auth muse-reviewer
```

### Step 4: Initiate the Exchange
From either session:
```
/talk start feature-auth "Migrate authentication from session cookies to JWT tokens"
```

### Step 5: Follow the 6-Stage Protocol
The exchange advances automatically through:
1. **PROPOSAL**: Initiator outlines problem, design, and work division.
2. **CRITIQUE & OWNERSHIP**: Peer provides constructive critique and commits to specific files.
3. **IMPLEMENTATION A**: First participant reports concrete code edits and test status.
4. **IMPLEMENTATION B**: Second participant shares their edits and test results.
5. **REVIEW**: Both participants inspect each other's work.
6. **SYNTHESIS**: Final summary compiling agreements, disagreements, files changed, and test outcomes.

### Step 6: View Transcript & Export
```bash
claude-muse talk transcript feature-auth
```

---

## 6. Billing & Subscription Separation

- **Muse Code**: Covered exclusively by your existing Muse Code subscription.
- **Claude Code via `claude-muse` with an API key** (`keychain` or `muse` source): API calls are routed through your Meta Model API key and billed on a pay-as-you-go basis, completely separate from the subscription.
- **Claude Code via `claude-muse` with the subscription** (`muse-subscription` source, in progress): will draw from the same Muse Code subscription quota as native Muse, so heavy use in one reduces what's left for the other.

> [!WARNING]
> Subscription mode reuses Muse Code's own sign-in token from a separate client. Check that Meta's Muse Code terms allow this before relying on it; using it outside the official client may risk account limits.
