"use strict";
/* ABSO Assistant — WhatsApp webhook (Vercel serverless function).
   Receives WhatsApp Cloud API events for the connected number,
   asks the same AI brain as the website chat (/api/chat) for an
   answer, and sends the reply back through the Graph API.

   GET  -> Meta webhook verification (hub.challenge) using
           WHATSAPP_VERIFY_TOKEN.
   POST -> { entry: [...] } message events. Text messages are
           answered; other types get one polite line asking for
           text. Duplicate deliveries (Meta retries) are filtered
           by message id within a warm instance.

   Environment (Vercel):
     WHATSAPP_TOKEN             access token for the number
     WHATSAPP_PHONE_NUMBER_ID   the sender phone number id
     WHATSAPP_VERIFY_TOKEN      webhook verification string
   The shop this demo number serves is fixed below (SHOP_SITE);
   the brain reads that shop's live catalogue and book. */

var GRAPH_BASE = "https://graph.facebook.com/v21.0/";
var SHOP_SITE = "https://www.rafacollection.com";
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

function fetchJson(url, options, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000);
  options = options || {};
  options.signal = ctrl.signal;
  return fetch(url, options).then(function (r) {
    return r.text().then(function (text) {
      clearTimeout(t);
      var json = null;
      try { json = JSON.parse(text); } catch (e) { /* keep null */ }
      return { status: r.status, json: json, text: text };
    });
  }).catch(function (e) {
    clearTimeout(t);
    throw e;
  });
}

function cleanReply(text) {
  return String(text == null ? "" : text)
    .replace(/\[\[HANDOVER:[^\]]*\]\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function askBrain(host, message) {
  return fetchJson("https://" + host + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: SHOP_SITE, message: message })
  }, 90000).then(function (r) {
    var reply = r.json && r.json.reply ? cleanReply(r.json.reply) : "";
    var products = (r.json && r.json.products) || [];
    if (reply && products.length) {
      var lines = [];
      for (var i = 0; i < products.length && i < 3; i++) {
        var p = products[i];
        var line = "• " + p.name;
        if (p.price) line += " — ₹" + p.price;
        if (p.url) line += "\n" + p.url;
        lines.push(line);
      }
      if (lines.length) reply += "\n\n" + lines.join("\n");
    }
    return reply;
  });
}

function sendWhatsApp(to, text) {
  var token = process.env.WHATSAPP_TOKEN;
  var phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.error("WHATSAPP_SEND_SKIPPED missing token or phone id");
    return Promise.resolve(false);
  }
  return fetchJson(GRAPH_BASE + phoneId + "/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + token
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: String(text).slice(0, 4000) }
    })
  }, 20000).then(function (r) {
    if (r.status >= 200 && r.status < 300) return true;
    console.error("WHATSAPP_SEND_FAILED status=" + r.status + " " + String(r.text || "").slice(0, 200));
    return false;
  }).catch(function (e) {
    console.error("WHATSAPP_SEND_FAILED " + (e && e.message ? e.message : e));
    return false;
  });
}

function alreadySeen(id) {
  var now = Date.now();
  for (var k in SEEN) { if (now - SEEN[k] > 10 * 60 * 1000) delete SEEN[k]; }
  if (SEEN[id]) return true;
  SEEN[id] = now;
  return false;
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
        (function (msg) {
          if (!msg || !msg.from) return;
          if (msg.id && alreadySeen(msg.id)) return;
          if (msg.type === "text" && msg.text && msg.text.body) {
            jobs.push(
              askBrain(host, msg.text.body)
                .then(function (reply) {
                  if (!reply) reply = "Sorry, ek minute — team ko bula raha hoon, wo aapko yahin jawab denge.";
                  return sendWhatsApp(msg.from, reply);
                })
                .catch(function (e) {
                  console.error("WHATSAPP_BRAIN_FAILED " + (e && e.message ? e.message : e));
                  return sendWhatsApp(msg.from, "Sorry, abhi thodi dikkat hai — team ko khabar kar di hai, wo aapko yahin jawab denge.");
                })
            );
          } else {
            jobs.push(sendWhatsApp(msg.from, "Namaste! Filhaal mai sirf likhe hue (text) message samajh pata hoon — apna sawal likh kar bhejiye, turant jawab dunga."));
          }
        })(messages[mi]);
      }
    }
  }

  try { await Promise.all(jobs); } catch (e) { /* individual jobs already logged */ }
  sendJson(res, 200, { ok: true });
};
