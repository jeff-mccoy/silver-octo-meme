// claw-agent — Matrix bot + agent glue
//
// Connects to Synapse, listens for messages, runs them through the Claude
// Agent SDK loop, posts responses back. Configurable via environment variables.

import fs from "fs";
import { marked } from "marked";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk";
import { runAgent } from "./agent.mjs";
import { loadPersonMemory } from "./memory.mjs";
import { startHeartbeat } from "./heartbeat.mjs";
import { startReflection } from "./reflection.mjs";

// --- Config (all from environment) ---
const HOMESERVER = process.env.MATRIX_HOMESERVER || "http://synapse:8008";
const MATRIX_USER = process.env.MATRIX_USER;
const MATRIX_PASSWORD = process.env.MATRIX_PASSWORD;
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || "Agent";
const RESPOND_TO = process.env.RESPOND_TO || "smart"; // "all" | "mentions" | "smart"
const HEARTBEAT_ROOM = process.env.HEARTBEAT_ROOM;
const ROOM_CONTEXT_LIMIT = parseInt(
  process.env.ROOM_CONTEXT_LIMIT || "30",
  10,
);

const TAG = `[${BOT_DISPLAY_NAME.toLowerCase()}]`;

if (!MATRIX_USER || !MATRIX_PASSWORD) {
  console.error(`${TAG} Need MATRIX_USER and MATRIX_PASSWORD`);
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(`${TAG} Need ANTHROPIC_API_KEY in environment`);
  process.exit(1);
}

// --- Matrix login ---
console.log(`${TAG} logging in as ${MATRIX_USER}...`);
const loginResp = await fetch(`${HOMESERVER}/_matrix/client/r0/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "m.login.password",
    identifier: { type: "m.id.user", user: MATRIX_USER },
    password: MATRIX_PASSWORD,
  }),
});
if (!loginResp.ok) {
  console.error(`${TAG} Login failed: ${await loginResp.text()}`);
  process.exit(1);
}
const { access_token } = await loginResp.json();

// --- Matrix client setup ---
const storage = new SimpleFsStorageProvider("/data/matrix-state.json");
const client = new MatrixClient(HOMESERVER, access_token, storage);
AutojoinRoomsMixin.setupOnClient(client);
const botUserId = await client.getUserId();
console.log(`${TAG} connected as ${botUserId}`);

try {
  await client.setDisplayName(BOT_DISPLAY_NAME);
} catch {}

// --- Room history ---
// Display name cache persists across restarts so agents remember who's who
const DISPLAY_NAMES_FILE = "/data/display-names.json";
const displayNameCache = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(DISPLAY_NAMES_FILE, "utf8"));
  for (const [k, v] of Object.entries(saved)) displayNameCache.set(k, v);
} catch {}

function saveDisplayNames() {
  try {
    fs.writeFileSync(
      DISPLAY_NAMES_FILE,
      JSON.stringify(Object.fromEntries(displayNameCache), null, 2),
    );
  } catch {}
}

async function getDisplayName(userId) {
  if (displayNameCache.has(userId)) return displayNameCache.get(userId);
  try {
    const profile = await client.getUserProfile(userId);
    const name = profile?.displayname || userId;
    displayNameCache.set(userId, name);
    saveDisplayNames();
    return name;
  } catch {
    return userId;
  }
}

async function fetchRoomContext(roomId) {
  try {
    const resp = await fetch(
      `${HOMESERVER}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${ROOM_CONTEXT_LIMIT}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (!resp.ok) return "";
    const data = await resp.json();
    const messages = (data.chunk || [])
      .filter((e) => e.type === "m.room.message" && e.content?.body)
      .reverse();

    if (messages.length === 0) return "";

    const lines = [];
    for (const msg of messages) {
      const name = await getDisplayName(msg.sender);
      const body = msg.content.body;
      const truncated =
        body.length > 2000
          ? body.slice(0, 2000) + "\n... (truncated)"
          : body;
      lines.push(`[${name}] ${truncated}`);
    }

    return "## Recent Room Messages\n\n" + lines.join("\n\n");
  } catch (err) {
    console.error(`${TAG} room context fetch error: ${err.message}`);
    return "";
  }
}

// --- Formatted message sending ---
async function sendFormatted(roomId, text) {
  const html = await marked.parse(text);
  await client.sendMessage(roomId, {
    msgtype: "m.text",
    body: text,
    format: "org.matrix.custom.html",
    formatted_body: html,
  });
}

// --- Message handling ---
const inflight = new Set();

const localpart = botUserId.split(":")[0].replace("@", "").toLowerCase();

// Known bot accounts — populated from BOT_USERS env var (comma-separated).
const BOT_USERS = new Set(
  (process.env.BOT_USERS || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),
);

function isBotSender(senderId) {
  const senderLocal = senderId.split(":")[0].replace("@", "").toLowerCase();
  return BOT_USERS.has(senderLocal);
}

// Word-boundary regex for name mentions (avoids "coder" matching "coder-style")
const namePattern = new RegExp(`(?:^|\\W)@?${localpart}(?:$|\\W)`, "i");

function shouldRespond(text, roomMemberCount, senderId) {
  if (RESPOND_TO === "all") return true;

  // Always respond if mentioned by name (word-boundary match)
  if (namePattern.test(text)) return true;

  if (RESPOND_TO === "mentions") return false;

  // "smart" mode (default): respond to humans, require mention for bots
  if (roomMemberCount <= 2) return true;
  if (!isBotSender(senderId)) return true;

  return false;
}

client.on("room.message", async (roomId, event) => {
  if (event.sender === botUserId) return;
  if (!event.content?.body) return;
  if (
    event.content.msgtype !== "m.text" &&
    event.content.msgtype !== "m.notice"
  )
    return;

  const text = event.content.body;
  const eventId = event.event_id;
  if (inflight.has(eventId)) return;
  inflight.add(eventId);

  let memberCount = 99;
  try {
    const members = await client.getJoinedRoomMembers(roomId);
    memberCount = members.length;
  } catch {}

  if (!shouldRespond(text, memberCount, event.sender)) {
    inflight.delete(eventId);
    return;
  }

  let senderName = event.sender;
  try {
    const profile = await client.getUserProfile(event.sender);
    senderName = profile?.displayname || event.sender;
  } catch {}

  console.log(`${TAG} <- ${senderName}: ${text.slice(0, 100)}`);

  try {
    await client.setTyping(roomId, true, 60000).catch(() => {});

    const roomContext = await fetchRoomContext(roomId);
    const personContext = loadPersonMemory(senderName);

    const response = await runAgent(
      roomId,
      senderName,
      text,
      (active) => {
        client.setTyping(roomId, active, active ? 60000 : 0).catch(() => {});
      },
      roomContext,
      personContext,
    );

    await client.setTyping(roomId, false, 0).catch(() => {});
    const MAX_MSG = 4000;
    for (let i = 0; i < response.length; i += MAX_MSG) {
      await sendFormatted(roomId, response.slice(i, i + MAX_MSG));
    }
    console.log(`${TAG} -> ${response.length} chars`);
  } catch (err) {
    console.error(`${TAG} error: ${err.message}`);
    await client.setTyping(roomId, false, 0).catch(() => {});
    await client
      .sendText(roomId, `(error: ${err.message})`)
      .catch(() => {});
  } finally {
    inflight.delete(eventId);
  }
});

// --- Start ---
await client.start();
console.log(`${TAG} ready — listening for messages`);

// --- Heartbeat ---
if (HEARTBEAT_ROOM) {
  let heartbeatRoomId = HEARTBEAT_ROOM;
  if (HEARTBEAT_ROOM.startsWith("#")) {
    try {
      const resolved = await client.resolveRoom(HEARTBEAT_ROOM);
      heartbeatRoomId = resolved;
    } catch (err) {
      console.error(
        `${TAG} failed to resolve room ${HEARTBEAT_ROOM}: ${err.message}`,
      );
    }
  }
  startHeartbeat(client, heartbeatRoomId);
  startReflection(client, heartbeatRoomId);
} else {
  try {
    const rooms = await client.getJoinedRooms();
    if (rooms.length > 0) {
      startHeartbeat(client, rooms[0]);
      startReflection(client, rooms[0]);
    }
  } catch {}
}
