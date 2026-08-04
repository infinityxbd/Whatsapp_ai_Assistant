/**
 * Admin settings tests
 * Exercises the REAL clamp helpers from src/admin/clamp.js — the same module
 * routes.js uses — so a production regression is caught here.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { clampChance, clampInt } = require('../src/admin/clamp');

test('clampChance preserves valid values and bounds extremes', () => {
  assert.strictEqual(clampChance('0.25'), 0.25);
  assert.strictEqual(clampChance('0.12'), 0.12);
  assert.strictEqual(clampChance('0.6'), 0.6);
  assert.strictEqual(clampChance('0'), 0);
  assert.strictEqual(clampChance('1.5'), 1);
  assert.strictEqual(clampChance('-1'), 0);
  assert.strictEqual(clampChance(''), 0);
  assert.strictEqual(clampChance('abc'), 0);
  assert.strictEqual(clampChance(undefined), 0);
  assert.strictEqual(clampChance('0.999'), 0.999);
});

test('clampInt bounds integer settings', () => {
  // contextMessageLimit: 3..10, fallback 5
  assert.strictEqual(clampInt('5', 5, 3, 10), 5);
  assert.strictEqual(clampInt('2', 5, 3, 10), 3);
  assert.strictEqual(clampInt('99', 5, 3, 10), 10);
  assert.strictEqual(clampInt('', 5, 3, 10), 5);
  assert.strictEqual(clampInt(undefined, 5, 3, 10), 5);
  // memoryAnalyzeEvery: min 5, no max (use large max)
  assert.strictEqual(clampInt('20', 20, 5, 99999), 20);
  assert.strictEqual(clampInt('2', 20, 5, 99999), 5);
  assert.strictEqual(clampInt('', 20, 5, 99999), 20);
});

// Regression: routes.js must call the shared clamps (never a hand-rolled copy
// that could silently re-introduce the "values < 1 become 1" bug).
test('routes.js uses the shared clamp helpers', () => {
  const fs = require('fs');
  const routes = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'admin', 'routes.js'), 'utf8');
  const count = (routes.match(/clampChance\(/g) || []).length;
  assert.ok(count >= 3, `expected clampChance in routes.js for the chance fields (found ${count})`);
  assert.ok(!/Math\.min\(Math\.max\([^)]*1\), 1\)/.test(routes), 'no stale broken clamp remains');
});
