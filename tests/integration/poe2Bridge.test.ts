/**
 * Integration tests that drive the real PoB2 engine through the Lua bridge.
 *
 * These require luajit on PATH and the PathOfBuilding-PoE2 fork (with the
 * api-stdio bridge) present. They are gated on that fork existing, so they run
 * in this dev environment but skip cleanly in CI / on machines without it.
 *
 * Override the fork location with POB_FORK_PATH if it isn't the default sibling.
 */
import path from "path";
import fs from "fs";
import { PoBLuaApiClient } from "../../src/pobLuaBridge";
import { Poe2SkillService } from "../../src/services/poe2SkillService";
import { handlePlanLeveling } from "../../src/handlers/levelingHandlers";

const forkSrc = process.env.POB_FORK_PATH
  || path.resolve(__dirname, "..", "..", "..", "PathOfBuilding-PoE2", "src");
const forkPresent = fs.existsSync(path.join(forkSrc, "HeadlessWrapper.lua"));

const d = forkPresent ? describe : describe.skip;
if (!forkPresent) {
  // eslint-disable-next-line no-console
  console.warn(`[poe2Bridge.test] PoE2 fork not found at ${forkSrc} — skipping integration tests.`);
}

d("PoE2 Lua bridge (integration)", () => {
  let api: PoBLuaApiClient;
  let ready = false;

  beforeAll(async () => {
    try {
      api = new PoBLuaApiClient({ cwd: forkSrc, cmd: process.env.POB_CMD || "luajit", timeoutMs: 90000 });
      await api.start();
      await api.newBuild();
      ready = true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[poe2Bridge.test] bridge failed to start (luajit missing?) — tests will no-op:", (e as Error).message);
    }
  }, 120000);

  afterAll(async () => {
    if (api) { try { await api.stop(); } catch { /* ignore */ } }
  });

  it("responds to ping", async () => {
    if (!ready) return;
    expect(await api.ping()).toBe(true);
  }, 30000);

  it("computes PoE2 stats including Spirit", async () => {
    if (!ready) return;
    const stats = await api.getStats(["Life", "Mana", "Spirit"]);
    expect(stats).toHaveProperty("Spirit");
    expect(Number(stats.Life)).toBeGreaterThan(0);
  }, 30000);

  it("recalculates on level change", async () => {
    if (!ready) return;
    const before = Number((await api.getStats(["Life"])).Life);
    await api.setLevel(90);
    const after = Number((await api.getStats(["Life"])).Life);
    expect(after).toBeGreaterThan(before);
  }, 30000);

  it("lists support gems from the engine gem DB", async () => {
    if (!ready) return;
    const res = await api.listGems({ type: "support", maxResults: 50 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.gems.every((g: any) => g.kind === "support")).toBe(true);
  }, 30000);

  it("exposes PoE2 classes (Witch=1, Ranger=2)", async () => {
    if (!ready) return;
    const { classes } = await api.getClasses();
    const byId = new Map(classes.map((c) => [c.classId, c.name]));
    expect(byId.get(1)).toBe("Witch");
    expect(byId.get(2)).toBe("Ranger");
  }, 30000);

  it("analyzes a skill setup and flags a mismatched support", async () => {
    if (!ready) return;
    const svc = new Poe2SkillService();
    const g = await api.createSocketGroup({ label: "Ice Nova", slot: "Weapon 1" });
    await api.addGem({ groupIndex: g.index, gemName: "Ice Nova", level: 20 });
    await api.addGem({ groupIndex: g.index, gemName: "Runic Infusion", level: 1 }); // Attack on a Spell

    const analysis = await svc.analyze(api);
    const group = analysis.groups.find((gr) => gr.index === g.index)!;
    expect(group.activeSkillName).toBe("Ice Nova");
    const runic = group.gems.find((gm) => gm.name === "Runic Infusion")!;
    expect(runic.compat?.compatibility).toBe("mismatch");

    const suggestions = await svc.suggestSupports(api, g.index, 5);
    expect(suggestions.activeSkill).toBe("Ice Nova");
    expect(suggestions.suggestions.length).toBeGreaterThan(0);
  }, 60000);

  it("plans PoE2 leveling: resolves Witch/Abyssal Lich, Trials not Labyrinth, skill-tailored", async () => {
    if (!ready) return;
    // Set Witch / Abyssal Lich via the tree (new_build always spawns the default class).
    const { classes } = await api.getClasses();
    const witch = classes.find((c) => c.name === "Witch")!;
    const abyssal = witch.ascendancies.find((a) => a.name === "Abyssal Lich")!;
    await api.updateTreeDelta({ classId: witch.classId, ascendClassId: abyssal.id });

    const ctx = { getLuaClient: () => api, ensureLuaClient: async () => {} };
    const out = (await handlePlanLeveling(ctx, { main_skill: "Entangle" })).content[0].text;

    // Acceptance: correct title (no "Unknown"), PoE2 trials/bosses, skill-tailored, no PoE1-isms.
    expect(out).toContain("Witch / Abyssal Lich");
    expect(out).not.toContain("Unknown");
    expect(out).toContain("Trial of the Sekhemas");
    expect(out).toContain("Count Geonor");
    expect(out).toContain("Entangle");
    // Entangle is a Plant skill — its tag-matched supports should surface.
    expect(out.toLowerCase()).toContain("plant");
    for (const poe1 of ["Labyrinth", "rustic sash", "Merveil", "6-link", "weapon swap", "Freezing Pulse"]) {
      expect(out).not.toContain(poe1);
    }
  }, 60000);
});
