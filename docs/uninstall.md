# claude-muse Uninstallation Guide

This document outlines how to cleanly and completely remove `claude-muse`, its configuration, credentials, and installed skills from your system.

---

## Complete Removal Steps

### Step 1: Remove Meta API Key from macOS Keychain
Run the following command to delete the stored API key:

```bash
security delete-generic-password -s com.claude-muse.meta-api-key -a claude-muse
```

### Step 2: Unlink CLI Binary
From anywhere in your terminal:

```bash
npm unlink -g claude-muse
```

Or from the `claude-muse` project directory:
```bash
npm unlink
```

### Step 3: Remove Configuration & Broker Data
Remove the application directory including journal databases, socket files, and configuration:

```bash
rm -rf ~/.claude-muse
```

### Step 4: Remove Installed Skills

#### Claude Code:
```bash
rm -f ~/.claude/skills/talk.md
```

#### Muse Code:
```bash
rm -f ~/.muse/skills/talk.md
```

---

## Verification

To verify that your native `claude` and `muse` installations remain pristine:

1. Check Claude Code:
   ```bash
   claude --version
   ```
2. Check Muse Code:
   ```bash
   muse --version
   ```
3. Check `claude-muse` has been removed:
   ```bash
   which claude-muse || echo "claude-muse successfully unlinked"
   ```
