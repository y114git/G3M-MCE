export const GAME_DEFINITIONS = [
  {
    id: 'deltarune',
    labelKey: 'ui.deltarune',
    fallbackLabel: 'DELTARUNE',
    tabs: [
      { id: 'deltarune_0', filesKey: '0', labelKey: 'tabs.menu_root', fallbackLabel: 'Menu / Root' },
      { id: 'deltarune_1', filesKey: '1', labelKey: 'tabs.chapter_1', fallbackLabel: 'Chapter 1' },
      { id: 'deltarune_2', filesKey: '2', labelKey: 'tabs.chapter_2', fallbackLabel: 'Chapter 2' },
      { id: 'deltarune_3', filesKey: '3', labelKey: 'tabs.chapter_3', fallbackLabel: 'Chapter 3' },
      { id: 'deltarune_4', filesKey: '4', labelKey: 'tabs.chapter_4', fallbackLabel: 'Chapter 4' }
    ]
  },
  {
    id: 'deltarunedemo',
    labelKey: 'ui.deltarunedemo',
    fallbackLabel: 'DELTARUNE Demo',
    tabs: [{ id: 'deltarunedemo', filesKey: 'demo', labelKey: 'tabs.demo', fallbackLabel: 'Demo' }]
  },
  {
    id: 'undertale',
    labelKey: 'ui.undertale',
    fallbackLabel: 'UNDERTALE',
    tabs: [{ id: 'undertale', filesKey: 'undertale', labelKey: 'tabs.undertale', fallbackLabel: 'UNDERTALE' }]
  },
  {
    id: 'undertaleyellow',
    labelKey: 'ui.undertaleyellow',
    fallbackLabel: 'UNDERTALE Yellow',
    tabs: [{ id: 'undertaleyellow', filesKey: 'undertale', labelKey: 'tabs.undertaleyellow', fallbackLabel: 'UNDERTALE Yellow' }]
  },
  {
    id: 'pizzatower',
    labelKey: 'ui.pizzatower',
    fallbackLabel: 'Pizza Tower',
    tabs: [{ id: 'pizzatower', filesKey: 'pizzatower', labelKey: 'tabs.pizzatower', fallbackLabel: 'Pizza Tower' }]
  },
  {
    id: 'sugaryspire',
    labelKey: 'ui.sugaryspire',
    fallbackLabel: 'Sugary Spire',
    tabs: [{ id: 'sugaryspire', filesKey: 'undertale', labelKey: 'tabs.sugaryspire', fallbackLabel: 'Sugary Spire' }]
  }
];

export const GAME_IDS = new Set(GAME_DEFINITIONS.map((game) => game.id));

export function getGameDefinition(gameId) {
  return GAME_DEFINITIONS.find((game) => game.id === gameId) || GAME_DEFINITIONS[0];
}

export function getVisibleGames() {
  return GAME_DEFINITIONS;
}

export function getGameTabs(gameId) {
  return getGameDefinition(gameId).tabs;
}

// getArchiveFolderName(fileKey, gameId): Maps archive file keys to folder names
// Rules: demo->demo, undertale->sugaryspire/undertale based on gameId, pizzatower->pizzatower, 
// 0->pizzatower/chapter_0 based on gameId, numeric->chapter_<n>, default->fileKey or 'chapter_0'
export function getArchiveFolderName(fileKey, gameId = 'deltarune') {
  if (fileKey === 'demo') return 'demo';
  if (fileKey === 'undertale') return gameId === 'sugaryspire' ? 'sugaryspire' : 'undertale';
  if (fileKey === 'pizzatower') return 'pizzatower';
  if (fileKey === '0') return gameId === 'pizzatower' ? 'pizzatower' : 'chapter_0';
  if (/^\d+$/.test(String(fileKey))) return `chapter_${fileKey}`;
  return String(fileKey || 'chapter_0');
}

export function mapConfigFileKeyToTabFilesKey(configFileKey, gameId = 'deltarune') {
  const gameDef = getGameDefinition(gameId);
  
  // Map using the same logic as main DELTAHUB's normalize_chapter_id
  // For deltarune, map deltarune_1 -> 1, deltarune_2 -> 2, etc.
  if (gameId === 'deltarune') {
    const match = configFileKey.match(/^deltarune_(\d+)$/);
    if (match) return match[1];
  }
  
  // Find matching tab by tab_id (not id)
  const matchingTab = gameDef.tabs.find(tab => tab.id === configFileKey);
  if (matchingTab) return matchingTab.filesKey;
  
  // Default to the config file key if no mapping found
  return configFileKey;
}

export function mapTabFilesKeyToConfigFileKey(tabFilesKey, gameId = 'deltarune') {
  const gameDef = getGameDefinition(gameId);
  
  // Reverse mapping: from filesKey back to tab_id (config file key)
  // For deltarune, map 1 -> deltarune_1, 2 -> deltarune_2, etc.
  if (gameId === 'deltarune' && /^\d+$/.test(String(tabFilesKey))) {
    return `deltarune_${tabFilesKey}`;
  }
  
  // Find matching tab by filesKey
  const matchingTab = gameDef.tabs.find(tab => tab.filesKey === tabFilesKey);
  if (matchingTab) return matchingTab.id;
  
  // Default to the tab files key if no mapping found
  return tabFilesKey;
}
