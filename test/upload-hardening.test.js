"use strict";
/* ============================================================================
   UPLOAD HARDENING — the stored file name is never attacker-controlled

   The bug this locks down: multer's fileFilter only sees the Content-Type
   header, and the name written to disk was built from `file.originalname`.
   Both are supplied by the client. A file sent as

       filename="evil.html"   Content-Type: image/png

   passed the image filter and was stored as `<random>.html`, then served back
   from our own origin as `text/html`. That is stored XSS, and because the file
   is same-origin it also walks straight through the `script-src 'self'` CSP —
   the CSP is not a second line of defence here, it is defeated by construction.

   The fix derives the extension from the MIME type that was actually allowed,
   so the name on disk and the type we serve always agree. These tests assert
   the observable consequence rather than the implementation: whatever the
   client calls the file, nothing HTML-ish ever lands in the upload directory.
   ========================================================================== */
const { test, before, after } = require("node:test");
const assert = require("node:assert");

const { initEnv, setup, Client, PASSWORD } = require("./helpers");
initEnv();

// Smallest valid 1x1 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
  "01f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

let ctx, admin;

before(async () => {
  ctx = await setup();
  admin = new Client(ctx.base);
  assert.equal((await admin.login("admin-a", PASSWORD)).status, 200);
});

after(async () => { await ctx.close(); });

/** Posts one multipart file to `url`, exactly as a browser would. */
async function upload(filename, mime, body, field, url) {
  const form = new FormData();
  form.append(field, new Blob([body], { type: mime }), filename);
  const token = await admin.csrf();
  const res = await fetch(ctx.base + url, {
    method: "POST",
    headers: { Cookie: admin.cookieHeader(), "X-CSRF-Token": token },
    body: form,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  const stored = (JSON.stringify(data || "").match(/\/uploads\/[^"\\]+/) || [])[0] || null;
  return { status: res.status, data, stored };
}

test("a genuine image uploads and keeps an image extension", async () => {
  const r = await upload("logo.png", "image/png", PNG, "logo", "/api/madrasa/profile/logo");
  assert.equal(r.status, 200, `expected the upload to succeed, got ${r.status}`);
  assert.ok(r.stored, "the response reports where the logo was stored");
  assert.match(r.stored, /\.png$/, "a PNG is stored with a .png extension");
});

test("an HTML payload disguised as an image is not stored as HTML", async () => {
  const html = Buffer.from("<script>alert(document.cookie)</script>");
  const r = await upload("evil.html", "image/png", html, "logo", "/api/madrasa/profile/logo");

  // The request may be accepted (the bytes are just stored) but the NAME must
  // not be the attacker's, because the name is what decides how it is served.
  if (r.stored) {
    assert.ok(!/\.html?$/i.test(r.stored),
      `the stored file must not carry an .html extension, got ${r.stored}`);
    assert.match(r.stored, /\.(png|jpg|webp)$/,
      `the extension must come from the declared image type, got ${r.stored}`);

    const served = await fetch(ctx.base + r.stored);
    const type = served.headers.get("content-type") || "";
    assert.ok(!/text\/html/i.test(type),
      `an uploaded file must never be served as text/html (got "${type}")`);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff",
      "nosniff stops the browser second-guessing that content type");
  }
});

test("a path-traversal file name cannot escape the upload directory", async () => {
  const r = await upload("../../../../etc/cron.d/pwn.png", "image/png", PNG, "logo", "/api/madrasa/profile/logo");
  if (r.stored) {
    assert.ok(!r.stored.includes(".."), `stored path must not contain traversal: ${r.stored}`);
    assert.match(r.stored, /^\/uploads\/logos\/[^/]+$/,
      `the file must land directly in its context directory, got ${r.stored}`);
  }
  assert.equal(require("fs").existsSync("/etc/cron.d/pwn.png"), false,
    "nothing may be written outside the upload directory");
});

test("a script-capable SVG is refused with a client error, not a 500", async () => {
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  const r = await upload("x.svg", "image/svg+xml", svg, "logo", "/api/madrasa/profile/logo");
  assert.ok(r.status >= 400 && r.status < 500,
    `an SVG must be refused as a client error, got ${r.status}`);
});

test("an executable is refused with a client error, not a 500", async () => {
  const r = await upload("x.exe", "application/x-msdownload", Buffer.from("MZ"), "logo", "/api/madrasa/profile/logo");
  assert.ok(r.status >= 400 && r.status < 500,
    `a non-image upload must be refused as a client error, got ${r.status}`);
});

test("an oversized file is refused as 413, not reported as a server crash", async () => {
  // MAX_UPLOAD_MB is 2 in the test environment.
  const r = await upload("big.png", "image/png", Buffer.alloc(5 * 1024 * 1024, 1), "logo", "/api/madrasa/profile/logo");
  assert.equal(r.status, 413,
    `an oversized upload is the caller's error, expected 413 and got ${r.status}`);
});
