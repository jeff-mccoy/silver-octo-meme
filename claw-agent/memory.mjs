// claw-agent — Memory context loader
//
// Reads markdown memory files and soul from disk, formats them for system
// prompt injection. The agent manages memories via Claude Code's native
// file tools (Read/Write) — just plain markdown files, no JSON schema.

import fs from "fs";
import path from "path";

const MEMORY_DIR = "/data/memory";
const SOUL_PATH = "/data/soul.md";
const MAX_MEMORIES_IN_CONTEXT = 50;

// Ensure directory exists
fs.mkdirSync(MEMORY_DIR, { recursive: true });

function loadAllMemories() {
  try {
    const files = fs
      .readdirSync(MEMORY_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        try {
          const content = fs
            .readFileSync(path.join(MEMORY_DIR, f), "utf8")
            .trim();
          if (!content) return null;
          // Use file mtime for sorting (most recent first)
          const stat = fs.statSync(path.join(MEMORY_DIR, f));
          return { file: f, content, mtime: stat.mtimeMs };
        } catch (err) {
          console.warn(`[memory] failed to read ${f}: ${err.message}`);
          return null;
        }
      })
      .filter(Boolean);
    // Most recently modified first
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
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
    const subset = memories.slice(0, MAX_MEMORIES_IN_CONTEXT);
    const lines = subset.map(
      (m) => `### ${m.file.replace(/\.md$/, "")}\n${m.content}`,
    );
    parts.push(`## My Memories\n\n${lines.join("\n\n")}`);
  }

  return parts.length > 0 ? "\n\n---\n\n" + parts.join("\n\n") : "";
}
