/**
 * PoE2 campaign data (patch 0.5 "Return of the Ancients").
 *
 * Authoritative, hand-maintained dataset for the leveling planner. PoB2's
 * shipped `QuestRewards.lua` only has clean PoE2 data for Acts 1–3 (Acts 4–6 in
 * that file are stale PoE1 areas), so it can't be used wholesale — these numbers
 * are sourced from the live 0.5 campaign guides instead.
 *
 * Structure of 0.5: four Acts plus three Interludes (the Interludes replaced the
 * old "Cruel" second campaign run that was removed in 0.3 — there is NO Cruel
 * difficulty in 0.5). Ascendancy points come from the Trials of Ascendancy
 * (Trial of the Sekhemas in Act 2, Trial of Chaos in Act 3), NOT a Labyrinth.
 *
 * Level targets are "expected character level on completion" and are approximate
 * — players over/under-level. Re-verify boss names and levels each patch.
 *
 * Sources (verified 2026-06):
 *  - https://maxroll.gg/poe2/getting-started/path-of-exile-2-campaign-guide
 *  - https://maxroll.gg/poe2/news/act-4-and-interludes-campaign-walkthrough-plus-boss-guides
 *  - https://maxroll.gg/poe2/getting-started/trials-of-ascendancy
 *  - https://game8.co/games/Path-of-Exile-2/archives/486659
 */

export interface PoE2Trial {
  /** Trial name, e.g. "Trial of the Sekhemas". */
  name: string;
  /** Ascendancy passive points granted on first completion. */
  ascendancyPoints: number;
  /** How the trial is accessed during this segment. */
  access: string;
  /** True if completing this trial first unlocks the Ascendancy class. */
  unlocksAscendancy?: boolean;
}

export interface PoE2CampaignSegment {
  kind: "act" | "interlude";
  /** Ordered position in the campaign (1-based). */
  order: number;
  /** Display name, e.g. "Act 2" or "Interlude: The Stolen Barya". */
  name: string;
  /** Final / capstone boss of the segment. */
  finalBoss: string;
  /** Approximate character level entering the segment. */
  levelStart: number;
  /** Approximate character level on completing the segment. */
  levelEnd: number;
  /** Ascendancy trial available during this segment, if any. */
  trial?: PoE2Trial;
  /** Extra per-segment guidance. */
  notes?: string[];
}

export const POE2_CAMPAIGN: PoE2CampaignSegment[] = [
  {
    kind: "act",
    order: 1,
    name: "Act 1",
    finalBoss: "Count Geonor",
    levelStart: 1,
    levelEnd: 22,
    notes: [
      "Earlier capstone: The King in the Mists (Freythorn) grants +30 Spirit — worth doing.",
      "Grab movement-speed boots as soon as you can — biggest early quality-of-life upgrade.",
    ],
  },
  {
    kind: "act",
    order: 2,
    name: "Act 2",
    finalBoss: "Jamanra, the Abomination",
    levelStart: 22,
    levelEnd: 38,
    trial: {
      name: "Trial of the Sekhemas",
      ascendancyPoints: 2,
      access:
        "Defeat Balbala, the Traitor in Traitor's Passage for Balbala's Barya, then use it at the Relic Altar.",
      unlocksAscendancy: true,
    },
    notes: [
      "First Trial of the Sekhemas completion unlocks your Ascendancy class — do it as soon as you can survive the honour-based run.",
    ],
  },
  {
    kind: "act",
    order: 3,
    name: "Act 3",
    finalBoss: "Doryani, Royal Thaumaturge",
    levelStart: 38,
    levelEnd: 52,
    trial: {
      name: "Trial of Chaos",
      ascendancyPoints: 2,
      access:
        "Defeat Xyclucian, the Chimera in the Chimeral Wetlands for the Chimeral Inscribed Ultimatum to enter the Temple of Chaos.",
    },
    notes: [
      "Second campaign ascendancy points — clears your in-campaign Ascendancy (4 of 8 total).",
    ],
  },
  {
    kind: "act",
    order: 4,
    name: "Act 4",
    finalBoss: "Tavakai, the Chieftain",
    levelStart: 52,
    levelEnd: 62,
    notes: [
      "Other dangerous Act 4 fights: Yama the White and Benedictus, First Herald of Utopia.",
    ],
  },
  {
    kind: "interlude",
    order: 5,
    name: "Interlude: Curse of Holten",
    finalBoss: "Thane Wulfric & Lady Elyswyth",
    levelStart: 62,
    levelEnd: 63,
    notes: ["Interludes replaced the old Cruel re-run — fresh content, not a repeat of the acts."],
  },
  {
    kind: "interlude",
    order: 6,
    name: "Interlude: The Stolen Barya",
    finalBoss: "Azmadi, the Faridun Prince",
    levelStart: 63,
    levelEnd: 64,
  },
  {
    kind: "interlude",
    order: 7,
    name: "Interlude: Doryani's Contingency",
    finalBoss: "Doryani's Contingency (campaign finale)",
    levelStart: 64,
    levelEnd: 65,
    notes: ["Finishing here opens the endgame (Atlas / maps)."],
  },
];

/** Ascendancy passive points obtainable from the two in-campaign Trials. */
export const POE2_CAMPAIGN_ASCENDANCY_POINTS = POE2_CAMPAIGN.reduce(
  (n, s) => n + (s.trial?.ascendancyPoints ?? 0),
  0
);

/**
 * PoE2 gem-system guidance. PoE2 does NOT use gear-based links: each skill gem
 * carries its OWN support sockets that unlock as the skill gem's level rises,
 * and every support gem is unique across the whole build (a given support can
 * only be socketed into one skill at a time). Skill/support gems are cut from
 * uncut gems and set to a level — they do not gain XP from being socketed.
 */
export const POE2_GEM_NOTES: string[] = [
  "PoE2 has no gear-based gem links. Each **skill gem has its own support sockets** that open up as that skill gem gains levels (up to ~5 supports on a fully-leveled skill).",
  "Each **support gem is unique to your build** — the same support can only be slotted into one skill at a time, so spend your best supports on your main skill.",
  "Skill and support gems are **cut from uncut gems** (skill / support gems) and set to a level. They don't level from being socketed, so cut new ones / re-level as your attributes allow.",
  "Quest reward and vendor uncut gems are limited early — prioritise cutting your main skill and its top 2–3 supports first.",
];
