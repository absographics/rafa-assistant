/* Rafa Assistant — website chat widget.
   Embed on any shop website:
     <script src="https://rafa-assistant.vercel.app/widget.js" data-site="https://yourshop.com"></script>
   Optional: data-name="Shop Name" for the panel header.
   Vanilla JS, no dependencies, all styles self-contained (rw- prefix) so
   the host page's CSS cannot break it and it cannot break the host page. */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("widget.js") >= 0) { script = all[i]; break; }
    }
  }
  if (!script) return;

  var site = script.getAttribute("data-site");
  if (!site) return;

  var shopName = script.getAttribute("data-name") || "";
  if (!shopName) {
    try { shopName = new URL(site).hostname.replace(/^www\./, ""); } catch (e) { shopName = site; }
  }

  /* Same-origin when the widget is served from the assistant's own domain
     (relative path always freshest); the absolute assistant URL otherwise. */
  var apiUrl = "https://rafa-assistant.vercel.app/api/chat";
  try {
    var scriptOrigin = new URL(script.src, window.location.href).origin;
    if (scriptOrigin === window.location.origin) apiUrl = "/api/chat";
  } catch (e) {}

  var MAROON = "#6E1423";

  var css = [
    ".rw-fab{position:fixed;right:16px;bottom:16px;z-index:99998;border:none;border-radius:999px;",
    "background:" + MAROON + ";color:#fff;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;",
    "font-size:15px;font-weight:500;padding:13px 20px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)}",
    ".rw-panel{position:fixed;right:16px;bottom:78px;z-index:99999;width:min(92vw,360px);",
    "height:min(70vh,540px);display:none;flex-direction:column;background:#fff;border-radius:16px;",
    "box-shadow:0 14px 44px rgba(0,0,0,.30);overflow:hidden;",
    "font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1C1A17}",
    ".rw-panel.rw-open{display:flex}",
    ".rw-head{background:" + MAROON + ";color:#fff;padding:13px 15px;display:flex;align-items:center;gap:8px}",
    ".rw-head-name{flex:1;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".rw-head-sub{font-size:11px;opacity:.85}",
    ".rw-close{border:none;background:transparent;color:#fff;font-size:19px;line-height:1;cursor:pointer;padding:2px 4px}",
    ".rw-msgs{flex:1;overflow-y:auto;padding:13px 12px;display:flex;flex-direction:column;gap:9px;background:#FBFAF7}",
    ".rw-msg{max-width:86%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-line;word-break:break-word}",
    ".rw-msg.rw-user{align-self:flex-end;background:#1C1A17;color:#fff;border-bottom-right-radius:4px}",
    ".rw-msg.rw-bot{align-self:flex-start;background:#fff;border:1px solid rgba(28,26,23,.13);border-bottom-left-radius:4px}",
    ".rw-prods{align-self:flex-start;display:flex;flex-direction:column;gap:6px;max-width:86%}",
    ".rw-prod{display:block;text-decoration:none;background:" + MAROON + ";color:#fff;font-size:13.5px;",
    "padding:9px 13px;border-radius:999px;font-weight:500}",
    ".rw-form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(28,26,23,.13);background:#fff}",
    ".rw-input{flex:1;min-width:0;border:1px solid rgba(28,26,23,.22);border-radius:999px;padding:10px 14px;font-size:14px;outline:none;font-family:inherit}",
    ".rw-input:focus{border-color:" + MAROON + "}",
    ".rw-send{flex:none;border:none;border-radius:999px;background:" + MAROON + ";color:#fff;font-size:14px;font-weight:500;padding:0 17px;cursor:pointer}",
    ".rw-send:disabled{opacity:.55;cursor:default}",
    "@media (max-width:480px){.rw-panel{right:8px;bottom:72px}.rw-fab{right:10px;bottom:10px}}"
  ].join("");

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var fab = document.createElement("button");
  fab.className = "rw-fab";
  fab.type = "button";
  fab.textContent = "💬 Chat";
  fab.setAttribute("aria-label", "Chat with the shop");

  var panel = document.createElement("div");
  panel.className = "rw-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Shop chat");

  var head = document.createElement("div");
  head.className = "rw-head";
  var headText = document.createElement("div");
  headText.style.flex = "1";
  headText.style.minWidth = "0";
  var nameEl = document.createElement("div");
  nameEl.className = "rw-head-name";
  nameEl.textContent = shopName;
  var subEl = document.createElement("div");
  subEl.className = "rw-head-sub";
  subEl.textContent = "Ask about designs & prices";
  headText.appendChild(nameEl);
  headText.appendChild(subEl);
  var closeBtn = document.createElement("button");
  closeBtn.className = "rw-close";
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close chat");
  head.appendChild(headText);
  head.appendChild(closeBtn);

  var msgs = document.createElement("div");
  msgs.className = "rw-msgs";

  var form = document.createElement("form");
  form.className = "rw-form";
  var input = document.createElement("input");
  input.className = "rw-input";
  input.type = "text";
  input.placeholder = "Ask about designs, prices, COD…";
  input.setAttribute("autocomplete", "off");
  var sendBtn = document.createElement("button");
  sendBtn.className = "rw-send";
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  form.appendChild(input);
  form.appendChild(sendBtn);

  panel.appendChild(head);
  panel.appendChild(msgs);
  panel.appendChild(form);
  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var opened = false;
  var busy = false;

  function addMsg(text, who) {
    var d = document.createElement("div");
    d.className = "rw-msg " + (who === "user" ? "rw-user" : "rw-bot");
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function addProducts(products) {
    if (!products || !products.length) return;
    var wrap = document.createElement("div");
    wrap.className = "rw-prods";
    products.forEach(function (p) {
      var a = document.createElement("a");
      a.className = "rw-prod";
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "↗ " + p.name + " — ₹" + p.price;
      wrap.appendChild(a);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function toggle(open) {
    var willOpen = typeof open === "boolean" ? open : !panel.classList.contains("rw-open");
    panel.classList.toggle("rw-open", willOpen);
    if (willOpen && !opened) {
      opened = true;
      addMsg("Hello, and welcome to " + shopName + "! Ask me about designs and prices — I answer from the shop's own catalogue.", "bot");
    }
    if (willOpen) input.focus();
  }

  fab.addEventListener("click", function () { toggle(); });
  closeBtn.addEventListener("click", function () { toggle(false); });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    addMsg(text, "user");
    var thinking = addMsg("…", "bot");
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: site, message: text })
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      thinking.textContent = (data && data.reply) || "Sorry, I didn't get that — please try again.";
      addProducts(data && data.products);
    }).catch(function () {
      thinking.textContent = "Sorry — something went wrong just now. Please try again in a moment.";
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
    });
  });
})();
