import type { LuaHandlerContext } from "./luaHandlers.js";
import { wrapHandler } from "../utils/errorHandling.js";
import { Poe2SkillService } from "../services/poe2SkillService.js";

const service = new Poe2SkillService();

function compatTag(c?: { compatibility: string }): string {
  if (!c) return "";
  if (c.compatibility === "mismatch") return " ⚠️ MISMATCH";
  if (c.compatibility === "universal") return " (universal)";
  return " ✓";
}

export async function handleAnalyzeSkillsPoe2(context: LuaHandlerContext) {
  return wrapHandler("analyze skills (PoE2)", async () => {
    await context.ensureLuaClient();
    const luaClient = context.getLuaClient();
    if (!luaClient) throw new Error("Lua client not initialized. Use lua_start first.");

    const analysis = await service.analyze(luaClient);
    const lines: string[] = ["=== PoE2 Skill Setup Analysis (engine-backed) ===", "", analysis.summary, ""];

    if (analysis.groups.length === 0) {
      lines.push("This build has no socket groups. Add a skill via create_socket_group + add_gem.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    for (const g of analysis.groups) {
      const mainTag = g.isMain ? " [MAIN]" : "";
      const disabledTag = g.enabled ? "" : " [DISABLED]";
      lines.push(`## Group ${g.index}: ${g.label}${mainTag}${disabledTag}`);
      if (g.slot) lines.push(`  Slot: ${g.slot}`);
      if (g.activeSkillName) {
        lines.push(`  Active skill: ${g.activeSkillName}  (${g.activeSkillTags})`);
      } else {
        lines.push(`  Active skill: (none)`);
      }
      lines.push(`  Supports: ${g.supportCount}`);

      for (const gem of g.gems) {
        if (gem.isSupport) {
          const q = gem.quality ? ` Q${gem.quality}` : "";
          lines.push(`    - ${gem.name} (L${gem.level}${q})${compatTag(gem.compat)}${gem.enabled ? "" : " [disabled]"}`);
        }
      }

      if (g.issues.length > 0) {
        lines.push(`  Issues:`);
        for (const issue of g.issues) lines.push(`    • ${issue}`);
      }
      lines.push("");
    }

    lines.push("Tip: use suggest_supports (group_index) for compatible supports this build isn't using.");
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });
}

export async function handleSuggestSupportsPoe2(
  context: LuaHandlerContext,
  groupIndex: number,
  count?: number,
  measureDps?: boolean
) {
  return wrapHandler("suggest supports (PoE2)", async () => {
    await context.ensureLuaClient();
    const luaClient = context.getLuaClient();
    if (!luaClient) throw new Error("Lua client not initialized. Use lua_start first.");

    if (groupIndex == null || Number.isNaN(Number(groupIndex))) {
      throw new Error("group_index is required (see analyze_skills for group numbers).");
    }

    // Measured (real-DPS) path: socket each candidate, recalc, rank by delta.
    if (measureDps) {
      const res = await service.measureSupportDps(luaClient, Number(groupIndex), { count: count || 6 });
      const lines: string[] = ["=== PoE2 Support Suggestions (measured DPS) ===", ""];
      if (!res.activeSkill) {
        lines.push(`Group ${groupIndex} has no active skill gem, so nothing can be measured.`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }
      lines.push(`Active skill: ${res.activeSkill}`);
      lines.push(`Baseline DPS: ${res.baselineDps.toLocaleString()}`);
      if (res.note) lines.push(`(${res.note})`);
      lines.push("", "Candidates ranked by measured DPS gain (each socketed, recalculated, then removed):", "");
      if (res.measured.length === 0) {
        lines.push("No compatible unused supports to measure.");
      } else {
        for (const m of res.measured) {
          const sign = m.delta >= 0 ? "+" : "";
          const pct = res.baselineDps > 0 ? ` (${sign}${m.deltaPct.toFixed(1)}%)` : "";
          lines.push(`- **${m.name}** — ${sign}${Math.round(m.delta).toLocaleString()} DPS${pct} → ${Math.round(m.dps).toLocaleString()}`);
          lines.push(`    tags: ${m.tags}`);
        }
      }
      lines.push("", "Note: measured on the in-memory build (transiently socketed then removed; build restored).");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    const res = await service.suggestSupports(luaClient, Number(groupIndex), Math.min(count || 8, 20));
    const lines: string[] = ["=== PoE2 Support Suggestions (engine gem data) ===", ""];

    if (!res.activeSkill) {
      lines.push(`Group ${groupIndex} has no active skill gem, so no support suggestions can be made.`);
      lines.push("Add an active skill gem to the group first.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    lines.push(`Active skill: ${res.activeSkill}`);
    lines.push(`Compatible supports not currently used (ranked by tag relevance):`, "");

    if (res.suggestions.length === 0) {
      lines.push("No additional compatible supports found (or all relevant supports are already socketed).");
    } else {
      for (const s of res.suggestions) {
        const shared = s.shared.length ? `  [shares: ${s.shared.join(", ")}]` : "";
        lines.push(`- **${s.name}** — ${s.reason}${shared}`);
        lines.push(`    tags: ${s.tags}`);
      }
    }
    lines.push("");
    lines.push("Note: ranking is a tag-based heuristic. Pass measure_dps=true to rank by real DPS gain instead.");
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });
}
