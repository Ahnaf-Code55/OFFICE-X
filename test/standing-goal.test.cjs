const test = require('node:test');
const assert = require('node:assert/strict');
const {withStandingGoal} = require('./load-ts.cjs')('src/shared/standingGoal.ts');
test('OpenCode lifecycle bridge still carries the current saved goal on delivery', () => {
  const a = {provider:'opencode',goal:'Report to Forge; remain idle without an assignment.'};
  assert.equal(withStandingGoal(a,'Verify the API'),'<goal>\n'+a.goal+'\n</goal>\n\nVerify the API');
  a.goal='Report to Atlas';
  assert.match(withStandingGoal(a,'Next task'),/Report to Atlas/);
});
test('hook-injected Codex goals are not duplicated in the terminal input', () => {
  assert.equal(withStandingGoal({provider:'codex',goal:'Review only'},'Task'),'Task');
});
test('empty goals and messages already carrying a goal remain unchanged', () => {
  assert.equal(withStandingGoal({provider:'opencode',goal:' '},'Task'),'Task');
  const seeded='<goal>\nExisting goal\n</goal>\nTask';
  assert.equal(withStandingGoal({provider:'opencode',goal:'New goal'},seeded),seeded);
});
