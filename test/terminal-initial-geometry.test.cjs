'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./load-ts.cjs');
test('a headless terminal accepts the native startup screen through its final row and column',async()=>{
 const {INITIAL_TERMINAL_SIZE}=load('src/shared/terminalGeometry.ts');
 globalThis.self=globalThis;
 const {Terminal}=require('@xterm/xterm'),term=new Terminal(INITIAL_TERMINAL_SIZE);
 try{
  // Captured native PTY startup geometry. The old xterm default 80x24 loses
  // the footer and leaves stale approval/spinner text on unopened agents.
  await new Promise(resolve=>term.write('\x1b[30;100H!',resolve));
  assert.equal(term.buffer.active.getLine(29)?.getCell(99)?.getChars(),'!');
 }finally{term.dispose()}
 const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 assert.match(read('src/renderer/src/components/terminalPool.ts'),/new Terminal\(\{\s*\.\.\.INITIAL_TERMINAL_SIZE/);
 assert.match(read('src/main/pty.ts'),/cols: opts\.cols \?\? INITIAL_TERMINAL_SIZE\.cols/);
 assert.match(read('src/main/pty.ts'),/rows: opts\.rows \?\? INITIAL_TERMINAL_SIZE\.rows/);
 assert.match(read('src/renderer/src/components/CommandCenterPanel.tsx'),/acquireTerminal\(a\.ptyId\)\.term\.resize\(cols, rows\)/);
 for(const file of ['src/renderer/src/hooks/useRestoreTeam.ts','src/renderer/src/hooks/useHive.ts','src/renderer/src/components/AddAgentModal.tsx'])assert.match(read(file),/\.\.\.INITIAL_TERMINAL_SIZE/);
});
