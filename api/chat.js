"use strict";
/* Rafa Assistant — website chat endpoint (Vercel serverless function).
   POST { site, message } -> { reply, products: [{ name, price, url }] }

   The shop's own website is the channel: this reads the shop's public
   Shopify catalogue (products.json), cached in memory for 60 seconds per
   site, and answers prices / lists / COD / ordering from it. Policies are
   only stated for shops whose policies are verified (Rafa Collection);
   for any other shop the reply honestly points to the store's own policy.
   No dependencies. */

var CACHE = {};
var CACHE_MS = 60 * 1000;
var FEED_LIMIT = 100;
var MAX_LIST = 8;

var RAFA_DOMAIN = "rafacollection.com";
var RAFA_NAME = "Rafa Collection";

function formatPrice(v) {
  var d = String(v == null ? "" : v).replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^0+(?=\d)/, "");
  var last3 = d.slice(-3), rest = d.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3;
}

function normalizeSite(raw) {
  try {
    var u = new URL(String(raw == null ? "" : raw).trim());
    if (u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch (e) { return null; }
}

function domainOf(site) {
  try { return new URL(site).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

function shopNameOf(site, products) {
  if (domainOf(site) === RAFA_DOMAIN) return RAFA_NAME;
  for (var i = 0; i < products.length; i++) {
    if (products[i].vendor) return products[i].vendor;
  }
  return domainOf(site);
}

var STOPWORDS = { suit: 1, suits: 1, set: 1, sets: 1, collection: 1, the: 1, and: 1, for: 1, with: 1 };

function keywordsOf(name) {
  var words = String(name || "").toLowerCase().split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length >= 3 && !STOPWORDS[w] && out.indexOf(w) < 0) out.push(w);
  }
  return out;
}

function parseFeed(data, site) {
  if (!data || !Array.isArray(data.products)) return null;
  var out = [];
  for (var i = 0; i < data.products.length && out.length < FEED_LIMIT; i++) {
    var p = data.products[i];
    if (!p || !p.title || !p.handle) continue;
    var v = (p.variants && p.variants[0]) || null;
    if (!v || v.price == null) continue;
    var num = Math.round(parseFloat(String(v.price)));
    if (!isFinite(num) || num <= 0) continue;
    out.push({
      name: String(p.title),
      price: formatPrice(String(num)),
      url: site + "/products/" + p.handle,
      vendor: p.vendor ? String(p.vendor) : "",
      keywords: keywordsOf(p.title)
    });
  }
  return out.length ? out : null;
}

async function getProducts(site) {
  var hit = CACHE[site];
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.products;
  var f = globalThis.fetch;
  if (!f) throw new Error("no fetch available");
  var res = await f(site + "/products.json?limit=" + FEED_LIMIT);
  if (!res || !res.ok) throw new Error("feed http");
  var data = await res.json();
  var products = parseFeed(data, site);
  if (!products) throw new Error("feed shape");
  CACHE[site] = { at: Date.now(), products: products };
  return products;
}

/* ------------------------- compact responder ------------------------- */

function normPad(s) {
  var c = String(s || "").toLowerCase().replace(/[^a-z0-9₹]+/g, " ").replace(/\s+/g, " ").trim();
  return " " + c + " ";
}

var HINGLISH_MARKERS = ["hai", "kya", "mujhe", "chahiye", "batao", "bataiye", "kitne", "kitna",
  "wala", "wali", "dikhao", "bhej", "mera", "meri", "nahi", "kaise", "kab", "milega", "hoga",
  "karna", "karo", "liye", "par", "bhi", "aur", "aap"];

function isHinglish(raw, np) {
  if (/[\u0900-\u097F]/.test(String(raw || ""))) return true;
  for (var i = 0; i < HINGLISH_MARKERS.length; i++) {
    if (np.indexOf(" " + HINGLISH_MARKERS[i] + " ") >= 0) return true;
  }
  return false;
}

function findMatches(products, np) {
  var scored = [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i], score = 0, longest = 0;
    for (var j = 0; j < p.keywords.length; j++) {
      var k = p.keywords[j];
      if (np.indexOf(" " + k + " ") >= 0 || np.indexOf(" " + k + "s ") >= 0) {
        score++;
        if (k.length > longest) longest = k.length;
      }
    }
    if (score > 0) scored.push({ p: p, score: score, longest: longest, idx: i });
  }
  scored.sort(function (a, b) {
    return (b.score - a.score) || (b.longest - a.longest) || (a.idx - b.idx);
  });
  return scored.map(function (s) { return s.p; });
}

function pub(p) { return { name: p.name, price: p.price, url: p.url }; }

function listText(items) {
  return items.map(function (p) { return "• " + p.name + " — ₹" + p.price; }).join("\n");
}

function respond(site, products, rawMessage) {
  var message = String(rawMessage || "").trim();
  var np = normPad(message);
  var hing = isHinglish(message, np);
  var isRafa = domainOf(site) === RAFA_DOMAIN;
  var shop = shopNameOf(site, products);

  function pick(en, hi) { return hing ? hi : en; }

  /* COD / shipping — policy text only where verified (Rafa); else honest */
  if (np.indexOf(" cod ") >= 0 || np.indexOf(" cash on delivery ") >= 0) {
    if (isRafa) {
      return { reply: pick(
        "COD is available on " + shop + "'s website — shipping for COD orders is calculated at checkout. You can order here: " + site,
        "COD " + shop + " ki website par available hai — COD orders ki shipping checkout par calculate hoti hai. Order yahan se karein: " + site
      ), products: [] };
    }
    return { reply: pick(
      "Please check the store's website for its COD and shipping policy, or ask the team.",
      "COD aur shipping policy ke liye store ki website check karein, ya team se puchein."
    ), products: [] };
  }
  if (np.indexOf(" shipping ") >= 0 || np.indexOf(" delivery charge ") >= 0 || np.indexOf(" delivery charges ") >= 0) {
    if (isRafa) {
      return { reply: pick(
        "Shipping is free on prepaid orders at " + shop + "; for COD orders the shipping charge is calculated at checkout.",
        "Prepaid orders par shipping free hai; COD orders ki shipping checkout par calculate hoti hai."
      ), products: [] };
    }
    return { reply: pick(
      "Please check the store's website for its COD and shipping policy, or ask the team.",
      "COD aur shipping policy ke liye store ki website check karein, ya team se puchein."
    ), products: [] };
  }

  /* how to order */
  if (np.indexOf(" order ") >= 0 || np.indexOf(" buy ") >= 0 || np.indexOf(" kharid") >= 0 || np.indexOf(" lena ") >= 0) {
    return { reply: pick(
      "Ordering is only through the website: " + site + " — open a design you like and place your order there." + (isRafa ? " COD is available too." : ""),
      "Order sirf website se hota hai: " + site + " — jo design pasand aaye use khol kar wahi order kar dein." + (isRafa ? " COD bhi available hai." : "")
    ), products: [] };
  }

  /* greetings */
  if (/^(hi|hii+|hello|hey|salaam|namaste|aoa)\b/i.test(message) && message.length <= 24) {
    return { reply: pick(
      "Hello, and welcome to " + shop + "! I can help you with designs and prices from the shop's own catalogue — tell me a design name, or ask for the price list.",
      "Hello, " + shop + " me khush aamdeed! Mai designs aur prices me madad kar sakta hu — kisi design ka naam bataiye, ya price list mangiye."
    ), products: [] };
  }

  /* specific design match */
  var matches = findMatches(products, np);
  var wantsList = np.indexOf(" price ") >= 0 || np.indexOf(" prices ") >= 0 ||
    np.indexOf(" list ") >= 0 || np.indexOf(" designs ") >= 0 || np.indexOf(" dikhao ") >= 0 ||
    np.indexOf(" show ") >= 0 || np.indexOf(" sab ") >= 0 || np.indexOf(" all ") >= 0;

  if (matches.length) {
    var top = matches.slice(0, 6);
    return {
      reply: pick("Here is what I found for you:\n", "Ye rahe designs jo mile:\n") + listText(top) +
        pick("\nTap a design to view it on the website.", "\nKisi design par tap karke website par dekhein."),
      products: top.map(pub)
    };
  }

  /* price list / catalogue browse */
  if (wantsList || np.indexOf(" price") >= 0 || np.indexOf(" rate ") >= 0 || np.indexOf(" cost ") >= 0 || np.indexOf(" collection ") >= 0) {
    var items = products.slice(0, MAX_LIST);
    var more = products.length > MAX_LIST
      ? pick("\n…and " + (products.length - MAX_LIST) + " more on the website: " + site,
             "\n…aur " + (products.length - MAX_LIST) + " designs website par: " + site)
      : "";
    return {
      reply: pick("Here are some designs with prices:\n", "Kuch designs prices ke saath:\n") + listText(items) + more +
        pick("\nTell me a design name for its page link.", "\nKisi design ka naam bataiye, uski page link bhej dunga."),
      products: items.map(pub)
    };
  }

  return { reply: pick(
    "I can help with designs and prices — tell me a design name, like 'Farshi' or 'Kaftan', or ask for the price list.",
    "Mai designs aur prices me madad kar sakta hu — kisi design ka naam bataiye, jaise 'Farshi' ya 'Kaftan', ya price list mangiye."
  ), products: [] };
}

/* ------------------------------ handler ------------------------------ */

function sendJson(res, code, obj) {
  res.status(code);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(function (resolve) {
    var body = req.body;
    if (body && typeof body === "object") return resolve(body);
    if (typeof body === "string") {
      try { return resolve(JSON.parse(body)); } catch (e) { return resolve(null); }
    }
    if (typeof req.on !== "function") return resolve(null);
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); }
      catch (e) { resolve(null); }
    });
    req.on("error", function () { resolve(null); });
  });
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    return sendJson(res, 405, { reply: "This endpoint only takes POST requests.", products: [] });
  }
  var body = await readBody(req);
  var site = normalizeSite(body && body.site);
  var message = String((body && body.message) || "").trim();
  if (!site) return sendJson(res, 400, { reply: "I don't know which shop's website this is — please check the widget setup.", products: [] });
  if (!message) return sendJson(res, 400, { reply: "Please type a message.", products: [] });
  try {
    var products = await getProducts(site);
    var out = respond(site, products, message);
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, 200, {
      reply: "Sorry — I couldn't reach the store's catalogue just now. Please try again in a moment.",
      products: []
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports._respond = respond;
module.exports._resetCache = function () { CACHE = {}; };
