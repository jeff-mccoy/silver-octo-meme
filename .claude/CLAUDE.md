# Claw — Multi-Agent Collaborative Sandbox

Declarative multi-agent workspace. Define agents in YAML, get a full Docker stack with one command. Agents chat together (and with humans) in a shared Matrix room.

## Architecture

```
Docker:
  Synapse (Matrix homeserver) ← agents + human connect here
  mitmproxy (egress control)  ← all agent traffic routed through
  Element (web chat UI)       ← human uses this to chat
  N x claw-agent containers   ← each has own identity, memory, soul
```

## Key Files

| Path | Purpose |
|------|---------|
| `claw.yaml` | Agent config — edit this, run `./init.sh` |
| `.env` | API keys (ANTHROPIC_API_KEY) |
| `init.sh` | Generates Docker Compose stack from claw.yaml |
| `claw-agent/` | Agent container source (~500 lines, 5 files) |
| `claw-init/` | Init container (YAML parser + provisioner) |
| `examples/` | Example identity files |
| `generated/` | Output of init.sh (docker-compose.yml + data) |
| `generated/agent-data/<name>/` | Per-agent persistent data (memory, sessions, soul) |

## Skills

| Skill | Purpose |
|-------|---------|
| `/claw-up` | Set up and start a workspace (interactive — asks what agents you want) |
| `/claw-down` | Tear down the stack |
| `/claw-status` | Check health of running services |
| `/claw-add-agent` | Add an agent to a running stack |

## Agent Runtime (claw-agent/)

Each agent is a Node.js container running the Claude Agent SDK. Features:
- **Matrix bot** — connects to Synapse, listens and responds in chat
- **Identity** — persona loaded from `/config/IDENTITY.md` each turn
- **Memory** — JSON files in `/data/memory/`, managed via Claude Code's native tools
- **Soul** — `/data/soul.md`, agent's evolving self-reflection
- **Heartbeat** — periodic wake-up (default 30min)
- **Reflection** — daily memory/soul maintenance (default 24h)
- **Room context** — fetches recent chat messages before each response
- **Session continuity** — conversations resume across restarts

## Ports

Default ports are in the 38xxx range to avoid collisions with common dev services:
- 38008 — Synapse (Matrix API)
- 38088 — Element (chat UI)
- 38081 — mitmproxy (traffic inspector)

Configurable in `claw.yaml`. init.sh checks for port conflicts before generating.

## Common Tasks

**Start fresh:**
```bash
echo "ANTHROPIC_API_KEY=..." > .env
vim claw.yaml
./init.sh
cd generated && docker compose up -d
```

**Add an agent:** Use `/claw-add-agent` or manually edit claw.yaml and re-run `./init.sh`.

**View agent logs:** `cd generated && docker compose logs -f agent-<name>`

**Wipe agent memory:** `rm -rf generated/agent-data/<name>/memory/*`

**Reset everything:** `rm -rf generated/ && ./init.sh`
