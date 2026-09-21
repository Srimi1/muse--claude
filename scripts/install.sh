#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# claude-muse installer
# Builds claude-muse, links executable, and installs /talk skills
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}=== claude-muse Installer ===${NC}\n"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}✗ Node.js is not installed. Please install Node.js >= v26.0.0.${NC}"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR}" -lt 26 ]; then
  echo -e "${YELLOW}⚠ Node.js $(node -v) detected. Node >= v26.0.0 is recommended.${NC}"
else
  echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
fi

# 2. Check Claude Code CLI
if command -v claude >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Claude Code CLI found at $(which claude)${NC}"
else
  echo -e "${YELLOW}⚠ 'claude' not found in PATH. Install with: npm install -g @anthropic-ai/claude-code${NC}"
fi

# 3. Check Muse Code CLI
if command -v muse >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Muse Code CLI found at $(which muse)${NC}"
else
  echo -e "${YELLOW}⚠ 'muse' not found in PATH.${NC}"
fi

# 4. Check Git and Xcode license
echo -n "Checking git status... "
if git --version >/dev/null 2>&1; then
  echo -e "${GREEN}✓ git operational${NC}"
else
  GIT_ERR=$(git --version 2>&1 || true)
  if echo "${GIT_ERR}" | grep -iq "Xcode"; then
    echo -e "${YELLOW}⚠ Git is blocked by unaccepted Xcode license!${NC}"
    echo -e "${YELLOW}  Run in your terminal: sudo xcodebuild -license accept${NC}"
    echo -e "${YELLOW}  (Installer will NOT accept licenses on your behalf)${NC}"
  else
    echo -e "${RED}✗ Git unavailable${NC}"
  fi
fi

# 5. Install dependencies and build
echo -e "\n${BOLD}Building claude-muse...${NC}"
cd "${PROJECT_ROOT}"
npm install
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

# 6. Link binary globally
echo -e "\n${BOLD}Linking claude-muse binary...${NC}"
npm link
echo -e "${GREEN}✓ 'claude-muse' binary linked to PATH${NC}"

# 7. Install /talk skill files
echo -e "\n${BOLD}Installing /talk skills...${NC}"

# Claude Code skill directory
CLAUDE_SKILL_DIR="${HOME}/.claude/skills"
mkdir -p "${CLAUDE_SKILL_DIR}"
cp "${PROJECT_ROOT}/src/skills/claude-talk.md" "${CLAUDE_SKILL_DIR}/talk.md"
echo -e "${GREEN}✓ Installed Claude Code skill -> ${CLAUDE_SKILL_DIR}/talk.md${NC}"

# Muse Code skill directory
MUSE_SKILL_DIR="${HOME}/.muse/skills"
mkdir -p "${MUSE_SKILL_DIR}"
cp "${PROJECT_ROOT}/src/skills/muse-talk.md" "${MUSE_SKILL_DIR}/talk.md"
echo -e "${GREEN}✓ Installed Muse Code skill -> ${MUSE_SKILL_DIR}/talk.md${NC}"

# 8. Setup MCP config instructions
echo -e "\n${BOLD}=== Installation Complete ===${NC}"
echo -e "Next steps:"
echo -e "  1. Run ${BOLD}claude-muse setup${NC} to configure your Meta Model API key"
echo -e "  2. Run ${BOLD}claude-muse doctor${NC} to verify diagnostics"
echo -e "  3. Start a talk broker in the background with: ${BOLD}claude-muse talk broker &${NC}"
echo -e "  4. Launch Claude Code with: ${BOLD}claude-muse launch${NC}"
echo -e ""
