// claw-agent — Heartbeat system
//
// Periodic wake-up that reads HEARTBEAT.md and runs a check prompt.
// Posts to Matrix only when there's something worth saying.

import fs from "fs";
import { runPrompt } from "./agent.mjs";

const HEARTBEAT_PATH = "/config/HEARTBEAT.md";
const INTERVAL_MS = parseInt(
  process.env.AGENT_HEARTBEAT_INTERVAL || "1800000",
  10,
); // 30 min default
const HEARTBEAT_SESSION = "__heartbeat__";

let matrixClient = null;
let targetRoomId = null;
let timer = null;

/**
 * Start the heartbeat loop.
 */
export function startHeartbeat(client, roomId) {
  matrixClient = client;
  targetRoomId = roomId;

  if (!fs.existsSync(HEARTBEAT_PATH)) {
    console.log("[heartbeat] no HEARTBEAT.md found, skipping");
    return;
  }

  if (INTERVAL_MS <= 0) {
    console.log("[heartbeat] disabled (interval=0)");
    return;
  }

  console.log(
    `[heartbeat] starting (interval: ${INTERVAL_MS / 1000}s, room: ${roomId})`,
  );

  // Run first heartbeat after a short delay (let things settle)
  setTimeout(() => runHeartbeat(), 30000);
  timer = setInterval(() => runHeartbeat(), INTERVAL_MS);
}

async function runHeartbeat() {
  try {
    const heartbeatConfig = fs.readFileSync(HEARTBEAT_PATH, "utf8").trim();
    if (!heartbeatConfig) return;

    const now = new Date();
    const prompt = [
      `[Heartbeat check — ${now.toISOString()}]`,
      "",
      "Your heartbeat instructions:",
      heartbeatConfig,
      "",
      "Based on these instructions, check if there's anything that needs attention right now.",
      "If there's something worth reporting, respond with the message to post.",
      'If everything is fine and there\'s nothing to report, respond with exactly "HEARTBEAT_OK" and nothing else.',
    ].join("\n");

    console.log("[heartbeat] running check...");
    const response = await runPrompt(HEARTBEAT_SESSION, prompt);

    if (
      !response ||
      response.includes("HEARTBEAT_OK") ||
      response.trim() === ""
    ) {
      console.log("[heartbeat] nothing to report");
      return;
    }

    if (matrixClient && targetRoomId) {
      const MAX_MSG = 4000;
      for (let i = 0; i < response.length; i += MAX_MSG) {
        await matrixClient.sendText(
          targetRoomId,
          response.slice(i, i + MAX_MSG),
        );
      }
      console.log(`[heartbeat] posted ${response.length} chars to Matrix`);
    }
  } catch (err) {
    console.error(`[heartbeat] error: ${err.message}`);
  }
}

export function stopHeartbeat() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[heartbeat] stopped");
  }
}
