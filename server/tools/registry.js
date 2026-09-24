// server/tools/registry.js — Tool dispatch table
import { listFiles }         from './listFiles.js';
import { findFile }          from './findFile.js';
import { deleteFile }        from './deleteFile.js';
import { moveFile }          from './moveFile.js';
import { openApplication }   from './openApplication.js';
import { createFile }        from './createFile.js';
import { writeFile }         from './writeFile.js';
import { readFile }          from './readFile.js';
import { renameFile }        from './renameFile.js';
import { createDirectory }   from './createDirectory.js';
import { organiseByRule }    from './organiseByRule.js';
import { openSettings }      from './openSettings.js';
import { screenAutomation }  from './screenAutomation.js';
import { browserAutomation } from './browserAutomation.js';
import { TOOL_NAMES }        from '../llm/schema.js';

const handlers = {
  listFiles,
  findFile,
  deleteFile,
  moveFile,
  createFile,
  writeFile,
  readFile,
  renameFile,
  openApplication,
  createDirectory,
  organiseByRule,
  openSettings,
  screenAutomation,
  browserAutomation,
};

const ALIASES = {
  mkdir:          'createDirectory',
  create_dir:     'createDirectory',
  create_folder:  'createDirectory',
  make_directory: 'createDirectory',
  list:           'listFiles',
  list_files:     'listFiles',
  ls:             'listFiles',
  readdir:        'listFiles',
  'fs.readdir':   'listFiles',
  delete:         'deleteFile',
  delete_file:    'deleteFile',
  remove:         'deleteFile',
  rm:             'deleteFile',
  move:           'moveFile',
  move_file:      'moveFile',
  rename:         'moveFile',
  create_file:    'createFile',
  new_file:       'createFile',
  write_file:     'writeFile',
  append_file:    'writeFile',
  read_file:      'readFile',
  cat:            'readFile',
  rename_file:    'renameFile',
  open:           'screenAutomation',
  launch:         'screenAutomation',
  open_app:       'screenAutomation',
  launch_app:     'screenAutomation',
  organise:             'organiseByRule',
  organize:             'organiseByRule',
  organise_files:       'organiseByRule',
  organize_files:       'organiseByRule',
  settings:             'openSettings',
  open_settings:        'openSettings',
  windows_settings:     'openSettings',
  control_panel:        'openSettings',
  screen:               'screenAutomation',
  screen_automation:    'screenAutomation',
  automate_screen:      'screenAutomation',
  screenshot:           'screenAutomation',
  take_screenshot:      'screenAutomation',
  click:                'screenAutomation',
  click_on:             'screenAutomation',
  type_text:            'screenAutomation',
  press_key:            'screenAutomation',
  scroll_screen:        'screenAutomation',
  find_on_screen:       'screenAutomation',
  browser:              'browserAutomation',
  browser_automation:   'browserAutomation',
  playwright:           'browserAutomation',
  web:                  'browserAutomation',
  web_automation:       'browserAutomation',
  openbrowser:          'browserAutomation',
  openurl:              'browserAutomation',
  opengoogledrive:      'browserAutomation',
  findfileinbrowser:    'browserAutomation',
};

export function resolveToolName(tool) {
  const t = String(tool ?? '').trim();
  if (!t) return t;

  if (TOOL_NAMES.includes(t)) {
    return t;
  }

  const lower = t.toLowerCase();
  const withoutFs = lower.startsWith('fs.') ? lower.slice(3) : lower;
  const canonicalByLower = TOOL_NAMES.find((name) => name.toLowerCase() === withoutFs);
  const resolved = ALIASES[t] ?? ALIASES[lower] ?? ALIASES[withoutFs] ?? canonicalByLower ?? withoutFs;
  return resolved || t;
}

export async function executeTool(tool, args = {}) {
  const normalized = resolveToolName(tool);
  if (!TOOL_NAMES.includes(normalized)) {
    throw new Error(`Unknown tool: "${tool}". Available: ${TOOL_NAMES.join(', ')}`);
  }
  return handlers[normalized](args);
}

export class ToolRegistry {
  list() {
    return [...TOOL_NAMES];
  }

  has(tool) {
    const resolved = resolveToolName(tool);
    return TOOL_NAMES.includes(resolved);
  }

  async execute(tool, args = {}) {
    return executeTool(tool, args);
  }
}
