---
name: status
description: Check health and status of the running Claw multi-agent stack. Use when the user wants to see if agents are running, check for errors, or get connection URLs.
---

Check the status of all Claw services and report a summary.

## Steps

1. Find the claw workspace. Check `./claw-workspace/generated/` or the current directory for `generated/docker-compose.yml`.

2. Check if the stack is running:
```bash
cd <workspace>/generated && docker compose ps 2>/dev/null
```

If nothing is running, tell the user and suggest `/claw:up`.

3. Check agent logs for recent activity or errors:
```bash
cd <workspace>/generated && docker compose logs --tail=5 --no-log-prefix 2>/dev/null | grep -E '\[(analyst|coder|agent)\]'
```

4. Check traffic stats:
```bash
wc -l <workspace>/generated/logs/traffic.jsonl 2>/dev/null
```

5. Read ports from `<workspace>/claw.yaml` and report a clean summary:

| Service | Status | URL |
|---------|--------|-----|
| synapse | healthy | (internal) |
| mitmproxy | healthy | http://localhost:PORT |
| element | running | http://localhost:PORT |
| agent-X | running | (last log line) |

6. If any containers are unhealthy, show their recent logs.

7. Remind the user of login credentials from `claw.yaml`.
