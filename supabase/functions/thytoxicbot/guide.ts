export const APPEAL_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/#submit-appeal";
export const STAFF_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/staff.html";

export const STAFF_GUIDE_MESSAGE = {
  allowed_mentions: { parse: [] },
  embeds: [
    {
      color: 0x72ff00,
      title: "⚖️ Appeals & Moderation Review — Staff Only",
      description:
        "Use **ThyToxicBot** for every warning, mute, kick, and ban. Each action creates a protected `TTG-MOD` case, records the result, attempts a private member notice, and keeps appeal communication together.",
      fields: [
        {
          name: "Required moderation commands",
          value:
            "`/t warn` · `/t mute` · `/t kick` · `/t ban`\nUse Discord's built-in controls only when ThyToxicGamer authorizes an exception. Give a specific, truthful reason and attach evidence when available.",
        },
        {
          name: "Reversals",
          value:
            "Use `/t unwarn`, `/t unmute`, or `/t unban` with the **original case number**. An accepted appeal stays pending until the matching action is safely reversed.",
        },
        {
          name: "Find and review",
          value:
            "`/t cases` searches by case number, member name, mention, or Discord ID. `/t caseinfo` shows the action, reason, moderator, delivery result, status, and recent history.",
        },
        {
          name: "Private communication",
          value:
            "Members use **Reply to Staff** in the bot DM. Staff answer with `/t appealreply` inside the case thread. Do not move case discussion into personal DMs.",
        },
        {
          name: "Notes and decisions",
          value:
            "Moderators: `/t staffnote`, `/t notes`. Administrators: `/t caseupdate`, `/t caseclose`. Permanent deletion is owner-only. Records automatically delete after six months.",
        },
        {
          name: "Official links",
          value: `[Member appeal form](${APPEAL_URL}) · [Staff review](${STAFF_URL})`,
        },
      ],
      footer: { text: "Toxic Command Core • Protected moderation records" },
      timestamp: new Date().toISOString(),
    },
  ],
};
