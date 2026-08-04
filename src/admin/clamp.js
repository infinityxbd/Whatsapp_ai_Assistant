/**
 * Admin settings value clamps — shared by routes.js and the test suite so the
 * tests exercise the REAL logic (a duplicated copy would drift silently).
 */

// Clamp a 0..1 probability field (groupReplyChance, reactionChance,
// questionBoostChance, reactionReplyChance). NaN/empty → 0.
function clampChance(value) {
  const v = parseFloat(value);
  return Math.min(Math.max(isNaN(v) ? 0 : v, 0), 1);
}

// Clamp an integer field to a [min, max] window (NaN/empty → fallback).
function clampInt(value, fallback, min, max) {
  const v = parseInt(value);
  const base = isNaN(v) ? fallback : v;
  return Math.min(Math.max(base, min), max);
}

module.exports = { clampChance, clampInt };
