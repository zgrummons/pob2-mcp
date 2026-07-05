-- pob-api/bootstrap.lua
--
-- External entry point for the pob2-mcp stdio bridge. This replaces the need to
-- patch Path of Building's own HeadlessWrapper.lua: it runs against an UNMODIFIED
-- ("vanilla") PathOfBuilding-PoE2 checkout.
--
-- Contract with the launcher (see pobLuaBridge.ts):
--   * argv[0] is the absolute path to THIS file (so we can locate our vendored
--     API/*.lua and utf8.lua via debug.getinfo).
--   * The working directory is the vanilla PoB `src/` directory, so that the
--     vanilla HeadlessWrapper.lua's `dofile("Launch.lua")` and PoB's runtime
--     library paths resolve exactly as they do for a normal headless run.
--
-- Flow: set up module paths -> route PoB logging to stderr -> provide a utf8
-- fallback -> dofile the vanilla HeadlessWrapper (which boots PoB and leaves
-- `build`/`newBuild`/`loadBuildFromXML` as globals) -> start the stdio server.

-- 1. Locate our own directory (the vendored pob-api dir) from the chunk source.
local function get_script_dir()
  local info = debug and debug.getinfo and debug.getinfo(1, 'S')
  local src = info and info.source or ''
  if type(src) == 'string' and src:sub(1, 1) == '@' then
    local p = src:sub(2)
    return (p:gsub('[^/\\]+$', '')):gsub('[ /\\]$', '')
  end
  return '.'
end
local SCRIPT_DIR = get_script_dir()
_G.POB_SCRIPT_DIR = SCRIPT_DIR

-- 2. Make our API/*.lua and utf8.lua resolvable via require()/dofile().
--    (Server.lua does `require('API.Handlers')`, which does `require('API.BuildOps')`.)
package.path = SCRIPT_DIR .. '/?.lua;' .. SCRIPT_DIR .. '/?/init.lua;' .. package.path

-- 3. stdout is reserved for the JSON-RPC protocol. Vanilla PoB is chatty during
--    init (Launch/OnInit) via print() and ConPrintf() -- and vanilla's ConPrintf
--    is implemented in terms of the global print() -- so overriding print() here,
--    BEFORE we load the wrapper, routes all of PoB's logging to stderr.
do
  local _stderr = io.stderr
  print = function(...)
    local n = select('#', ...)
    local parts = {}
    for i = 1, n do parts[i] = tostring((select(i, ...))) end
    _stderr:write(table.concat(parts, '\t') .. '\n')
  end
end

-- 4. Provide a utf8 fallback before PoB initializes. A vanilla runtime usually
--    ships lua-utf8 (resolved via require), but headless builds may lack the
--    native lib; fall back to our minimal pure-Lua stub.
if type(_G.utf8) ~= 'table' then
  local ok_u, mod = pcall(require, 'utf8')
  if ok_u and type(mod) == 'table' then
    _G.utf8 = mod
  else
    local ok2, stub = pcall(dofile, SCRIPT_DIR .. '/utf8.lua')
    if ok2 and type(stub) == 'table' then _G.utf8 = stub end
  end
end

-- 5. Boot the vanilla headless environment. HeadlessWrapper.lua defines all the
--    headless stubs, runs Launch/OnInit/OnFrame, and on success leaves `build`,
--    `newBuild`, and `loadBuildFromXML` as globals before returning. It only
--    blocks (io.read) on an init error (mainObject.promptMsg), which the
--    launcher surfaces as a ready-banner timeout.
dofile('HeadlessWrapper.lua')

-- 6. Safety net: ensure the globals the API relies on exist even if a future
--    wrapper stops setting them directly.
if not _G.build and mainObject and mainObject.main and mainObject.main.modes then
  _G.build = mainObject.main.modes['BUILD']
end
if not _G.newBuild then
  function _G.newBuild()
    if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
    mainObject.main:SetMode('BUILD', false, 'Headless build')
    runCallback('OnFrame')
  end
end
if not _G.loadBuildFromXML then
  function _G.loadBuildFromXML(xmlText, name)
    mainObject.main:SetMode('BUILD', false, name or '', xmlText)
    runCallback('OnFrame')
  end
end

-- 7. Hand off to the JSON-RPC loop. Server.lua writes the ready banner and then
--    reads/dispatches actions from stdin until it receives `quit` or EOF.
dofile(SCRIPT_DIR .. '/API/Server.lua')
