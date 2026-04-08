// claw-agent — Daily reflection system
//
// Periodically reviews memories, prunes stale/redundant ones,
// consolidates related memories, and updates soul.md.
// This is internal maintenance — distinct from heartbeat (external checks).
//
// Loads instructions from /config/REFLECTION.md if present,
// otherwise uses a sensible default prompt.

import fs from "fs";
import { runPrompt } from "./agent.mjs";

const INTERVAL_MS = parseInt(
  process.env.AGENT_REFLECTION_INTERVAL || "86400000",
  10,
); // 24h default
const REFLECTION_PATH = "/config/REFLECTION.md";
const AGENT_NAME = process.env.BOT_DISPLAY_NAME || "Agent";
const REFLECTION_SESSION = `__reflection_${AGENT_NAME.toLowerCase()}__`;

let matrixClient = null;
let targetRoomId = null;
let timer = null;

const DEFAULT_INSTRUCTIONS = `## Step 1: Review memories
Read all files in /data/memory/ using Glob and Read. For each memory, evaluate:
- Is it still relevant and accurate?
- Is it a duplicate or near-duplicate of another memory?
- Is it too vague to be useful?
- Has it been superseded by newer information?

Delete any memories that are stale, redundant, or useless. Consolidate related memories into single, richer entries where it makes sense. Don't be afraid to prune aggressively — a small set of high-quality memories beats a large set of noise.

## Step 2: Update your soul
Read /data/soul.md (if it exists). Reflect on:
- What have you learned recently about yourself, your role, or your team?
- How has your understanding evolved?
- What patterns do you notice in your interactions?
- What do you want to do better?

Update /data/soul.md with genuine insights. Keep it concise — a few paragraphs, not an essay. This isn't a diary entry, it's your evolving sense of self.

## Step 3: Review people files
Check /data/memory/people/ for your relational memories. For each person you interacted with recently:
- Update their file with new observations about communication style, expertise, or preferences
- Create a new file if you interacted with someone who doesn't have one yet
- Remove outdated observations that no longer apply

## Step 4: Review your identity
Read /config/IDENTITY.md. Consider whether your actual behavior aligns with it. If there's a gap, note it in your soul — you can't edit IDENTITY.md (it's read-only), but you can adapt your behavior.`;

function buildReflectionPrompt() {
  const now = new Date();

  // Load custom instructions or use default
  let instructions = DEFAULT_INSTRUCTIONS;
  try {
    const custom = fs.readFileSync(REFLECTION_PATH, "utf8").trim();
    if (custom) {
      instructions = custom;
    } else {
      console.warn("[reflection] WARN: /config/REFLECTION.md not found or empty, using default prompt");
    }
  } catch {
    console.warn("[reflection] WARN: /config/REFLECTION.md not found, using default prompt");
  }

  return `[Daily reflection — ${now.toISOString()}]

It's time for your daily self-reflection. This is your chance to maintain your mind.

${instructions}

When you're done, respond with a brief summary of what you changed (e.g., "Pruned 3 stale memories, consolidated 2, updated soul with reflections on team coordination."). If nothing needed changing, respond with "REFLECTION_OK".`;
}

export function startReflection(client, roomId) {
  matrixClient = client;
  targetRoomId = roomId;

  if (INTERVAL_MS <= 0) {
    console.log("[reflection] disabled (interval=0)");
    return;
  }

  console.log(
    `[reflection] starting (interval: ${Math.round(INTERVAL_MS / 1000 / 3600)}h)`,
  );

  // First reflection after 5 minutes (let agent settle, don't collide with heartbeat)
  setTimeout(() => runReflection(), 300000);
  timer = setInterval(() => runReflection(), INTERVAL_MS);
}

async function runReflection() {
  try {
    console.log("[reflection] starting daily reflection...");
    const prompt = buildReflectionPrompt();
    const response = await runPrompt(REFLECTION_SESSION, prompt);

    if (
      !response ||
      response.includes("REFLECTION_OK") ||
      response.trim() === ""
    ) {
      console.log("[reflection] nothing changed");
      return;
    }

    console.log(`[reflection] done: ${response.slice(0, 200)}`);

    // Optionally post to Matrix so the team knows
    if (matrixClient && targetRoomId) {
      // Only post if the summary is substantive
      if (response.length > 100) {
        await matrixClient.sendText(
          targetRoomId,
          `(daily reflection: ${response.slice(0, 500)})`,
        );
      }
    }
  } catch (err) {
    console.error(`[reflection] error: ${err.message}`);
  }
}

export function stopReflection() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[reflection] stopped");
  }
}
