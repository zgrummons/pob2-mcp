import { describe, it, expect } from '@jest/globals';
import { handlePlanLeveling, type LevelingContext } from '../../src/handlers/levelingHandlers.js';

/**
 * Minimal fake of the PoB2 Lua bridge for the leveling planner. Only the methods
 * the handler touches are implemented; listGems branches on the requested type.
 */
function makeClient(opts: {
  info?: { className?: string; ascendClassName?: string };
  groups?: any[];
  mainSocketGroup?: number;
  activeGems?: any[];
  supportGems?: any[];
}): any {
  return {
    getBuildInfo: async () => opts.info ?? {},
    getSkills: async () => ({ mainSocketGroup: opts.mainSocketGroup ?? 0, groups: opts.groups ?? [] }),
    listGems: async (params: { type?: 'active' | 'support' }) => {
      const gems = params.type === 'support' ? (opts.supportGems ?? []) : (opts.activeGems ?? []);
      return { gems, count: gems.length, total: gems.length };
    },
  };
}

function ctx(client: any): LevelingContext {
  return { getLuaClient: () => client, ensureLuaClient: async () => {} };
}

const text = (r: any) => r.content[0].text as string;

describe('handlePlanLeveling (PoE2)', () => {
  // The original repro: fresh Witch/Abyssal Lich build with no socket groups,
  // main_skill="Entangle" passed as an arg.
  const entangle = { name: 'Entangle', tags: 'physical', tagKeys: ['spell', 'physical'] };
  const supportGems = [
    { name: 'Brutality', tags: 'physical', tagKeys: ['support', 'physical'] }, // universal + shares physical
    { name: 'Arcane Tempo', tags: 'spell', tagKeys: ['support', 'spell'] }, // gating spell matches
    { name: 'Fork', tags: 'projectile', tagKeys: ['support', 'projectile'] }, // gating projectile -> mismatch
    { name: 'Martial Tempo', tags: 'attack', tagKeys: ['support', 'attack'] }, // gating attack -> mismatch
  ];

  it('resolves class/ascendancy from engine className/ascendClassName (no "Unknown")', async () => {
    const client = makeClient({
      info: { className: 'Witch', ascendClassName: 'Abyssal Lich' },
      groups: [],
      activeGems: [entangle],
      supportGems,
    });
    const out = text(await handlePlanLeveling(ctx(client), { main_skill: 'Entangle' }));
    expect(out).toContain('Witch / Abyssal Lich');
    expect(out).not.toContain('Unknown');
    expect(out).not.toContain('(Unknown)');
  });

  it('uses PoE2 campaign structure & Trials, not PoE1 content', async () => {
    const client = makeClient({
      info: { className: 'Witch', ascendClassName: 'Abyssal Lich' },
      activeGems: [entangle],
      supportGems,
    });
    const out = text(await handlePlanLeveling(ctx(client), { main_skill: 'Entangle' }));

    // PoE2 present
    expect(out).toContain('Trial of the Sekhemas');
    expect(out).toContain('Trial of Chaos');
    expect(out).toContain('Count Geonor');
    expect(out).toContain('Jamanra');
    expect(out).toContain('Doryani');

    // PoE1-isms absent
    for (const poe1 of ['Labyrinth', 'rustic sash', 'Merveil', 'Vaal Oversoul', '6-link', '6L', 'Freezing Pulse', 'weapon swap']) {
      expect(out).not.toContain(poe1);
    }
  });

  it('tailors support direction to the skill tags, excluding mismatched supports', async () => {
    const client = makeClient({ info: { className: 'Witch' }, activeGems: [entangle], supportGems });
    const out = text(await handlePlanLeveling(ctx(client), { main_skill: 'Entangle' }));

    expect(out).toContain('Entangle');
    // Compatible supports surface...
    expect(out).toMatch(/Brutality|Arcane Tempo/);
    // ...mismatched (wrong delivery tag) ones do not.
    expect(out).not.toContain('Fork');
    expect(out).not.toContain('Martial Tempo');
  });

  it('reframes gems as PoE2 support sockets, not gear links', async () => {
    const client = makeClient({ info: { className: 'Witch' }, activeGems: [entangle], supportGems });
    const out = text(await handlePlanLeveling(ctx(client), { main_skill: 'Entangle' }));
    expect(out).toContain('support sockets');
    expect(out).toMatch(/uncut/i);
    expect(out).toContain('unique to');
  });

  it('args override engine values', async () => {
    const client = makeClient({ info: { className: 'Witch', ascendClassName: 'Abyssal Lich' }, activeGems: [], supportGems: [] });
    const out = text(await handlePlanLeveling(ctx(client), { class_name: 'Monk', ascendancy: 'Invoker' }));
    expect(out).toContain('Monk / Invoker');
  });

  it('works with no Lua client (args only) without crashing', async () => {
    const context: LevelingContext = { getLuaClient: () => null, ensureLuaClient: async () => {} };
    const out = text(await handlePlanLeveling(context, { class_name: 'Warrior' }));
    expect(out).toContain('Warrior');
    expect(out).toContain('Trial of the Sekhemas');
    expect(out).not.toContain('Labyrinth');
  });
});
