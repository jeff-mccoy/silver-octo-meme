# /claw-add-agent — Add an agent to a running Claw stack

Add a new agent to an existing Claw workspace without disrupting running agents.

## Steps

1. Read the current `claw.yaml` to understand existing agents.

2. Ask the user (or parse from their prompt):
   - Agent name (lowercase, no spaces)
   - Display name
   - Model (default: claude-haiku-4-5-20251001)
   - Role/identity (or use an example from `examples/`)
   - Workspace mounts (if any)
   - Response mode: smart (default), all, or mentions

3. Write an identity file for the new agent at `identities/<name>.md` if the user wants a custom persona.

4. Add the new agent to the `agents:` list in `claw.yaml`.

5. Regenerate the stack:
```bash
cd <claw-project-root> && ./init.sh
```

This preserves existing agent data while adding the new agent's directories.

6. Register the new account and start only the new agent:
```bash
cd <claw-project-root>/generated && docker compose up -d claw-provision agent-<name>
```

The provision container will register the new Matrix account (existing accounts are skipped). The new agent will join the room automatically.

7. Verify the new agent is running:
```bash
docker compose ps agent-<name>
```

8. Tell the user the new agent is live and will appear in the Element chat room.

## Notes
- Existing agents are NOT restarted — they keep their sessions and memory intact.
- The new agent starts fresh with empty memory and no soul file.
- If the user wants to update BOT_USERS for existing agents (so they know about the new bot), those agents need a restart: `docker compose restart agent-<existing-name>`.
