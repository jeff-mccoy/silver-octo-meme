# /claw-down — Tear down the Claw stack

Stop and remove all Claw containers.

## Steps

1. Check if the stack is running:
```bash
cd <claw-project-root>/generated && docker compose ps 2>/dev/null
```

If no containers are running, tell the user and stop.

2. Ask the user if they want to preserve data or clean everything:
   - **Keep data** (default): just stop containers. Memories, sessions, and soul files persist in `generated/agent-data/`.
   - **Clean everything**: stop containers AND delete `generated/agent-data/`, `generated/logs/`, `generated/provision-data/`. This wipes all agent memory.

3. Tear down:
```bash
cd <claw-project-root>/generated && docker compose down
```

4. If user chose clean everything:
```bash
rm -rf <claw-project-root>/generated/agent-data
rm -rf <claw-project-root>/generated/logs
rm -rf <claw-project-root>/generated/provision-data
```

5. Confirm to the user that the stack is down and what was preserved/deleted.
