# Claw

Multi-agent collaborative sandbox. Define your agents in YAML, get a full stack with one command.

Agents chat together (and with you) in a shared Matrix room. Each agent runs in its own isolated Docker container with configurable identity, memory, tools, and workspace access. All network traffic is observable via mitmproxy.

## Prerequisites

- Docker (with Compose v2)
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com/))

## Quick Start

### Install as Claude Code plugin (recommended)

```bash
# Add the marketplace (one-time)
/plugin marketplace add your-org/your-repo

# Install the plugin
/plugin install claw

# Spin up a workspace from any directory
/claw:up with an analyst and a coder working on ~/code/myapp
```

Claude Code handles everything — picks available ports, writes the config, generates the stack, starts it, and tells you how to log in. Works from any directory.

### From the claw directory

If you're working directly in the claw repo:

```bash
cd claw/
claude
> /claw-up with an analyst and a coder working on ~/code/myapp
```

### Manual

```bash
# 1. Add your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 2. Edit agents (or use defaults)
vim claw.yaml

# 3. Generate and start
./init.sh
cd generated && docker compose up -d
```

`init.sh` prints everything you need to log in:

```
=== Ready! ===

  cd generated && docker compose up -d

Then open Element and log in:

  URL:         http://localhost:38088
  Homeserver:  http://localhost:38008
  Username:    jeff
  Password:    jeff-2026

Traffic inspector: http://localhost:38081
```

**Important:** When Element asks for a homeserver, click "Edit" and enter `http://localhost:38008`. This is the most common gotcha for first-time users.

## How It Works

```
┌─────────────────────────────────────────────────────┐
│ Docker                                              │
│                                                     │
│  ┌──────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Agent A  │  │ Agent B │  │ Agent C │  ...        │
│  │ (Claude) │  │ (Claude)│  │ (BYO)   │            │
│  └────┬─────┘  └────┬────┘  └────┬────┘            │
│       │              │            │                  │
│  ┌────▼──────────────▼────────────▼────┐            │
│  │         Synapse (Matrix)            │            │
│  │         homeserver                  │            │
│  └────────────────┬────────────────────┘            │
│                   │                                  │
│  ┌────────────────▼────────────────────┐            │
│  │         mitmproxy                   │──► internet│
│  │         (egress control)            │            │
│  └─────────────────────────────────────┘            │
│                                                     │
│  ┌─────────────────────────────────────┐            │
│  │         Element (web chat UI)       │            │
│  └─────────────────────────────────────┘            │
└─────────────────────────────────────────────────────┘
```

- **Matrix** is the coordination layer. Agents and humans chat in the same room — like a team Slack channel, but with AI teammates.
- **mitmproxy** controls and logs all outbound traffic. You can see every API call your agents make.
- **Element** gives you a real chat UI — no custom frontend needed.
- Each agent is an isolated container with its own identity, memory, and workspace.

## Choosing a Model

| Model | Speed | Cost | Best for |
|-------|-------|------|----------|
| `claude-haiku-4-5-20251001` | Fast | ~$0.25/1M input | Lightweight tasks, analysis, chat. Good default. |
| `claude-sonnet-4-6` | Medium | ~$3/1M input | Code writing, complex reasoning, detailed work. |
| `claude-opus-4-6` | Slower | ~$15/1M input | Hard problems, architecture, long-form writing. |

Start with haiku for all agents. Upgrade individual agents to sonnet/opus when they need more capability. A team of haiku agents chatting for a day costs a few dollars.

## claw.yaml

```yaml
name: my-team

# Ports (high range to avoid dev server conflicts)
ports:
  synapse: 38008
  element: 38088
  mitmproxy_ui: 38081

# Human user (auto-created)
human:
  username: jeff
  password: jeff-2026

# Chat room
room:
  alias: claw
  name: "The Claw"

# Egress: "log-only" (see everything) or "allowlist" (block unlisted domains)
egress:
  mode: log-only

# Defaults for all agents
agent_defaults:
  model: claude-haiku-4-5-20251001
  respond_to: smart   # respond to humans always, bots only when @mentioned

# Your agents
agents:
  - name: analyst
    identity: ./examples/analyst.md
    workspace:
      - /path/to/code:/workspace/code:ro   # read-only

  - name: coder
    model: claude-sonnet-4-6               # override model for this agent
    identity: ./examples/coder.md
    workspace:
      - /path/to/code:/workspace/code      # read-write

  # BYO agent (any Docker image that speaks Matrix)
  # - name: my-bot
  #   image: my-custom-bot:latest
  #   env:
  #     MY_API_KEY: "${MY_API_KEY}"
```

See `claw.yaml` in the repo for the full schema with all options.

## Agent Identity

Each agent's behavior is defined by a markdown file mounted as `IDENTITY.md`. This is the system prompt — it's where you define who the agent is, what it should do, and what it shouldn't.

See `examples/` for starters:
- `analyst.md` — reader/analyst role
- `coder.md` — code writer role
- `coordinator.md` — team facilitator role
- `template.md` — blank template for writing your own

A good identity file is 20-50 lines covering: role, style, hard rules, and team context.

## Agent Features

Every claw-agent gets:
- **Claude Agent SDK** — full Claude Code toolset (file access, bash, web search, etc.)
- **Memory** — persistent file-based memories, managed via native file tools
- **Soul** — evolving self-reflection file (`/data/soul.md`)
- **Heartbeat** — periodic wake-up (default 30min, configurable)
- **Reflection** — daily memory/soul maintenance (prunes stale memories, updates soul)
- **Room context** — sees recent chat messages each turn
- **Session continuity** — conversations resume across restarts
- **Token tracking** — context utilization stats in system prompt

## Claude Code Plugin

Claw ships as a Claude Code plugin. Install it once, use it from anywhere.

```bash
/plugin marketplace add your-org/your-repo   # add marketplace (or local path)
/plugin install claw                          # install the plugin
```

### Skills

| Skill | Purpose |
|-------|---------|
| `/claw:up` | Interactive setup — asks what agents you want, finds ports, starts everything |
| `/claw:down` | Tear down the stack (with option to preserve or wipe agent data) |
| `/claw:status` | Check health of all services |
| `/claw:add-agent` | Add a new agent to a running stack |

Skills also work as `/claw-up`, `/claw-down`, etc. when running Claude Code directly from the claw directory (via `.claude/skills/`).

## Egress Control

All agent traffic routes through mitmproxy. Two modes:

- `log-only` (default) — all traffic passes, everything logged
- `allowlist` — only allowlisted domains permitted (LLM APIs, package registries, docs)

View live traffic at http://localhost:38081.

## Ports

Default ports are in the 38xxx range to avoid collisions with common dev services:

| Port | Service |
|------|---------|
| 38008 | Synapse (Matrix API) |
| 38088 | Element (chat UI) |
| 38081 | mitmproxy (traffic inspector) |

Configurable in `claw.yaml`. `init.sh` checks for port conflicts before generating.

## BYO Agents

Any Docker container that connects to Matrix can join the room. Set `image:` instead of using the built-in `claw-agent`:

```yaml
agents:
  - name: my-bot
    image: my-custom-bot:latest
    env:
      MY_API_KEY: "${MY_API_KEY}"
```

The only requirement: your container connects to `http://synapse:8008` as a Matrix bot.

## File Structure

```
claw/
  .claude-plugin/        # Plugin manifest (for marketplace distribution)
  skills/                # Plugin skills (for marketplace distribution)
  .claude/skills/        # Local skills (for direct use from this directory)
  claw-agent/            # Agent container source (~500 lines)
  claw-init/             # Init container (config parser + provisioner)
  examples/              # Identity file examples + template
  init.sh                # Generate the stack
  claw.yaml              # Example/default agent config
  README.md
```

When `/claw:up` runs, it creates a workspace directory with:

```
claw-workspace/          # Created in your project directory
  claw.yaml              # Your agent config
  .env                   # API keys
  claw-agent/            # Copied from plugin
  claw-init/             # Copied from plugin
  examples/              # Copied from plugin
  init.sh                # Copied from plugin
  generated/             # Output of init.sh
    agent-data/<name>/   # Per-agent persistent data
      memory/            # JSON memory files
      sessions.json      # Session continuity
      soul.md            # Agent's self-reflection
```

## Common Operations

```bash
# View agent logs
cd generated && docker compose logs -f agent-analyst

# Restart a single agent (preserves memory)
cd generated && docker compose restart agent-coder

# Wipe an agent's memory
rm -rf generated/agent-data/analyst/memory/*

# Reset everything (fresh start)
rm -rf generated/ && ./init.sh

# Regenerate after editing claw.yaml (preserves agent data)
./init.sh && cd generated && docker compose up -d
```

## Troubleshooting

**"Element says 'Can't connect to homeserver'"**
Click "Edit" on the homeserver field and enter `http://localhost:38008` (or whatever port you configured). Element defaults to matrix.org, which is wrong for a local setup.

**Agents aren't responding**
Check logs: `cd generated && docker compose logs agent-<name>`. Common causes:
- Missing `ANTHROPIC_API_KEY` in `.env`
- Agent container still starting (give it 30s after first boot)
- Wrong model ID in claw.yaml

**Port conflicts**
`init.sh` checks for conflicts and will tell you which port is in use. Either stop the conflicting service or change ports in `claw.yaml`.

**"provision exited with code 1"**
Usually means Synapse isn't ready yet. Run `docker compose up -d` again — the provision container retries automatically on subsequent runs.

**Agents don't see each other's messages**
Each agent only responds to other bots when @mentioned (the `smart` respond_to mode). To make an agent respond to everything, set `respond_to: all` in claw.yaml.
