// claw-agent — Agent loop powered by Claude Agent SDK
//
// Thin wrapper around the Claude Agent SDK's query() function.
// Claude Code handles all tool execution (files, bash, web, etc.).
// We manage Matrix integration, sessions, memory context, and token tracking.

import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs";
import { loadContext } from "./memory.mjs";

const MODEL = process.env.AGENT_MODEL || "claude-haiku-4-5-20251001";
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || "15", 10);

if (!process.env.AGENT_MODEL) {
  console.warn(`[agent] WARN: AGENT_MODEL not set, using default: ${MODEL}`);
}
if (!process.env.AGENT_MAX_TURNS) {
  console.warn(`[agent] WARN: AGENT_MAX_TURNS not set, using default: ${MAX_TURNS}`);
}
const SESSIONS_FILE = "/data/sessions.json";
const STATS_FILE = "/data/stats.json";

// Load base identity from mounted config
const AGENT_NAME = process.env.BOT_DISPLAY_NAME || "Agent";
let baseIdentity = `You are ${AGENT_NAME}, a helpful assistant in a Matrix chat room. Be concise and direct.`;
try {
  const identity = fs.readFileSync("/config/IDENTITY.md", "utf8");
  if (identity.trim()) baseIdentity = identity;
} catch {}

// Session ID tracking (room -> Claude session ID for resume)
let sessionMap = {};
try {
  sessionMap = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
} catch {}

function saveSessionMap() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionMap, null, 2));
  } catch (err) {
    console.error(`[agent] session save error: ${err.message}`);
  }
}

// --- Token usage tracking ---

let statsMap = {};
try {
  statsMap = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
} catch {}

function saveStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(statsMap, null, 2));
  } catch {}
}

function updateStats(sessionKey, usage) {
  if (!statsMap[sessionKey]) {
    statsMap[sessionKey] = {
      totalUncachedTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      lastContextSize: 0,
      turns: 0,
      startedAt: new Date().toISOString(),
    };
  }
  const s = statsMap[sessionKey];
  const uncached = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;
  const contextSize = uncached + cacheRead + cacheCreate;

  s.totalUncachedTokens += uncached;
  s.totalOutputTokens += output;
  s.totalCacheReadTokens += cacheRead;
  s.totalCacheCreationTokens += cacheCreate;
  s.lastContextSize = contextSize;
  s.turns++;
  s.lastUpdated = new Date().toISOString();
  saveStats();

  const cacheable = cacheRead + cacheCreate;
  const cacheHit =
    cacheable > 0 ? ((cacheRead / cacheable) * 100).toFixed(1) : "n/a";
  console.log(
    `[tokens] turn ${s.turns}: context ~${contextSize.toLocaleString()} tokens ` +
      `(${uncached.toLocaleString()} uncached + ${cacheRead.toLocaleString()} cache-read + ${cacheCreate.toLocaleString()} cache-create), ` +
      `${output.toLocaleString()} out, cache hit ${cacheHit}%`,
  );
}

function getStatsContext(sessionKey) {
  const s = statsMap[sessionKey];
  if (!s) {
    return `\n\n## Context Status\n- First turn — no stats yet.`;
  }

  const totalCacheable = s.totalCacheReadTokens + s.totalCacheCreationTokens;
  const cacheHit =
    totalCacheable > 0
      ? ((s.totalCacheReadTokens / totalCacheable) * 100).toFixed(1)
      : "n/a";

  return `\n\n## Context Status
- Session turns: ${s.turns}
- Last turn context: ~${s.lastContextSize.toLocaleString()} tokens
- Cumulative output: ${s.totalOutputTokens.toLocaleString()} tokens
- Cache hit rate: ${cacheHit}%
- Session started: ${s.startedAt}`;
}

// --- System prompt ---

function buildSystemPrompt(sessionKey) {
  const memoryInstructions = `

## Memory Management

Your persistent memories are markdown files in /data/memory/.
Each file is a short note — plain text, no special format required.

To save a memory: Write a .md file to /data/memory/<descriptive-name>.md
  Example: /data/memory/jeff-preferences.md with content like "Prefers concise responses. Senior engineer."
To search memories: Use Glob to list /data/memory/*.md, then Read to check contents
To update a memory: Edit or overwrite the file
To delete a memory: Remove the file
Your soul file is at /data/soul.md — update it with genuine insights about yourself.

Use memories proactively — check what you know about someone before responding to them.
Don't save trivial things. Do save: facts about people, preferences, important context.
Use descriptive filenames so you can find things later (e.g., "project-goals.md", "jeff-preferences.md").`;

  return baseIdentity + loadContext() + memoryInstructions + getStatsContext(sessionKey);
}

// --- Agent execution ---

async function processStream(result, sessionKey) {
  let responseText = "";
  let sessionId = null;

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
      sessionId = msg.session_id;
    }

    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          responseText += block.text;
        }
        if (block.type === "tool_use") {
          console.log(
            `[agent] tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`,
          );
        }
      }
    }

    if (msg.type === "result" && msg.subtype === "success" && msg.usage) {
      updateStats(sessionKey, msg.usage);
    }
  }

  if (sessionId) {
    sessionMap[sessionKey] = sessionId;
    saveSessionMap();
  }

  return responseText;
}

/**
 * Run the agent for a single user message.
 */
export async function runAgent(
  roomId,
  senderName,
  message,
  onTyping,
  roomContext,
) {
  const parts = [];
  if (roomContext) {
    parts.push(roomContext);
    parts.push("---\n");
  }
  parts.push(`[Matrix/${senderName}] ${message}`);
  const prompt = parts.join("\n\n");

  if (onTyping) onTyping(true);

  try {
    const options = {
      cwd: "/workspace",
      model: MODEL,
      systemPrompt: buildSystemPrompt(roomId),
      maxTurns: MAX_TURNS,
      permissionMode: "bypassPermissions",
    };

    if (sessionMap[roomId]) {
      options.resume = sessionMap[roomId];
    }

    const result = query({ prompt, options });
    const responseText = await processStream(result, roomId);

    if (onTyping) onTyping(false);
    return responseText || "(no response)";
  } catch (err) {
    if (onTyping) onTyping(false);

    // If resume failed, retry fresh (once only — deleting session prevents further recursion)
    if (sessionMap[roomId]) {
      console.log(
        `[agent] resume failed for ${roomId}, retrying fresh: ${err.message}`,
      );
      delete sessionMap[roomId];
      saveSessionMap();
      return runAgent(roomId, senderName, message, onTyping, roomContext);
    }

    console.error(`[agent] error details:`, err.stack || err);
    throw err;
  }
}

/**
 * Run a prompt directly (no sender context). Used by heartbeat.
 */
export async function runPrompt(sessionKey, prompt) {
  try {
    const options = {
      cwd: "/workspace",
      model: MODEL,
      systemPrompt: buildSystemPrompt(sessionKey),
      maxTurns: MAX_TURNS,
      permissionMode: "bypassPermissions",
      resume: sessionMap[sessionKey] || undefined,
    };

    const result = query({ prompt, options });
    return await processStream(result, sessionKey);
  } catch (err) {
    if (sessionMap[sessionKey]) {
      console.log(`[agent] stale session, retrying fresh`);
      delete sessionMap[sessionKey];
      saveSessionMap();
      return runPrompt(sessionKey, prompt);
    }
    console.error(`[agent] prompt error: ${err.message}`);
    return "";
  }
}
