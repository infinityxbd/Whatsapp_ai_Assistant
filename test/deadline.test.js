/**
 * Tests the overall AI deadline wiring in the provider loop.
 * The deadline (90s) is too long to wait in a test, so we assert the source
 * wires it correctly: constant defined, check before each provider attempt,
 * and a break that skips the rest of the list. This guards against a future
 * refactor dropping the cap (which would re-wedge the MAX_CONCURRENT queue).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('source wires an overall deadline into the provider loop', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai', 'service.js'), 'utf8');
  assert.ok(src.includes('OVERALL_AI_DEADLINE_MS'), 'deadline constant defined');
  assert.ok(/OVERALL_AI_DEADLINE_MS\s*=\s*90000/.test(src), 'deadline is 90s');
  assert.ok(src.includes('Date.now() > overallDeadline'), 'deadline check before each provider');
  assert.ok(src.includes('skipping remaining providers'), 'break skips remaining providers');
});
