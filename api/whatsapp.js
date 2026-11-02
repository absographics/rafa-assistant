"use strict";
/* ABSO Assistant — WhatsApp webhook (Vercel serverless function).
   Receives WhatsApp Cloud API events for the connected number.

   GET  -> Meta webhook verification (hub.challenge) using
           WHATSAPP_VERIFY_TOKEN.
   POST -> message events. This handler answers Meta IMMEDIATELY
           (200) and hands each text message to /api/whatsapp-reply,
           which does the slow work (AI brain + Graph API reply).
           Reason: the AI can take 30-60s when the free line is
           busy, and a slow webhook answer makes Meta mark the
           delivery failed — the customer then gets silence.
           Duplicate deliveries are filtered by message id.

   Environment (Vercel): WHATSAPP_VERIFY_TOKEN. */

var SEEN = {};

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { resolve({}); }
    });
    req.on("error", function () { resolve({}); });
  });
}

function alreadySeen(id) {
  var now = Date.now();
  for (var k in SEEN) { if (now - SEEN[k] > 10 * 60 * 1000) delete SEEN[k]; }
  if (SEEN[id]) return true;
  SEEN[id] = now;
  return false;
}

function dispatch(host, payload) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, 4000);
  return fetch("https://" + host + "/api/whatsapp-reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hook-secret": process.env.WHATSAPP_VERIFY_TOKEN || ""
    },
    body: JSON.stringify(payload),
    signal: ctrl.signal
  }).then(function () {
    clearTimeout(t);
    return true;
  }).catch(function () {
    /* The request has been dispatched; the reply function runs
       on its own lifecycle even if this wait is cut short. */
    clearTimeout(t);
    return false;
  });
}

module.exports = async function (req, res) {
  if (req.method === "GET") {
    var q = {};
    try { q = new URL(req.url, "https://x").searchParams; } catch (e) { /* ignore */ }
    var mode = q.get ? q.get("hub.mode") : null;
    var token = q.get ? q.get("hub.verify_token") : null;
    var challenge = q.get ? q.get("hub.challenge") : null;
    if (mode === "subscribe" && token && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end(String(challenge || ""));
      return;
    }
    sendJson(res, 403, { error: "verification failed" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  var body = await readBody(req);
  var host = req.headers.host || "rafa-assistant.vercel.app";
  var jobs = [];

  var entries = Array.isArray(body.entry) ? body.entry : [];
  for (var ei = 0; ei < entries.length; ei++) {
    var changes = Array.isArray(entries[ei].changes) ? entries[ei].changes : [];
    for (var ci = 0; ci < changes.length; ci++) {
      var value = changes[ci].value || {};
      var messages = Array.isArray(value.messages) ? value.messages : [];
      for (var mi = 0; mi < messages.length; mi++) {
        var msg = messages[mi];
        if (!msg || !msg.from) continue;
        if (msg.id && alreadySeen(msg.id)) continue;
        if (msg.type === "text" && msg.text && msg.text.body) {
          jobs.push(dispatch(host, { to: msg.from, text: msg.text.body }));
        } else {
          jobs.push(dispatch(host, { to: msg.from, text: null }));
        }
      }
    }
  }

  try { await Promise.all(jobs); } catch (e) { /* dispatch is best-effort */ }
  sendJson(res, 200, { ok: true });
};
