# pob2-mcp — Handoff

Port of the PoE1 `pob-mcp` server to **Path of Exile 2**. This doc captures the current
state so work can resume cleanly. Last updated: 2026-06-01.

## Committed revisions (local only — nothing pushed)

| Repo | Branch | Commit | Contents |
|---|---|---|---|
| `pob2-mcp/` | `main` | HEAD (see `git log`) | The TypeScript MCP server (this project). No git remote yet. |
| `PathOfBuilding-PoE2/` | `api-stdio-poe2` (off `dev`) | `7b5a673` | The Lua bridge port: `src/API/*` (+`list_gems`, get_skills gem breakdown, `get_classes`), `src/utf8.lua`, `HeadlessWrapper.lua` hooks. |

`PathOfBuilding-PoE2`'s `origin` is the community upstream (no push rights); `dev` is left pristine
for pulling upstream. To back up the bridge, push `api-stdio-poe2` to a personal fork. SHAs are the
state described below; later work will move past them.

## TL;DR

- The hard foundation is **done and verified working**: a headless `luajit` PoB2 process exposing a
  JSON-over-stdio API, driven by the TypeScript MCP server.
- Verified end-to-end through the **compiled** TS bridge: live PoE2 stat calc (incl. `Spirit`),
  tree get/set, item/skill ops, XML export → parse → validate, and a new PoE2-native `list_gems` tool.
- What remains is mostly **PoE2-correctness of carried-over PoE1 heuristics** (skill-gem analysis,
  defensive thresholds, poe.ninja/Trade endpoints), not plumbing.

## Repo layout (siblings under `…/pob-mcp/`)

| Dir | What |
|---|---|
| `pob-mcp/` | Original PoE1 server (reference, untouched) |
| `PathOfBuilding/` | ianderse's PoE1 fork, branch `api-stdio` — the **blueprint** for the Lua bridge |
| `PathOfBuilding-PoE2/` | Community PoE2 fork (`dev`) **+ the ported api-stdio bridge** (see below) |
| `pob2-mcp/` | The PoE2 MCP server (this project) |

## Architecture (two halves)

1. **TypeScript MCP server** (`pob2-mcp/src`) — copied from `pob-mcp`, retargeted to PoE2.
   XML tools + thin `lua_*` wrappers over the bridge.
2. **Headless PoB2 engine** — `luajit HeadlessWrapper.lua` with `POB_API_STDIO=1`, speaking
   newline-delimited JSON on stdio. Lives in `PathOfBuilding-PoE2/src`.

## What was ported into `PathOfBuilding-PoE2/` (the Lua bridge)

- `src/API/Server.lua`, `src/API/Handlers.lua` — copied verbatim from the PoE1 `api-stdio` branch
  (transport + dispatch are game-agnostic). Handlers also extended with `list_gems`.
- `src/API/BuildOps.lua` — **adapted** for PoE2 internals (see "PoE2 engine differences" below).
- `src/utf8.lua` — copied (headless utf8 stub).
- `src/HeadlessWrapper.lua` — patched: added the `POB_API_STDIO` block, script-dir/`package.path`
  resolution, utf8 fallback, `newBuild`/`loadBuildFromXML` globals, and a redirect of
  `print`/`ConPrintf` → **stderr** so stdout stays pure JSON.

## PoE2 engine differences already handled

- `PassiveSpec:ImportFromNodeList` has extra leading `className` and a `weaponSets` param.
  Call as `ImportFromNodeList(nil, classId, ascend, secondary, nodes, {}, {}, mastery, treeVersion)`.
- No bandit/pantheon → `get_config`/`set_config` are a generic `configTab.input` passthrough.
- `Spirit` added to default stat export; flask slots validated against the actual item set.
- **XML root element is `<PathOfBuilding2>`** (not `<PathOfBuilding>`). `buildService.readBuild`
  normalizes via `parsed.PathOfBuilding ?? parsed.PathOfBuilding2`. Any new XML parse site must do
  the same. `clusterJewelHandlers` (non-MVP) still reads `build.PathOfBuilding?.Build` and needs
  this fix if revived.
- In PoE2, auras reserve **Spirit**, not mana/life.

## Runtime requirements / gotchas

- `luajit` must be on PATH (here: scoop shim).
- PoB2's `Modules/Common.lua` hard-requires native `lua-utf8`. The TS bridge auto-sets `LUA_CPATH`
  to `<fork>/../runtime/?.dll` so `runtime/lua-utf8.dll` resolves. If you run `luajit` manually,
  set `LUA_CPATH` yourself or you'll get `module 'lua-utf8' not found`.
- PoB2 prints 50+ startup log lines; the stdout→stderr redirect above is what keeps the bridge's
  ready-banner scan working. Don't remove it.

## How to run / verify

Build:
```
cd pob2-mcp && npm install && npm run build
```

Manual Lua smoke test (from `PathOfBuilding-PoE2/src`, bash):
```
export LUA_CPATH='…/PathOfBuilding-PoE2/runtime/?.dll;;'
printf '%s\n' '{"action":"ping"}' '{"action":"new_build"}' '{"action":"get_stats"}' '{"action":"quit"}' \
  | POB_API_STDIO=1 luajit HeadlessWrapper.lua 2>/dev/null
```

MCP config (Claude Desktop) — see `claude_desktop_config.example.json`. Key env:
`POB_LUA_ENABLED=true`, `POB_FORK_PATH=…/PathOfBuilding-PoE2/src`, `POB_CMD=luajit`,
`POB_DIRECTORY=<your PoB2 Builds>`, `POB_TIMEOUT_MS=30000`.

> **Full suite is green:** `npx jest` → 14 suites / 251 tests pass, including the env-gated PoE2
> bridge integration suite (`tests/integration/poe2Bridge.test.ts`, auto-skips without the fork).
> The previously-inherited pob-mcp unit-test failures (stale `useTcpMode`/`PoBLuaTcpClient` refs,
> evolved context shapes, wrong mock response keys, PoE1 fixture shapes, immunity critical-vs-warning)
> have all been fixed.

## Status

### Done & verified
- Lua api-stdio bridge ported to PoE2; `ping/new_build/get_tree/get_stats/set_level/export` all work.
- TS server copies + builds clean; identity = `pob2-mcp-server`; default fork path → PoE2.
- `<PathOfBuilding2>` XML parse fix.
- Validation tool retuned for PoE2 (removed Scion/Enlighten/Elreon/Grace/Determination/Acrobatics/
  Brine King/Aquamarine refs; life thresholds lowered — **estimates, revisit**; Spirit-reservation note).
- **`list_gems`** MCP tool: queries PoB2's authoritative gem DB (`build.data.gems`) — filter by
  type/search/tag, dedupe by name. Full chain verified (tool → router → handler → bridge → engine).
- **PoE2-native skill analysis** (replaces the PoE1 heuristics for the common cases):
  - `BuildOps.get_skills` now returns an engine-truth per-gem breakdown (active vs support via
    `gemData.grantedEffect.support`, level, quality, enabled, tags).
  - `analyze_skills` tool — shows each socket group's active skill + supports, flags tag-mismatched
    supports (e.g. an Attack support on a Cold spell), empty/disabled/unknown gems.
  - `suggest_supports` tool — ranks compatible, unused supports from the engine gem DB by tag
    relevance, OR (with `measure_dps=true`) by **real measured DPS gain**: each candidate is
    transiently socketed, the build recalculated, the delta recorded, then removed (main group
    restored). Service: `services/poe2SkillService.ts`; handlers: `handlers/poe2SkillHandlers.ts`.
    Verified: Ice Nova flags Runic Infusion mismatch; measured ranking gives Cold Penetration +60% >
    Concentrated Area +30% > Cold Mastery +13%.
- **`get_classes`** tool — PoE2 classes + ascendancy IDs straight from the engine tree
  (Witch=1, Ranger=2, Warrior=6, Sorceress=7, Huntress=8, Mercenary=9, Monk=10, Druid=11).
  README class-ID table corrected from PoE1.
- **Integration tests** — `tests/integration/poe2Bridge.test.ts`, gated on the PoE2 fork being
  present (skips in CI otherwise). 6 tests pass (ping, Spirit stats, level recalc, list_gems,
  get_classes, analyze/suggest).
- **Defensive analyzer retuned for PoE2** (`defensiveAnalyzer.ts` + `validateDefensiveLayers`):
  avoidance now uses `EvadeChance` / block / spell block / `DeflectChance` (no spell suppression or
  passive dodge); PoE1 aura/keystone advice (Grace/Determination/Acrobatics/Vitality/Wicked Ward) removed.
- **Legacy PoE1 gem tools deregistered** — `analyze_skill_links`, `suggest_support_gems`,
  `validate_gem_quality`, `compare_gem_setups`, `find_optimal_links`, `gem_upgrade_path` are no longer
  exposed unless `POB_LEGACY_GEM_TOOLS=true`. The engine-backed tools supersede them.
- **poe.ninja ported to PoE2 — LIVE-VERIFIED** — endpoint is
  `/poe2/api/economy/exchange/current/overview?league=<League>&type=Currency` (the docs' `currencyexchange`
  path 404s). Base currency is **Exalted Orb** (primaryValue=1), not Chaos — map anchors Exalted=1,
  output relabelled to `ex`. Verified against `Runes of Aldur` (48 currencies, Mirror 50,990 ex). On by
  default (`POE_NINJA_DISABLED=true`). `find_arbitrage` inert (spread-less feed). Unit-tested.
- **Trade API ported to PoE2 `trade2` — round-trip VERIFIED** — search `/search/poe2/<league>` returns
  `{id,result[],total}`; fetch `/fetch/<ids>?query=<id>&realm=poe2` returns `{result:[{id,listing,item}]}`
  with `item.realm:"poe2"`, `listing.price{amount,currency}` (PoE2 currency codes e.g. `aug`). Confirmed
  against a live `Runes of Aldur` query; `tradeTypes` (SearchResult/FetchResult/ItemListing/TradePrice)
  match the payload, so parsing is correct. StatMapper auto-loads PoE2 trade stats from `…/api/trade2`.
  Behind `POE_TRADE_ENABLED`; the **server** needs `POE_SESSION_ID` (POESESSID). Env:
  `POE_TRADE_BASE`/`POE_TRADE_REALM`/`POE_TRADE_USER_AGENT`.
  **Server-side VERIFIED:** the compiled `tradeClient` (Node, not a browser) ran search→fetch through
  Cloudflare with only `POE_SESSION_ID` set — no 403 (real listing returned, `realm:poe2`). So the trade
  tools work headless as long as a valid POESESSID is provided.
- **PoE2 build parsing** — `parseFlasks` reads Charm slots (ailment immunity from Thawing/Staunching/…),
  no longer assumes 5 flask slots; build issues flag **Spirit** over-reservation.
- **`import_build` tool** — accepts a PoB2 export code OR a pobb.in/pastebin link, decodes it
  (`src/utils/buildCode.ts`: base64url → zlib inflate), loads it into the engine, and optionally saves
  to `POB_DIRECTORY` (`save_as`). Verified live against a pobb.in link. `get_build_info` now resolves
  class/ascendancy from the spec/tree (so imported builds show e.g. "Monk (Martial Artist)").
- **Full unit + integration suite green** (263 tests).

### Carried over from PoE1 — needs PoE2 review
- poe.ninja `find_arbitrage` is inert (the PoE2 currency-exchange feed has no buy/sell spread).
- Legacy skill-gem tools (`skillGemService.ts`) — still PoE1 internally; **deregistered by default**.
  Reimplement on engine data or delete the dead code if never re-enabling.
- `clusterJewelHandlers` (non-MVP) — PoE1 cluster jewel model + needs the `PathOfBuilding2` fix.
- `analyze_build` / `validate_build` — weapon-swap sets and deeper import-code coverage still untested
  against real PoE2 build codes.

## Recommended next steps (in order)

All external-input verifications are complete (build pipeline, poe.ninja, and server-side trade are
live-verified). Remaining polish, lower priority:

1. Exercise `analyze_build` / `validate_build` on more real PoE2 build codes — especially weapon-swap
   sets and multi-spec — to confirm the XML paths beyond the single Monk build tested.
2. Delete the dead `skillGemService.ts` / `skillGemHandlers.ts` (and PoE1 schemas) if the legacy gem
   tools will never be re-enabled — currently deregistered but still compiled.
3. Validate the PoE2 life/defensive thresholds against real endgame builds (current numbers are
   reasoned estimates).
4. Wire a non-secret way to supply `POE_SESSION_ID` (it expires) and surface a clear 401/403 message
   in the trade handlers prompting a refresh.

## Memory

A `project`-type memory exists at the session memory dir (`pob2-mcp-port.md`) with the same key
facts; keep both in sync if either changes materially.
