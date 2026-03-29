// registry.ts — Tool dispatch table
import { listFiles }         from './listFiles.js';
import { findFile }          from './findFile.js';
import { deleteFile }        from './deleteFile.js';
import { moveFile }          from './moveFile.js';
import { openApplication }   from './openApplication.js';
import { createFile }        from './createFile';
import { writeFile }         from './writeFile';
import { readFile }          from './readFile.js';
import { renameFile }        from './renameFile';
import { createDirectory }   from './createDirectory.js';
import { organiseByRule }    from './organiseByRule.js';
import { openSettings }      from './openSettings.js';
import { screenAutomation }  from './screenAutomation.js';
import { browserAutomation } from './browserAutomation.js';
import { TOOL_NAMES, type ToolName } from '../llm/schema.js';

type ToolArgs    = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<string>;

const handlers: Record<ToolName, ToolHandler> = {
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

/** Common shorthands the model may emit → canonical tool name. */
const ALIASES: Record<string, ToolName> = {
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
  // 'open' and 'launch' go through screenAutomation so the user sees Win+R
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
  // screen automation aliases
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

/** Resolve an alias or canonical name to the registered ToolName, or return as-is. */
export function resolveToolName(tool: string): string {
  const t = String(tool ?? '').trim();
  if (!t) return t;

  // Preserve exact canonical names first.
  if ((TOOL_NAMES as readonly string[]).includes(t)) {
    return t;
  }

  const lower = t.toLowerCase();
  const withoutFs = lower.startsWith('fs.') ? lower.slice(3) : lower;
  const canonicalByLower = (TOOL_NAMES as readonly string[]).find((name) => name.toLowerCase() === withoutFs);
  const resolved = ALIASES[t] ?? ALIASES[lower] ?? ALIASES[withoutFs] ?? canonicalByLower ?? withoutFs;
  return resolved || t;
}

/**
 * Execute a named tool with the provided args.
 * Resolves aliases (e.g. "mkdir" → "createDirectory") before dispatching.
 * Throws if the tool name is not registered.
 */
export async function executeTool(tool: string, args: ToolArgs): Promise<string> {
  const normalized = resolveToolName(tool);
  const resolved = normalized as ToolName;
  if (!TOOL_NAMES.includes(resolved)) {
    throw new Error(`Unknown tool: "${tool}". Available: ${TOOL_NAMES.join(', ')}`);
  }
  return handlers[resolved](args);
}

/** Class adapter for code paths that prefer an OO tool registry. */
export class ToolRegistry {
  async execute(tool: string, args: ToolArgs): Promise<string> {
    return executeTool(tool, args);
  }
}
