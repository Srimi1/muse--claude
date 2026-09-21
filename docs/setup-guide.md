# claude-muse Setup & Operations Guide

This guide walks through configuring **`claude-muse`** (Claude Code powered by Meta Model API with Muse Spark models) and the **`/talk`** cross-terminal bridge between Claude Code and Muse Code.

---

## Architecture Overview

```
┌──────────────────────────────────────┐     ┌──────────────────────────────────────┐
│             Claude Code              │     │              Muse Code               │
│     (claude-muse launcher)           │     │          (native binary)             │
│  - Powered by Meta Model API         │     │  - Muse Code subscription            │
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
4. **Meta Model API Key**: Obtain from [dev.meta.ai](https://dev.meta.ai)
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
1. Prompt for your Meta Model API key.
2. Securely store it in macOS Keychain under service `com.claude-muse.meta-api-key`.
3. Test authentication against `https://api.meta.ai/v1/models`.
4. List available Spark models (e.g. `muse-spark-1.3`, `muse-spark-1.3-contributor`).
5. Configure model alias mappings in `~/.claude-muse/config.json`.
6. Verify local tool dependencies.

---

## 3. Diagnostics (`claude-muse doctor`)

Run diagnostics at any time to verify system health:

```bash
claude-muse doctor
```

Checks performed:
- Node.js runtime version
- Keychain entry status
- Meta API authentication & connectivity
- Model availability
- Messages API streaming latency
- Claude Code & Muse Code binary detection
- Git readiness & Xcode license status
- Native Muse subscription verification

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
> `claude-muse` launches Claude with:
> - `ANTHROPIC_BASE_URL=https://api.meta.ai/v1`
> - `ANTHROPIC_API_KEY=<key retrieved directly from macOS Keychain>`
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
- **Claude Code via `claude-muse`**: API calls are routed through your Meta Model API key and billed on a pay-as-you-go basis.
- The two billing channels are completely separate and do not conflict.
