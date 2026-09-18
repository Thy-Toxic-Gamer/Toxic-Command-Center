const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const output = path.resolve(__dirname, "../streamerbot/ThyToxicGamer-Game-Requests-1.0.7.sb");
const actionId = crypto.randomUUID();
const commands = [
  ["Game Request", "!gamerequest"],
  ["Game Request · Owned", "!owned"],
  ["Game Request · Request Game", "!requestgame"],
  ["Game Request · Games", "!games"],
].map(([name, command]) => ({
  id: crypto.randomUUID(),
  name,
  enabled: true,
  include: true,
  mode: 0,
  command,
  regexExplicitCapture: false,
  location: 0,
  ignoreBotAccount: false,
  ignoreInternal: false,
  sources: 2098177,
  persistCounter: false,
  persistUserCounter: false,
  caseSensitive: false,
  globalCooldown: 30,
  userCooldown: 60,
  group: "Game Requests",
  grantType: 0,
  permittedUsers: [],
  permittedGroups: [],
}));

const bundle = {
  meta: {
    name: "ThyToxicGamer Game Requests",
    author: "ThyToxicGamer",
    version: "1.0.0",
    description: "Game Request website command with !gamerequest, !owned, !requestgame, and !games aliases for Streamer.bot 1.0.7.",
    autoRunAction: null,
    minimumVersion: null,
  },
  data: {
    actions: [{
      id: actionId,
      queue: "00000000-0000-0000-0000-000000000000",
      enabled: true,
      excludeFromHistory: false,
      excludeFromPending: false,
      name: "Game Request Link",
      group: "Game Requests",
      alwaysRun: false,
      randomAction: false,
      concurrent: false,
      triggers: commands.map((command) => ({ commandId: command.id, id: crypto.randomUUID(), type: 401, enabled: true, exclusions: [] })),
      subActions: [{
        text: "Game requests: https://thy-toxic-gamer.github.io/Toxic-Command-Center/games/ — Sign in with Twitch to submit a request, pay after staff approval, or check your request status.",
        pin: false,
        pinToStreamEnd: false,
        useBot: true,
        fallback: true,
        id: crypto.randomUUID(),
        weight: 0,
        type: 10,
        parentId: null,
        enabled: true,
        index: 0,
      }],
      collapsedGroups: [],
    }],
    queues: [],
    commands,
    websocketServers: [],
    websocketClients: [],
    timers: [],
  },
  version: 24,
  exportedFrom: "1.0.7",
  minimumVersion: "1.0.0-alpha.1",
};

fs.mkdirSync(path.dirname(output), { recursive: true });
const encoded = Buffer.concat([Buffer.from("SBAE"), zlib.gzipSync(Buffer.from(JSON.stringify(bundle)))])
  .toString("base64");
fs.writeFileSync(output, encoded);
console.log(output);
