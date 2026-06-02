# pob2-mcp — Handoff

Port of the PoE1 `pob-mcp` server to **Path of Exile 2**. This doc captures the current
state so work can resume cleanly. Last updated: 2026-06-01.

## Committed revisions (local only — nothing pushed)

| Repo | Branch | Commit | Contents |
|---|---|---|---|
| `pob2-mcp/` | `main` | `2190b85` | The TypeScript MCP server (this project). No git remote yet. |
| `PathOfBuilding-PoE2/` | `api-stdio-poe2` (off `dev`) | `ab38fe8` | The Lua bridge port: `src/API/*`, `src/utf8.lua`, `HeadlessWrapper.lua` hooks. |

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

> Disposable verification scripts used during this work (`smoke-bridge.mjs`,
> `verify-build-pipeline.mjs`, `verify-list-gems.mjs`) were removed after passing. Re-create from the
> patterns above if needed; consider promoting one into `tests/` as a real integration test.

## Status

### Done & verified
- Lua api-stdio bridge ported to PoE2; `ping/new_build/get_tree/get_stats/set_level/export` all work.
- TS server copies + builds clean; identity = `pob2-mcp-server`; default fork path → PoE2.
- `<PathOfBuilding2>` XML parse fix.
- Validation tool retuned for PoE2 (removed Scion/Enlighten/Elreon/Grace/Determination/Acrobatics/
  Brine King/Aquamarine refs; life thresholds lowered — **estimates, revisit**; Spirit-reservation note).
- **`list_gems`** MCP tool: queries PoB2's authoritative gem DB (`build.data.gems`) — filter by
  type/search/tag, dedupe by name. Full chain verified (tool → router → handler → bridge → engine).

### Carried over from PoE1 — needs PoE2 review
- **Skill-gem analysis** (`skillGemService.ts`, ~936 lines + `skillGemHandlers.ts`): hand-coded PoE1
  gem DB, archetype templates, and a **6-link assumption**. Wrong for PoE2 (uncut skills + per-skill
  support sockets, no Awakened/Empower/Enlighten). Tools affected: `analyze_skill_links`,
  `suggest_support_gems`, `validate_gem_quality`, `compare_gem_setups`, `find_optimal_links`,
  `gem_upgrade_path`. **Next planned task — rewrite on top of `list_gems` + engine `ProcessSocketGroup`.**
- Defensive analyzer thresholds; class/ascendancy ID tables in some tool descriptions.
- `poe.ninja` + Trade API (PoE1 leagues/URLs); not validated for PoE2.
- `clusterJewelHandlers` (non-MVP) — PoE1 cluster jewel model + needs the `PathOfBuilding2` fix.

## Recommended next steps (in order)

1. **Rewrite `skillGemService` for PoE2** on top of `list_gems`: drop archetype/6-link logic; model
   per-skill support sockets; use the engine to validate support compatibility. Get a real PoE2 build
   (with gems) to test against — none are bundled; generate one via the bridge or import a build code.
2. Add a real integration test under `pob2-mcp/tests/` (promote a verify script).
3. Audit `poe.ninja`/Trade for PoE2 (new endpoints/leagues) or gate them off until ported.
4. Validate class/ascendancy ID tables in tool docs against PoE2 (`PassiveSpec`/tree class map).

## Memory

A `project`-type memory exists at the session memory dir (`pob2-mcp-port.md`) with the same key
facts; keep both in sync if either changes materially.
