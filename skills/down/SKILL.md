---
name: down
description: Tear down the Claw multi-agent stack. Use when the user wants to stop agents, shut down the workspace, or clean up.
---

Stop and remove all Claw containers.

## Steps

1. Find the claw workspace. Check `./claw-workspace/generated/` or the current directory for a `generated/docker-compose.yml`. If not found, ask the user where their claw workspace is.

2. Check if the stack is running:
```bash
cd <workspace>/generated && docker compose ps 2>/dev/null
```

If no containers are running, tell the user and stop.

3. Ask the user if they want to preserve data or clean everything:
   - **Keep data** (default): just stop containers. Memories, sessions, and soul files persist.
   - **Clean everything**: stop containers AND delete agent data, logs, and provision data. This wipes all agent memory.

4. Tear down:
```bash
cd <workspace>/generated && docker compose down
```

5. If user chose clean everything:
```bash
rm -rf <workspace>/generated/agent-data
rm -rf <workspace>/generated/logs
rm -rf <workspace>/generated/provision-data
```

6. Confirm what was preserved or deleted.
