const ROOT = "https://thy-toxic-gamer.github.io/Toxic-Command-Center";

const button = (label: string, path: string) => ({
  type: 2,
  style: 5,
  label,
  url: `${ROOT}${path}`,
});

export const COMMUNITY_INFO_TITLES = [
  "☣️ ThyToxicBot & Toxic Command Center",
  "🎮 Game Requests, Payments & Support",
  "⚖️ Appeals, Moderation & Staff Review",
  "🎟️ Private Tickets & Community Support",
];

export const COMMUNITY_INFO_CLEANUP_TITLES = [
  ...COMMUNITY_INFO_TITLES,
  "🎟️ Private Tickets, Polls & Community Tools",
  "☣️ ThyToxicBot",
  "⚖️ Appeals Center",
  "🎟️ Private Tickets",
  "🛡️ Moderation & Community Management",
];

export const COMMUNITY_INFO_MESSAGES = [
  {
    embeds: [{
      color: 0x72ff00,
      title: COMMUNITY_INFO_TITLES[0],
      description: `**Our privately developed community system, created specifically for ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ and built around how this Community actually operates.**

ThyToxicBot and the Toxic Command Center work together as the protected core for moderation cases, appeals, private tickets, verified donations, staff tools, and permanent system records. Dedicated public bots now handle routine chat protection, chat commands, and platform notifications so each part of the Community has one clear responsibility.

• **Focused Command Network** — The Appeals Center, Ticket Center, Support Center, protected staff workspaces, and Discord case tools share one organized system.
• **Case-Based Moderation** — Authorized staff can warn, mute, kick, ban, reverse eligible actions, search cases, review infractions, and document important decisions through ThyToxicBot.
• **Protected TTG-MOD Records** — Moderation actions receive case numbers containing the reason, responsible staff member, timestamps, evidence, replies, status changes, and complete event history.
• **Appeals Integration** — Eligible members receive private directions to the Appeals Center and can continue protected communication with staff through the linked case.
• **Private Ticket System** — General Support, Report a User, Staff Inquiry, and Suggestion tickets create controlled channels with Claim Ticket and confirmed Close Ticket actions.
• **Verified Donation Processing** — Confirmed PayPal donations create one protected receipt, one Discord record, and one queued Streamer.bot/OBS alert without duplicate playback.
• **Dedicated Bot Responsibilities** — Dyno handles routine Discord AutoMod, Nightbot and StreamElements handle stream-chat commands, YouTube Bot handles YouTube notices, and UB3R-B0T handles Twitch go-live notices.
• **Permission Protection** — Sensitive tools remain restricted to the Owner, Administrators, Moderators, or specifically authorized staff according to the action being performed.
• **Retention & Accountability** — Protected records follow their established retention policy, while owner-only deletion and automatic cleanup prevent uncontrolled access.

ThyToxicBot is not a generic public bot, and the Toxic Command Center is not a collection of unrelated services. Together they form our custom community and stream-management system, while the other bots perform clearly assigned supporting roles.`,
      footer: { text: "ThyToxicBot • Custom-built for ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆" },
    }],
    components: [{
      type: 1,
      components: [button("Open Toxic Command Center", "/")],
    }],
    allowed_mentions: { parse: [] },
  },
  {
    embeds: [{
      color: 0xffcc33,
      title: COMMUNITY_INFO_TITLES[1],
      description: `**Our custom request and support systems now handle the full process—from choosing a game or support amount through verified payment, Discord routing, stream alerts, and protected records.**

The Game Request Center is built for clear expectations. The Support Center gives viewers a direct way to support the stream without sending them through StreamElements or Streamlabs.

• **Verified Requester Identity** — Viewers sign in with Twitch so each request is connected to the correct person and active-request limits can be enforced.
• **Flexible Game Search** — The catalog supports partial and forgiving searches instead of requiring an exact title, with organized platform IDs and collection ranges for games packaged together.
• **Request Options** — Catalog games use Play at **$5**, Speed at **$10**, or 100% at **$15**. A 100% request may require more than one stream.
• **Pending Staff Review** — New viewer requests begin as Pending. Staff confirms the selection before opening payment; choosing an approval status cannot bypass payment verification.
• **Secure Payment Window** — Once staff selects Approve & Request Payment, the requester receives a 24-hour PayPal window. Unpaid requests expire automatically and move to the Expired record channel.
• **Automatic PayPal Verification** — A matching completed payment moves the request to Approved and routes the Discord record automatically. Amount or currency mismatches stop for staff review.
• **Scheduling & Completion** — After payment, staff chooses the future stream date. Completion requires a valid YouTube VOD, and the staff page can automatically use the latest completed livestream.
• **Game Changes** — Requesters can submit a protected game-change request. Staff may approve or deny it, while authorized staff retain unlimited correction control with a confirmation step.
• **Discord Request Records** — Pending, Awaiting Payment, Approved, Scheduled, Completed, Denied, Cancelled, and Expired stages are routed to their proper locations, with one final history record updated throughout the request.
• **Direct Support Center** — Supporters choose an amount, optional display name, optional message, anonymous status, and whether a message may be considered for TTS.
• **Verified Donation Alerts** — PayPal confirmation creates a TTG-DON receipt, sends the donation to Discord, and queues the matching Streamer.bot/OBS alert exactly once.
• **Payment Privacy** — PayPal handles card and bank information. Our site stores the verified receipt and system history, not the supporter’s financial instrument details.
• **Protected Receipts** — Donation records remain available to authorized staff for 15 months before automatic cleanup.

Both systems were built for this stream. Requests cannot jump ahead without verification, and an alert is never treated as valid until PayPal confirms the payment.`,
      footer: { text: "Toxic Command Center • Verified requests and support" },
    }],
    components: [{
      type: 1,
      components: [
        button("Open Game Requests", "/games/"),
        button("Open Support Center", "/support/"),
      ],
    }],
    allowed_mentions: { parse: [] },
  },
  {
    embeds: [{
      color: 0xff3b93,
      title: COMMUNITY_INFO_TITLES[2],
      description: `**Our privately developed Appeals Center and moderation system provide one documented, identity-verified process for reviewing staff actions across the Community.**

Every Discord moderation action created through ThyToxicBot is tied to a protected case. The Appeals Center supports Discord, Twitch, YouTube, Kick, TikTok, Instagram, and X / Twitter actions while keeping case access limited to the affected member and authorized staff.

• **Protected Moderation Commands** — Authorized staff can issue warnings, timed mutes, kicks, and bans with a required reason and optional evidence.
• **TTG-MOD Case Numbers** — Every action receives a unique case number connected to the member, action, staff member, reason, evidence, timestamps, status, and history.
• **Action Reversals** — Unwarn, unmute, and unban commands remain tied to the original case so the record shows both the action and its correction.
• **Case Search & Infractions** — Staff can search by case number, member name, or Discord ID, inspect case history, view all current infractions, or filter by warning, mute, kick, or ban.
• **Owner Safety Controls** — Clearing every current infraction and permanently deleting a case require owner authorization and exact confirmation text.
• **Verified Appeals** — Members verify with Twitch or Discord before submitting or tracking a case. Discord appeals must match an eligible TTG-MOD record belonging to that member.
• **Platform-Specific Review** — The appeal records where the action occurred instead of assuming every punishment came from Discord.
• **One Active Case** — Duplicate appeals are blocked. Members must allow the current case to close and follow the submission cooldown before creating another.
• **Evidence & Context** — Members may explain what happened and attach up to five relevant public evidence links without exposing private information.
• **Private Case Conversation** — Staff replies and member responses remain attached to the protected case instead of being scattered across public channels or personal messages.
• **Staff Review Controls** — Moderators may review and recommend; Administrators and the Owner can finalize outcomes according to their assigned authority.
• **Clear Status Tracking** — Cases can move through appealed, under review, needs information, accepted pending reversal, accepted, denied, reversed, closed, or failed states.
• **Decision Notifications** — Members receive private case updates and directions back to the Appeals Center. Accepted cases that still need a reversal stay visibly pending until the action is actually corrected.
• **Protected Archives** — Completed cases, staff notes, decisions, and event history remain available for review under the six-month retention policy. Permanent deletion remains owner-only.

This process is designed to support fair review without weakening moderation. Appeals are private requests for reconsideration—not a place to harass staff, bypass restrictions, or submit false evidence.`,
      footer: { text: "ThyToxicBot • Documented moderation and protected appeals" },
    }],
    components: [{
      type: 1,
      components: [button("Open Appeals Center", "/appeals-center/")],
    }],
    allowed_mentions: { parse: [] },
  },
  {
    embeds: [{
      color: 0x48e69b,
      title: COMMUNITY_INFO_TITLES[3],
      description: `**Our private Ticket Center gives members one organized place to ask for help, report concerns, contact staff, or submit a suggestion.**

Tickets are operated through ThyToxicBot and the Toxic Command Center. Private matters stay private, staff actions remain documented, and important conversations are preserved instead of being scattered across public channels or direct messages.

**Need to open a ticket? Click here:** <#1536971857088086026>

• **Four Ticket Types** — Members can open General Support, Report a User, Staff Inquiry, or Suggestion tickets from the official Ticket Center.
• **Private Channel Creation** — Each ticket is placed inside its matching protected category and can be viewed only by the requester and authorized staff.
• **One Active Ticket** — Duplicate active tickets are prevented so the member and staff can keep one complete conversation in the correct location.
• **Claim Ticket** — Moderators, Administrators, and the Owner can claim an open ticket. The assigned staff member is shown in the channel and saved with the protected record.
• **Confirmed Closing** — Close Ticket requires confirmation. The requester or authorized staff may close an open ticket, while accidental closure can be cancelled before anything is removed.
• **Archive Before Deletion** — ThyToxicBot saves the complete available conversation and posts the permanent completion summary before deleting the private Discord channel.
• **Failure Protection** — If the archive or ticket-log delivery fails, the private channel remains open instead of silently disappearing.
• **Live Support Status** — The status channel shows open tickets, tickets waiting for staff, claimed tickets, today’s opened and closed totals, average first-response time, and counts by ticket type.
• **Protected Ticket Records** — Authorized staff can review active and archived tickets through the secured website workspace.
• **Six-Month Retention** — Closed ticket records remain available for review and automatically purge after six months according to the established retention policy.
• **Controlled Staff Access** — Ticket claims, staff actions, closure details, and completion records remain tied to the protected ticket history.
• **Clear System Ownership** — ThyToxicBot manages the Discord ticket channels while the Toxic Command Center provides the protected website records and staff workspace.

The goal is simple: private issues receive organized staff attention, complete records, and a clear resolution process from opening through closure.`,
      footer: { text: "ThyToxicBot • Private support and protected ticket records" },
    }],
    components: [{
      type: 1,
      components: [
        button("Open Ticket Center", "/tickets/"),
      ],
    }],
    allowed_mentions: { parse: [] },
  },
] as const;
