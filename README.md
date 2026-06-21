# Path of Building MCP Server — PoE2

An MCP (Model Context Protocol) server that enables Claude to analyze, modify, and optimize **Path of Exile 2** builds using Path of Building's actual calculation engine, via the [PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) fork.

It is a port of [`pob-mcp`](../pob-mcp) (PoE1) to PoE2. The high-fidelity calculation half is driven by a headless `luajit` process running an `api-stdio` JSON bridge that was ported onto the PoE2 PoB codebase (`PathOfBuilding-PoE2/src/API/` + `HeadlessWrapper.lua` hooks).

> ### ⚠️ MVP / port status
>
> The Lua bridge foundation is **ported and verified working** against the PoE2 engine (ping, new build, tree get/set, live stat calc incl. **Spirit**, item/skill/config ops, what-if calc). The TypeScript server is a copy of the PoE1 server with PoE2-aware bridge wiring.
>
> **Validated for PoE2:** the `lua_*` engine tools (stats, tree, items, skills, config, level), and XML build analysis (PoE2 uses the same PoB XML schema).
>
> **PoE2-native additions:** `list_gems` queries Path of Building's own PoE2 gem database (skill + support gems, tags, gem family, requirements, max level) — use it for accurate gem info instead of the legacy heuristics below.
>
> **Engine-backed PoE2 tools to prefer:** `analyze_skills`, `suggest_supports` (incl. `measure_dps`), `list_gems`, `get_classes` — all sourced from the PoB2 engine. The defensive analyzer and `validate_build` have been retuned for PoE2 mechanics (evade/block/deflect, Spirit, charms; no spell suppression).
>
> **poe.ninja** currency tools are ported to the PoE2 economy endpoint and on by default (`POE_NINJA_DISABLED=true` to hide).
>
> **Disabled by default (PoE1-shaped, opt-in):** the legacy skill-gem tools (`analyze_skill_links`, `suggest_support_gems`, `find_optimal_links`, `validate_gem_quality`, `compare_gem_setups`, `gem_upgrade_path`) — `POB_LEGACY_GEM_TOOLS=true`; Trade API — `POE_TRADE_ENABLED=true` (PoE2 trade2 endpoints; see below). Class/ascendancy ID tables in some descriptions and bandit/pantheon config (absent in PoE2) are PoE1 remnants.
>
> **PoE2 engine differences already handled in the bridge:** `PassiveSpec:ImportFromNodeList` signature (extra `className` / `weaponSets` params), generic config passthrough (no bandit/pantheon), flask-slot validation against the actual item set, `Spirit` in default stat export, and stdout reserved for the JSON protocol (PoB logging redirected to stderr).

---

## Features

### Build Analysis (Always Available)
- **List & Analyze Builds**: Browse builds and extract stats, skills, items, passive trees, and notes from XML
- **Compare Builds**: Side-by-side build comparison
- **File Watching**: Real-time detection of builds saved from PoB with automatic cache invalidation
- **Tree Analysis**: Compare passive trees, find paths to nodes, discover nearby notables, what-if allocation testing

### High-Fidelity Calculations (Lua Bridge)
- **Live Stats**: Accurate stat calculation using PoB's own engine — identical to what PoB GUI shows
- **Build Loading & Creation**: Load existing builds or create new ones from scratch by class/ascendancy
- **Passive Tree Editing**: Set full tree allocation and see immediate stat recalculation
- **Node Search**: Search the passive tree for nodes by name or stat text
- **Character Level**: Set level and watch all stats update accordingly

### Item & Skill Management (Lua Bridge)
- **Items**: Add items from PoE clipboard text, view all equipped gear
- **Flasks**: Toggle flasks active/inactive with immediate stat feedback
- **Skills**: Full gem management — create socket groups, add/remove/level/quality gems
- **Batch Operations**: `setup_skill_with_gems` and `add_multiple_items` for efficient workflows

### Build Optimization (Lua Bridge)
- **Defensive Analysis**: 3-layer framework (avoidance / mitigation / recovery) — evaluates EHP, spell suppression, armour/PDR, evasion, block, life regen, and leech
- **Node Suggestions**: Archetype-aware suggestions by goal (damage, life, ES, defense, resist)
- **Tree Optimization**: Recommend nodes within reach of the current allocation
- **Item Upgrade Analysis**: Slot-by-slot upgrade recommendations based on live stats
- **Skill Link Optimization**: Detect missing "more" multipliers, penetration gaps, anti-synergies
- **Budget Build Creation**: Generate starter build plans with skill links, gearing strategy, and passive priorities

### Build Validation
- **Comprehensive Checks**: Resistances, life pool, defensive layers, mana, flask immunities, accuracy, damage scaling
- **Severity Classification**: Critical / Warning / Info with actionable suggestions
- **Dual Source**: Uses Lua bridge stats when available, falls back to XML parsing
- **Overall Score**: 0–10 build health score

### Configuration & Scenario Testing (Lua Bridge)
- **Config State**: View bandit, pantheon, enemy settings
- **Toggle Conditions**: Charges, buffs (Onslaught, Fortify, Leeching), boss mode
- **Enemy Tuning**: Set enemy level, resistances, armour, evasion for boss DPS testing

### Skill Gem Analysis
- **Archetype Detection**: Classify builds (Elemental Bow Attack, Summoner, Critical Spell, etc.)
- **Support Gem Recommendations**: Ranked suggestions with DPS estimates and cost context
- **Quality Validation**: Identify missing quality, awakened upgrade paths, corruption targets
- **Optimal Links**: Auto-generate best support gem combinations for 4/5/6-link setups
- **Budget Tiers**: League-start, mid-league, and endgame recommendations

### Build Export & Persistence
- **Export**: Copy builds to XML files with optional notes
- **Save Tree**: Write optimized passive tree back to an existing build file
- **Snapshots**: Versioned build history with tags, stat metadata, and one-click rollback

### Currency & Market Data (poe.ninja)
- **Exchange Rates**: Real-time currency prices in Chaos Orb equivalent
- **Arbitrage Detection**: Find profitable currency trading loops
- **Trade Profit Calculator**: Evaluate custom trading chains

### Trade API (Optional, `POE_TRADE_ENABLED=true`)
- **Item Search**: Search trade with stat filters, price range, link count
- **Price Checking**: Min/max/median/average from recent listings
- **Upgrade Finder**: Identify best item upgrade candidates for your build
- **Resistance Gear**: Find affordable gear to cap resistances
- **Cluster Jewels**: Search and analyze cluster jewel setups
- **Shopping List**: Generate a prioritized shopping list from build analysis

---

## Installation

```bash
cd pob-mcp
npm install
npm run build
```

## Configuration

### Claude Desktop Configuration

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

#### XML-Only (No Lua Bridge)
```json
{
  "mcpServers": {
    "pob": {
      "command": "node",
      "args": ["/absolute/path/to/pob-mcp-server/build/index.js"],
      "env": {
        "POB_DIRECTORY": "/path/to/your/Path of Building/Builds"
      }
    }
  }
}
```

#### Full Configuration (With Lua Bridge)
```json
{
  "mcpServers": {
    "pob": {
      "command": "node",
      "args": ["/absolute/path/to/pob-mcp-server/build/index.js"],
      "env": {
        "POB_DIRECTORY": "/path/to/your/Path of Building/Builds",
        "POB_LUA_ENABLED": "true",
        "POB_FORK_PATH": "/path/to/PathOfBuilding/src",
        "POB_CMD": "/usr/local/bin/luajit",
        "POB_TIMEOUT_MS": "10000"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POB_DIRECTORY` | OS-default Builds dir | Path to your PoB builds directory |
| `POB_LUA_ENABLED` | `false` | Set `"true"` to enable Lua bridge |
| `POB_FORK_PATH` | `~/Projects/PathOfBuilding-PoE2/src` | Path to PathOfBuilding-PoE2/src |
| `POB_CMD` | `luajit` | LuaJIT binary path |
| `POB_TIMEOUT_MS` | `10000` | Lua request timeout (ms) |
| `POE_TRADE_ENABLED` | `false` | Enable Trade API tools (PoE2 `trade2` endpoints — Cloudflare/session-gated, see below) |
| `POE_SESSION_ID` | — | Your `POESESSID` cookie — required for most Trade API calls (Cloudflare/auth) |
| `POE_TRADE_BASE` | `…/api/trade2` | Override the trade API base path if GGG changes it |
| `POE_TRADE_USER_AGENT` | `pob2-mcp-server/0.1 …` | Descriptive contactable User-Agent for trade requests |
| `POE_NINJA_DISABLED` | `false` | Set `"true"` to hide poe.ninja tools (ported to the PoE2 economy endpoint; on by default) |
| `POB_LEGACY_GEM_TOOLS` | `false` | Expose the legacy PoE1 skill-gem tools (⚠️ PoE1 gem model; prefer the engine-backed gem tools) |

### Setting Up the Lua Bridge

The Lua bridge uses PoB's actual calculation engine for accurate stats.

#### 1. Install LuaJIT
```bash
# macOS
brew install luajit

# Ubuntu/Debian
sudo apt-get install luajit

# Windows: download from https://luajit.org/ and add to PATH
```

#### 2. Get the PoE2 PoB fork with the api-stdio bridge
This repo's sibling `PathOfBuilding-PoE2/` already contains the ported api-stdio bridge
(`src/API/{Server,Handlers,BuildOps}.lua`, `src/utf8.lua`, and the `POB_API_STDIO` hooks in
`src/HeadlessWrapper.lua`). Point `POB_FORK_PATH` at its `src/` directory.

If you are setting this up from a clean upstream clone instead, copy those `src/API/` files and
`src/utf8.lua` over, and apply the `POB_API_STDIO` block from `src/HeadlessWrapper.lua` (which also
redirects PoB logging to stderr so stdout stays pure JSON).

#### 3. Verify
```bash
luajit -v
ls /path/to/PathOfBuilding/src/HeadlessWrapper.lua
```

#### 4. Update Claude Desktop config and restart Claude Desktop

---

## Available Tools

The server registers **91 tools** across 10 categories.

### XML-Based Tools (Always Available)

| Tool | Description |
|---|---|
| `list_builds` | List all `.xml` build files |
| `analyze_build` | Full build summary: class, stats, skills, items, tree |
| `compare_builds` | Side-by-side build comparison |
| `get_build_stats` | Extract raw stats from build XML |
| `get_build_notes` | Get build notes from XML |
| `set_build_notes` | Set build notes in XML |
| `start_watching` | Monitor builds directory for changes |
| `stop_watching` | Stop file monitoring |
| `watch_status` | Show watching status and cache info |
| `get_recent_changes` | List recently modified builds |
| `refresh_tree_data` | Clear passive tree data cache |

### Tree Analysis Tools (Always Available)

| Tool | Description |
|---|---|
| `compare_trees` | Show node differences between two builds |
| `get_nearby_nodes` | Find notables/keystones reachable from current allocation |
| `find_path_to_node` | Shortest path to a target node ID |
| `get_passive_upgrades` | Suggest passive tree upgrades |
| `suggest_masteries` | Suggest mastery choices for allocated clusters |

### Lua Bridge — Core (Require `POB_LUA_ENABLED=true`)

| Tool | Description |
|---|---|
| `lua_start` | Start the PoB calculation engine (stdio or TCP) |
| `lua_stop` | Stop the engine and free resources |
| `lua_new_build` | Create a blank build for a given class/ascendancy |
| `lua_load_build` | Load a build file into the engine |
| `lua_save_build` | Save the current in-memory build to a `.xml` file |
| `lua_reload_build` | Reload the current build from disk |
| `lua_get_build_info` | Get current build metadata (class, level, etc.) |
| `set_character_level` | Set level and recalculate all stats |
| `lua_get_stats` | Get calculated stats (`category`: `offense`/`defense`/`all`) |
| `lua_get_tree` | View passive tree: class, ascendancy, all allocated node IDs |
| `lua_set_tree` | Replace passive tree allocation (preserves class if omitted) |
| `update_tree_delta` | Add/remove individual nodes without replacing entire tree |
| `search_tree_nodes` | Search passive tree by name or stat text |
| `list_specs` | List all tree specs in the current build |
| `select_spec` | Switch active tree spec |
| `create_spec` | Create a new tree spec |
| `delete_spec` | Delete a tree spec |
| `rename_spec` | Rename a tree spec |
| `list_item_sets` | List all item sets in the current build |
| `select_item_set` | Switch active item set |
| `plan_leveling` | Generate a leveling plan for a build |

**`lua_set_tree` class IDs (PoE2)**: 1=Witch, 2=Ranger, 6=Warrior, 7=Sorceress, 8=Huntress, 9=Mercenary, 10=Monk, 11=Druid. Call `get_classes` for the live list (classes/ascendancies can change between PoE2 patches).

**Ascendancy IDs (PoE2)** — per class, e.g. Witch: 1=Infernalist, 2=Blood Mage, 3=Lich, 4=Abyssal Lich; Monk: 1=Martial Artist, 2=Invoker, 3=Acolyte of Chayula. Use `get_classes` for the full, current mapping.

**`lua_save_build` is required** before using file-based tools (`validate_build`, `analyze_build`, etc.) on an in-memory build.

### Lua Bridge — Item & Skill Management

| Tool | Description |
|---|---|
| `add_item` | Add item from PoE clipboard text to a slot |
| `add_multiple_items` | Add multiple items in one operation |
| `get_equipped_items` | List all equipped gear with name, base, and rarity |
| `toggle_flask` | Activate/deactivate flask 1–5; returns updated stats |
| `get_skill_setup` | Show all socket groups with gems, levels, and quality |
| `set_main_skill` | Set which group/gem is used for DPS calculations |
| `create_socket_group` | Create a new socket group (label, slot, enabled) |
| `add_gem` | Add a gem to a socket group (name, level, quality) |
| `set_gem_level` | Set gem level by group + gem index |
| `set_gem_quality` | Set gem quality (Default/Anomalous/Divergent/Phantasmal) |
| `remove_gem` | Remove a gem by group + gem index |
| `remove_skill` | Remove an entire socket group |
| `setup_skill_with_gems` | Create a socket group with active gem + supports in one call |

**Slot names**: `Weapon 1`, `Weapon 2`, `Helmet`, `Body Armour`, `Gloves`, `Boots`, `Amulet`, `Ring 1`, `Ring 2`, `Belt`, `Flask 1`–`Flask 5`

### Lua Bridge — Build Optimization

| Tool | Description |
|---|---|
| `analyze_defenses` | 3-layer defensive audit: avoidance / mitigation / recovery |
| `suggest_optimal_nodes` | Archetype-aware node suggestions by goal |
| `optimize_tree` | Recommend nearby nodes to allocate for a goal |
| `analyze_items` | Slot-by-slot item analysis with upgrade priorities |
| `optimize_skill_links` | Audit supports: "more" multipliers, penetration, anti-synergies |
| `create_budget_build` | Generate a starter build plan for a class/skill/budget |
| `get_build_issues` | Get prioritized list of build problems and suggestions |
| `check_boss_readiness` | Evaluate readiness for specific boss encounters |
| `suggest_watchers_eye` | Suggest Watcher's Eye mods for the build's auras |

**`suggest_optimal_nodes` goals**: `damage`, `defense`, `life`, `es`, `resist`, `speed`

**Defensive layers**:
- **Avoidance** — evasion, spell suppression, dodge, block
- **Mitigation** — armour/PDR, endurance charges
- **Recovery** — life regen (≥1%/s), leech, ES recharge

A build with all 3 layers is considered exceptional.

### Configuration & Enemy Settings

| Tool | Description |
|---|---|
| `get_config` | View bandit, pantheon, and enemy settings |
| `set_config` | Toggle charges, buffs, conditions (e.g. `usePowerCharges`, `enemyIsBoss`) |
| `set_enemy_stats` | Set enemy level, resistances, armour, evasion for DPS scenarios |
| `save_config_preset` | Save current config as a named preset |
| `load_config_preset` | Load a saved config preset |
| `list_config_presets` | List all saved config presets |

### Build Validation

| Tool | Description |
|---|---|
| `validate_build` | Check resistances, life, defensive layers, mana, immunities, accuracy, damage scaling |

Returns critical issues, warnings, and info with actionable suggestions and an overall 0–10 health score. Uses Lua bridge stats when available; falls back to XML parsing. `build_name` is optional — omitting it validates the currently loaded Lua bridge build.

### Skill Gem Analysis (PoE2, engine-backed — preferred)

| Tool | Description |
|---|---|
| `analyze_skills` | Engine-truth breakdown of each socket group: active skill + supports, flags tag-mismatched supports, empty/disabled/unknown gems |
| `suggest_supports` | Compatible supports for a group's active skill from PoB2's gem DB; ranked by tag relevance, or by **real measured DPS** with `measure_dps=true` |
| `list_gems` | Query PoB2's authoritative gem database (active/support, tags, family, requirements, max level) |
| `get_classes` | PoE2 classes + ascendancy IDs from the engine |

#### Legacy PoE1 gem tools (not registered by default)

`analyze_skill_links`, `suggest_support_gems`, `validate_gem_quality`, `compare_gem_setups`,
`find_optimal_links`, `gem_upgrade_path` use a hand-coded PoE1 gem DB / archetype templates and a
6-link + Awakened-gem model that does not match PoE2. They are **disabled by default**; set
`POB_LEGACY_GEM_TOOLS=true` to expose them. Prefer the engine-backed tools above.

### Build Export & Persistence

| Tool | Description |
|---|---|
| `export_build` | Copy a build to a new XML file with optional notes |
| `save_tree` | Write passive tree back to an existing build file |
| `snapshot_build` | Create a versioned snapshot with description and tag |
| `list_snapshots` | List all snapshots for a build |
| `restore_snapshot` | Restore from a snapshot (auto-backs up current state) |
| `export_build_summary` | Export a human-readable build summary |

Snapshots are stored in `POB_DIRECTORY/.pob-mcp/snapshots/`.

**Note**: `export_build` copies from the XML file, not from the Lua bridge. Use `lua_save_build` first if you want to export in-memory changes.

### Currency & Market Data (poe.ninja)

| Tool | Description |
|---|---|
| `get_currency_rates` | Live PoE2 currency exchange rates (Exalted Orb equivalent) |
| `find_arbitrage` | Detect profitable currency trading loops (see note) |
| `calculate_trading_profit` | Evaluate a specific trading chain |

Sourced from the **PoE2** poe.ninja economy endpoint
(`/poe2/api/economy/exchange/current/overview?league=<League>&type=Currency`), cached 5 min.
**Live-verified.** Pass the **exact**, case-sensitive PoE2 league name (e.g., `Runes of Aldur`, `Standard`).
Values are in **Exalted Orb** equivalent (PoE2's base currency), not Chaos.

> **Note:** the PoE2 currency-exchange feed exposes a single value per currency (no separate buy/sell
> spread), so `find_arbitrage` generally returns nothing — round-trips evaluate to ~0% profit.
> `get_currency_rates` and `calculate_trading_profit` are the useful tools here.

### Trade API Tools (Require `POE_TRADE_ENABLED=true`)

Ported to the **PoE2 `trade2`** endpoints (`https://www.pathofexile.com/api/trade2`). Stat IDs and
leagues are fetched from this base, so the stat mapper picks up PoE2 trade stats automatically.

> **Heads up:** the official trade API is behind Cloudflare and most endpoints require a logged-in
> session — set `POE_SESSION_ID` to your `POESESSID` cookie. It is also strictly rate-limited.
> **Verified working server-side** (search→fetch through Cloudflare with only `POE_SESSION_ID` set).
> Note POESESSID expires periodically; refresh it if you start getting 401/403s.

| Tool | Description |
|---|---|
| `search_trade_items` | Search trade with stat filters, price range, link count |
| `get_item_price` | Price statistics (min/max/median/average) for an item |
| `get_leagues` | List available leagues |
| `search_stats` | Look up Trade API stat IDs |
| `find_item_upgrades` | Identify best upgrade candidates for your build |
| `find_resistance_gear` | Find affordable gear to cap specific resistances |
| `compare_trade_items` | Compare multiple trade listings side by side |
| `search_cluster_jewels` | Search for cluster jewels by notable |
| `analyze_build_cluster_jewels` | Evaluate cluster jewel setups for a build |
| `generate_shopping_list` | Generate a prioritized shopping list from build analysis |

---

## Typical Workflows

### Analyze an existing build
```
1. lua_start
2. lua_load_build (build_name: "MyBuild.xml")
3. lua_get_stats (category: "defense")
4. validate_build
5. analyze_defenses (build_name: "MyBuild.xml")
```

### Build from scratch
```
1. lua_start
2. lua_new_build (class_name: "Witch", ascendancy: "Necromancer")
3. setup_skill_with_gems (active_gem: "Summon Skeletons", support_gems: [...])
4. lua_set_tree (nodes: [...])
5. lua_get_stats
6. lua_save_build (build_name: "MySummoner.xml")
```

### Optimize passive tree
```
1. lua_load_build (build_name: "MyBuild.xml")
2. suggest_optimal_nodes (goal: "life", points_available: 5)
3. search_tree_nodes (query: "maximum life")
4. lua_get_tree   ← copy current node list
5. lua_set_tree   ← add new nodes to the list
6. lua_get_stats  ← verify improvement
7. lua_save_build ← persist
```

### Test DPS against Shaper
```
1. lua_load_build
2. set_enemy_stats (level: 84, fire_resist: 40, cold_resist: 40, lightning_resist: 40)
3. set_config (config_name: "enemyIsBoss", value: true)
4. lua_get_stats (category: "offense")
```

---

## Troubleshooting

### XML Features

**No builds found**
- Verify `POB_DIRECTORY` is correct and contains `.xml` files
- Check file permissions

**Parse errors**
- Open the build in PoB GUI to verify it isn't corrupted
- Ensure PoB is up to date

### Lua Bridge

**`luajit command not found`**
```bash
brew install luajit          # macOS
sudo apt-get install luajit  # Ubuntu/Debian
```
Or set `POB_CMD` to the full path (e.g., `/opt/homebrew/bin/luajit`).

**`Failed to find valid ready banner`**
`POB_FORK_PATH` must point to the directory containing `HeadlessWrapper.lua`:
```bash
ls "$POB_FORK_PATH/HeadlessWrapper.lua"   # must exist
ls "$POB_FORK_PATH/Modules/"              # must exist
```

**`Timed out waiting for response`**
- Increase `POB_TIMEOUT_MS` (try `20000`)
- Test manually: `cd "$POB_FORK_PATH" && luajit HeadlessWrapper.lua`

**Stats don't match PoB GUI**
- Check bandit/pantheon/enemy settings with `get_config`
- Ensure the correct tree spec is active in the XML
- Make sure your PathOfBuilding fork is on the `api-stdio` branch and up to date

**Bridge becomes unresponsive**
```
lua_stop → wait a moment → lua_start
```
If still unresponsive, restart Claude Desktop.

**Nodes dropped after `lua_set_tree`**
Nodes must form a valid connected path from the class starting node. Disconnected nodes are silently dropped by PoB. Ensure all intermediate nodes are included.

**`lua_save_build` doesn't persist gem changes**
Gem modifications made via `add_gem`, `set_gem_level`, `set_gem_quality` are currently held in Lua memory and are not serialized back to the XML on save. This is a known limitation.

---

## Development

```bash
npm run build   # compile TypeScript
npm run dev     # watch mode
```

## Path of Building XML Structure

PoB builds are XML files with:
- `<Build>`: Character info and stats
- `<Tree>`: Passive skill tree node allocations
- `<Skills>`: Socket groups and gem links
- `<Items>`: Equipped items
- `<Notes>`: Build notes

## Contributing

Issues and pull requests are welcome!

## Contributors

<table>
	<tbody>
		<tr>
            <td align="center">
                <a href="https://github.com/zgrummons">
                    <img src="https://avatars.githubusercontent.com/u/22529961?v=4" width="100;" alt="zgrummons"/>
                    <br />
                    <sub><b>zgrummons</b></sub>
                </a>
            </td>
		</tr>
	</tbody>
</table>

## License

GPL-3.0
