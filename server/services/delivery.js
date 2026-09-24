"use strict";
/* ============================================================================
   OUTBOUND MESSAGE DELIVERY — email, SMS and WhatsApp.
   ----------------------------------------------------------------------------
   Additive: this service is the ONLY place that talks to an external provider.
   It is deliberately dependency-free — SMTP speaks the protocol over Node's
   built-in net/tls, every HTTP provider uses the global fetch that ships with
   Node 22. Nothing here throws: a caller always receives
   { ok, provider, messageId, error, skipped } so a failed SMS can never break
   a fee reminder, a result publication or an admission decision.

   With every provider left at "none" (the default) each send* call is a silent
   no-op — the in-app notification and communication_history row are still
   created by the existing communication service.
   ========================================================================== */
const net = require("net");
const tls = require("tls");
const config = require("../config");

const MAX_BODY = 5000;

/* ----------------------------- small helpers ---------------------------- */
function str(v, max = 1000) {
  return String(v === undefined || v === null ? "" : v).replace(/\u0000/g, "").trim().slice(0, max);
}
function stripHtml(html) {
  return str(html, MAX_BODY).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function escapeHtml(text) {
  return str(text, MAX_BODY).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function logFailure(scope, error) {
  console.error(`[delivery] ${scope}: ${error && error.message ? error.message : error}`);
}
function fail(provider, error) {
  logFailure(provider, error);
  return { ok: false, provider, messageId: "", error: str(error && error.message ? error.message : error, 500) };
}
function skip(reason, provider) {
  return { ok: false, skipped: true, provider: provider || "none", messageId: "", error: "", reason };
}

/**
 * Nigerian numbers are stored in every shape a school secretary can type:
 * 08031234567, 8031234567, 234 803 123 4567, +234-803-123-4567. Providers only
 * accept E.164, so normalise here, once. Numbers that already carry a non-234
 * country code are passed through untouched.
 */
function normalisePhone(raw, defaultCountry = "234") {
  let v = str(raw, 40).replace(/[\s()\-.]/g, "");
  if (!v) return "";
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (v.startsWith("+")) return `+${v.slice(1).replace(/\D/g, "")}`;
  v = v.replace(/\D/g, "");
  if (!v) return "";
  if (v.startsWith(defaultCountry) && v.length >= 12) return `+${v}`;
  if (v.startsWith("0")) return `+${defaultCountry}${v.slice(1)}`;
  if (v.length === 10) return `+${defaultCountry}${v}`;
  return `+${v}`;
}

function validEmail(raw) {
  const v = str(raw, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

/** Timeout-guarded fetch so a hanging provider cannot hold a request open. */
async function postForm(url, { headers = {}, body, json, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: Object.assign(json ? { "Content-Type": "application/json" } : { "Content-Type": "application/x-www-form-urlencoded" }, headers),
      body: json ? JSON.stringify(json) : body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    return { res, data, text };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ SMTP client ----------------------------- */
/* A minimal, dependency-free SMTP conversation: EHLO, optional STARTTLS,
 * optional AUTH LOGIN, MAIL FROM / RCPT TO / DATA. Enough for every hosted
 * relay a school will realistically use (Gmail, Zoho, Namecheap, Mailgun SMTP)
 * without pulling nodemailer into the dependency list. */
function smtpSend({ host, port, user, pass, from, to, subject, html, text, timeoutMs = 20000 }) {
  return new Promise((resolve) => {
    const useTls = Number(port) === 465;
    let socket = useTls ? tls.connect({ host, port: Number(port), servername: host }) : net.connect({ host, port: Number(port) });
    let buffer = "";
    let done = false;
    const queue = [];
    let waiting = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) { /* already closed */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish(fail("smtp", new Error("SMTP timeout"))), timeoutMs);
    const cleanup = () => clearTimeout(timer);

    const onLine = (code, line) => {
      if (waiting) { const w = waiting; waiting = null; w({ code, line }); }
      queue.push({ code, line });
    };
    const read = () => new Promise((r) => { waiting = r; });
    const write = (line) => socket.write(`${line}\r\n`);

    const attach = () => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          // multi-line replies use "250-", the final one "250 "
          if (/^\d{3}-/.test(line)) continue;
          onLine(Number(line.slice(0, 3)), line);
        }
      });
      socket.on("error", (e) => { cleanup(); finish(fail("smtp", e)); });
      socket.on("close", () => { cleanup(); if (!done) finish(fail("smtp", new Error("SMTP connection closed"))); });
    };
    attach();

    const expect = async (codes) => {
      const r = await read();
      if (!codes.includes(r.code)) throw new Error(`SMTP ${r.line}`);
      return r;
    };

    const conversation = async () => {
      await expect([220]);
      write(`EHLO ${str(host, 120) || "localhost"}`);
      await expect([250]);
      if (!useTls && Number(port) !== 25) {
        write("STARTTLS");
        await expect([220]);
        await new Promise((r, j) => {
          const upgraded = tls.connect({ socket, servername: host }, r);
          upgraded.on("error", j);
          socket = upgraded;
        });
        buffer = "";
        attach();
        write(`EHLO ${str(host, 120) || "localhost"}`);
        await expect([250]);
      }
      if (user) {
        write("AUTH LOGIN");
        await expect([334]);
        write(Buffer.from(user).toString("base64"));
        await expect([334]);
        write(Buffer.from(pass || "").toString("base64"));
        await expect([235]);
      }
      const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];
      write(`MAIL FROM:<${fromAddr}>`);
      await expect([250]);
      write(`RCPT TO:<${to}>`);
      await expect([250, 251]);
      write("DATA");
      await expect([354]);
      const boundary = `edusphere_${Date.now().toString(36)}`;
      const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@edusphere>`;
      const body = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Message-ID: ${messageId}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        text.replace(/^\./gm, ".."),
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        html.replace(/^\./gm, ".."),
        `--${boundary}--`,
        "",
        ".",
      ].join("\r\n");
      socket.write(`${body}\r\n`);
      await expect([250]);
      write("QUIT");
      cleanup();
      finish({ ok: true, provider: "smtp", messageId, error: "" });
    };

    conversation().catch((e) => { cleanup(); finish(fail("smtp", e)); });
  });
}

/* -------------------------------- EMAIL --------------------------------- */
/**
 * sendEmail(to, subject, html, text)
 * Selects the provider from EMAIL_PROVIDER and falls back silently when the
 * provider is "none" or incompletely configured.
 * @returns {Promise<{ok:boolean, provider:string, messageId:string, error:string, skipped?:boolean}>}
 */
async function sendEmail(to, subject, html, text) {
  const cfg = config.DELIVERY.email;
  try {
    const provider = cfg.provider;
    if (provider === "none") return skip("EMAIL_PROVIDER is none");
    const address = validEmail(to);
    if (!address) return skip("no valid recipient email", provider);
    if (!cfg.configured) return skip(`${provider} email provider is not fully configured`, provider);

    const subjectLine = str(subject, 200) || "Message from your school";
    const htmlBody = str(html, MAX_BODY) || `<p>${escapeHtml(text)}</p>`;
    const textBody = str(text, MAX_BODY) || stripHtml(htmlBody);

    if (provider === "smtp") {
      return await smtpSend({
        host: cfg.smtp.host, port: cfg.smtp.port, user: cfg.smtp.user, pass: cfg.smtp.pass,
        from: cfg.smtp.from, to: address, subject: subjectLine, html: htmlBody, text: textBody,
      });
    }
    if (provider === "sendgrid") {
      const { res, data, text: raw } = await postForm("https://api.sendgrid.com/v3/mail/send", {
        headers: { Authorization: `Bearer ${cfg.sendgrid.apiKey}` },
        json: {
          personalizations: [{ to: [{ email: address }] }],
          from: { email: cfg.sendgrid.from },
          subject: subjectLine,
          content: [{ type: "text/plain", value: textBody }, { type: "text/html", value: htmlBody }],
        },
      });
      if (!res.ok) return fail("sendgrid", new Error(str((data.errors && data.errors[0] && data.errors[0].message) || raw || `HTTP ${res.status}`, 300)));
      return { ok: true, provider: "sendgrid", messageId: str(res.headers.get("x-message-id"), 160), error: "" };
    }
    if (provider === "mailgun") {
      const form = new URLSearchParams({ from: cfg.mailgun.from, to: address, subject: subjectLine, text: textBody, html: htmlBody });
      const { res, data, text: raw } = await postForm(`https://api.mailgun.net/v3/${encodeURIComponent(cfg.mailgun.domain)}/messages`, {
        headers: { Authorization: `Basic ${Buffer.from(`api:${cfg.mailgun.apiKey}`).toString("base64")}` },
        body: form.toString(),
      });
      if (!res.ok) return fail("mailgun", new Error(str(data.message || raw || `HTTP ${res.status}`, 300)));
      return { ok: true, provider: "mailgun", messageId: str(data.id, 160), error: "" };
    }
    return skip(`unknown email provider ${provider}`, provider);
  } catch (e) {
    return fail(cfg.provider || "email", e);
  }
}

/* --------------------------------- SMS ---------------------------------- */
/**
 * sendSms(to, body) — Nigerian numbers are normalised to +234 before sending.
 */
async function sendSms(to, body) {
  const cfg = config.DELIVERY.sms;
  try {
    const provider = cfg.provider;
    if (provider === "none") return skip("SMS_PROVIDER is none");
    const phone = normalisePhone(to);
    if (!phone || phone.replace(/\D/g, "").length < 10) return skip("no valid recipient phone", provider);
    if (!cfg.configured) return skip(`${provider} SMS provider is not fully configured`, provider);
    const message = str(body, 1000);
    if (!message) return skip("empty message", provider);

    if (provider === "termii") {
      const { res, data, text: raw } = await postForm("https://api.ng.termii.com/api/sms/send", {
        json: { to: phone.replace(/^\+/, ""), from: cfg.termii.senderId, sms: message, type: "plain", channel: "generic", api_key: cfg.termii.apiKey },
      });
      if (!res.ok || (data.code && data.code !== "ok")) return fail("termii", new Error(str(data.message || raw || `HTTP ${res.status}`, 300)));
      return { ok: true, provider: "termii", messageId: str(data.message_id, 160), error: "" };
    }
    if (provider === "twilio") {
      return await twilioMessage(cfg.twilio, cfg.twilio.from, phone, message, "twilio");
    }
    if (provider === "africastalking") {
      const form = new URLSearchParams({ username: cfg.africastalking.username, to: phone, message });
      if (cfg.africastalking.from) form.set("from", cfg.africastalking.from);
      const live = cfg.africastalking.username.toLowerCase() !== "sandbox";
      const url = live ? "https://api.africastalking.com/version1/messaging" : "https://api.sandbox.africastalking.com/version1/messaging";
      const { res, data, text: raw } = await postForm(url, {
        headers: { apiKey: cfg.africastalking.apiKey, Accept: "application/json" },
        body: form.toString(),
      });
      const recipients = (data.SMSMessageData && data.SMSMessageData.Recipients) || [];
      if (!res.ok || !recipients.length) return fail("africastalking", new Error(str((data.SMSMessageData && data.SMSMessageData.Message) || raw || `HTTP ${res.status}`, 300)));
      const first = recipients[0];
      if (first.status && !/success/i.test(first.status)) return fail("africastalking", new Error(str(first.status, 300)));
      return { ok: true, provider: "africastalking", messageId: str(first.messageId, 160), error: "" };
    }
    return skip(`unknown SMS provider ${provider}`, provider);
  } catch (e) {
    return fail(cfg.provider || "sms", e);
  }
}

async function twilioMessage(creds, from, to, body, provider) {
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const { res, data, text: raw } = await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`,
    { headers: { Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}` }, body: form.toString() }
  );
  if (!res.ok) return fail(provider, new Error(str(data.message || raw || `HTTP ${res.status}`, 300)));
  return { ok: true, provider, messageId: str(data.sid, 160), error: "" };
}

/* ------------------------------- WHATSAPP -------------------------------- */
/** sendWhatsapp(to, body) — Twilio WhatsApp sandbox or an approved number. */
async function sendWhatsapp(to, body) {
  const cfg = config.DELIVERY.whatsapp;
  try {
    const provider = cfg.provider;
    if (provider === "none") return skip("WHATSAPP_PROVIDER is none");
    const phone = normalisePhone(to);
    if (!phone || phone.replace(/\D/g, "").length < 10) return skip("no valid recipient phone", provider);
    if (!cfg.configured) return skip("twilio WhatsApp is not fully configured", provider);
    const message = str(body, 1000);
    if (!message) return skip("empty message", provider);
    const from = cfg.twilio.from.startsWith("whatsapp:") ? cfg.twilio.from : `whatsapp:${cfg.twilio.from}`;
    return await twilioMessage(cfg.twilio, from, `whatsapp:${phone}`, message, "whatsapp");
  } catch (e) {
    return fail("whatsapp", e);
  }
}

/* ------------------------- provider status (UI) -------------------------- */
/** Safe summary for the admin settings screen. NEVER contains a key or secret. */
function providerStatus() {
  const cfg = config.DELIVERY;
  return {
    email: { channel: "email", provider: cfg.email.provider, enabled: cfg.email.provider !== "none", configured: cfg.email.configured },
    sms: { channel: "sms", provider: cfg.sms.provider, enabled: cfg.sms.provider !== "none", configured: cfg.sms.configured },
    whatsapp: { channel: "whatsapp", provider: cfg.whatsapp.provider, enabled: cfg.whatsapp.provider !== "none", configured: cfg.whatsapp.configured },
  };
}

/** Channel-agnostic entry point used by the bulk sender and the test button. */
async function send(channel, recipient, { subject, message, html } = {}) {
  const ch = str(channel, 20).toLowerCase();
  if (ch === "email") return sendEmail(recipient, subject, html || `<p>${escapeHtml(message)}</p>`, message);
  if (ch === "sms") return sendSms(recipient, message);
  if (ch === "whatsapp") return sendWhatsapp(recipient, message);
  return skip(`unsupported channel ${ch}`);
}

module.exports = {
  sendEmail,
  sendSms,
  sendWhatsapp,
  send,
  providerStatus,
  normalisePhone,
  validEmail,
  stripHtml,
  escapeHtml,
};
