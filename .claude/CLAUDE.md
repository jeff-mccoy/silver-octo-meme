# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Claw is a declarative multi-agent collaborative sandbox. Users define agents in `claw.yaml`, run `./init.sh` to generate a Docker Compose stack, and agents chat together (and with humans) in a shared Matrix room. Each agent runs the Claude Agent SDK in its own container.

## Build & Run

```bash
# Generate stack from claw.yaml (builds claw-init Docker image, outputs to generated/)
./init.sh

# Start everything
cd generated && docker compose up -d

# Rebuild a single agent after code changes
cd generated && docker compose up -d --build agent-<name>

# View logs
cd generated && docker compose logs -f agent-<name>

# Regenerate after editing claw.yaml (preserves agent data in generated/agent-data/)
./init.sh && cd generated && docker compose up -d
```

There are no tests or linters in this project. The agent code is plain Node.js ESM (~500 lines across 5 files) with no build step.

## Architecture

Two Docker images, one config file:

1. **claw-init** (`claw-init/`) — Reads `claw.yaml`, renders EJS templates (`claw-init/templates/`) into `generated/docker-compose.yml` + Synapse/Element/mitmproxy configs. Also runs in "provision" mode as a Docker Compose init container to register Matrix accounts and create the chat room via Synapse's admin API.

2. **claw-agent** (`claw-agent/`) — The agent runtime. One container per agent. Connects to Matrix as a bot, pipes messages through the Claude Agent SDK's `query()` function, posts responses back. Each agent container mounts:
   - `/config/IDENTITY.md` — persona (read-only, from `generated/agent-config/<name>/`)
   - `/data/` — persistent state (from `generated/agent-data/<name>/`): memory files, sessions, soul

3. **claw.yaml** — Single source of truth. Defines agents (name, model, identity file, workspace mounts), human user, ports, egress mode, and agent defaults. `init.sh` is a thin shell wrapper that builds claw-init, runs generate mode, and checks for port conflicts.

### Agent message flow

```
Matrix message → index.mjs (shouldRespond filter) → agent.mjs (runAgent)
  → builds system prompt: IDENTITY.md + feedback + person memory + general memories + soul + token stats
  → Claude Agent SDK query() with session resume
  → streams response, tracks token usage
  → posts response back to Matrix (chunked at 4000 chars)
```

### Agent subsystems (all in claw-agent/)

- **memory.mjs** — Loads `/data/memory/*.md` (general) and `/data/memory/people/*.md` (per-person) into the system prompt. Max 50 memories. Agent manages files via Claude Code's native Read/Write tools.
- **heartbeat.mjs** — Periodic wake-up (default 30min). Reads `/config/HEARTBEAT.md` for instructions, runs a prompt, posts to Matrix only if there's something to report (suppresses "HEARTBEAT_OK").
- **reflection.mjs** — Daily maintenance (default 24h, first run after 5min). Reviews and prunes memories, updates `/data/soul.md`. Uses `/config/REFLECTION.md` for custom instructions or falls back to a built-in prompt.
- **Session continuity** — `sessions.json` maps room IDs to Claude session IDs. On resume failure, automatically retries fresh.

### respond_to modes

- `all` — respond to every message
- `mentions` — only when @mentioned by name (word-boundary match)
- `smart` (default) — respond to humans always, bots only when @mentioned. Uses `BOT_USERS` env var to distinguish.

## claw-init template system

`claw-init/init.mjs` has two modes:
- **generate** — Parses `claw.yaml`, applies `agent_defaults`, renders EJS templates from `claw-init/templates/` into `generated/`. Generates secrets (`.claw-secrets.json`), copies identity files, creates agent data directories.
- **provision** — Runs as a Docker init container. Registers Matrix accounts via Synapse's HMAC admin API, creates the chat room, invites all agents. Writes `provisioned.json` marker to skip on subsequent runs.

## Skills

Skills in `.claude/skills/` (local) and `skills/` (plugin distribution) provide `/claw-up`, `/claw-down`, `/claw-status`, and `/claw-add-agent`. The `/claw-up` skill is interactive — it asks the user what agents they want, generates `claw.yaml`, runs `init.sh`, and starts the stack.

## Gotchas

- **Env changes require recreate, not restart.** `docker compose restart` does not re-read `.env` or `environment:` changes. After changing `.env`, always use `docker compose up -d --force-recreate` (or just `docker compose up -d` which recreates if config changed).
- **Provision command uses ENTRYPOINT.** The claw-init Dockerfile has `ENTRYPOINT ["node", "init.mjs"]`, so the compose `command:` only provides the mode argument (e.g., `["provision"]`), not the full invocation.

## Key constraints

- All agent egress routes through mitmproxy (port 38081 UI). Mode is set in `claw.yaml` under `egress.mode`: `log-only` or `allowlist`.
- Default ports are 38xxx range (38008 Synapse, 38088 Element, 38081 mitmproxy) to avoid dev server conflicts.
- Agent passwords default to `<name>-bot-2026`. Human password defaults to `<username>-2026`.
- Dependencies: `@anthropic-ai/claude-agent-sdk` and `matrix-bot-sdk` for agents; `yaml` and `ejs` for init.
