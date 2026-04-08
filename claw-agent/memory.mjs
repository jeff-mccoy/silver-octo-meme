// claw-agent — Memory context loader
//
// Reads memory files and soul from disk, formats them for system prompt injection.
// The agent manages memories via Claude Code's native file tools (Read/Write).
// This module just loads existing memories into context each turn.

import fs from "fs";
import path from "path";

const MEMORY_DIR = "/data/memory";
const SOUL_PATH = "/data/soul.md";
const MAX_MEMORIES_IN_CONTEXT = 50;

// Ensure directory exists
fs.mkdirSync(MEMORY_DIR, { recursive: true });

function loadAllMemories() {
  try {
    return fs
      .readdirSync(MEMORY_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(MEMORY_DIR, f), "utf8")
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build the memory + soul context block for the system prompt.
 * Returns empty string if no memories/soul exist yet.
 */
export function loadContext() {
  const parts = [];

  // Load soul
  try {
    const soul = fs.readFileSync(SOUL_PATH, "utf8").trim();
    if (soul) parts.push(`## My Soul\n${soul}`);
  } catch {}

  // Load memories
  const memories = loadAllMemories();
  if (memories.length > 0) {
    memories.sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );
    const subset = memories.slice(0, MAX_MEMORIES_IN_CONTEXT);

    const grouped = {};
    for (const m of subset) {
      if (!grouped[m.subject]) grouped[m.subject] = [];
      grouped[m.subject].push(m);
    }

    const lines = [];
    for (const [subject, mems] of Object.entries(grouped)) {
      lines.push(`**${subject}:**`);
      for (const m of mems) {
        lines.push(`- [${m.category}] ${m.content}`);
      }
    }
    parts.push(`## My Memories\n${lines.join("\n")}`);
  }

  return parts.length > 0 ? "\n\n---\n\n" + parts.join("\n\n") : "";
}
