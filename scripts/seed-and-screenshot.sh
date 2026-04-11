#!/bin/bash
# Seeds the canvas with demo content and captures a screenshot for the README.
# Requires: canvas server running on PORT.

PORT=${1:-4519}
BASE="http://127.0.0.1:$PORT"

echo "Seeding canvas at $BASE..."

# Clear
curl -s -X POST "$BASE/api/canvas/clear" > /dev/null

# ── Column 1: Project overview (left) ──────────────────────
WELCOME=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "Project Architecture",
    "content": "## Auth Service Refactor\n\nMigrating from session-based auth to **JWT + refresh tokens**.\n\n### Goals\n- Stateless authentication\n- Token rotation with refresh flow\n- Backwards-compatible API\n\n### Files changed\n`src/auth/jwt.ts` · `src/middleware/verify.ts` · `src/routes/login.ts`",
    "x": 60, "y": 60, "width": 380, "height": 340
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

PLAN=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "Implementation Plan",
    "content": "### Phase 1 — Token issuing\n1. Generate RS256 key pair\n2. Issue access token (15min) + refresh token (7d)\n3. Store refresh token hash in DB\n\n### Phase 2 — Middleware\n4. Replace session lookup with JWT verify\n5. Add token refresh endpoint\n\n### Phase 3 — Rollout\n6. Feature flag: `USE_JWT_AUTH`\n7. Dual-mode for 2 weeks\n8. Remove session code",
    "x": 60, "y": 430, "width": 380, "height": 360
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

# ── Column 2: Code + context (center) ──────────────────────
PIPELINE=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "CI Pipeline Status",
    "content": "**Status:** All checks passing\n\n| Check | Result |\n|-------|--------|\n| Unit tests | 142 passed |\n| Coverage | 94% |\n| Build | 3.2s |\n| Lint | clean |\n\nBranch: `feature/jwt-auth`",
    "x": 480, "y": 60, "width": 340, "height": 280
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

JWT=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "src/auth/jwt.ts",
    "content": "```typescript\nimport { SignJWT, jwtVerify } from \"jose\";\n\nconst ALG = \"RS256\";\n\nexport async function issueTokenPair(\n  userId: string,\n  privateKey: CryptoKey,\n) {\n  const access = await new SignJWT({ sub: userId })\n    .setProtectedHeader({ alg: ALG })\n    .setExpirationTime(\"15m\")\n    .sign(privateKey);\n\n  const refresh = await new SignJWT({ sub: userId })\n    .setProtectedHeader({ alg: ALG })\n    .setExpirationTime(\"7d\")\n    .sign(privateKey);\n\n  return { access, refresh };\n}\n```",
    "x": 480, "y": 370, "width": 340, "height": 420
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

# ── Column 3: Review + deps (right) ─────────
REVIEW=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "Security Review Notes",
    "content": "### Token Storage\n- Access token: memory only (no localStorage)\n- Refresh token: httpOnly secure cookie\n- Key rotation: every 30 days via cron\n\n### Attack Surface\n- XSS mitigated: no token in JS-accessible storage\n- CSRF mitigated: SameSite=Strict on cookie\n- Replay mitigated: refresh token is single-use",
    "x": 860, "y": 60, "width": 360, "height": 320
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

DEPS=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "Dependencies",
    "content": "| Package | Version | Purpose |\n|---------|---------|--------|\n| jose | 5.2.0 | JWT sign/verify |\n| argon2 | 0.31.0 | Refresh token hashing |\n| cookie | 0.6.0 | Secure cookie handling |",
    "x": 860, "y": 410, "width": 360, "height": 180
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

AGENT=$(curl -s -X POST "$BASE/api/canvas/node" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "title": "Agent Activity Log",
    "content": "**Latest run:** Implemented `issueTokenPair` and `verifyAccess`\n\n- Added 4 new files\n- Modified 2 existing files\n- Duration: 48s\n- All tests passing after changes",
    "x": 860, "y": 620, "width": 360, "height": 170
  }' | bun -e 'const j=await Bun.stdin.json();console.log(j.id)')

echo "Nodes: $WELCOME $PLAN $PIPELINE $JWT $REVIEW $DEPS $AGENT"

# ── Edges ──────────────────────────────────────────────────
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$WELCOME\",\"to\":\"$PLAN\",\"type\":\"flow\",\"label\":\"phases\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$WELCOME\",\"to\":\"$PIPELINE\",\"type\":\"flow\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$PLAN\",\"to\":\"$JWT\",\"type\":\"depends-on\",\"label\":\"implements\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$PIPELINE\",\"to\":\"$JWT\",\"type\":\"relation\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$JWT\",\"to\":\"$REVIEW\",\"type\":\"references\",\"label\":\"reviewed in\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$REVIEW\",\"to\":\"$DEPS\",\"type\":\"depends-on\"}" > /dev/null
curl -s -X POST "$BASE/api/canvas/edge" -H "Content-Type: application/json" \
  -d "{\"from\":\"$AGENT\",\"to\":\"$JWT\",\"type\":\"references\",\"label\":\"produced\"}" > /dev/null

# ── Pin context nodes ─────────────────────────────────────
curl -s -X POST "$BASE/api/canvas/context-pins" -H "Content-Type: application/json" \
  -d "{\"nodeIds\":[\"$WELCOME\",\"$JWT\",\"$REVIEW\"]}" > /dev/null

echo "Canvas seeded with 7 nodes, 7 edges, 3 pins."
echo "Open http://127.0.0.1:$PORT/workbench to preview."
