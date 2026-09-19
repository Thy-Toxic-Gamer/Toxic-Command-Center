export const APPLICATION_ID = Deno.env.get("DISCORD_APPLICATION_ID") ?? "1544711402873290873";
export const APPEALS_CHANNEL_ID = Deno.env.get("DISCORD_APPEALS_CHANNEL_ID") ?? "1537193380864598037";
export const POLLS_CHANNEL_ID = Deno.env.get("DISCORD_POLLS_CHANNEL_ID") ?? "1540905290440900759";
export const POLLS_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/polls/";

const STRING = 3;
const INTEGER = 4;
const USER = 6;
const ATTACHMENT = 11;

const reason = { type: STRING, name: "reason", description: "Clear, truthful reason", required: true, min_length: 3, max_length: 2000 };
const evidence = { type: ATTACHMENT, name: "evidence", description: "Optional evidence attachment", required: false };
const user = { type: USER, name: "user", description: "Member", required: true };
const caseNumber = (required = true) => ({
  type: STRING,
  name: "case_number",
  description: "TTG-MOD case number",
  required,
  autocomplete: true,
});

const pollDuration = {
  type: STRING,
  name: "duration",
  description: "How long voting stays open",
  required: false,
  choices: [
    ["15 minutes", "15m"], ["30 minutes", "30m"], ["1 hour", "1h"], ["1.5 hours", "90m"],
    ["3 hours", "3h"], ["6 hours", "6h"], ["12 hours", "12h"], ["1 day", "1d"],
    ["3 days", "3d"], ["7 days", "7d"], ["No automatic close", "none"],
  ].map(([name, value]) => ({ name, value })),
};

export const T_COMMAND = {
  name: "t",
  description: "ThyToxicBot community, moderation, and appeal commands",
  type: 1,
  options: [
    { type: 1, name: "warn", description: "Issue a documented warning", options: [user, reason, evidence] },
    {
      type: 1,
      name: "mute",
      description: "Temporarily mute a member",
      options: [
        user,
        {
          type: STRING,
          name: "duration",
          description: "Mute duration",
          required: true,
          choices: [
            ["5 minutes", "5m"], ["10 minutes", "10m"], ["30 minutes", "30m"],
            ["1 hour", "1h"], ["6 hours", "6h"], ["12 hours", "12h"],
            ["1 day", "1d"], ["3 days", "3d"], ["7 days", "7d"], ["28 days", "28d"],
          ].map(([name, value]) => ({ name, value })),
        },
        reason,
        evidence,
      ],
    },
    { type: 1, name: "kick", description: "Kick a member and create a case", options: [user, reason, evidence] },
    {
      type: 1,
      name: "ban",
      description: "Ban a member and create a case",
      options: [
        user,
        reason,
        {
          type: INTEGER,
          name: "delete_history",
          description: "Message history to remove",
          required: false,
          choices: [
            { name: "Preserve messages", value: 0 },
            { name: "Previous hour", value: 3600 },
            { name: "Previous day", value: 86400 },
            { name: "Previous 7 days", value: 604800 },
          ],
        },
        evidence,
      ],
    },
    { type: 1, name: "unwarn", description: "Reverse a recorded warning", options: [user, caseNumber(), reason, evidence] },
    { type: 1, name: "unmute", description: "Remove a timeout tied to a case", options: [user, caseNumber(), reason, evidence] },
    {
      type: 1,
      name: "unban",
      description: "Unban a user tied to a case",
      options: [
        { type: STRING, name: "user_id", description: "Discord user ID", required: true, min_length: 16, max_length: 22 },
        caseNumber(), reason, evidence,
      ],
    },
    {
      type: 1,
      name: "cases",
      description: "Search cases by number, name, or Discord ID",
      options: [
        { type: STRING, name: "query", description: "Case number, member name, or Discord user ID", required: false, max_length: 100 },
        { type: USER, name: "user", description: "Member", required: false },
        {
          type: STRING, name: "status", description: "Filter by status", required: false,
          choices: ["active", "appealed", "under_review", "needs_information", "accepted_pending_reversal", "accepted", "denied", "reversed", "closed", "failed"].map((value) => ({ name: value.replaceAll("_", " "), value })),
        },
      ],
    },
    {
      type: 1,
      name: "infractions",
      description: "List every current infraction by member",
      options: [{
        type: STRING,
        name: "action",
        description: "Optionally show one infraction type",
        required: false,
        choices: ["warn", "mute", "kick", "ban"].map((value) => ({ name: value, value })),
      }],
    },
    { type: 1, name: "caseinfo", description: "Show a case and recent history", options: [caseNumber()] },
    {
      type: 1,
      name: "appealreply",
      description: "Reply to the member through the protected case",
      options: [
        { type: STRING, name: "message", description: "Message to the member", required: true, min_length: 1, max_length: 1800 },
        caseNumber(false),
      ],
    },
    {
      type: 1,
      name: "staffnote",
      description: "Add a private staff note about a member",
      options: [user, { type: STRING, name: "note", description: "Private staff note", required: true, min_length: 3, max_length: 3000 }],
    },
    { type: 1, name: "notes", description: "View recent private notes for a member", options: [user] },
    {
      type: 1,
      name: "caseupdate",
      description: "Correct a case reason",
      options: [caseNumber(), { ...reason, description: "Corrected reason" }, evidence],
    },
    {
      type: 1,
      name: "caseclose",
      description: "Record an appeal outcome or close a case",
      options: [
        caseNumber(),
        {
          type: STRING,
          name: "outcome",
          description: "Case outcome",
          required: true,
          choices: [
            { name: "Accepted", value: "accepted" },
            { name: "Denied", value: "denied" },
            { name: "Needs information", value: "needs_information" },
            { name: "Closed", value: "closed" },
          ],
        },
        { type: STRING, name: "response", description: "Decision or request sent to the member", required: true, min_length: 3, max_length: 1800 },
      ],
    },
    {
      type: 1,
      name: "casedelete",
      description: "Owner only: permanently delete a case",
      options: [
        caseNumber(),
        { type: STRING, name: "confirmation", description: "Type DELETE followed by the case number", required: true, max_length: 40 },
      ],
    },
    {
      type: 1,
      name: "clearinfractions",
      description: "Owner only: reverse every current infraction",
      options: [{
        type: STRING,
        name: "confirmation",
        description: "Type CLEAR ALL INFRACTIONS",
        required: true,
        min_length: 21,
        max_length: 21,
      }],
    },
    { type: 1, name: "poll", description: "Open the Poll Center and list polls accepting votes" },
    { type: 1, name: "polls", description: "Open the Poll Center and list polls accepting votes" },
    {
      type: 1,
      name: "pollcreate",
      description: "Staff: create a website poll and post it to Discord",
      options: [
        { type: STRING, name: "question", description: "Poll question", required: true, min_length: 3, max_length: 240 },
        { type: STRING, name: "option1", description: "First choice", required: true, min_length: 1, max_length: 100 },
        { type: STRING, name: "option2", description: "Second choice", required: true, min_length: 1, max_length: 100 },
        { type: STRING, name: "option3", description: "Third choice", required: false, min_length: 1, max_length: 100 },
        { type: STRING, name: "option4", description: "Fourth choice", required: false, min_length: 1, max_length: 100 },
        { type: STRING, name: "option5", description: "Fifth choice", required: false, min_length: 1, max_length: 100 },
        { type: STRING, name: "option6", description: "Sixth choice", required: false, min_length: 1, max_length: 100 },
        pollDuration,
      ],
    },
    {
      type: 1,
      name: "pollclose",
      description: "Staff: close an open poll and publish final results",
      options: [{ type: INTEGER, name: "poll_number", description: "Number shown in TTG-POLL-000001", required: true, min_value: 1 }],
    },
    {
      type: 1,
      name: "pollclear",
      description: "Owner only: archive every poll",
      options: [{ type: STRING, name: "confirmation", description: "Type CLEAR ALL POLLS", required: true, min_length: 15, max_length: 15 }],
    },
    { type: 1, name: "guide", description: "Administrator: refresh the staff procedure message" },
  ],
};

export const DURATION_SECONDS: Record<string, number> = {
  "5m": 300,
  "10m": 600,
  "30m": 1800,
  "1h": 3600,
  "6h": 21600,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "7d": 604800,
  "28d": 2419200,
};
