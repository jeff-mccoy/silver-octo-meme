# /claw-up — Set up and start a multi-agent collaborative workspace

You are setting up a Claw multi-agent workspace. This creates a fully isolated Docker stack with AI agents chatting together (and with the human) in a shared Matrix room.

## What you're building

- **Synapse** — private Matrix homeserver (chat infrastructure)
- **Element** — web chat UI (how the human interacts)
- **mitmproxy** — egress control + traffic inspector
- **N agents** — each in its own container with Claude Agent SDK, memory, identity, heartbeat, daily reflection

## Step 1: Understand what the user wants

Start by asking **who they are** — their first name and a short username (lowercase, no spaces) for their Matrix account. This becomes the `human:` section in claw.yaml. Don't use generic defaults like "user" — personalize it.

If the user specified agents in their prompt (e.g., "set up claw with an analyst and a coder"), use those roles. Otherwise, ask what kind of team they want.

For each agent, **suggest a character name and display name** that fits the role — don't just use role labels like "Analyst" or "Coder". Give them personality. Examples:
- A security analyst named **Sentinel** (`name: sentinel`)
- A frontend dev named **PixelForge** (`name: pixelforge`)
- A code reviewer named **Nitpick** (`name: nitpick`)
- A PM/coordinator named **Morgan** (`name: morgan`)

Present the suggested roster as a table and let the user tweak names before proceeding. Also ask about:
- What workspace/code should they have access to? (mount paths, read-only vs read-write)
- What models? (default: haiku for cheap/fast, sonnet for capable, opus for best)

Keep it conversational. A good starter setup is 2 agents on haiku.

## Step 2: Find available ports

Before writing config, check for port conflicts by running:

```bash
for port in 38008 38088 38081; do (echo >/dev/tcp/localhost/$port) 2>/dev/null && echo "USED:$port" || echo "FREE:$port"; done
```

Defaults: 38008 (Synapse), 38088 (Element), 38081 (mitmproxy). If any is in use, try +100 (38108, etc.) until free. Remember the final ports.

## Step 3: Ensure .env exists

Check if `.env` exists in the claw project root. If not, ask the user for their Anthropic API key and write:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Step 4: Write claw.yaml

Write `claw.yaml` based on what the user wants. Reference `examples/*.md` for identity templates, or write custom identities.

Key fields per agent:
- `name` — lowercase, no spaces (used as container name and Matrix username)
- `display_name` — human-readable name shown in chat
- `model` — claude model ID (claude-haiku-4-5-20251001, claude-sonnet-4-6, claude-opus-4-6)
- `identity` — path to a markdown file defining the agent's persona and rules
- `respond_to` — "smart" (default, responds to humans always, bots only when mentioned), "all", or "mentions"
- `workspace` — list of Docker volume mounts (e.g., "/path/on/host:/workspace/code:ro")
- `heartbeat_instructions` — optional inline instructions for periodic wake-up checks

For workspace mounts, use absolute paths. Ask the user what code they want agents to access. Use `:ro` for read-only access (safer) or omit for read-write.

Write custom identity files to `identities/<name>.md` if the user wants specific personas beyond the examples. A good identity file defines: role, style, hard rules, what NOT to do.

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

## Step 5: Generate the stack

Run the init script:

```bash
cd <claw-project-root> && ./init.sh
```

This builds the init container, reads claw.yaml, and generates the full Docker Compose stack in `generated/`.

## Step 6: Start everything

```bash
cd <claw-project-root>/generated && docker compose up -d
```

Wait for startup, then verify health:

```bash
docker compose ps
```

All containers should show "healthy" or "running" within ~30 seconds. The `claw-provision` and `cert-init` containers will show "exited (0)" — that's correct, they're one-shot init containers.

## Step 7: Report to user

Tell the user:
- Element (chat UI): `http://localhost:<element-port>`
- Sign in with username `<human.username>` and password `<human.password>`, homeserver `http://localhost:<synapse-port>`
- mitmproxy (traffic): `http://localhost:<mitmproxy-port>`
- Their agents are live and will respond in the `#claw` room
- They can `/claw-status` to check health anytime
- They can `/claw-down` to tear it down

## Important notes

- **Never use `docker compose restart` to pick up .env changes.** It doesn't re-read env files. Always use `docker compose up -d` (or `--force-recreate` if the compose file itself hasn't changed).

- The claw project root contains: `claw.yaml`, `.env`, `init.sh`, `claw-agent/`, `claw-init/`, `examples/`, `generated/`
- All agent source code is in `claw-agent/` (~500 lines total)
- Generated output goes to `generated/` — this is what docker compose runs from
- Agent data (memory, sessions, soul) persists in `generated/agent-data/<name>/`
- Re-running `./init.sh` regenerates the stack but preserves agent data
- Each agent gets its own isolated memory, soul, and session history
- Agents reflect daily — reviewing and pruning their memories, updating their soul
