-- API/BuildOps.lua (PoE2)
-- Thin wrappers around PoB headless objects for programmatic operations.
-- Ported from the PoE1 api-stdio fork and adapted for Path of Building - PoE2.
-- Key PoE2 differences handled here:
--   * PassiveSpec:ImportFromNodeList has extra leading `className` and `weaponSets` params
--   * No bandit/pantheon config (config is treated as a generic passthrough)
--   * Flask slot count is validated against the actual item set rather than hardcoded

local M = {}

-- Constants
local MIN_PLAYER_LEVEL = 1
local MAX_PLAYER_LEVEL = 100
local MAX_ITEM_TEXT_LENGTH = 10240  -- 10KB

-- Ensure outputs are (re)built and return the main output table safely
function M.get_main_output()
  if not build or not build.calcsTab then
    return nil, "build not initialized"
  end
  if build.calcsTab.BuildOutput then
    build.calcsTab:BuildOutput()
  end
  local output = build.calcsTab and build.calcsTab.mainOutput or nil
  if not output then
    return nil, "no output available"
  end
  return output
end

-- Export a subset of useful stats from main output
-- If fields is provided, only export those keys (when present)
function M.export_stats(fields)
  local output, err = M.get_main_output()
  if not output then
    return nil, err
  end
  local wanted = fields or {
    "Life", "EnergyShield", "Mana", "Spirit", "Ward",
    "Armour", "Evasion",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "BlockChance", "SpellBlockChance",
    "LifeRegen", "ManaRegen",
    "TotalDPS", "FullDPS", "CombinedDPS",
  }
  local result = {}
  for _, k in ipairs(wanted) do
    if type(output[k]) ~= 'nil' then
      result[k] = output[k]
    end
  end
  -- include some metadata if available
  result._meta = result._meta or {}
  if build and build.targetVersion then
    result._meta.treeVersion = tostring(build.targetVersion)
  end
  if build and build.characterLevel then
    result._meta.level = tonumber(build.characterLevel)
  end
  if build and build.buildName then
    result._meta.buildName = tostring(build.buildName)
  end
  return result
end

-- Read current tree allocation and metadata
function M.get_tree()
  if not build or not build.spec then
    return nil, "build/spec not initialized"
  end
  local spec = build.spec
  local out = {
    treeVersion = spec.treeVersion,
    classId = tonumber(spec.curClassId) or 0,
    ascendClassId = tonumber(spec.curAscendClassId) or 0,
    secondaryAscendClassId = tonumber(spec.curSecondaryAscendClassId or 0) or 0,
    nodes = {},
    masteryEffects = {},
  }
  for id, _ in pairs(spec.allocNodes or {}) do
    table.insert(out.nodes, id)
  end
  for mastery, effect in pairs(spec.masterySelections or {}) do
    out.masteryEffects[mastery] = effect
  end
  table.sort(out.nodes)
  return out
end

-- Set tree allocation from parameters
-- params: { classId, ascendClassId, secondaryAscendClassId?, nodes:[int], masteryEffects?:{[id]=effect}, treeVersion? }
function M.set_tree(params)
  if not build or not build.spec then
    return nil, "build/spec not initialized"
  end
  if type(params) ~= 'table' then
    return nil, "invalid params"
  end
  local classId = tonumber(params.classId or 0) or 0
  local ascendId = tonumber(params.ascendClassId or 0) or 0
  local secondaryId = tonumber(params.secondaryAscendClassId or 0) or 0
  local nodes = {}
  if type(params.nodes) == 'table' then
    for _, v in ipairs(params.nodes) do
      table.insert(nodes, tonumber(v))
    end
  end
  local mastery = params.masteryEffects or {}
  local treeVersion = params.treeVersion
  -- PoE2 signature: (className, classId, ascendClassId, secondaryAscendClassId,
  --                  hashList, weaponSets, hashOverrides, masteryEffects, treeVersion)
  -- Pass className=nil (we provide classId directly) and empty weaponSets/hashOverrides.
  build.spec:ImportFromNodeList(nil, classId, ascendId, secondaryId, nodes, {}, {}, mastery, treeVersion)
  -- Rebuild calcs to reflect changes
  M.get_main_output()
  return true
end

-- Export full build XML
function M.export_build_xml()
  if not build or not build.SaveDB then
    return nil, 'build not initialized'
  end
  local xml = build:SaveDB('api-export')
  if not xml then return nil, 'failed to compose xml' end
  return xml
end

-- Set player level and rebuild
function M.set_level(level)
  if not build or not build.configTab then
    return nil, 'build/config not initialized'
  end
  local lvl = tonumber(level)
  if not lvl or lvl < MIN_PLAYER_LEVEL or lvl > MAX_PLAYER_LEVEL then
    return nil, string.format('invalid level (must be %d-%d)', MIN_PLAYER_LEVEL, MAX_PLAYER_LEVEL)
  end
  build.characterLevel = lvl
  build.characterLevelAutoMode = false
  if build.configTab and build.configTab.BuildModList then
    build.configTab:BuildModList()
  end
  M.get_main_output()
  return true
end

-- Basic build info
function M.get_build_info()
  if not build then return nil, 'build not initialized' end
  local className = build.buildClassName or (build.Build and build.Build.className)
  local ascendClassName = build.buildAscendName or (build.Build and build.Build.ascendClassName)
  -- Resolve class/ascendancy from the passive spec/tree when not set directly
  -- (e.g. after loadBuildFromXML, buildClassName is often empty).
  if (not className or className == '') and build.spec and build.spec.tree and build.spec.curClassId then
    local cls = build.spec.tree.classes and build.spec.tree.classes[build.spec.curClassId]
    if type(cls) == 'table' and cls.name then
      className = cls.name
      local ascId = tonumber(build.spec.curAscendClassId) or 0
      local ascendancies = cls.classes or cls.ascendancies
      if ascId > 0 and type(ascendancies) == 'table' and ascendancies[ascId] then
        ascendClassName = ascendancies[ascId].name or ascendClassName
      end
    end
  end
  local info = {
    name = build.buildName,
    level = build.characterLevel,
    className = className,
    ascendClassName = ascendClassName,
    classId = build.spec and tonumber(build.spec.curClassId) or nil,
    ascendClassId = build.spec and tonumber(build.spec.curAscendClassId) or nil,
    treeVersion = build.targetVersion or (build.spec and build.spec.treeVersion) or nil,
  }
  return info
end

-- Update tree by delta lists
function M.update_tree_delta(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  local current, err = M.get_tree()
  if not current then return nil, err end
  local set = {}
  for _, id in ipairs(current.nodes) do set[id] = true end
  if params and type(params.removeNodes) == 'table' then
    for _, id in ipairs(params.removeNodes) do set[tonumber(id)] = nil end
  end
  if params and type(params.addNodes) == 'table' then
    for _, id in ipairs(params.addNodes) do set[tonumber(id)] = true end
  end
  local nodes = {}
  for id,_ in pairs(set) do table.insert(nodes, id) end
  table.sort(nodes)
  local mastery = current.masteryEffects or {}
  local classId = params.classId or current.classId or 0
  local ascendId = params.ascendClassId or current.ascendClassId or 0
  local secId = params.secondaryAscendClassId or current.secondaryAscendClassId or 0
  local tv = params.treeVersion or current.treeVersion
  build.spec:ImportFromNodeList(nil, tonumber(classId) or 0, tonumber(ascendId) or 0, tonumber(secId) or 0, nodes, {}, {}, mastery, tv)
  M.get_main_output()
  return true
end


-- Calculate what-if scenario without persisting changes
-- params: { addNodes?: number[], removeNodes?: number[], useFullDPS?: boolean }
function M.calc_with(params)
  if not build or not build.calcsTab then return nil, 'build not initialized' end
  local calcFunc, baseOut = build.calcsTab:GetMiscCalculator()
  local override = {}
  if params and type(params.addNodes) == 'table' then
    override.addNodes = {}
    for _, id in ipairs(params.addNodes) do
      local n = build.spec and build.spec.nodes and build.spec.nodes[tonumber(id)]
      if n then override.addNodes[n] = true end
    end
  end
  if params and type(params.removeNodes) == 'table' then
    override.removeNodes = {}
    for _, id in ipairs(params.removeNodes) do
      local n = build.spec and build.spec.nodes and build.spec.nodes[tonumber(id)]
      if n then override.removeNodes[n] = true end
    end
  end
  local out = calcFunc(override, params and params.useFullDPS)
  return out, baseOut
end


-- Get basic config values.
-- PoE2 has no bandit/pantheon; expose the raw config input map plus enemy level.
function M.get_config()
  if not build or not build.configTab then return nil, 'build/config not initialized' end
  local cfg = {
    enemyLevel = build.configTab.enemyLevel,
    input = {},
  }
  if type(build.configTab.input) == 'table' then
    for k, v in pairs(build.configTab.input) do
      local t = type(v)
      if t == 'string' or t == 'number' or t == 'boolean' then
        cfg.input[k] = v
      end
    end
  end
  return cfg
end

-- Set selected config values and rebuild.
-- params: { enemyLevel?: number, <any configTab.input key>: string|number|boolean }
function M.set_config(params)
  if not build or not build.configTab then return nil, 'build/config not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local input = build.configTab.input or {}
  build.configTab.input = input
  local changed = false
  for k, v in pairs(params) do
    if k == 'enemyLevel' then
      build.configTab.enemyLevel = tonumber(v) or build.configTab.enemyLevel
      changed = true
    else
      local t = type(v)
      if t == 'string' or t == 'number' or t == 'boolean' then
        input[k] = v
        changed = true
      end
    end
  end
  if changed and build.configTab.BuildModList then build.configTab:BuildModList() end
  M.get_main_output()
  return true
end


-- Skills API
function M.get_skills()
  if not build or not build.skillsTab or not build.calcsTab then return nil, 'skills not initialized' end
  local groups = {}
  for idx, g in ipairs(build.skillsTab.socketGroupList or {}) do
    local names = {}
    if g.displaySkillList then
      for _, eff in ipairs(g.displaySkillList) do
        if eff and eff.activeEffect and eff.activeEffect.grantedEffect then
          table.insert(names, eff.activeEffect.grantedEffect.name)
        end
      end
    end
    -- Engine-truth per-gem breakdown (active vs support). PoB2 marks supports via
    -- gemData.grantedEffect.support; tags come from the gem data.
    local gems = {}
    local activeCount, supportCount = 0, 0
    for gidx, gem in ipairs(g.gemList or {}) do
      local gd = gem.gemData
      local ge = gd and gd.grantedEffect
      local isSupport = (ge and ge.support == true) or false
      local resolvedName = (ge and ge.name) or gem.nameSpec or 'Unknown'
      if isSupport then supportCount = supportCount + 1 else activeCount = activeCount + 1 end
      -- Authoritative boolean tag keys (tagString omits the primary delivery
      -- tag like attack/spell, so callers need these for gating checks).
      local tagKeys = {}
      if gd and type(gd.tags) == 'table' then
        for k, v in pairs(gd.tags) do if v == true then table.insert(tagKeys, k) end end
      end
      table.insert(gems, {
        index = gidx,
        name = resolvedName,
        nameSpec = gem.nameSpec,
        level = gem.level,
        quality = gem.quality or 0,
        enabled = gem.enabled ~= false,
        isSupport = isSupport,
        gemType = gd and gd.gemType,
        tags = gd and gd.tagString,
        tagKeys = tagKeys,
        known = gd ~= nil,
      })
    end
    table.insert(groups, {
      index = idx,
      label = g.label,
      slot = g.slot,
      enabled = g.enabled,
      includeInFullDPS = g.includeInFullDPS,
      mainActiveSkill = g.mainActiveSkill,
      skills = names,
      gems = gems,
      activeCount = activeCount,
      supportCount = supportCount,
    })
  end
  local result = {
    mainSocketGroup = build.mainSocketGroup,
    calcsSkillNumber = build.calcsTab.input and build.calcsTab.input.skill_number or nil,
    groups = groups,
  }
  return result
end

function M.set_main_selection(params)
  if not build or not build.skillsTab or not build.calcsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if params.mainSocketGroup ~= nil then
    build.mainSocketGroup = tonumber(params.mainSocketGroup) or build.mainSocketGroup
  end
  local g = build.skillsTab.socketGroupList[build.mainSocketGroup]
  if not g then return nil, 'invalid mainSocketGroup' end
  if params.mainActiveSkill ~= nil then
    g.mainActiveSkill = tonumber(params.mainActiveSkill) or g.mainActiveSkill
  end
  if params.skillPart ~= nil then
    local idx = g.mainActiveSkill or 1
    local src = g.displaySkillList and g.displaySkillList[idx] and g.displaySkillList[idx].activeEffect and g.displaySkillList[idx].activeEffect.srcInstance
    if src then src.skillPart = tonumber(params.skillPart) end
  end
  -- Keep calcsTab in sync: use active group index
  build.calcsTab.input.skill_number = build.mainSocketGroup
  M.get_main_output()
  return true
end

-- Items API
function M.add_item_text(params)
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  if type(params) ~= 'table' or type(params.text) ~= 'string' then return nil, 'missing text' end

  -- Validate input to prevent potential issues
  if #params.text == 0 then return nil, 'item text cannot be empty' end
  if #params.text > MAX_ITEM_TEXT_LENGTH then
    return nil, string.format('item text too long (max %d bytes)', MAX_ITEM_TEXT_LENGTH)
  end

  -- Use pcall to safely handle item creation
  local ok, item = pcall(new, 'Item', params.text)
  if not ok then return nil, 'invalid item text: ' .. tostring(item) end
  if not item or not item.baseName then return nil, 'failed to parse item' end

  item:NormaliseQuality()
  build.itemsTab:AddItem(item, params.noAutoEquip == true)
  if params.slotName then
    local slot = tostring(params.slotName)
    if build.itemsTab.slots[slot] then
      build.itemsTab.slots[slot]:SetSelItemId(item.id)
      build.itemsTab:PopulateSlots()
    end
  end
  build.itemsTab:AddUndoState()
  build.buildFlag = true
  M.get_main_output()
  return { id = item.id, name = item.name, slot = params.slotName or item:GetPrimarySlot() }
end

function M.set_flask_active(params)
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  local idx = tonumber(params.index)
  local active = params.active == true
  if not idx or idx < 1 then
    return nil, 'invalid flask index'
  end
  local slotName = 'Flask ' .. tostring(idx)
  -- Validate the slot actually exists in this build's item set (PoE2 flask counts differ)
  if not build.itemsTab.slots or not build.itemsTab.slots[slotName] then
    return nil, 'flask slot not found: ' .. slotName
  end
  if not build.itemsTab.activeItemSet or not build.itemsTab.activeItemSet[slotName] then return nil, 'slot not found in active item set' end
  build.itemsTab.activeItemSet[slotName].active = active
  build.itemsTab:AddUndoState()
  build.buildFlag = true
  M.get_main_output()
  return true
end


-- Get equipped items summary
function M.get_items()
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  local itemsTab = build.itemsTab
  local result = { }
  -- Prefer orderedSlots for deterministic order
  local ordered = itemsTab.orderedSlots or {}
  local seen = {}
  local function add_slot(slotName)
    if seen[slotName] then return end
    seen[slotName] = true
    local slotCtrl = itemsTab.slots[slotName]
    if not slotCtrl then return end
    local selId = slotCtrl.selItemId or 0
    local entry = { slot = slotName, id = selId }
    if selId > 0 then
      local it = itemsTab.items[selId]
      if it then
        entry.name = it.name
        entry.baseName = it.baseName
        entry.type = it.type
        entry.rarity = it.rarity
        entry.raw = it.raw
      end
    end
    -- Flask/Tincture activation flag stored in activeItemSet
    local set = itemsTab.activeItemSet
    if set and set[slotName] and set[slotName].active ~= nil then
      entry.active = set[slotName].active and true or false
    end
    table.insert(result, entry)
  end
  for _, slot in ipairs(ordered) do
    if slot and slot.slotName then add_slot(slot.slotName) end
  end
  -- Add any remaining slots not in ordered list
  for slotName, _ in pairs(itemsTab.slots or {}) do add_slot(slotName) end
  return result
end


-- Skill/Gem Creation and Modification API

-- Create a new socket group
-- params: { label?: string, slot?: string, enabled?: boolean, includeInFullDPS?: boolean }
function M.create_socket_group(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then params = {} end

  local socketGroup = {
    label = params.label or '',
    slot = params.slot,
    enabled = params.enabled ~= false,
    includeInFullDPS = params.includeInFullDPS == true,
    gemList = {},
    mainActiveSkill = 1,
    mainActiveSkillCalcs = 1,
  }

  -- Get the active skill set
  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  -- Add to socket group list
  table.insert(skillSet.socketGroupList, socketGroup)
  local index = #skillSet.socketGroupList

  -- Process the socket group
  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return { index = index, label = socketGroup.label }
end

-- Add a gem to a socket group
-- params: { groupIndex: number, gemName: string, level?: number, quality?: number, qualityId?: string, enabled?: boolean }
function M.add_gem(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemName then return nil, 'missing groupIndex or gemName' end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found at index ' .. tostring(groupIndex) end

  -- Create gem instance
  local gemInstance = {
    nameSpec = tostring(params.gemName),
    level = tonumber(params.level) or 20,
    quality = tonumber(params.quality) or 0,
    qualityId = params.qualityId or 'Default',
    enabled = params.enabled ~= false,
    enableGlobal1 = true,
    enableGlobal2 = false,
    count = tonumber(params.count) or 1,
  }

  -- Try to find gem data
  if build.data and build.data.gems then
    for _, gemData in pairs(build.data.gems) do
      if gemData.name == gemInstance.nameSpec or gemData.nameSpec == gemInstance.nameSpec then
        gemInstance.gemId = gemData.id
        if gemData.grantedEffect then
          gemInstance.skillId = gemData.grantedEffect.id
        elseif gemData.grantedEffectId then
          gemInstance.skillId = gemData.grantedEffectId
        end
        gemInstance.gemData = gemData
        break
      end
    end
  end

  table.insert(socketGroup.gemList, gemInstance)
  local gemIndex = #socketGroup.gemList

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return { gemIndex = gemIndex, name = gemInstance.nameSpec }
end

-- Set gem level
-- params: { groupIndex: number, gemIndex: number, level: number }
function M.set_gem_level(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex or not params.level then
    return nil, 'missing groupIndex, gemIndex, or level'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)
  local level = tonumber(params.level)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  if level < 1 or level > 40 then return nil, 'invalid level (must be 1-40)' end

  gemInstance.level = level

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- Set gem quality
-- params: { groupIndex: number, gemIndex: number, quality: number, qualityId?: string }
function M.set_gem_quality(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex or not params.quality then
    return nil, 'missing groupIndex, gemIndex, or quality'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)
  local quality = tonumber(params.quality)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  if quality < 0 or quality > 23 then return nil, 'invalid quality (must be 0-23)' end

  gemInstance.quality = quality
  if params.qualityId then
    gemInstance.qualityId = tostring(params.qualityId)
  end

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- Remove a socket group
-- params: { groupIndex: number }
function M.remove_skill(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex then return nil, 'missing groupIndex' end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  -- Don't allow removing special groups with sources
  if socketGroup.source then
    return nil, 'cannot remove special socket groups (item/node granted skills)'
  end

  table.remove(skillSet.socketGroupList, groupIndex)

  build.buildFlag = true
  M.get_main_output()

  return true
end

-- Remove a gem from a socket group
-- params: { groupIndex: number, gemIndex: number }
function M.remove_gem(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex then
    return nil, 'missing groupIndex or gemIndex'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local gemIndex = tonumber(params.gemIndex)

  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[gemIndex]
  if not gemInstance then return nil, 'gem not found' end

  table.remove(socketGroup.gemList, gemIndex)

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end


-- Search for passive tree nodes by keyword
-- params: { keyword: string, nodeType?: string ('normal'|'notable'|'keystone'), maxResults?: number, includeAllocated?: boolean }
function M.search_nodes(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  if type(params) ~= 'table' or type(params.keyword) ~= 'string' then
    return nil, 'missing or invalid keyword'
  end

  local keyword = params.keyword:lower()
  local nodeType = params.nodeType and params.nodeType:lower() or nil
  local maxResults = tonumber(params.maxResults) or 50
  local includeAllocated = params.includeAllocated ~= false

  local results = {}
  local count = 0

  -- Get allocated nodes set for quick lookup
  local allocatedSet = {}
  if build.spec.allocNodes then
    for id, _ in pairs(build.spec.allocNodes) do
      allocatedSet[id] = true
    end
  end

  -- Search through all nodes
  for id, node in pairs(build.spec.nodes) do
    if count >= maxResults then break end

    -- Skip if already allocated and we don't want allocated nodes
    if not includeAllocated and allocatedSet[id] then
      goto continue
    end

    -- Filter by node type if specified
    if nodeType then
      local nType = 'normal'
      if node.isKeystone then nType = 'keystone'
      elseif node.isNotable then nType = 'notable'
      elseif node.isJewelSocket then nType = 'jewel'
      elseif node.isMultipleChoiceOption then nType = 'mastery'
      elseif node.ascendancyName then nType = 'ascendancy'
      end
      if nType ~= nodeType then goto continue end
    end

    -- Check if keyword matches name
    local matches = false
    if node.name and node.name:lower():find(keyword, 1, true) then
      matches = true
    end

    -- Check if keyword matches stats/modifiers
    if not matches and node.sd then
      for _, stat in ipairs(node.sd) do
        if type(stat) == 'string' and stat:lower():find(keyword, 1, true) then
          matches = true
          break
        end
      end
    end

    -- Check modifiers list
    if not matches and node.modList then
      for _, mod in ipairs(node.modList) do
        local modStr = tostring(mod)
        if modStr:lower():find(keyword, 1, true) then
          matches = true
          break
        end
      end
    end

    if matches then
      local rNodeType = 'normal'
      if node.isKeystone then rNodeType = 'keystone'
      elseif node.isNotable then rNodeType = 'notable'
      elseif node.isJewelSocket then rNodeType = 'jewel'
      elseif node.isMultipleChoiceOption then rNodeType = 'mastery'
      elseif node.ascendancyName then rNodeType = 'ascendancy'
      end

      local stats = {}
      if node.sd then
        for _, stat in ipairs(node.sd) do
          if type(stat) == 'string' then
            table.insert(stats, stat)
          end
        end
      end

      table.insert(results, {
        id = id,
        name = node.name or 'Unnamed',
        type = rNodeType,
        stats = stats,
        allocated = allocatedSet[id] == true,
        x = node.x,
        y = node.y,
        orbit = node.orbit,
        orbitIndex = node.orbitIndex,
        ascendancyName = node.ascendancyName,
      })
      count = count + 1
    end

    ::continue::
  end

  -- Sort results: keystones first, then notables, then normal
  table.sort(results, function(a, b)
    local typeOrder = { keystone = 1, notable = 2, jewel = 3, mastery = 4, ascendancy = 5, normal = 6 }
    local aOrder = typeOrder[a.type] or 99
    local bOrder = typeOrder[b.type] or 99
    if aOrder ~= bOrder then
      return aOrder < bOrder
    end
    return (a.name or '') < (b.name or '')
  end)

  return { nodes = results, count = #results }
end


-- List gems from PoB2's authoritative gem database.
-- params: { type?: 'active'|'support', search?: string, tag?: string, maxResults?: number, dedupeByName?: boolean }
function M.list_gems(params)
  if type(params) ~= 'table' then params = {} end
  local data = (build and build.data) or _G.data
  if not data or not data.gems then return nil, 'gem data not available' end

  local typeFilter = params.type and tostring(params.type):lower() or nil
  local search = params.search and tostring(params.search):lower() or nil
  local tag = params.tag and tostring(params.tag):lower() or nil
  local maxResults = tonumber(params.maxResults) or 400
  local dedupe = params.dedupeByName == true

  local out = {}
  local seenNames = {}
  for _, g in pairs(data.gems) do
    if type(g) == 'table' and g.name then
      local isSupport = (g.gemType == 'Support') or (g.tags and g.tags.support == true)
      local kind = isSupport and 'support' or 'active'
      local include = true
      if typeFilter and kind ~= typeFilter then include = false end
      if include and search and not g.name:lower():find(search, 1, true) then include = false end
      if include and tag then
        local hasTag = false
        if g.tagString and g.tagString:lower():find(tag, 1, true) then hasTag = true end
        if not hasTag and g.tags and g.tags[tag] == true then hasTag = true end
        if not hasTag then include = false end
      end
      if include and dedupe and seenNames[g.name] then include = false end
      if include then
        seenNames[g.name] = true
        local tagKeys = {}
        if type(g.tags) == 'table' then
          for k, v in pairs(g.tags) do if v == true then table.insert(tagKeys, k) end end
        end
        table.insert(out, {
          name = g.name,
          kind = kind,
          gemType = g.gemType,
          gemFamily = g.gemFamily,
          tags = g.tagString,
          tagKeys = tagKeys,
          maxLevel = g.naturalMaxLevel,
          tier = g.Tier,
          reqStr = g.reqStr,
          reqDex = g.reqDex,
          reqInt = g.reqInt,
        })
      end
    end
  end

  table.sort(out, function(a, b)
    if a.kind ~= b.kind then return a.kind < b.kind end
    return (a.name or '') < (b.name or '')
  end)

  local total = #out
  if total > maxResults then
    local trimmed = {}
    for i = 1, maxResults do trimmed[i] = out[i] end
    out = trimmed
  end

  return { gems = out, count = #out, total = total }
end


-- List PoE2 classes and their ascendancies with engine IDs (for set_tree/new builds).
function M.get_classes()
  if not build or not build.spec or not build.spec.tree then
    return nil, 'tree not initialized'
  end
  local tree = build.spec.tree
  local out = {}
  for classId, class in pairs(tree.classes or {}) do
    if type(class) == 'table' and class.name then
      local ascendancies = {}
      for ascId, asc in pairs(class.classes or class.ascendancies or {}) do
        if ascId ~= 0 and type(asc) == 'table' and asc.name and asc.name ~= 'None' then
          table.insert(ascendancies, { id = ascId, name = asc.name })
        end
      end
      table.sort(ascendancies, function(a, b) return a.id < b.id end)
      table.insert(out, { classId = classId, name = class.name, ascendancies = ascendancies })
    end
  end
  table.sort(out, function(a, b) return a.classId < b.classId end)
  return { classes = out }
end


-- Persistence

-- Save the current build to a file on disk (full PathOfBuilding2 DB XML).
-- params: { path: string }
function M.save_build(params)
  if not build then return nil, 'build not initialized' end
  if type(params) ~= 'table' or type(params.path) ~= 'string' or params.path == '' then
    return nil, 'missing path'
  end
  if type(build.SaveDB) ~= 'function' then return nil, 'save not supported by this build' end
  -- SaveDB composes the complete DB (Build + all savers: Tree/Skills/Items/Config/...)
  local xmlText = build:SaveDB(params.path)
  if not xmlText then return nil, 'failed to compose build XML' end
  local file, ferr = io.open(params.path, 'w+')
  if not file then
    return nil, 'cannot open file for writing: ' .. tostring(ferr)
  end
  file:write(xmlText)
  file:close()
  -- Mirror the UI: a successful save clears the modified flags.
  if type(build.ResetModFlags) == 'function' then build:ResetModFlags() end
  return { path = params.path, bytes = #xmlText }
end


-- Skill/socket-group enablement

-- Enable or disable an entire socket group.
-- params: { groupIndex: number, enabled: boolean }
function M.set_socket_group_enabled(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex then return nil, 'missing groupIndex' end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local groupIndex = tonumber(params.groupIndex)
  local socketGroup = skillSet.socketGroupList[groupIndex]
  if not socketGroup then return nil, 'socket group not found at index ' .. tostring(groupIndex) end

  socketGroup.enabled = params.enabled and true or false

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return { groupIndex = groupIndex, label = socketGroup.label or '', enabled = socketGroup.enabled }
end

-- Enable or disable a single gem within a socket group.
-- params: { groupIndex: number, gemIndex: number, enabled: boolean }
function M.set_gem_enabled(params)
  if not build or not build.skillsTab then return nil, 'skills not initialized' end
  if type(params) ~= 'table' then return nil, 'invalid params' end
  if not params.groupIndex or not params.gemIndex then
    return nil, 'missing groupIndex or gemIndex'
  end

  local skillSetId = build.skillsTab.activeSkillSetId or 1
  local skillSet = build.skillsTab.skillSets[skillSetId]
  if not skillSet then return nil, 'active skill set not found' end

  local socketGroup = skillSet.socketGroupList[tonumber(params.groupIndex)]
  if not socketGroup then return nil, 'socket group not found' end

  local gemInstance = socketGroup.gemList[tonumber(params.gemIndex)]
  if not gemInstance then return nil, 'gem not found' end

  gemInstance.enabled = params.enabled and true or false

  if build.skillsTab.ProcessSocketGroup then
    build.skillsTab:ProcessSocketGroup(socketGroup)
  end

  build.buildFlag = true
  M.get_main_output()

  return true
end


-- Masteries

-- Enumerate mastery nodes with their selectable effect options and current selection.
function M.get_mastery_options(params)
  if not build or not build.spec then return nil, 'build/spec not initialized' end
  local spec = build.spec
  local tree = spec.tree
  if not tree then return nil, 'tree not loaded' end

  local masteries = {}
  for id, node in pairs(spec.nodes) do
    if node.type == 'Mastery' and node.masteryEffects and #node.masteryEffects > 0 then
      local effects = {}
      for _, eff in ipairs(node.masteryEffects) do
        local effId = eff.effect
        local stats = eff.stats
        if (not stats) and tree.masteryEffects and tree.masteryEffects[effId] then
          stats = tree.masteryEffects[effId].stats or tree.masteryEffects[effId].sd
        end
        table.insert(effects, {
          effectId = effId,
          stats = (type(stats) == 'table') and table.concat(stats, ' / ') or nil,
        })
      end
      table.insert(masteries, {
        nodeId = id,
        name = node.dn,
        allocated = node.alloc and true or false,
        selectedEffect = spec.masterySelections and spec.masterySelections[id] or nil,
        effects = effects,
      })
    end
  end
  table.sort(masteries, function(a, b) return tostring(a.name or '') < tostring(b.name or '') end)
  return { masteries = masteries }
end


-- Passive tree specs (loadouts)

-- List all passive tree specs.
function M.list_specs()
  if not build or not build.treeTab then return nil, 'tree tab not initialized' end
  local treeTab = build.treeTab
  local specs = {}
  for i, spec in ipairs(treeTab.specList or {}) do
    local used
    if type(spec.CountAllocNodes) == 'function' then
      local ok2, n = pcall(function() return (spec:CountAllocNodes()) end)
      if ok2 then used = n end
    end
    table.insert(specs, {
      index = i,
      title = spec.title or 'Default',
      treeVersion = spec.treeVersion,
      classId = tonumber(spec.curClassId) or 0,
      className = spec.curClassName,
      ascendClassName = spec.curAscendClassName,
      pointsUsed = used,
      active = (i == treeTab.activeSpec),
    })
  end
  return { specs = specs, activeSpec = treeTab.activeSpec }
end

-- Create a new passive tree spec, optionally copying an existing one.
-- params: { title?: string, copyFrom?: number, activate?: boolean }
function M.create_spec(params)
  if not build or not build.treeTab then return nil, 'tree tab not initialized' end
  if type(params) ~= 'table' then params = {} end
  local treeTab = build.treeTab
  local newSpec

  if params.copyFrom then
    local src = treeTab.specList[tonumber(params.copyFrom)]
    if not src then return nil, 'copyFrom spec not found at index ' .. tostring(params.copyFrom) end
    newSpec = new('PassiveSpec', build, src.treeVersion)
    newSpec.title = (params.title and tostring(params.title)) or ((src.title or 'Default') .. ' (Copy)')
    newSpec.jewels = copyTable(src.jewels)
    newSpec:RestoreUndoState(src:CreateUndoState())
    newSpec:BuildClusterJewelGraphs()
  else
    local ver = rawget(_G, 'latestTreeVersion') or (build.spec and build.spec.treeVersion)
    newSpec = new('PassiveSpec', build, ver)
    newSpec.title = (params.title and tostring(params.title)) or 'New Tree'
    if build.spec then
      newSpec:SelectClass(build.spec.curClassId)
      newSpec:SelectAscendClass(build.spec.curAscendClassId)
      if type(newSpec.SelectSecondaryAscendClass) == 'function' then
        newSpec:SelectSecondaryAscendClass(build.spec.curSecondaryAscendClassId or 0)
      end
    end
  end

  table.insert(treeTab.specList, newSpec)
  local index = #treeTab.specList
  local activated = params.activate == true
  if activated then
    treeTab:SetActiveSpec(index)
  end
  build.buildFlag = true
  return { index = index, title = newSpec.title, activated = activated }
end

-- Activate an existing passive tree spec.
-- params: { index: number }
function M.select_spec(params)
  if not build or not build.treeTab then return nil, 'tree tab not initialized' end
  local index = tonumber(params and params.index)
  if not index then return nil, 'missing index' end
  local treeTab = build.treeTab
  if not treeTab.specList[index] then return nil, 'spec not found at index ' .. tostring(index) end
  treeTab:SetActiveSpec(index)
  build.buildFlag = true
  M.get_main_output()
  return { activeSpec = treeTab.activeSpec, title = build.spec.title or 'Default' }
end

-- Delete a passive tree spec (cannot delete the last remaining one).
-- params: { index: number }
function M.delete_spec(params)
  if not build or not build.treeTab then return nil, 'tree tab not initialized' end
  local index = tonumber(params and params.index)
  if not index then return nil, 'missing index' end
  local treeTab = build.treeTab
  if not treeTab.specList[index] then return nil, 'spec not found at index ' .. tostring(index) end
  if #treeTab.specList <= 1 then return nil, 'cannot delete the last spec' end

  table.remove(treeTab.specList, index)

  if index == treeTab.activeSpec then
    treeTab:SetActiveSpec(math.max(1, index - 1))
  else
    -- build.spec object is unchanged; find its new index in the list
    for i, spec in ipairs(treeTab.specList) do
      if spec == build.spec then treeTab.activeSpec = i break end
    end
  end
  build.buildFlag = true
  return { deleted = index, activeSpec = treeTab.activeSpec, remaining = #treeTab.specList }
end

-- Rename a passive tree spec.
-- params: { index: number, title: string }
function M.rename_spec(params)
  if not build or not build.treeTab then return nil, 'tree tab not initialized' end
  local index = tonumber(params and params.index)
  local title = params and params.title and tostring(params.title)
  if not index then return nil, 'missing index' end
  if not title or title == '' then return nil, 'missing title' end
  local spec = build.treeTab.specList[index]
  if not spec then return nil, 'spec not found at index ' .. tostring(index) end
  spec.title = title
  return { index = index, title = title }
end


-- Item sets

-- List all item sets.
function M.list_item_sets()
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  local itemsTab = build.itemsTab
  local sets = {}
  for _, id in ipairs(itemsTab.itemSetOrderList or {}) do
    local set = itemsTab.itemSets[id]
    if set then
      table.insert(sets, {
        id = id,
        title = set.title or 'Default',
        active = (id == itemsTab.activeItemSetId),
      })
    end
  end
  return { itemSets = sets, activeItemSet = itemsTab.activeItemSetId }
end

-- Activate an existing item set by id.
-- params: { id: number }
function M.select_item_set(params)
  if not build or not build.itemsTab then return nil, 'items not initialized' end
  local id = tonumber(params and params.id)
  if not id then return nil, 'missing id' end
  local itemsTab = build.itemsTab
  if not itemsTab.itemSets[id] then return nil, 'item set not found: ' .. tostring(id) end
  itemsTab:SetActiveItemSet(id)
  build.buildFlag = true
  M.get_main_output()
  return { activeItemSet = itemsTab.activeItemSetId, title = itemsTab.activeItemSet.title or 'Default' }
end

return M
