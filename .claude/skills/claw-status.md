# /claw-status — Check health of the Claw stack

Check the status of all Claw services and report a summary.

## Steps

1. Check if the stack exists:
```bash
cd <claw-project-root>/generated && docker compose ps --format json 2>/dev/null
```

If nothing is running, tell the user and suggest `/claw-up`.

2. For each container, report: name, status (running/healthy/exited), uptime.

3. Check agent logs for recent errors:
```bash
cd <claw-project-root>/generated && docker compose logs --tail=5 --no-log-prefix agent-* 2>/dev/null
```

4. Check mitmproxy traffic stats:
```bash
wc -l <claw-project-root>/generated/logs/traffic.jsonl 2>/dev/null
```

5. Report a clean summary table:

| Service | Status | Notes |
|---------|--------|-------|
| synapse | healthy | Matrix homeserver |
| mitmproxy | healthy | N requests logged |
| element | running | http://localhost:PORT |
| agent-X | running | Last log: ... |
| ... | ... | ... |

6. If any containers are unhealthy, show their recent logs to help debug.

7. Remind the user of the URLs:
   - Element: `http://localhost:<element-port>` (read ports from `claw.yaml`)
   - mitmproxy: `http://localhost:<mitmproxy-port>`
