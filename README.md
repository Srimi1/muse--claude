# Muse Spark in Claude Code + Cross-Terminal `/talk`

A hybrid coding agent harness that enables **Claude Code** to be driven by **Meta Model API** (Muse Spark models) alongside native **Muse Code**, with a cross-terminal structured exchange bridge (`/talk`).

---

## Architecture

- **`claude-muse`**: Drop-in launcher wrapping Claude Code with Meta credentials: a Meta Model API key stored in macOS Keychain, or (in progress) your existing Muse Code subscription.
- **`/talk` Broker**: Local Unix-domain socket server with a WASM SQLite message journal (`sql.js`).
- **6-Stage Collaboration Protocol**:
  1. `PROPOSAL`
  2. `CRITIQUE_OWNERSHIP`
  3. `IMPLEMENTATION_A`
  4. `IMPLEMENTATION_B`
  5. `REVIEW`
  6. `SYNTHESIS`
- **MCP Stdio Adapter**: Exposes `/talk` capabilities directly to both Claude Code and Muse Code as native agent tools (`talk_join`, `talk_send`, `talk_receive`, `talk_status`, `talk_stop`).
- **Safeguards**: Max 6 messages, 8 KiB size limits, 30-minute deadline, session isolation, and worktree isolation. Peer messages cannot execute tools or bypass permissions.

### Broker durability

Room state, participants and messages are written to the SQLite journal as the
exchange progresses, and the broker rebuilds its in-memory rooms from that
journal on startup. Restarting `claude-muse talk broker` therefore resumes an
exchange at the stage it had reached rather than orphaning the room. A room
whose 30-minute deadline lapsed while the broker was down is restored as
`CANCELLED`. The broker shuts down on `SIGINT`/`SIGTERM`, releasing its
deadline timers and removing its socket.

---

## Quick Start

### 1. Install & Build
```bash
./scripts/install.sh
```

### 2. Configure Credentials
```bash
claude-muse setup
```
If you're signed in to Muse Code, setup first offers to use your **Muse Code subscription** instead of an API key. Otherwise, if Muse already has a Meta API key (`muse auth set`), setup offers to reuse it, so you don't enter the key twice. For a single run, `--muse` forces Muse's stored API key and `--subscription` forces the subscription (the two can't be combined).

> [!IMPORTANT]
> Subscription mode is in progress. `setup`, `models --subscription` and `doctor --subscription` accept it today, but `claude-muse launch` on the subscription exits with "not supported yet" until Muse's subscription endpoint is wired up. Keep using an API key to launch for now.

### 3. Verify Setup
```bash
claude-muse doctor
```

### 4. Launch Claude Code with Muse Spark
```bash
claude-muse launch
# or specify model:
claude-muse launch --model muse-spark-1.3
```

### 5. Cross-Terminal `/talk` Collaboration
In terminal 1:
```bash
claude-muse talk broker
```

In Claude Code session:
```
/talk join feature-x claude-dev
```

In Muse Code session:
```
/talk join feature-x muse-dev
```

Initiate task from either terminal:
```
/talk start feature-x "Implement user authentication with JWT"
```

---

## Testing

Run the full automated test suite:
```bash
npm test
```

Run specific test suites:
```bash
npm run test:api        # Meta API client & model resolution
npm run test:broker     # Broker room lifecycle & SQLite journal
npm run test:protocol   # Wire protocol & NDJSON parsing
npm run test:mcp        # MCP tools schemas
npm run test:e2e        # End-to-end two-terminal collaboration simulation
npm run test:regression # Journal persistence, broker restart & shutdown
npm run test:security   # Credential and git-argument handling
```

---

## Documentation

- [Setup & Operations Guide](docs/setup-guide.md)
- [Uninstallation Guide](docs/uninstall.md)
