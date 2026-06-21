/**
 * Leveling Handlers (PoE2)
 *
 * Generates a PoE2 0.5 leveling guide from the loaded build's class /
 * ascendancy / main skill. The campaign structure (acts, interludes, bosses,
 * level targets, Trials of Ascendancy) comes from the verified dataset in
 * `data/poe2Campaign.ts`; early-skill and support direction are driven by the
 * build's actual skill tags via the engine gem DB (`list_gems`) using the same
 * tag-gating logic as `analyze_skills` / `suggest_supports`.
 *
 * This is PoE2-specific: no Labyrinth, no 10-act PoE1 campaign, no gear-based
 * 2L–6L links, no PoE1 vendor recipes / weapon-swap gem XP.
 */

import type { PoBLuaApiClient } from "../pobLuaBridge.js";
import { wrapHandler } from "../utils/errorHandling.js";
import {
  POE2_CAMPAIGN,
  POE2_CAMPAIGN_ASCENDANCY_POINTS,
  POE2_GEM_NOTES,
} from "../data/poe2Campaign.js";
import {
  effectiveTagSet,
  resolveActiveSkillTags,
  rankSupportsForSkillTags,
  type SupportSuggestion,
} from "../services/poe2SkillService.js";

export interface LevelingContext {
  getLuaClient: () => PoBLuaApiClient | null;
  ensureLuaClient: () => Promise<void>;
}

interface ResolvedSkill {
  name: string;
  tags: Set<string>;
  tagString: string;
  /** Supports already socketed on the main skill (excluded from suggestions). */
  usedSupports: Set<string>;
}

/**
 * Resolve the build's main skill (name + effective tags) for tailoring filler
 * and support direction. Prefers the loaded build's main socket group; falls
 * back to looking the skill up by name in the engine gem DB (so a freshly-made
 * build with only `main_skill` provided still gets tag-aware output).
 */
async function resolveMainSkill(
  client: PoBLuaApiClient | null,
  overrideSkill?: string
): Promise<ResolvedSkill | null> {
  if (!client) {
    return overrideSkill ? { name: overrideSkill, tags: new Set(), tagString: "", usedSupports: new Set() } : null;
  }

  // Try the loaded build's main socket group first.
  try {
    const skills = await client.getSkills();
    const groups: any[] = skills?.groups || [];
    if (groups.length > 0) {
      const mainGroup = groups.find((g) => g.index === skills.mainSocketGroup) || groups[0];
      const activeGem = (mainGroup?.gems || []).find((gm: any) => !gm.isSupport) || null;
      const usedSupports = new Set<string>(
        (mainGroup?.gems || []).filter((gm: any) => gm.isSupport).map((gm: any) => String(gm.name).toLowerCase())
      );
      // No override (or it matches the loaded skill): use the live gem's tags directly.
      if (activeGem && (!overrideSkill || overrideSkill.toLowerCase() === String(activeGem.name).toLowerCase())) {
        return {
          name: activeGem.name,
          tags: effectiveTagSet(activeGem),
          tagString: activeGem.tags || "",
          usedSupports,
        };
      }
    }
  } catch {
    // fall through to name-based resolution
  }

  // Resolve by name from the gem DB (override given, or no skills loaded).
  const skillName = overrideSkill;
  if (skillName) {
    try {
      const resolved = await resolveActiveSkillTags(client, skillName);
      if (resolved) {
        return { name: resolved.name, tags: resolved.tags, tagString: resolved.tagString, usedSupports: new Set() };
      }
    } catch {
      // fall through
    }
    return { name: skillName, tags: new Set(), tagString: "", usedSupports: new Set() };
  }
  return null;
}

function formatSupportLine(s: SupportSuggestion): string {
  const why = s.shared.length ? ` (${s.shared.join("/")})` : s.reason ? ` (${s.reason})` : "";
  return `**${s.name}**${why}`;
}

export async function handlePlanLeveling(
  context: LevelingContext,
  args: {
    build_name?: string;
    class_name?: string;
    main_skill?: string;
    ascendancy?: string;
  }
) {
  return wrapHandler("plan leveling", async () => {
    let className = args.class_name;
    let ascendancy = args.ascendancy;

    const luaClient = context.getLuaClient();

    // Pull class / ascendancy from the loaded build. NOTE: the engine returns
    // `className` / `ascendClassName` (resolved from the passive tree) — earlier
    // versions read `class` / `ascendancy` here, which were always undefined.
    if (luaClient) {
      try {
        const info = await luaClient.getBuildInfo();
        className = className || info?.className;
        ascendancy = ascendancy || info?.ascendClassName;
      } catch {
        // use whatever args provided
      }
    }

    const skill = await resolveMainSkill(luaClient, args.main_skill);
    const mainSkill = skill?.name || "your main skill";

    // Tag-aware support direction for the main skill (engine gem DB).
    let supports: SupportSuggestion[] = [];
    if (luaClient && skill && skill.tags.size > 0) {
      try {
        supports = await rankSupportsForSkillTags(luaClient, skill.tags, {
          count: 5,
          exclude: skill.usedSupports,
        });
      } catch {
        supports = [];
      }
    }

    const classLabel = className
      ? ascendancy && ascendancy !== "None"
        ? `${className} / ${ascendancy}`
        : className
      : "Unknown class";

    const descriptive = skill ? [...skill.tags].filter((t) => !["support"].includes(t)) : [];
    const typeHint = skill?.tagString || descriptive.join(", ");

    let out = `# PoE2 Leveling Guide: ${classLabel}\n`;
    out += `**Main Skill:** ${mainSkill}${typeHint ? ` _(${typeHint})_` : ""}\n\n`;

    // --- Early leveling -----------------------------------------------------
    out += `## Early Leveling\n`;
    out += `- PoE2 lets you cut **${mainSkill}** from an uncut skill gem early — use it as soon as it's available and you meet the attribute requirement.\n`;
    if (typeHint) {
      out += `- Before then, fill in with any early skill of the same type (${typeHint}) so your passive/gear investment carries over.\n`;
    } else {
      out += `- Before then, use any early skill that matches your intended damage type so your passives carry over.\n`;
    }
    if (supports.length > 0) {
      out += `- **Support direction for ${mainSkill}** (add as the skill gem levels and opens sockets):\n`;
      for (const s of supports) out += `  - ${formatSupportLine(s)}\n`;
      out += `  _Each support is unique to one skill — reserve these for ${mainSkill}._\n`;
    } else if (luaClient) {
      out += `- Use \`suggest_supports\` on a loaded build for measured support recommendations.\n`;
    }
    out += `\n`;

    // --- Campaign -----------------------------------------------------------
    out += `## Campaign Progression (PoE2 0.5)\n\n`;
    for (const seg of POE2_CAMPAIGN) {
      out += `### ${seg.name} — ${seg.finalBoss} (~Lvl ${seg.levelEnd})\n`;
      if (seg.trial) {
        const unlocks = seg.trial.unlocksAscendancy ? " — first completion **unlocks your Ascendancy**" : "";
        out += `- **${seg.trial.name}** → +${seg.trial.ascendancyPoints} ascendancy points${unlocks}.\n`;
        out += `  - ${seg.trial.access}\n`;
      }
      for (const note of seg.notes || []) out += `- ${note}\n`;
      out += `- Re-cap **Fire / Cold / Lightning** resistances — progression applies resistance penalties at major story steps.\n`;
      out += `\n`;
    }

    // --- Ascendancy ---------------------------------------------------------
    out += `## Ascendancy (Trials of Ascendancy)\n`;
    out += `Ascendancy in PoE2 is unlocked through the **Trials of Ascendancy** — there is no campaign maze to run. Your ${POE2_CAMPAIGN_ASCENDANCY_POINTS} in-campaign points come from:\n`;
    for (const seg of POE2_CAMPAIGN) {
      if (seg.trial) out += `- **${seg.trial.name}** (${seg.name}) — +${seg.trial.ascendancyPoints} points\n`;
    }
    out += `The remaining points (up to 8 total) come from higher-tier endgame Trials (Sekhemas / Chaos with higher-level keys, and Trial of the Hidden).\n\n`;

    // --- Gems ---------------------------------------------------------------
    out += `## Gems & Support Sockets (PoE2)\n`;
    for (const note of POE2_GEM_NOTES) out += `- ${note}\n`;
    out += `\n`;

    // --- Passive tree -------------------------------------------------------
    out += `## Passive Tree Priority\n`;
    out += `1. Path toward your main damage cluster for ${mainSkill}\n`;
    out += `2. Life and Spirit on the way (Spirit funds your reservations/auras in PoE2)\n`;
    out += `3. Resistances near your path to stay capped through act transitions\n`;
    out += `4. Take your Ascendancy nodes as soon as each Trial unlocks them\n`;
    out += `5. Jewel sockets once you have worthwhile leveling jewels\n\n`;
    out += `_Use \`suggest_optimal_nodes\` / \`get_passive_upgrades\` on a loaded build for specific node recommendations._\n`;

    return { content: [{ type: "text" as const, text: out }] };
  });
}
