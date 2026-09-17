export const APPEAL_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/#submit-appeal";
export const STAFF_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/staff.html";

const base = { allowed_mentions: { parse: [] } };

export const STAFF_GUIDE_MESSAGES = [
  {
    ...base,
    embeds: [{
      color: 0x72ff00,
      title: "⚖️ Appeals & Moderation Review — Staff Only (1/4)",
      description:
        "**Moderators & Administrators**\n\n⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆'s Community uses **ThyToxicBot** together with our **Appeals Center** for moderation actions, numbered cases, private member communication, staff notes, evidence, decisions, and protected records.",
      fields: [
        {
          name: "❗ Required Moderation Procedure",
          value:
            "Staff must use ThyToxicBot's `/t` moderation commands when warning, muting, kicking, or banning a member. Do not use Discord's built-in Ban or Timeout controls unless **⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆** specifically authorizes it for an exceptional situation.",
        },
        {
          name: "Using built-in Discord actions may bypass",
          value:
            "• TTG-MOD case creation\n• The member's private moderation notice\n• Appeal instructions and the Reply to Staff button\n• Evidence and staff records\n• The protected Discord appeal thread\n• Appeals Center case history\n• Moderation logging and later reversal tracking",
        },
        {
          name: "Reasons and evidence",
          value:
            "Every action must have a clear, truthful, and specific reason. Add evidence when available. The reason, evidence, moderator identity, action time, delivery result, case conversation, and final outcome may later be reviewed during an appeal.",
        },
        {
          name: "Professional conduct",
          value:
            "Never use moderation commands to settle a personal disagreement. Never invent evidence, exaggerate an incident, or use an unclear reason such as “because I said so.” If unsure, pause and ask another Moderator, an Administrator, or **⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆**.",
        },
      ],
      footer: { text: "Toxic Command Core • Staff procedure 1 of 4" },
    }],
  },
  {
    ...base,
    embeds: [{
      color: 0xff2b8a,
      title: "🔨 Required ThyToxicBot Commands (2/4)",
      description: "Use the slash-command options Discord displays after selecting `/t`.",
      fields: [
        {
          name: "⚠️ Warning",
          value: "`/t warn user:<member> reason:<reason> [evidence]`\nCreates a documented warning. Warnings do **not** use a duration.",
        },
        {
          name: "🔇 Temporary Mute",
          value:
            "`/t mute user:<member> duration:<choice> reason:<reason> [evidence]`\nAvailable durations: 5 minutes, 10 minutes, 30 minutes, 1 hour, 6 hours, 12 hours, 1 day, 3 days, 7 days, or 28 days.",
        },
        {
          name: "📤 Kick",
          value: "`/t kick user:<member> reason:<reason> [evidence]`\nRemoves the member from the server. A kick does not use a duration.",
        },
        {
          name: "🔨 Ban",
          value:
            "`/t ban user:<member> reason:<reason> [delete_history] [evidence]`\nThe optional setting can preserve messages or remove the previous hour, day, or seven days. Delete history only when necessary and appropriate.",
        },
        {
          name: "Numbered cases and member notices",
          value:
            "Every eligible action creates a case such as **TTG-MOD-000006**. ThyToxicBot attempts to DM the member their action, reason, case number, appeal link, and **Reply to Staff** button. Staff can review whether delivery succeeded.",
        },
        {
          name: "↩️ Reversing an action",
          value:
            "• `/t unwarn` reverses a recorded warning.\n• `/t unmute` removes an active timeout.\n• `/t unban` removes an active server ban.\n\nUse the affected member or user ID, the **original TTG-MOD case number**, a truthful reason, and optional evidence. Use autocomplete when available. Never reverse the wrong case or create a second action merely to correct the first one.",
        },
        {
          name: "Higher-impact actions",
          value:
            "Administrators and **⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆** handle corrections and higher-impact decisions. Owner-only commands and permanent deletion remain restricted to **⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆**.",
        },
      ],
      footer: { text: "Toxic Command Core • Staff procedure 2 of 4" },
    }],
  },
  {
    ...base,
    embeds: [{
      color: 0x9b6cff,
      title: "📩 Appeals & Private Communication (3/4)",
      description:
        "After an eligible moderation action, ThyToxicBot attempts to DM the member their case information and appeal access.",
      fields: [
        {
          name: "If the member did not receive the notice",
          value:
            `If delivery failed, the member lost the information, or someone asks where to appeal, provide only this official address:\n${APPEAL_URL}`,
        },
        {
          name: "🔎 Finding and reviewing a case",
          value:
            "• `/t cases` searches by member, action, status, case number, member name, or Discord ID.\n• `/t caseinfo case_number:<case>` displays the action, status, reason, moderator, DM-delivery result, and recent history.\n• Authorized staff can use the Appeals Center Staff Review page for the protected record.",
        },
        {
          name: "💬 Member communication",
          value:
            "When the member selects **Reply to Staff** on the ThyToxicBot notice, their response is saved with the case and copied into that case's protected Discord thread.",
        },
        {
          name: "Staff replies",
          value:
            "Inside the correct case thread, use `/t appealreply message:<message> [case_number]`. The case number normally fills from the thread. Outside it, provide the TTG-MOD case number manually. ThyToxicBot DMs the response, records it, and copies it into the protected thread.",
        },
        {
          name: "Keep the complete record together",
          value:
            "The member replies with **Reply to Staff**. Staff replies with `/t appealreply`. Do not move the discussion into personal DMs. Personal DMs are not part of the protected case record and can leave authorized staff without information needed for review.",
        },
      ],
      footer: { text: "Toxic Command Core • Staff procedure 3 of 4" },
    }],
  },
  {
    ...base,
    embeds: [{
      color: 0x72ff00,
      title: "🛡️ Review, Staff Roles & Protected Records (4/4)",
      description:
        "Before recommending or making a decision, review the original action and reason, all evidence, the member's explanation, the complete conversation, relevant previous violations and staff notes, the seriousness and circumstances, consistency with Community Rules, and whether clarification is still needed.",
      fields: [
        {
          name: "🟣 Moderators",
          value:
            "• Review cases, evidence, and member explanations.\n• Communicate professionally through the protected system.\n• Use `/t staffnote` for relevant private information and `/t notes` when prior notes are needed.\n• Make recommendations and escalate uncertain or high-impact decisions.",
        },
        {
          name: "🩷 Administrators",
          value:
            "• Review the full case and Moderator recommendations.\n• Request more information when needed.\n• Make authorized decisions consistently with policy.\n• Use `/t caseupdate` to correct an inaccurate reason.\n• Use `/t caseclose` to record the outcome.\n• Use the proper reversal command when an accepted appeal requires action reversal.",
        },
        {
          name: "🟢 ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆",
          value:
            "Has final authority over protected settings, permanent deletion, exceptional cases, and owner-only commands. Accepted active warnings, mutes, and bans remain **pending reversal** until the matching reversal command is completed.",
        },
        {
          name: "Closing and retention",
          value:
            "Record the outcome and reasoning before closing a case. Closing a conversation does not immediately erase its history. Protected cases, events, and staff notes automatically delete after **six months** under the system retention rule.",
        },
        {
          name: "⚠️ Protected information",
          value:
            "Appeal submissions, evidence, moderation records, case conversations, private staff notes, and staff discussions must remain in authorized areas. Only the affected person may access their own member-facing communication. When the correct result is unclear, pause and ask another authorized staff member or **⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆**.",
        },
        {
          name: "Official pages",
          value: `[Staff Review](${STAFF_URL})\n[Member Appeal Form](${APPEAL_URL})`,
        },
      ],
      footer: { text: "Toxic Command Core • Staff procedure 4 of 4 • six-month retention" },
    }],
  },
];
