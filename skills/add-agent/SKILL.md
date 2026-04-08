---
name: add-agent
description: Add a new agent to a running Claw workspace. Use when the user wants another AI agent in their team without disrupting existing ones.
---

Add a new agent to an existing Claw workspace without disrupting running agents.

## Steps

1. Find the claw workspace and read current `claw.yaml` to see existing agents.

2. Ask the user (or parse from their prompt):
   - Agent name (lowercase, no spaces)
   - Display name
   - Model (default: claude-haiku-4-5-20251001)
   - Role/identity (use an example from `${CLAUDE_PLUGIN_ROOT}/examples/` or write custom)
   - Workspace mounts (if any)
   - Response mode: smart (default), all, or mentions

3. Write an identity file for the new agent if the user wants a custom persona.

4. Add the new agent to the `agents:` list in `claw.yaml`.

5. Regenerate the stack:
```bash
cd <workspace> && ./init.sh
```

This preserves existing agent data while adding the new agent's directories.

6. Start the new agent (and re-run provision for the new account):
```bash
cd <workspace>/generated && docker compose up -d claw-provision agent-<name>
```

The provision container skips existing accounts and only registers the new one.

7. Verify:
```bash
cd <workspace>/generated && docker compose ps agent-<name>
```

8. Tell the user the new agent is live and will appear in the chat room.

**Note:** Existing agents won't know about the new bot for `smart` respond_to mode until restarted. If needed: `docker compose restart agent-<existing-name>` to update their BOT_USERS list.
