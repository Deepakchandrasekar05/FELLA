// registry.ts — Tool dispatch table
import { listFiles }         from './listFiles.js';
import { deleteFile }        from './deleteFile.js';
import { moveFile }          from './moveFile.js';
import { createDirectory }   from './createDirectory.js';
import { organiseByRule }    from './organiseByRule.js';
import { screenAutomation }  from './screenAutomation.js';
import { TOOL_NAMES, type ToolName } from '../llm/schema.js';

type ToolArgs    = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<string>;

const handlers: Record<ToolName, ToolHandler> = {
  listFiles,
  deleteFile,
  moveFile,
  // openApplication delegates to screenAutomation so launches are always visible
  openApplication: (args) => screenAutomation({ action: 'launch', ...args }),
  createDirectory,
  organiseByRule,
  screenAutomation,
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
  delete:         'deleteFile',
  delete_file:    'deleteFile',
  remove:         'deleteFile',
  rm:             'deleteFile',
  move:           'moveFile',
  move_file:      'moveFile',
  rename:         'moveFile',
  // 'open' and 'launch' go through screenAutomation so the user sees Win+R
  open:           'screenAutomation',
  launch:         'screenAutomation',
  open_app:       'screenAutomation',
  launch_app:     'screenAutomation',
  organise:             'organiseByRule',
  organize:             'organiseByRule',
  organise_files:       'organiseByRule',
  organize_files:       'organiseByRule',
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
};

/** Resolve an alias or canonical name to the registered ToolName, or return as-is. */
export function resolveToolName(tool: string): string {
  return ALIASES[tool] ?? tool;
}

/**
 * Execute a named tool with the provided args.
 * Resolves aliases (e.g. "mkdir" → "createDirectory") before dispatching.
 * Throws if the tool name is not registered.
 */
export async function executeTool(tool: string, args: ToolArgs): Promise<string> {
  const resolved = (ALIASES[tool] ?? tool) as ToolName;
  if (!TOOL_NAMES.includes(resolved)) {
    throw new Error(`Unknown tool: "${tool}". Available: ${TOOL_NAMES.join(', ')}`);
  }
  return handlers[resolved](args);
}
