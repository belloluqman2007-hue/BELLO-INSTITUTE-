"use strict";
/* ============================================================================
   PERMISSION-GATED UI CONTROLS

   The dashboard hides action buttons the signed-in user cannot use, via a
   `data-needs="<permission>"` attribute swept after every render.

   The failure mode this guards against is silent and permanent: a typo in a
   permission name matches nothing, so the control disappears for *everyone*
   and no error is ever raised. Three of the first eight attributes written
   had exactly that bug. So the contract is checked statically here rather
   than trusted to review.
   ========================================================================== */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { ALL_PERMISSIONS } = require("../server/services/permissions");
const DASHBOARD = path.join(__dirname, "..", "public", "js", "dashboard.js");
const source = fs.readFileSync(DASHBOARD, "utf8");

/** Every distinct permission named by a data-needs attribute. */
function gatedPermissions() {
  return [...new Set(
    [...source.matchAll(/data-needs="([^"]+)"/g)]
      .flatMap((m) => m[1].split(/[,\s]+/))
      .filter(Boolean)
  )];
}

test("every data-needs attribute names a real permission", () => {
  const known = new Set(ALL_PERMISSIONS);
  const unknown = gatedPermissions().filter((p) => !known.has(p));
  assert.deepEqual(unknown, [],
    `these gates name permissions that do not exist, so the control is hidden from everyone: ${unknown.join(", ")}`);
});

test("the UI actually gates some controls", () => {
  // Guards against the attribute being refactored away, which would quietly
  // turn the test above into a no-op that passes forever.
  assert.ok(gatedPermissions().length >= 5,
    "expected the dashboard to gate a meaningful number of write actions");
});

test("the gate sweep is wired into the render path", () => {
  assert.match(source, /function applyPermissionGates/,
    "the sweep helper exists");
  assert.match(source, /applyPermissionGates\(content\)/,
    "the sweep runs after a route renders, not just when defined");
});

test("an unknown permission list leaves the interface intact", () => {
  // A failed /auth/me or an older session must not blank out every button:
  // when we cannot tell what the user holds, we show everything and let the
  // server refuse. This is the safe direction to fail in.
  const fn = source.slice(source.indexOf("function applyPermissionGates"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /!state\.permissions\s*\|\|\s*!state\.permissions\.size/,
    "the sweep bails out when the permission set is absent or empty");
  assert.ok(
    body.indexOf("return;") < body.indexOf("querySelectorAll"),
    "the bail-out happens before anything is removed"
  );
});

test("gated controls are write actions, never navigation or read-only views", () => {
  // Hiding a read screen behind a write permission is a subtle way to break
  // a legitimate user; every gate should reference a create/edit/send/
  // generate-style capability.
  const readOnly = gatedPermissions().filter((p) => /\.view$/.test(p));
  assert.deepEqual(readOnly, [],
    `a *.view permission gates a button, which suggests the wrong capability was chosen: ${readOnly.join(", ")}`);
});
