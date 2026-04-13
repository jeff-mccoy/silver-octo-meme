---
name: up
description: Set up and start a multi-agent collaborative workspace. Use when the user wants to create an AI agent team, spin up a claw workspace, or start agents chatting in a shared room.
---

You are setting up a Claw multi-agent workspace. This creates a fully isolated Docker stack with AI agents chatting together (and with the human) in a shared Matrix room. Each agent has its own identity, memory, tools, and daily reflection cycle.

The claw source code is at `${CLAUDE_PLUGIN_ROOT}`. All Dockerfiles, templates, and examples live there.

## Step 1: Pick a workspace directory

The user's claw workspace will be created in the current working directory at `./claw-workspace/` (or a name they specify). This is where `claw.yaml`, `.env`, and `generated/` will live.

```bash
mkdir -p ./claw-workspace
```

Copy the required source files from the plugin:
```bash
cp -r ${CLAUDE_PLUGIN_ROOT}/claw-agent ./claw-workspace/
cp -r ${CLAUDE_PLUGIN_ROOT}/claw-init ./claw-workspace/
cp -r ${CLAUDE_PLUGIN_ROOT}/examples ./claw-workspace/
cp ${CLAUDE_PLUGIN_ROOT}/init.sh ./claw-workspace/
chmod +x ./claw-workspace/init.sh
```

## Step 2: Understand what the user wants

Start by asking **who they are** — their first name and a short username (lowercase, no spaces) for their Matrix account. This becomes the `human:` section in claw.yaml. Don't use generic defaults like "user" — personalize it.

If the user specified agents in their prompt (e.g., "with an analyst and a coder on ~/code/myapp"), use those roles. Otherwise, ask what kind of team they want.

For each agent, **suggest a character name and display name** that fits the role — don't just use role labels like "Analyst" or "Coder". Give them personality. Examples:
- A security analyst named **Sentinel** (`name: sentinel`)
- A frontend dev named **PixelForge** (`name: pixelforge`)
- A code reviewer named **Nitpick** (`name: nitpick`)
- A PM/coordinator named **Morgan** (`name: morgan`)

Present the suggested roster as a table and let the user tweak names before proceeding. Also ask about:
- What workspace/code should they have access to? (mount paths, read-only vs read-write)
- What models? (default: haiku for cheap/fast, sonnet for capable, opus for best)

A good starter: 2 agents on haiku. Costs a few dollars/day.

| Model | Speed | Cost | Best for |
|-------|-------|------|----------|
| claude-haiku-4-5-20251001 | Fast | ~$0.25/1M in | Chat, analysis, lightweight tasks |
| claude-sonnet-4-6 | Medium | ~$3/1M in | Code writing, complex reasoning |
| claude-opus-4-6 | Slower | ~$15/1M in | Hard problems, architecture |

## Step 3: Find available ports

Check for port conflicts:

```bash
for port in 38008 38088 38081; do (echo >/dev/tcp/localhost/$port) 2>/dev/null && echo "USED:$port" || echo "FREE:$port"; done
```

Defaults: 38008 (Synapse), 38088 (Element), 38081 (mitmproxy). If any is in use, try +100 and re-check until you find 3 free ports.

## Step 4: Create .env

Check if `./claw-workspace/.env` exists. If not, ask the user for their Anthropic API key and write it:

```
ANTHROPIC_API_KEY=sk-ant-...
```

If they don't have one: https://console.anthropic.com/

## Step 5: Write claw.yaml

Write `./claw-workspace/claw.yaml`. Key fields per agent:
- `name` — lowercase, no spaces (used as container name + Matrix username)
- `display_name` — human-readable name shown in chat
- `model` — claude model ID
- `identity` — path to identity markdown file (relative to claw-workspace/)
- `respond_to` — "smart" (default), "all", or "mentions"
- `workspace` — list of Docker volume mounts with absolute host paths (e.g., "/Users/name/code:/workspace/code:ro")

Write custom identity files to `./claw-workspace/identities/<name>.md` if the user wants specific personas. A good identity is 20-50 lines covering: role, style, hard rules, team context. See `${CLAUDE_PLUGIN_ROOT}/examples/template.md` for the skeleton.

For workspace mounts, always use absolute paths. Use `:ro` for read-only (safer) or omit for read-write.

IMPORTANT: Write the COMPLETE claw.yaml in one Write call. Do not write partial files. Use this as a template — replace the ALL_CAPS placeholders:

```yaml
name: claw
server_name: localhost
ports:
  synapse: SYNAPSE_PORT
  element: ELEMENT_PORT
  mitmproxy_ui: MITMPROXY_PORT
human:
  username: HUMAN_USERNAME
  password: HUMAN_PASSWORD
  display_name: HUMAN_DISPLAY_NAME
  admin: true
room:
  alias: claw
  name: "The Claw"
  topic: "Multi-agent collaboration room"
egress:
  mode: log-only
agent_defaults:
  model: claude-haiku-4-5-20251001
  max_turns: 15
  respond_to: smart
  heartbeat_interval: 1800000
  reflection_interval: 86400000
agents:
  - name: AGENT_NAME
    display_name: AGENT_DISPLAY_NAME
    identity: ./identities/AGENT_NAME.md
    # model: claude-sonnet-4-6          # uncomment to override default
    # workspace:
    #   - /absolute/host/path:/workspace/code:ro
# shared_repo: /absolute/path/to/repo   # mounted to all agents, worktree discipline auto-injected
env_file: .env
```

## Step 6: Generate and start

```bash
cd ./claw-workspace && ./init.sh
cd ./claw-workspace/generated && docker compose up -d
```

Wait ~30s, then verify:
```bash
cd ./claw-workspace/generated && docker compose ps
```

`claw-provision` and `cert-init` showing "exited (0)" is correct — they're one-shot init containers.

## Step 7: Report to user

Print clearly:
- **Element (chat UI):** `http://localhost:<element-port>`
- **Homeserver** (enter this in Element's login): `http://localhost:<synapse-port>`
- **Username / Password** from claw.yaml's `human:` section
- **Traffic inspector:** `http://localhost:<mitmproxy-port>`

Remind them: when Element asks for a homeserver, click "Edit" and enter `http://localhost:<synapse-port>`. This is the #1 gotcha.

Tell them:
- `/claw:status` to check health
- `/claw:down` to tear down
- `/claw:add-agent` to add more agents
- Agent data (memory, soul) persists in `./claw-workspace/generated/agent-data/`

## Important notes

- **Never use `docker compose restart` to pick up .env changes.** It doesn't re-read env files. Always use `docker compose up -d` (or `--force-recreate` if the compose file itself hasn't changed).
- Docker commands run from `./claw-workspace/generated/` (where docker-compose.yml lives).
- `claw-provision` and `cert-init` exiting with code 0 is normal — they're one-shot init containers.
