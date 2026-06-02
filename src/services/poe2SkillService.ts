/**
 * PoE2 Skill / Support analysis — engine-backed.
 *
 * Unlike the legacy PoE1 `skillGemService` (hand-coded gem DB + archetype
 * templates + 6-link assumption), this service reads the build's ACTUAL skill
 * setup from the PoB2 engine (`get_skills`) and the authoritative gem database
 * (`list_gems`), so it stays correct for PoE2's uncut-skill / support-socket
 * model with no hand-maintained gem data.
 *
 * Support compatibility uses a tag-gating heuristic grounded in real gem tags:
 * a support that carries a "delivery" gating tag (attack/spell/minion/…) only
 * applies to a skill that also has that tag. Descriptive tags (cold, fire, …)
 * are used for relevance ranking, not gating.
 */

/** Minimal slice of the Lua bridge this service needs (keeps it decoupled). */
export interface SkillEngine {
  getSkills(): Promise<any>;
  listGems(params: { type?: "active" | "support"; search?: string; tag?: string; maxResults?: number; dedupeByName?: boolean }): Promise<{ gems: any[]; count: number; total: number }>;
  // Optional — only needed for measured (real-DPS) support ranking.
  getStats?(fields?: string[]): Promise<Record<string, any>>;
  setMainSelection?(params: { mainSocketGroup?: number; mainActiveSkill?: number; skillPart?: number }): Promise<void>;
  addGem?(params: { groupIndex: number; gemName: string; level?: number; quality?: number }): Promise<any>;
  removeGem?(params: { groupIndex: number; gemIndex: number }): Promise<void>;
}

/** Pick the most representative DPS number PoB exposes, in priority order. */
function pickDps(stats: Record<string, any> | undefined): number {
  if (!stats) return 0;
  for (const k of ["CombinedDPS", "TotalDPS", "FullDPS", "WithIgniteDPS", "TotalDotDPS"]) {
    const v = Number(stats[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/** Tags that gate which skills a support can apply to. */
const GATING_TAGS = new Set([
  "attack", "spell", "projectile", "melee", "minion", "totem", "trigger",
  "brand", "warcry", "slam", "channelling", "channeling", "companion",
  "herald", "aura", "curse", "mine", "trap", "strike",
]);

function parseTags(tagString?: string): Set<string> {
  if (!tagString || typeof tagString !== "string") return new Set();
  return new Set(
    tagString.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
}

function gatingOf(tags: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tags) if (GATING_TAGS.has(t)) out.add(t);
  return out;
}

export type Compatibility = "compatible" | "mismatch" | "universal";

export interface SupportCompat {
  compatibility: Compatibility;
  reason: string;
  sharedDescriptiveTags: string[];
}

/**
 * Decide whether a support's tags are compatible with an active skill's tags.
 * `universal` = support has no gating tags (applies broadly).
 */
export function supportCompatibility(skillTags: Set<string>, supportTags: Set<string>): SupportCompat {
  const supportGating = gatingOf(supportTags);
  const descriptive = [...supportTags].filter((t) => !GATING_TAGS.has(t) && t !== "support");
  const shared = descriptive.filter((t) => skillTags.has(t));

  if (supportGating.size === 0) {
    return { compatibility: "universal", reason: "no delivery-tag requirement", sharedDescriptiveTags: shared };
  }
  const met = [...supportGating].filter((t) => skillTags.has(t));
  if (met.length > 0) {
    return { compatibility: "compatible", reason: `matches skill ${met.join("/")}`, sharedDescriptiveTags: shared };
  }
  return {
    compatibility: "mismatch",
    reason: `requires ${[...supportGating].join("/")}, skill is not`,
    sharedDescriptiveTags: shared,
  };
}

export interface AnalyzedGem {
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
  isSupport: boolean;
  tags: string;
  known: boolean;
  compat?: SupportCompat; // supports only, relative to the group's main active skill
}

export interface AnalyzedGroup {
  index: number;
  label: string;
  slot?: string;
  enabled: boolean;
  isMain: boolean;
  activeSkillName: string | null;
  activeSkillTags: string;
  gems: AnalyzedGem[];
  supportCount: number;
  issues: string[];
}

export interface SkillAnalysis {
  groups: AnalyzedGroup[];
  mainSocketGroup: number | null;
  summary: string;
}

export class Poe2SkillService {
  async analyze(engine: SkillEngine): Promise<SkillAnalysis> {
    const skills = await engine.getSkills();
    const groups: AnalyzedGroup[] = [];
    const mainIdx = typeof skills.mainSocketGroup === "number" ? skills.mainSocketGroup : null;

    for (const g of skills.groups || []) {
      const gemList: any[] = g.gems || [];
      const activeGem = gemList.find((gm) => !gm.isSupport) || null;
      const skillTags = parseTags(activeGem?.tags);

      const issues: string[] = [];
      const supports = gemList.filter((gm) => gm.isSupport);

      if (gemList.length === 0) {
        issues.push("Empty socket group (no gems).");
      } else if (!activeGem) {
        issues.push("No active skill gem — supports do nothing without a skill to support.");
      }

      const gems: AnalyzedGem[] = gemList.map((gm) => {
        const tags = parseTags(gm.tags);
        const base: AnalyzedGem = {
          name: gm.name,
          level: gm.level ?? 0,
          quality: gm.quality ?? 0,
          enabled: gm.enabled !== false,
          isSupport: gm.isSupport === true,
          tags: gm.tags || "",
          known: gm.known !== false,
        };
        if (gm.isSupport && activeGem) {
          base.compat = supportCompatibility(skillTags, tags);
          if (base.compat.compatibility === "mismatch") {
            issues.push(`Support "${gm.name}" looks mismatched: ${base.compat.reason}.`);
          }
        }
        if (!base.enabled) issues.push(`"${gm.name}" is disabled.`);
        if (!base.known) issues.push(`"${gm.name}" not found in gem data (check the name).`);
        return base;
      });

      groups.push({
        index: g.index,
        label: g.label || `Group ${g.index}`,
        slot: g.slot,
        enabled: g.enabled !== false,
        isMain: mainIdx != null && g.index === mainIdx,
        activeSkillName: activeGem ? activeGem.name : null,
        activeSkillTags: activeGem?.tags || "",
        gems,
        supportCount: supports.length,
        issues,
      });
    }

    const totalIssues = groups.reduce((n, g) => n + g.issues.length, 0);
    const summary = groups.length === 0
      ? "No socket groups found."
      : `${groups.length} socket group(s), ${totalIssues} issue(s) flagged.`;

    return { groups, mainSocketGroup: mainIdx, summary };
  }

  /**
   * Suggest compatible support gems for a socket group's active skill, ranked
   * by relevance (shared descriptive tags), excluding supports already used.
   */
  async suggestSupports(
    engine: SkillEngine,
    groupIndex: number,
    count = 8
  ): Promise<{ activeSkill: string | null; suggestions: { name: string; tags: string; reason: string; shared: string[] }[] }> {
    const skills = await engine.getSkills();
    const group = (skills.groups || []).find((g: any) => g.index === groupIndex);
    if (!group) throw new Error(`Socket group ${groupIndex} not found (build has ${(skills.groups || []).length}).`);

    const gemList: any[] = group.gems || [];
    const activeGem = gemList.find((gm) => !gm.isSupport) || null;
    if (!activeGem) {
      return { activeSkill: null, suggestions: [] };
    }
    const skillTags = parseTags(activeGem.tags);
    const used = new Set(gemList.filter((gm) => gm.isSupport).map((gm) => String(gm.name).toLowerCase()));

    // Pull the full support list from the engine and rank.
    const all = await engine.listGems({ type: "support", maxResults: 500, dedupeByName: true });
    const ranked = [];
    for (const sg of all.gems) {
      if (used.has(String(sg.name).toLowerCase())) continue;
      const compat = supportCompatibility(skillTags, parseTags(sg.tags));
      if (compat.compatibility === "mismatch") continue;
      ranked.push({
        name: sg.name,
        tags: sg.tags || "",
        reason: compat.compatibility === "universal" ? "applies broadly" : compat.reason,
        shared: compat.sharedDescriptiveTags,
        score: compat.sharedDescriptiveTags.length + (compat.compatibility === "compatible" ? 1 : 0),
      });
    }
    ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return {
      activeSkill: activeGem.name,
      suggestions: ranked.slice(0, count).map(({ score, ...rest }) => rest),
    };
  }

  /**
   * Measure each candidate support's REAL DPS contribution via the engine:
   * tag-prefilter compatible unused supports, then for each one socket it,
   * recalculate, record the DPS delta, and remove it. Restores the original
   * main socket group afterward. Returns candidates ranked by measured delta.
   *
   * Mutates the in-memory build transiently (each candidate is added then
   * removed); the loaded build is left as it was found.
   */
  async measureSupportDps(
    engine: SkillEngine,
    groupIndex: number,
    opts: { count?: number; candidatePool?: number; level?: number } = {}
  ): Promise<{
    activeSkill: string | null;
    baselineDps: number;
    measured: { name: string; tags: string; dps: number; delta: number; deltaPct: number }[];
    note?: string;
  }> {
    if (!engine.getStats || !engine.setMainSelection || !engine.addGem || !engine.removeGem) {
      throw new Error("Engine does not support measured DPS (needs getStats/setMainSelection/addGem/removeGem).");
    }

    const count = Math.min(opts.count || 6, 12);
    const candidatePool = Math.min(opts.candidatePool || 16, 30);
    const level = opts.level || 20;

    // Heuristic shortlist of compatible, unused supports to measure.
    const shortlist = await this.suggestSupports(engine, groupIndex, candidatePool);
    if (!shortlist.activeSkill) {
      return { activeSkill: null, baselineDps: 0, measured: [] };
    }

    // Make this group the main skill so DPS reflects it; remember the original.
    const before = await engine.getSkills();
    const originalMain = typeof before.mainSocketGroup === "number" ? before.mainSocketGroup : undefined;
    await engine.setMainSelection({ mainSocketGroup: groupIndex });

    const baselineDps = pickDps(await engine.getStats(["CombinedDPS", "TotalDPS", "FullDPS"]));

    const measured: { name: string; tags: string; dps: number; delta: number; deltaPct: number }[] = [];
    try {
      for (const s of shortlist.suggestions) {
        let added: any = null;
        try {
          added = await engine.addGem({ groupIndex, gemName: s.name, level });
          const dps = pickDps(await engine.getStats(["CombinedDPS", "TotalDPS", "FullDPS"]));
          const delta = dps - baselineDps;
          const deltaPct = baselineDps > 0 ? (delta / baselineDps) * 100 : 0;
          measured.push({ name: s.name, tags: s.tags, dps, delta, deltaPct });
        } finally {
          // Always remove the candidate we added so the build is restored.
          if (added && typeof added.gemIndex === "number") {
            try { await engine.removeGem({ groupIndex, gemIndex: added.gemIndex }); } catch { /* best effort */ }
          }
        }
      }
    } finally {
      if (originalMain !== undefined) {
        try { await engine.setMainSelection({ mainSocketGroup: originalMain }); } catch { /* best effort */ }
      }
    }

    measured.sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
    const note = baselineDps === 0
      ? "Baseline DPS is 0 (no gear/level or non-damaging skill) — deltas may be small; load a real build for meaningful numbers."
      : undefined;

    return {
      activeSkill: shortlist.activeSkill,
      baselineDps,
      measured: measured.slice(0, count),
      note,
    };
  }
}
