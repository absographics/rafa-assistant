"use strict";
/* ABSO Assistant — WhatsApp reply worker (Vercel serverless function).
   Called only by /api/whatsapp (header x-hook-secret must equal
   WHATSAPP_VERIFY_TOKEN). Takes one customer message, asks the AI
   brain (/api/chat, same shop book + live catalogue) for the
   answer, and sends it back through the WhatsApp Graph API.
   Runs on its own lifecycle so the webhook can answer Meta
   instantly while this takes as long as the AI needs.

   POST { to, text }  — text null means "non-text message", which
   gets one polite line asking for a written question.

   Environment (Vercel):
     WHATSAPP_TOKEN             access token for the number
     WHATSAPP_PHONE_NUMBER_ID   the sender phone number id
     WHATSAPP_VERIFY_TOKEN      shared secret with the webhook */

var GRAPH_BASE = "https://graph.facebook.com/v21.0/";
var SHOP_SITE = "https://www.rafacollection.com";

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
  }, 55000).then(function (r) {
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
    if (r.status >= 200 && r.status < 300) {
      var mid = r.json && r.json.messages && r.json.messages[0] ? r.json.messages[0].id : "?";
      console.log("WHATSAPP_SEND_OK id=" + mid);
      return true;
    }
    console.error("WHATSAPP_SEND_FAILED status=" + r.status + " " + String(r.text || "").slice(0, 200));
    return false;
  }).catch(function (e) {
    console.error("WHATSAPP_SEND_FAILED " + (e && e.message ? e.message : e));
    return false;
  });
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  if (!process.env.WHATSAPP_VERIFY_TOKEN || req.headers["x-hook-secret"] !== process.env.WHATSAPP_VERIFY_TOKEN) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  var body = await readBody(req);
  var to = body.to;
  if (!to) {
    sendJson(res, 400, { error: "missing recipient" });
    return;
  }
  var host = req.headers.host || "rafa-assistant.vercel.app";

  if (!body.text) {
    var sentPolite = await sendWhatsApp(to, "Namaste! Filhaal mai sirf likhe hue (text) message samajh pata hoon — apna sawal likh kar bhejiye, turant jawab dunga.");
    sendJson(res, 200, { ok: true, sent: sentPolite });
    return;
  }

  var reply = "";
  try {
    reply = await askBrain(host, body.text);
  } catch (e) {
    console.error("WHATSAPP_BRAIN_FAILED " + (e && e.message ? e.message : e));
  }
  if (!reply) reply = "Sorry, abhi thodi dikkat hai — team ko khabar kar di hai, wo aapko yahin jawab denge.";
  var sent = await sendWhatsApp(to, reply);
  sendJson(res, 200, { ok: true, sent: sent });
};
