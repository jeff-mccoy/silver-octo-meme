// claw-init — Generate docker-compose stack and provision Matrix accounts
//
// Two modes:
//   generate  — reads claw.yaml, renders docker-compose.yml + synapse config + element config
//   provision — registers Matrix accounts, creates room, invites everyone

import fs from "fs";
import path from "path";
import crypto from "crypto";
import YAML from "yaml";
import ejs from "ejs";

const MODE = process.argv[2] || "generate";

// ─── GENERATE MODE ──────────────────────────────────────────────────────────

async function generate() {
  const configPath = "/config/claw.yaml";
  const outputDir = "/output";

  if (!fs.existsSync(configPath)) {
    console.error("Error: claw.yaml not found at /config/claw.yaml");
    process.exit(1);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let config;
  try {
    config = YAML.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse claw.yaml: ${err.message}`);
    process.exit(1);
  }

  // Validate
  if (!config.agents || config.agents.length === 0) {
    console.error("Error: claw.yaml must define at least one agent");
    process.exit(1);
  }
  if (!config.human?.username) {
    console.error("Error: claw.yaml must define a human user");
    process.exit(1);
  }

  // Apply defaults
  const defaults = config.agent_defaults || {};
  const agents = config.agents.map((a) => ({
    name: a.name,
    username: a.username || a.name,
    password: a.password || `${a.name}-bot-2026`,
    display_name: a.display_name || a.name.charAt(0).toUpperCase() + a.name.slice(1),
    model: a.model || defaults.model || "claude-haiku-4-5-20251001",
    max_turns: a.max_turns || defaults.max_turns || 15,
    respond_to: a.respond_to || defaults.respond_to || "smart",
    heartbeat_interval: a.heartbeat === false ? 0 : (a.heartbeat_interval || defaults.heartbeat_interval || 1800000),
    reflection_interval: a.reflection === false ? 0 : (a.reflection_interval || defaults.reflection_interval || 86400000),
    workspace: a.workspace || [],
    identity: a.identity || null,
    heartbeat_instructions: a.heartbeat_instructions || null,
    reflection_instructions: a.reflection_instructions || null,
    image: a.image || null,
    env: a.env || {},
  }));

  const sharedRepo = config.shared_repo || null; // e.g. "/Users/jeff/code/myproject"

  const allBotUsernames = agents.map((a) => a.username);
  const serverName = config.server_name || "localhost";
  const ports = {
    synapse: config.ports?.synapse || 38008,
    element: config.ports?.element || 38088,
    mitmproxy_ui: config.ports?.mitmproxy_ui || 38081,
  };
  const roomAlias = config.room?.alias || "claw";
  const roomName = config.room?.name || "The Claw";
  const roomTopic = config.room?.topic || "Multi-agent collaboration room";
  const egressMode = config.egress?.mode || "log-only";
  const envFile = config.env_file || ".env";

  // Generate or load secrets
  const secretsPath = path.join(outputDir, ".claw-secrets.json");
  let secrets;
  if (fs.existsSync(secretsPath)) {
    secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    console.log("[init] Using existing secrets from .claw-secrets.json");
  } else {
    secrets = {
      registration_shared_secret: crypto.randomBytes(32).toString("base64url"),
      macaroon_secret_key: crypto.randomBytes(32).toString("base64url"),
      form_secret: crypto.randomBytes(32).toString("base64url"),
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
    console.log("[init] Generated new secrets");
  }

  // Build provision config (embedded in compose as env var)
  const provisionConfig = {
    server_name: serverName,
    room_alias: roomAlias,
    room_name: roomName,
    room_topic: roomTopic,
    human: {
      username: config.human.username,
      password: config.human.password || `${config.human.username}-2026`,
      display_name: config.human.display_name || config.human.username,
      admin: config.human.admin !== false,
    },
    agents: agents.map((a) => ({
      username: a.username,
      password: a.password,
      display_name: a.display_name,
    })),
  };

  // Template data
  const templateData = {
    config,
    agents,
    allBotUsernames,
    serverName,
    ports,
    roomAlias,
    roomName,
    roomTopic,
    egressMode,
    envFile,
    secrets,
    sharedRepo,
    provisionConfig: JSON.stringify(provisionConfig),
  };

  // Render templates
  const templatesDir = "/app/templates";

  const compose = ejs.render(
    fs.readFileSync(path.join(templatesDir, "docker-compose.yml.ejs"), "utf8"),
    templateData,
  );
  const homeserver = ejs.render(
    fs.readFileSync(path.join(templatesDir, "homeserver.yaml.ejs"), "utf8"),
    templateData,
  );
  const elementConfig = ejs.render(
    fs.readFileSync(path.join(templatesDir, "element-config.json.ejs"), "utf8"),
    templateData,
  );

  // Write output files
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "docker-compose.yml"), compose);

  const synapseDir = path.join(outputDir, "synapse-data");
  fs.mkdirSync(synapseDir, { recursive: true });
  fs.writeFileSync(path.join(synapseDir, "homeserver.yaml"), homeserver);

  // Copy log config
  const logConfig = fs.readFileSync(
    path.join(templatesDir, "log.config"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(synapseDir, `${serverName}.log.config`),
    logConfig,
  );

  fs.writeFileSync(
    path.join(outputDir, "element-config.json"),
    elementConfig,
  );

  // Copy mitmproxy scripts
  const mitmDir = path.join(outputDir, "mitmproxy", "scripts");
  fs.mkdirSync(mitmDir, { recursive: true });

  // Generate allowlist.py based on egress mode
  const allowlistTemplate = fs.readFileSync(
    path.join(templatesDir, "allowlist.py.ejs"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(mitmDir, "allowlist.py"),
    ejs.render(allowlistTemplate, templateData),
  );
  fs.copyFileSync(
    path.join(templatesDir, "logger.py"),
    path.join(mitmDir, "logger.py"),
  );

  // Create agent directories and copy identity files
  for (const agent of agents) {
    // Data directory (memory, sessions, soul)
    const dataDir = path.join(outputDir, "agent-data", agent.name);
    fs.mkdirSync(path.join(dataDir, "memory"), { recursive: true });
    const sessionsFile = path.join(dataDir, "sessions.json");
    if (!fs.existsSync(sessionsFile)) {
      fs.writeFileSync(sessionsFile, "{}");
    }

    // Config directory (identity, heartbeat)
    const configDir = path.join(outputDir, "agent-config", agent.name);
    fs.mkdirSync(configDir, { recursive: true });

    // Copy identity file if specified
    if (agent.identity) {
      const identitySource = path.join("/config", agent.identity);
      if (fs.existsSync(identitySource)) {
        fs.copyFileSync(
          identitySource,
          path.join(configDir, "IDENTITY.md"),
        );
      } else {
        console.warn(
          `[init] Warning: identity file not found: ${agent.identity}`,
        );
        // Write a default identity
        fs.writeFileSync(
          path.join(configDir, "IDENTITY.md"),
          `# ${agent.display_name}\n\nYou are ${agent.display_name}, a helpful assistant in a Matrix chat room. Be concise and direct.\n`,
        );
      }
    } else {
      fs.writeFileSync(
        path.join(configDir, "IDENTITY.md"),
        `# ${agent.display_name}\n\nYou are ${agent.display_name}, a helpful assistant in a Matrix chat room. Be concise and direct.\n`,
      );
    }

    // Write heartbeat instructions if specified
    if (agent.heartbeat_instructions) {
      fs.writeFileSync(
        path.join(configDir, "HEARTBEAT.md"),
        agent.heartbeat_instructions,
      );
    }

    // Write reflection instructions if specified
    if (agent.reflection_instructions) {
      fs.writeFileSync(
        path.join(configDir, "REFLECTION.md"),
        agent.reflection_instructions,
      );
    }

    // Write human feedback preferences if specified
    const feedback = config.human.feedback;
    if (feedback) {
      const style = feedback.style || "diplomatic";
      const notes = feedback.notes || "";
      const humanName = config.human.display_name || config.human.username;
      let content = `# How to Give Feedback to ${humanName}\n\n`;
      content += `**Style:** ${style}\n`;
      if (style === "direct") {
        content += `Deliver observations plainly without hedging. Be specific, use examples.\n`;
      } else if (style === "minimal") {
        content += `Only surface feedback if it's genuinely blocking. Otherwise absorb and adapt.\n`;
      } else {
        content += `Frame observations as questions or suggestions. Be constructive.\n`;
      }
      if (notes) {
        content += `\n**Notes:** ${notes}\n`;
      }
      fs.writeFileSync(path.join(configDir, "FEEDBACK.md"), content);
    }
  }

  // Create logs directory
  fs.mkdirSync(path.join(outputDir, "logs"), { recursive: true });

  // Create mitmproxy certs directory
  fs.mkdirSync(path.join(outputDir, "mitmproxy", "certs"), { recursive: true });

  // Create .gitignore
  fs.writeFileSync(
    path.join(outputDir, ".gitignore"),
    `# Generated by claw init — don't commit secrets or data
.claw-secrets.json
synapse-data/
agent-data/
mitmproxy/certs/
logs/
`,
  );

  console.log("");
  console.log("=== Stack generated successfully ===");
  console.log(`  Output:    ${outputDir}/`);
  console.log(`  Agents:    ${agents.map((a) => a.display_name).join(", ")}`);
  console.log(`  Human:     ${config.human.username}`);
  console.log(`  Room:      #${roomAlias}:${serverName}`);
  console.log(`  Egress:    ${egressMode}`);
  console.log("");
  console.log("Next steps:");
  console.log("  cd generated && docker compose up -d");
  console.log(`  open http://localhost:${ports.element}   # Element Web`);
  console.log(`  open http://localhost:${ports.mitmproxy_ui}   # mitmproxy`);
  console.log("");
}

// ─── PROVISION MODE ─────────────────────────────────────────────────────────

async function provision() {
  const SYNAPSE_URL = process.env.SYNAPSE_URL || "http://synapse:8008";
  const SHARED_SECRET = process.env.SHARED_SECRET;
  const PROVISION_CONFIG = process.env.PROVISION_CONFIG;

  if (!SHARED_SECRET || !PROVISION_CONFIG) {
    console.error("[provision] Missing SHARED_SECRET or PROVISION_CONFIG");
    process.exit(1);
  }

  // Check if already provisioned
  const markerFile = "/data/provisioned.json";
  if (fs.existsSync(markerFile)) {
    console.log("[provision] Already provisioned, skipping");
    process.exit(0);
  }

  const config = JSON.parse(PROVISION_CONFIG);

  // Wait for Synapse to be ready
  console.log("[provision] Waiting for Synapse...");
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`${SYNAPSE_URL}/health`);
      if (resp.ok) break;
    } catch {}
    if (i === 29) {
      console.error("[provision] Synapse not ready after 30 attempts");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("[provision] Synapse is ready");

  // Register accounts using Synapse admin registration API
  // https://element-hq.github.io/synapse/latest/admin_api/register_api.html
  async function registerUser(username, password, displayName, admin = false) {
    // Step 1: Get nonce
    const nonceResp = await fetch(
      `${SYNAPSE_URL}/_synapse/admin/v1/register`,
    );
    if (!nonceResp.ok) {
      throw new Error(`Failed to get nonce: ${await nonceResp.text()}`);
    }
    const { nonce } = await nonceResp.json();

    // Step 2: Compute HMAC
    const adminStr = admin ? "admin" : "notadmin";
    const mac = crypto
      .createHmac("sha1", SHARED_SECRET)
      .update(`${nonce}\0${username}\0${password}\0${adminStr}`)
      .digest("hex");

    // Step 3: Register
    const regResp = await fetch(
      `${SYNAPSE_URL}/_synapse/admin/v1/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce,
          username,
          password,
          mac,
          admin,
          displayname: displayName,
        }),
      },
    );

    if (!regResp.ok) {
      const body = await regResp.text();
      // User already exists is fine
      if (body.includes("User ID already taken")) {
        console.log(`[provision] ${username} already exists`);
        return null;
      }
      throw new Error(`Failed to register ${username}: ${body}`);
    }

    const result = await regResp.json();
    console.log(`[provision] Registered ${username}`);
    return result;
  }

  // Login as a user to get an access token
  async function login(username, password) {
    const resp = await fetch(`${SYNAPSE_URL}/_matrix/client/r0/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password,
      }),
    });
    if (!resp.ok) throw new Error(`Login failed for ${username}`);
    return (await resp.json()).access_token;
  }

  // Register all accounts
  console.log("[provision] Registering accounts...");

  // Human user (admin)
  await registerUser(
    config.human.username,
    config.human.password,
    config.human.display_name,
    config.human.admin,
  );

  // Agent accounts
  for (const agent of config.agents) {
    await registerUser(agent.username, agent.password, agent.display_name);
  }

  // Create room as the human user
  console.log("[provision] Creating room...");
  const humanToken = await login(
    config.human.username,
    config.human.password,
  );

  const createRoomResp = await fetch(
    `${SYNAPSE_URL}/_matrix/client/r0/createRoom`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${humanToken}`,
      },
      body: JSON.stringify({
        room_alias_name: config.room_alias,
        name: config.room_name,
        topic: config.room_topic,
        visibility: "private",
        preset: "private_chat",
        invite: config.agents.map(
          (a) => `@${a.username}:${config.server_name}`,
        ),
      }),
    },
  );

  if (!createRoomResp.ok) {
    const body = await createRoomResp.text();
    if (body.includes("Room alias already taken")) {
      console.log("[provision] Room already exists");
    } else {
      console.error(`[provision] Failed to create room: ${body}`);
    }
  } else {
    const { room_id } = await createRoomResp.json();
    console.log(`[provision] Created room ${room_id}`);
  }

  // Auto-join agents to the room
  console.log("[provision] Joining agents to room...");
  for (const agent of config.agents) {
    try {
      const agentToken = await login(agent.username, agent.password);
      const joinResp = await fetch(
        `${SYNAPSE_URL}/_matrix/client/r0/join/${encodeURIComponent(`#${config.room_alias}:${config.server_name}`)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${agentToken}`,
          },
          body: "{}",
        },
      );
      if (joinResp.ok) {
        console.log(`[provision] ${agent.username} joined room`);
      } else {
        console.warn(
          `[provision] ${agent.username} failed to join: ${await joinResp.text()}`,
        );
      }
    } catch (err) {
      console.warn(
        `[provision] ${agent.username} join error: ${err.message}`,
      );
    }
  }

  // Write marker
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(
    markerFile,
    JSON.stringify(
      {
        provisioned_at: new Date().toISOString(),
        accounts: [
          config.human.username,
          ...config.agents.map((a) => a.username),
        ],
        room: `#${config.room_alias}:${config.server_name}`,
      },
      null,
      2,
    ),
  );

  console.log("[provision] Done!");
}

// ─── Main ───────────────────────────────────────────────────────────────────

if (MODE === "generate") {
  await generate();
} else if (MODE === "provision") {
  await provision();
} else {
  console.error(`Unknown mode: ${MODE}. Use "generate" or "provision".`);
  process.exit(1);
}
