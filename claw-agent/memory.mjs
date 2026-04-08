// claw-agent — Memory context loader
//
// Reads markdown memory files and soul from disk, formats them for system
// prompt injection. The agent manages memories via Claude Code's native
// file tools (Read/Write) — just plain markdown files, no JSON schema.
//
// Memory structure:
//   /data/memory/*.md         — general memories (facts, preferences, etc.)
//   /data/memory/people/*.md  — per-person relational memories (keyed by name)
//   /data/soul.md             — agent's evolving self-reflection

import fs from "fs";
import path from "path";

const MEMORY_DIR = "/data/memory";
const PEOPLE_DIR = path.join(MEMORY_DIR, "people");
const SOUL_PATH = "/data/soul.md";
const MAX_MEMORIES_IN_CONTEXT = 50;

// Ensure directories exist
fs.mkdirSync(MEMORY_DIR, { recursive: true });
fs.mkdirSync(PEOPLE_DIR, { recursive: true });

function loadMarkdownFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        try {
          const content = fs
            .readFileSync(path.join(dir, f), "utf8")
            .trim();
          if (!content) return null;
          const stat = fs.statSync(path.join(dir, f));
          return { file: f, content, mtime: stat.mtimeMs };
        } catch (err) {
          console.warn(`[memory] failed to read ${f}: ${err.message}`);
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Load the relational memory file for a specific person.
 * Returns the file content or empty string if none exists.
 */
export function loadPersonMemory(displayName) {
  if (!displayName) return "";
  // Normalize: lowercase, spaces to hyphens, strip non-alphanumeric
  const slug = displayName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const filePath = path.join(PEOPLE_DIR, `${slug}.md`);
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    if (content) {
      return `\n\n## About ${displayName}\n${content}`;
    }
  } catch {}
  return "";
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

  // Load general memories (not people/ subdirectory)
  const memories = loadMarkdownFiles(MEMORY_DIR);
  if (memories.length > 0) {
    const subset = memories
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_MEMORIES_IN_CONTEXT);
    const lines = subset.map(
      (m) => `### ${m.file.replace(/\.md$/, "")}\n${m.content}`,
    );
    parts.push(`## My Memories\n\n${lines.join("\n\n")}`);
  }

  return parts.length > 0 ? "\n\n---\n\n" + parts.join("\n\n") : "";
}
