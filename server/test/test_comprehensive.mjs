// server/test/test_comprehensive.mjs — Comprehensive Test Suite for FELLA CLI
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

import { resolvePath, assertAllowed } from '../security/pathGuard.js';
import { ToolRegistry } from '../tools/registry.js';
import { UndoStack } from '../execution/history.js';
import { MemoryStore } from '../memory/store.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('      FELLA Comprehensive End-to-End Test Suite     ');
  console.log('====================================================\n');

  const testDir = path.join(os.homedir(), '.fella', 'comprehensive_test');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // ── 1. Security PathGuard Tests ─────────────────────────────────────────
    console.log('[1/6] Testing PathGuard Security Rules');

    let blockedWin = false;
    try {
      resolvePath('C:\\Windows\\System32\\cmd.exe');
    } catch {
      blockedWin = true;
    }
    assert(blockedWin, 'PathGuard blocks C:\\Windows');

    let blockedProg = false;
    try {
      resolvePath('C:\\Program Files\\app');
    } catch {
      blockedProg = true;
    }
    assert(blockedProg, 'PathGuard blocks C:\\Program Files');

    let blockedData = false;
    try {
      resolvePath('C:\\ProgramData\\secret');
    } catch {
      blockedData = true;
    }
    assert(blockedData, 'PathGuard blocks C:\\ProgramData');

    let blockedTraversal = false;
    try {
      resolvePath('downloads/../../../../Windows/System32');
    } catch {
      blockedTraversal = true;
    }
    assert(blockedTraversal, 'PathGuard rejects directory traversal attack');

    let blockedEmpty = false;
    try {
      resolvePath('   ');
    } catch {
      blockedEmpty = true;
    }
    assert(blockedEmpty, 'PathGuard rejects empty/whitespace paths');

    const resolvedUser = resolvePath('downloads');
    assert(resolvedUser.toLowerCase().includes('downloads'), 'Resolves downloads alias to user path');

    // ── 2. Tool Registry & Discovery ───────────────────────────────────────
    console.log('\n[2/6] Testing Tool Registry & Tool Names');
    const registry = new ToolRegistry();
    const toolNames = registry.list();
    assert(toolNames.length >= 14, `Registry loaded ${toolNames.length} tools (expected >= 14)`);

    const expectedTools = [
      'createFile',
      'writeFile',
      'readFile',
      'listFiles',
      'findFile',
      'deleteFile',
      'moveFile',
      'renameFile',
      'createDirectory',
      'organiseByRule',
      'openSettings',
      'openApplication',
      'screenAutomation',
      'browserAutomation',
    ];
    for (const tool of expectedTools) {
      assert(registry.has(tool), `Registry contains tool: ${tool}`);
    }

    // ── 3. Filesystem Tool Operations ──────────────────────────────────────
    console.log('\n[3/6] Testing Filesystem Tool Implementations');

    const subDir = path.join(testDir, 'subfolder');
    const createDirRes = await registry.execute('createDirectory', { path: subDir });
    assert(fs.existsSync(subDir), 'createDirectory created subfolder');

    const testFile = path.join(subDir, 'hello.txt');
    const createFileRes = await registry.execute('createFile', { path: testFile });
    assert(fs.existsSync(testFile), 'createFile created target file');

    await registry.execute('writeFile', { path: testFile, content: 'Hello FELLA!' });
    let readRes = await registry.execute('readFile', { path: testFile });
    assert(readRes.includes('Hello FELLA!'), 'writeFile and readFile read back written content');

    await registry.execute('writeFile', { path: testFile, content: ' Appended line.', append: true });
    readRes = await registry.execute('readFile', { path: testFile });
    assert(readRes.includes('Hello FELLA! Appended line.'), 'writeFile appended content successfully');

    const renamedFile = path.join(subDir, 'renamed_hello.txt');
    await registry.execute('renameFile', { path: testFile, newName: 'renamed_hello.txt' });
    assert(!fs.existsSync(testFile) && fs.existsSync(renamedFile), 'renameFile renamed file successfully');

    const movedFile = path.join(testDir, 'moved_hello.txt');
    await registry.execute('moveFile', { source: renamedFile, destination: movedFile });
    assert(fs.existsSync(movedFile), 'moveFile moved file successfully');

    const listRes = await registry.execute('listFiles', { path: testDir });
    assert(typeof listRes === 'string' && listRes.includes('moved_hello.txt'), 'listFiles lists files');

    const findRes = await registry.execute('findFile', { query: 'moved_hello', dir: testDir });
    assert(typeof findRes === 'string' && findRes.includes('moved_hello.txt'), 'findFile found target file by query');

    const orgRes = await registry.execute('organiseByRule', { source_dir: testDir, rule: 'by_type', dry_run: true });
    assert(typeof orgRes === 'string' && (orgRes.includes('PREVIEW') || orgRes.includes('No files')), 'organiseByRule returned preview');

    await registry.execute('deleteFile', { path: movedFile });
    assert(!fs.existsSync(movedFile), 'deleteFile deleted file successfully');

    // ── 4. Undo / Redo History Stacks ──────────────────────────────────────
    console.log('\n[4/6] Testing Undo/Redo Engine History');
    const undoStack = new UndoStack();
    let counter = 0;
    undoStack.push({
      description: 'Increment counter',
      undo: async () => { counter -= 1; },
      redo: async () => { counter += 1; },
    });
    counter += 1;

    assert(undoStack.canUndo, 'UndoStack reports canUndo = true');
    const undoneDesc = await undoStack.undo();
    assert(counter === 0 && undoneDesc.includes('Increment counter'), 'Undo restored counter to 0');
    assert(undoStack.canRedo, 'UndoStack reports canRedo = true');

    await undoStack.redo();
    assert(counter === 1, 'Redo re-applied counter increment');

    // ── 5. SQLite Persistent Memory Store ──────────────────────────────────
    console.log('\n[5/6] Testing SQLite Memory Store');
    const store = new MemoryStore();
    const testSessionId = `comp_test_${Date.now()}`;

    store.createSession(testSessionId);
    store.appendTurn(testSessionId, 'user', 'Ping test', new Date().toISOString(), true);
    store.appendTurn(testSessionId, 'assistant', 'Pong response', new Date().toISOString(), true);

    const history = store.loadSessionHistory(testSessionId);
    assert(history.length === 2, 'Loaded 2 turns from session history');
    assert(history[0].content === 'Ping test', 'User turn matches content');
    assert(history[1].content === 'Pong response', 'Assistant turn matches content');

    store.saveFact('Test fact: user loves fast tests.', 'unit_test');
    const facts = store.getFacts();
    assert(facts.some((f) => f.includes('user loves fast tests')), 'Fact saved and retrieved from SQLite');

    store.deleteSession(testSessionId);
    const postDeleteTurns = store.loadSessionHistory(testSessionId);
    assert(postDeleteTurns.length === 0, 'deleteSession cleared turns from SQLite');

    // ── 6. Full CLI Binary Execution Tests ─────────────────────────────────
    console.log('\n[6/6] Testing CLI Binary Execution & Commands');

    const versionOut = execSync('node bin/fella.js --version', { encoding: 'utf8' });
    assert(versionOut.includes('FELLA v2.0.0'), 'CLI: node bin/fella.js --version returns version');

    const helpOut = execSync('node bin/fella.js --help', { encoding: 'utf8' });
    assert(helpOut.includes('Usage:') && helpOut.includes('fella sessions'), 'CLI: node bin/fella.js --help returns usage guide');

    const sessionsOut = execSync('node bin/fella.js sessions', { encoding: 'utf8' });
    assert(typeof sessionsOut === 'string', 'CLI: node bin/fella.js sessions executes cleanly');

    const whoamiOut = execSync('node bin/fella.js whoami', { encoding: 'utf8' });
    assert(whoamiOut.includes('Logged in as') || whoamiOut.includes('Not logged in'), 'CLI: node bin/fella.js whoami returns auth status');

    if (process.platform === 'win32') {
      const batOut = execSync('cmd.exe /c "bin\\fella.bat --version"', { encoding: 'utf8' });
      assert(batOut.includes('FELLA v2.0.0'), 'CLI: bin\\fella.bat runs cleanly in Windows shell');
    }
  } finally {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
