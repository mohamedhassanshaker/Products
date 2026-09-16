/* ============================================================
   NextBot Wireframes — Application engine (renderers, nav, stories)
   ============================================================ */
(function () {
  "use strict";

  var SCREENS = window.NEXTBOT_SCREENS || [];
  var STORIES = window.NEXTBOT_STORIES || [];

  var PORTALS = [
    { k: "CFG", name: "Bot — Agent Platform (B.15)", users: "Platform Engineer / Senior Admin" },
    { k: "C", name: "Bot — Conversation Designer (C)", users: "Conversation / Bot Designer" },
    { k: "LA", name: "Live Agent — Escalation & Bridge", users: "Human Escalation Agent / Admin" }
  ];

  /* ---------- state ---------- */
  var state = {
    mode: "browse",        // "browse" | "story"
    screen: SCREENS.length ? SCREENS[0].id : null,
    story: STORIES.length ? STORIES[0].id : null,
    storyStep: 0,
    filterText: "",
    onlyCritical: false,
    collapsed: {}
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function byId(id) {
    return SCREENS.find(function (s) { return s.id === id; });
  }
  function storyById(id) {
    return STORIES.find(function (s) { return s.id === id; });
  }
  function pill(c) {
    return '<span class="status-pill ' + c.pill + '">' + (c.dot ? '<span class="dot ' + c.pill + '"></span>' : "") + esc(c.t) + "</span>";
  }
  function sparkline(arr, cls) {
    var max = Math.max.apply(null, arr);
    return '<div class="sparkline">' + arr.map(function (v) {
      var h = Math.max(8, Math.round((v / max) * 24));
      return '<i style="height:' + h + 'px"></i>';
    }).join("") + "</div>";
  }
  function gauge(v) {
    var r = 40, c = 2 * Math.PI * r;
    var off = c * (1 - v / 100);
    return '<svg class="gauge" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="#e8ebf1" stroke-width="11"/>' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="#1b6b4a" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 50 50)"/>' +
      '<text x="50" y="57" text-anchor="middle" font-size="17" font-weight="800" fill="#1c2333">' + v + "%</text></svg>";
  }

  /* ---------- field renderer (for tabs/forms) ---------- */
  function renderField(f) {
    if (f.label && (f.ph || f.mask)) {
      var extra = f.readonly ? ' style="background:#f7f8fb"' : "";
      return '<div class="frow"><label>' + esc(f.label) + (f.req ? ' <span class="req">*</span>' : "") + "</label>" +
        '<div class="in' + (f.mask ? " mask" : "") + '" data-ph="' + esc(f.ph || "") + '"' + extra + "></div>" +
        (f.hint ? '<div class="hint">' + esc(f.hint) + "</div>" : "") + "</div>";
    }
    if (f.label && f.toggle !== undefined) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" +
        '<div style="display:flex;align-items:center;gap:8px"><div class="toggle' + (f.toggle ? "" : " off") + '"></div><span style="font-size:12px;color:var(--muted)">' + esc(f.t) + "</span></div></div>";
    }
    if (f.label && f.sel) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" +
        '<div class="sel" style="justify-content:space-between">' + esc(f.ph) + ' <span style="color:var(--faint)">▾</span></div></div>';
    }
    if (f.label && f.ta) {
      return '<div class="frow full"><label>' + esc(f.label) + "</label><textarea>" + esc(f.ph || "") + "</textarea></div>";
    }
    if (f.label && f.pill) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" + pill({ pill: f.pill, t: f.pt || "" }) + "</div>";
    }
    if (f.label && f.color) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" +
        '<div style="display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;border-radius:6px;border:1px solid #d7dce5;background:' + esc(f.color) + '"></span><span style="font-size:12px;font-family:var(--mono)">' + esc(f.color) + "</span></div></div>";
    }
    if (f.label && f.env) {
      return '<div class="frow"><label>' + esc(f.label) + "</label><span class='status-pill b'>" + esc(f.env) + " · ADM-05</span></div>";
    }
    if (f.label && f.tier !== undefined) {
      var n = f.tier;
      var blocks = "";
      for (var i = 1; i <= 4; i++) {
        blocks += '<span style="display:inline-block;width:34px;height:10px;border-radius:3px;margin-right:4px;background:' + (i <= n ? "#1b6b4a" : "#e8ebf1") + '"></span>';
      }
      return '<div class="frow"><label>' + esc(f.label) + "</label><div>" + blocks + '<span style="font-size:11px;color:var(--muted);margin-left:4px">Tier ' + n + " of 4</span></div></div>";
    }
    if (f.label && f.slider !== undefined) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" +
        '<input type="range" min="0" max="100" value="' + f.slider + '" style="width:100%"></div>';
    }
    if (f.label && f.qr) {
      return '<div class="frow"><label>' + esc(f.label) + "</label>" +
        '<div style="width:88px;height:88px;border:1px dashed #c9cfdb;border-radius:8px;background:repeating-conic-gradient(#2a2f3a 0% 25%, #fff 0% 50%) 0 0/14px 14px;"></div></div>';
    }
    if (f.label && f.list) {
      var lis = (f.list || []).map(function (li) { return '<div style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--border-soft)">' + esc(li) + "</div>"; }).join("");
      return '<div class="frow full"><label>' + esc(f.label) + "</label><div>" + lis +
        (f.note ? '<div class="hint">' + esc(f.note) + "</div>" : "") + "</div></div>";
    }
    if (f.btn) {
      return '<div class="frow"><div style="display:flex;gap:8px">' +
        '<button class="btn' + (f.bl ? " pri" : "") + (f.danger ? " danger" : "") + '">' + esc(f.btn) + "</button></div></div>";
    }
    if (f.note) {
      return '<div class="frow full"><div style="font-size:12.5px;color:var(--muted);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:8px;padding:10px;line-height:1.5">' + esc(f.note) + "</div></div>";
    }
    return "";
  }

  function renderTableData(t) {
    if (!t) return "";
    var h = "<thead><tr>" + t.cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead>";
    var b = t.rows.map(function (r) {
      return "<tr>" + r.map(function (c) {
        if (typeof c === "string") return "<td>" + esc(c) + "</td>";
        if (c.pill) return "<td>" + pill(c) + "</td>";
        if (c.m) return '<td><span class="cell-main">' + esc(c.m) + '</span><span class="cell-sub">' + esc(c.s || "") + "</span></td>";
        if (c.mono) return '<td><span class="mono">' + esc(c.mono) + "</span></td>";
        if (Array.isArray(c)) return "<td>" + c.map(function (a) {
          if (a.btn) return '<button class="btn sm">' + esc(a.btn) + "</button>";
          if (a.link) return '<button class="btn sm ghost">' + esc(a.link) + "</button>";
          return "";
        }).join(" ") + "</td>";
        return "<td></td>";
      }).join("") + "</tr>";
    }).join("");
    var foot = t.action ? '<div style="padding:9px 12px;border-top:1px solid var(--border-soft);font-size:11.5px;color:var(--blue);font-weight:600">' + esc(t.action) + "</div>" : "";
    return '<div class="wtbl-wrap"><table class="wtbl">' + h + "<tbody>" + b + "</tbody></table>" + foot + "</div>";
  }

  function renderTest(t) {
    if (!t) return "";
    return '<div style="border:1px solid var(--border-soft);border-radius:10px;background:#fff;padding:14px">' +
      '<div class="section-label">Test console</div>' +
      '<div class="frow"><label>Tool</label><div class="in" data-ph="' + esc(t.tool) + '"></div></div>' +
      '<div class="frow" style="margin-top:8px"><label>Sample args (JSON)</label><div class="json-tree" style="font-size:11px">' + esc(t.args) + "</div></div>" +
      '<button class="btn blue" style="margin-top:10px">Execute</button>' +
      (t.result ? '<div style="margin-top:10px" class="section-label">Response</div><div class="json-tree" style="font-size:11px">' + esc(t.result) + "</div>" : "") +
      (t.e2e ? '<div style="margin-top:10px" class="section-label">End-to-end simulation</div><div class="json-tree" style="font-size:11px">message → goal recognition → tool selection → payload from schema → tool call → AI response</div>' : "") +
      "</div>";
  }

  /* ---------- widget chat message renderer ---------- */
  function renderMsg(m) {
    switch (m.t) {
      case "sys":
        return '<div class="msg system"><div class="bubble">' + esc(m.text) + "</div></div>";
      case "ai": {
        var tone = m.tone === "error" ? ' style="background:#fde8e8;border-color:#f3c1c1;color:#7a1f1f"' : "";
        return '<div class="msg ai"><div class="ava">N</div><div><div class="bubble" style="max-width:100%"' + tone + ">" + inline(m.text) + "</div></div></div>";
      }
      case "cust":
        return '<div class="msg customer"><div><div class="bubble">' + esc(m.text) + "</div>" +
          (m.ticks ? '<div class="ticks">' + esc(m.ticks) + "</div>" : "") + "</div></div>";
      case "typing":
        return '<div class="msg ai"><div class="ava">N</div><div class="bubble" style="padding:10px 12px"><span class="typing"><i></i><i></i><i></i></span></div></div>';
      case "agent":
        return '<div class="msg ai"><div class="ava" style="background:var(--violet)">S</div><div><div style="font-size:10px;color:var(--violet);font-weight:700;margin:0 4px 2px">' + esc(m.name) + "</div><div class='bubble' style='background:#f5f1fb;border:1px solid #e5d4f8'>" + esc(m.text) + "</div></div></div>";
      case "queue":
        return '<div class="msg system"><div class="bubble">You are <b>#' + m.pos + '</b> in the queue <span class="queue-dots"><i></i><i></i><i></i></span></div></div>';
      case "chips": {
        var items = m.items.map(function (c) {
          return '<button class="chip" data-used="' + (c.u ? "1" : "0") + '">' + esc(c.l) + "</button>";
        }).join("");
        return '<div class="msg"><div style="display:flex;flex-wrap:wrap;gap:6px;padding-left:31px">' + items + "</div>" +
          (m.note ? '<div style="font-size:10px;color:var(--faint);padding-left:31px;margin-top:4px">' + esc(m.note) + "</div>" : "") + "</div>";
      }
      case "list": {
        var rows = m.items.map(function (it) {
          return '<div class="row"><div class="lic">' + esc(it.ic) + '</div><div class="li"><div class="lt">' + esc(it.label) + '</div><div class="ls">' + esc(it.sub || "") + '</div></div><button class="btn sm" data-select="1">Select</button></div>';
        }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><span class="brand-logo">▤</span><div><div class="ic-title">' + esc(m.title || "Please select") + '</div><div class="ic-sub">' + esc(m.sub || "") + "</div></div></div>" +
          '<div class="ic-body"><div class="ic-list">' + (m.search ? '<div class="search-mini">⌕ Search…</div>' : "") + rows + "</div></div></div></div>";
      }
      case "link":
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><span class="brand-logo">' + esc(m.brand) + '</span><div><div class="ic-title">' + esc(m.title) + '</div><div class="ic-sub">' + esc(m.desc) + " <b>" + esc(m.amount || "") + "</b></div></div></div>" +
          '<div class="ic-body" style="padding:0"><button class="btn pri block" style="border-radius:0">' + esc(m.btn) + "</button></div>" +
          '<div class="ic-body" style="padding:8px 11px;font-size:10.5px;color:var(--faint)">You\'ll be redirected to <b style="color:var(--muted)">' + esc(m.domain) + "</b>.</div>" +
          (m.follow ? '<div class="ic-foot"><span style="font-size:11px;color:var(--muted)">Done? </span><button class="chip">Check Status</button></div>' : "") +
          "</div></div>";
      case "file":
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-body" style="display:flex;align-items:center;gap:10px"><div class="lic" style="width:32px;height:32px;border-radius:8px;background:var(--red-soft);color:var(--red);display:grid;place-items:center;font-size:13px">▤</div>' +
          '<div style="flex:1"><div style="font-size:12.5px;font-weight:700">' + esc(m.name) + '</div><div style="font-size:11px;color:var(--muted)">' + esc(m.size) + "</div></div>" +
          '<button class="btn sm pri">Download</button></div></div></div>';
      case "dcard":
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><span class="brand-logo">$</span><div><div class="ic-title">' + esc(m.title) + '</div><div class="ic-sub">' + esc(m.ts || "") + "</div></div></div>" +
          '<div class="ic-body"><div class="dataval">' + esc(m.value) + "</div><dl class='kv'>" +
          m.fields.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl></div></div></div>";
      case "dtable": {
        var th = m.cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
        var tr = m.rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return i === r.length - 1 ? '<td class="amt">' + esc(c) + "</td>" : "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><div><div class="ic-title">' + esc(m.title) + "</div></div></div>" +
          '<div class="ic-body" style="padding:0;overflow-x:auto"><table class="ic-tbl"><thead><tr>' + th + "</tr></thead><tbody>" + tr + "</tbody></table></div>" +
          (m.more ? '<div class="ic-foot"><button class="btn sm ghost" style="margin-left:auto">Show more →</button></div>' : "") + "</div></div>";
      }
      case "form": {
        var flds = m.fields.map(function (f, i) {
          if (f.sel) {
            return '<div class="fld"><label>' + esc(f.label) + (f.req ? ' <span class="req">*</span>' : "") + '</label><div class="in" data-ph="' + esc(f.ph) + '" style="justify-content:space-between"><span></span><span style="color:var(--faint)">▾</span></div></div>';
          }
          var cls = f.err ? " in err" : " in" + (f.ta ? " ta" : "");
          return '<div class="fld"><label>' + esc(f.label) + (f.req ? ' <span class="req">*</span>' : "") + '</label><div class="' + cls + '" data-ph="' + esc(f.ph || "") + '"></div>' +
            (f.err ? '<div class="fmsg">' + esc(f.err) + "</div>" : "") + "</div>";
        }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><div><div class="ic-title">' + esc(m.title || "Provide details") + "</div></div></div>" +
          '<div class="ic-body">' + flds + "</div><div class='ic-foot'><button class='btn pri block'>" + esc(m.submit || "Submit") + "</button></div></div></div>";
      }
      case "otp": {
        var boxes = "";
        for (var i = 0; i < 6; i++) {
          boxes += '<div class="d' + (i < 4 ? " filled" : "") + '">' + (i < 4 ? esc(m.boxes.charAt(i)) : "") + "</div>";
        }
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><div><div class="ic-title">Verify your identity</div></div></div>' +
          '<div class="ic-body"><div style="font-size:11.5px;color:var(--muted);margin-bottom:8px">' + esc(m.sub) + "</div>" +
          '<div class="otp-box">' + boxes + "</div>" +
          '<div class="otp-timer" style="margin-top:8px">' + esc(m.timer) + '</div>' +
          (m.error ? '<div style="margin-top:8px;font-size:11px;color:var(--red);background:var(--red-soft);border-radius:6px;padding:6px 8px">' + esc(m.error) + "</div>" : "") +
          "</div><div class='ic-foot'><button class='btn pri'>Verify</button><button class='btn sm ghost'>Use backup code</button></div></div></div>";
      }
      case "confirm": {
        var kv = m.rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><span class="brand-logo" style="background:var(--amber-soft);color:var(--amber)">!</span><div><div class="ic-title">' + esc(m.title || "Confirm action") + "</div></div></div>" +
          '<div class="ic-body"><dl class="kv" style="grid-template-columns:1fr auto">' + kv + "</dl>" +
          '<div style="margin-top:8px;font-size:10.5px;color:var(--faint)">' + esc(m.disclaimer) + "</div></div>" +
          "<div class='ic-foot'><button class='btn pri'>Confirm</button><button class='btn sm'>Cancel</button></div></div></div>";
      }
      case "ticket": {
        var kv2 = m.rows.map(function (r) {
          var val = esc(r[1]) + (r[2] ? ' <button class="btn xs ghost" style="margin-left:4px">Copy</button>' : "");
          return "<dt>" + esc(r[0]) + "</dt><dd>" + val + "</dd>";
        }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><span class="brand-logo" style="background:var(--brand-soft);color:var(--brand)">✓</span><div><div class="ic-title">Case Created</div></div></div>' +
          '<div class="ic-body"><dl class="kv" style="grid-template-columns:1fr auto">' + kv2 + "</dl></div>" +
          '<div class="ic-foot">' + m.chips.map(function (c) { return '<button class="chip">' + esc(c.l) + "</button>"; }).join("") + "</div></div></div>";
      }
      case "status": {
        var steps = ["Open", "In Progress", "Resolved", "Closed"];
        var stepper = steps.map(function (s, i) {
          var cls = i < m.step ? "done" : (i === m.step ? "cur" : "");
          return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">' +
            '<div style="width:18px;height:18px;border-radius:50%;background:' + (i <= m.step ? "#1b6b4a" : "#e8ebf1") + ';color:#fff;display:grid;place-items:center;font-size:9px;font-weight:700">' + (i < m.step ? "✓" : i + 1) + "</div>" +
            '<span style="font-size:9px;color:var(--muted)">' + s + "</span></div>";
        }).join("");
        var kv3 = m.rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-head"><div><div class="ic-title mono">' + esc(m.num) + '</div><div class="ic-sub"><span class="status-pill a">' + esc(m.status) + "</span></div></div></div>" +
          '<div class="ic-body"><div style="display:flex;margin:4px 0 12px">' + stepper + "</div><dl class='kv' style='grid-template-columns:1fr auto'>" + kv3 + "</dl></div></div></div>";
      }
      case "upload": {
        var prog = '<div class="prog"><i style="width:' + m.progress + '%"></i></div>';
        return '<div class="msg customer"><div class="icard" style="max-width:82%"><div class="ic-body" style="display:flex;align-items:center;gap:10px"><div class="lic" style="width:30px;height:30px;border-radius:8px;background:var(--blue-soft);color:var(--blue);display:grid;place-items:center">▤</div>' +
          '<div style="flex:1"><div style="font-size:12px;font-weight:700">' + esc(m.name) + ' · ' + esc(m.size) + "</div>" +
          (m.progress < 100 ? prog : '<div style="font-size:10.5px;color:var(--brand);margin-top:2px">✓ ' + esc(m.note) + "</div>") +
          (m.done ? '<div style="font-size:10.5px;color:var(--brand);margin-top:2px">✓ ' + esc(m.note) + "</div>" : "") +
          "</div></div></div></div>";
      }
      case "survey":
        return '<div class="msg ai"><div class="ava">N</div><div class="icard" style="max-width:100%"><div class="ic-body"><div style="font-size:13px;font-weight:700;margin-bottom:8px">How was your experience?</div>' +
          '<div style="display:flex;gap:4px;margin-bottom:8px">' + "★★★★★".split("").map(function (s, i) { return '<span style="font-size:18px;color:' + (i < m.stars ? "#f59e0b" : "#d7dce5") + '">' + s + "</span>"; }).join("") + "</div>" +
          '<div class="in ta" data-ph="' + esc(m.comment || "Optional comment…") + '"></div></div>' +
          '<div class="ic-foot"><button class="btn pri sm">Send</button><button class="btn sm ghost">Skip</button></div></div></div>';
    }
    return "";
  }

  /* inline markdown-ish: **bold** and [links] */
  function inline(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }

  /* ---------- widget frame ---------- */
  function widgetFrame(data, bodyHtml, foot, opts) {
    opts = opts || {};
    var head = '<div class="widget-head"><div class="ava">N</div><div class="tt">Support Assistant</div>' +
      '<div class="mini"><span title="Language">A</span><span title="Minimize">–</span><span title="Close">✕</span></div></div>';
    var modeBar = "";
    if (opts.modes) {
      modeBar = '<div class="widget-modes">' +
        '<button data-wmode="chat" data-wkey="' + esc(opts.wkey || "") + '" class="' + (opts.active === "chat" ? "active" : "") + '">✎ Chat</button>' +
        '<button data-wmode="menu" data-wkey="' + esc(opts.wkey || "") + '" class="' + (opts.active === "menu" ? "active" : "") + '">☰ Menu</button></div>';
    }
    var quick = (opts.active !== "menu") && data.quick && data.quick.length
      ? '<div class="widget-quick">' + data.quick.map(function (q) { return '<button class="chip">' + esc(q) + "</button>"; }).join("") + "</div>" : "";
    var f = foot === false ? "" : '<div class="widget-foot"><button class="ibtn">⌁</button><div class="input">Type a message…</div><button class="send">➤</button><button class="ibtn">🎤</button></div>';
    return '<div class="phone' + (data.sm ? " sm" : "") + '" data-wkey="' + esc(opts.wkey || "") + '">' + head + modeBar + quick + '<div class="widget-body">' + bodyHtml + "</div>" + f + "</div>";
  }

  function widgetStage(inner) {
    return '<div style="background:#dde2ea;border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;justify-content:center">' + inner + "</div>";
  }

  /* chat vs. menu bodies */
  function chatBodyFor(d) {
    if (d.welcome && !d.messages) return renderWelcomeBody(d);
    return (d.messages || []).map(renderMsg).join("");
  }
  function menuBodyHTML(level, crumb) {
    var crumbs = (crumb || []).map(function (c, i) {
      return '<span class="sep">▸</span><span class="part" data-crumb="' + i + '">' + esc(c) + "</span>";
    }).join("");
    var rows = (level || []).map(function (n, i) {
      return '<div class="menu-row" data-menuselect="1" data-kind="' + (n.sub ? "sub" : "intent") + '" data-i="' + i + '">' +
        '<span class="menu-ic">' + esc(n.ic || "·") + '</span><span class="menu-lb">' + esc(n.label) +
        (n.hint ? '<span class="menu-hint">' + esc(n.hint) + "</span>" : "") +
        '</span><span class="menu-go">' + (n.sub ? "▸" : "→") + "</span></div>";
    }).join("");
    return '<div class="menu-pad">' +
      '<div class="menu-crumb"><span class="home" data-menuhome="1">Home</span>' + crumbs + "</div>" +
      '<div class="menu-search">⌕ Search menu or type a question…</div>' +
      '<div class="menu-list">' + (rows || '<div class="empty-hint">No options</div>') + "</div>" +
      '<div class="menu-tip">Tip: you can also type your question freely in the input below — no need to browse the menu.</div>' +
      "</div>";
  }
  function buildWidget(d, active) {
    window.__WK = window.__WK || {};
    var wkey = d.wkey || d.id || "";
    var chatHtml = chatBodyFor(d);
    var rec = window.__WK[wkey];
    if (!rec) {
      rec = window.__WK[wkey] = {
        menu: d.menu || null,
        welcomeBody: d.welcome ? renderWelcomeBody(d) : "",
        chatHtml: chatHtml,
        level: null, stack: [], crumb: []
      };
      rec.level = rec.menu ? rec.menu.slice() : null;
    } else {
      rec.chatHtml = chatHtml;
    }
    var menuHtml = rec.menu ? menuBodyHTML(rec.menu, []) : rec.welcomeBody;
    var body = (active === "menu" && menuHtml) ? menuHtml : chatHtml;
    return widgetFrame(d, body, d.welcome ? false : undefined, { modes: !!d.modes, active: active, wkey: wkey });
  }

  /* ---------- main render dispatch ---------- */
  function renderScreen(s) {
    var html = "";
    switch (s.type) {
      case "launcher": html = renderLauncher(s.data); break;
      case "widget": html = renderWidget(s.data); break;
      case "welcome": html = renderWelcome(s.data); break;
      case "modal": html = renderModal(s.data); break;
      case "chat": html = renderChat(s.data); break;
      case "code": html = renderCodeScreen(s.data); break;
      case "shell": html = renderShell(s.data); break;
      case "dashboard": html = renderDashboard(s.data); break;
      case "table": html = renderTable(s.data); break;
      case "tabs": html = renderTabs(s.data); break;
      case "wizard": html = renderWizard(s.data); break;
      case "queue": html = renderQueue(s.data); break;
      case "matrix": html = renderMatrix(s.data); break;
      case "workflow": html = renderWorkflow(s.data); break;
      case "health": html = renderHealth(s.data); break;
      case "schema": html = renderSchema(s.data); break;
      case "report": html = renderReport(s.data); break;
      case "login": html = renderLogin(s.data); break;
      case "trace": html = renderTrace(s.data); break;
      default: html = '<div class="empty-hint">Wireframe renderer not defined for: ' + esc(s.type) + "</div>";
    }
    return '<div class="canvas"><div class="wframe-wrap"><div class="wframe"><div class="wframe-stage">' + html + "</div></div></div>" + specPanel(s) + "</div>";
  }

  function renderLauncher(d) {
    var page = '<div class="chrome-host"><div class="page">' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:14px"><span style="width:10px;height:10px;border-radius:50%;background:#f87171"></span><span style="width:10px;height:10px;border-radius:50%;background:#fbbf24"></span><span style="width:10px;height:10px;border-radius:50%;background:#34d399"></span>' +
      '<span style="margin-left:8px;font-size:11px;color:var(--faint)">' + esc(d.hostTitle) + "</span></div>" +
      d.hostLines.map(function (w) { return '<div class="skel" style="width:' + w + '%;margin-bottom:10px"></div>'; }).join("") +
      '<div class="ph" style="height:120px;margin-top:8px">Host website content</div>' +
      '<div class="launcher' + (d.nudge ? "" : " pulse") + '">' +
      (d.nudge ? '<div class="bubble-tip">' + esc(d.nudge.text) + '<div style="text-align:right;margin-top:2px"><button class="btn xs ghost">✕</button></div></div>' : "") +
      '<div class="btn">✆</div>' +
      (d.nudge ? "" : '<span class="badge" style="position:absolute;top:-4px;right:-4px">2</span>') +
      "</div></div></div>";
    return page;
  }

  function renderWidget(d) {
    var active = d.modes && d.active === "menu" ? "menu" : "chat";
    return widgetStage(buildWidget(d, active));
  }

  function renderWelcome(d) {
    var active = d.active === "menu" ? "menu" : "chat";
    return widgetStage(buildWidget(d, active));
  }

  function renderWelcomeBody(d) {
    var cards = d.cards.map(function (c) {
      return '<div class="service-card"><div class="ic ' + c.ic + '">' + esc(c.g) + '</div><div class="lb">' + esc(c.label) + '</div><div class="sb">' + esc(c.sub) + "</div></div>";
    }).join("");
    var recent = d.recent ? '<div class="recent-card"><div class="rt">Recent conversation</div><div class="rm">' + esc(d.recent.txt) + '</div><div class="rl">' + esc(d.recent.link) + " →</div></div>" : "";
    return '<div class="welcome-pad"><div class="greet">' + esc(d.greeting) + '</div><div class="sub">' + esc(d.sub || "") + "</div>" +
      '<div class="service-grid">' + cards + "</div>" +
      '<div class="welcome-search">⌕ Ask me anything…</div>' + recent + "</div>";
  }

  function renderModal(d) {
    var inner = "";
    if (d.voice) {
      var bars = "";
      for (var i = 0; i < 18; i++) { bars += '<i style="animation-delay:' + (i * 0.06) + 's"></i>'; }
      inner = '<div class="overlay-back"><div class="overlay-sheet">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="font-size:13px;font-weight:700">Voice mode</div><button class="btn sm danger">Stop</button></div>' +
        '<div class="voice-vis">' + bars + "</div>" +
        '<div style="font-size:10.5px;color:var(--muted);text-align:center;margin:6px 0 10px">Listening…</div>' +
        '<div class="msg ai"><div class="ava">N</div><div class="bubble" style="max-width:100%">' + esc(d.voice.transcript) + ' <span style="color:var(--faint)">▏</span></div></div>' +
        '<div style="display:flex;gap:6px;margin-top:10px"><button class="btn pri sm" style="flex:1">Send</button><button class="btn sm" style="flex:1">Edit</button></div>' +
        "</div></div>";
    } else if (d.lang) {
      var lc = d.lang.map(function (l, i) {
        return '<div class="lang-card' + (i === 0 ? " sel" : "") + '"><div style="font-size:9px;color:var(--faint)">' + esc(l.code) + '</div>' + esc(l.label) + "</div>";
      }).join("");
      inner = '<div class="overlay-back"><div class="overlay-sheet">' +
        '<div style="font-size:13px;font-weight:700;margin-bottom:10px">' + esc(d.title || "Choose your language") + "</div>" +
        (d.auto ? '<div class="detect-banner"><span>We detected your language as <b>English</b>. Continue?</span><button class="btn sm pri">Yes</button></div>' : "") +
        '<div class="lang-grid">' + lc + "</div></div></div>";
    }
    return '<div style="position:relative;background:#dde2ea;border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;justify-content:center;min-height:440px">' +
      widgetFrame({}, '<div class="msg ai"><div class="ava">N</div><div class="bubble">' + (d.voice ? "Say something — I'm listening." : "Pick a language to continue.") + "</div></div>", false) + inner + "</div>";
  }

  function renderChat(d) {
    var active = d.modes && d.active === "menu" ? "menu" : "chat";
    return widgetStage(buildWidget(d, active));
  }

  function renderCodeScreen(d) {
    return '<div><div class="section-label">' + esc(d.title || "") + "</div><div class='code-block'>" + esc(d.code) + "</div></div>";
  }

  /* ---------- admin renderers ---------- */
  function renderShell(d) {
    var side = d.side.map(function (it) {
      return '<div class="si' + (it.act ? " act" : "") + '">' + (it.l.length > 18 ? "▪" : "·") + " " + esc(it.l) + "</div>";
    }).join("");
    return '<div class="shell"><div class="shell-side"><div class="logo2"><i>N</i>NextBot</div>' + side + "</div>" +
      '<div class="shell-main"><div class="shell-top"><span class="env">SANDBOX</span><div class="q">⌕ Global search…</div><div style="margin-left:auto;display:flex;gap:12px;align-items:center"><span style="font-size:12px">🔔</span><span style="width:22px;height:22px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:10px">AR</span></div></div>' +
      '<div class="shell-body"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + esc(d.breadcrumb) + "</div>" +
      '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;height:100%;display:grid;place-items:center;color:var(--faint);font-size:13px">Content area — see individual screens</div></div></div></div>';
  }

  function renderDashboard(d) {
    var kpis = d.kpis.map(function (k) {
      var vis = "";
      if (k.spark) vis = sparkline(k.spark);
      else if (k.gauge) vis = gauge(k.gauge);
      else if (k.gauge === null && k.t === "Pending approvals") vis = '<div style="width:34px;height:34px;border-radius:50%;background:var(--amber-soft);color:var(--amber);display:grid;place-items:center;font-weight:800">' + esc(k.v) + "</div>";
      return '<div class="kpi"><div class="kt">' + esc(k.t) + '</div><div style="display:flex;align-items:center;gap:12px"><div class="kv" style="margin:2px 0">' + esc(k.v) + '</div>' + (vis || "") + '</div><div class="ks">' + k.s + "</div></div>";
    }).join("");

    var charts = d.charts.map(function (c) {
      var body = "";
      if (c.donut) {
        var seg = c.donut.map(function (s) { return '<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:' + (s[1] > 30 ? "#1b6b4a" : s[1] > 15 ? "#2563eb" : "#d7dce5") + '"></span>' + esc(s[0]) + ' <b>' + s[1] + "%</b></div>"; }).join("");
        body = '<div style="display:flex;align-items:center;gap:16px"><div class="donut"></div><div style="display:flex;flex-direction:column;gap:5px;font-size:11.5px">' + seg + "</div></div>";
      } else if (c.tbl) {
        body = renderTableData(c.tbl);
      } else if (c.kpi) {
        body = '<div style="display:flex;align-items:baseline;gap:10px"><div style="font-size:30px;font-weight:800;color:var(--brand)">' + esc(c.kpi.v) + '</div><div style="font-size:12px;color:var(--muted)">' + c.kpi.s + "</div></div>";
      }
      return '<div class="chart-card"><h5>' + esc(c.title) + '</h5><div class="cs">' + esc(c.sub) + "</div>" + body + "</div>";
    }).join("");

    var conns = d.connectors.map(function (c) {
      return '<div class="kpi" style="cursor:pointer"><div class="kt" style="display:flex;align-items:center;gap:6px"><span class="dot ' + c.st + '"></span>' + esc(c.n) + '</div><div class="kv" style="font-size:17px">' + c.tools + ' tools</div><div class="ks">' + esc(c.check) + "</div></div>";
    }).join("");

    var alerts = d.alerts.map(function (a) {
      return '<div class="alert-row ' + a.sev + '"><span class="dot ' + a.sev + '"></span><div style="flex:1">' + esc(a.text) + '</div><span class="at">' + esc(a.at) + "</span></div>";
    }).join("");

    return '<div class="kpi-grid">' + kpis + "</div>" +
      '<div class="grid-2" style="margin-top:14px">' + charts + "</div>" +
      '<div class="section-label" style="margin-top:20px">Connected backends (MCP)</div><div class="kpi-grid">' + conns + "</div>" +
      '<div class="section-label" style="margin-top:20px">Recent alerts</div>' + alerts +
      '<div style="text-align:right;margin-top:6px"><button class="btn sm ghost">View all →</button></div>';
  }

  function renderTable(d) {
    var filter = d.filter ? '<div class="filterbar">' + d.filter.map(function (f) {
      return '<span class="f">' + esc(f) + " <b>▾</b></span>";
    }).join("") + '<span class="spacer"></span>' + (d.actionBtn ? '<button class="btn sm pri">' + esc(d.actionBtn) + "</button>" : "") + "</div>" : "";
    var bulk = d.bulk ? '<div style="margin-top:10px;display:flex;gap:6px;align-items:center"><span style="font-size:11.5px;color:var(--muted)">Bulk:</span>' + d.bulk.split("·").map(function (b) { return '<button class="btn sm">' + esc(b.trim()) + "</button>"; }).join("") + "</div>" : "";
    var test = d.testPanel ? '<div style="margin-top:14px;border:1px dashed var(--border);border-radius:10px;padding:14px;background:#fff"><div class="section-label">Test a scenario</div>' +
      '<div style="display:flex;gap:8px;align-items:center"><span class="f">Channel: <b>Web Widget ▾</b></span><span class="f">Utterance: “I want a refund”</span><button class="btn sm pri">Run</button></div>' +
      '<div style="margin-top:10px;font-size:12px;color:var(--muted)">→ Rule 1 fires: <b>task = payment_dispute</b> → <b>Redirect to queue</b></div></div>' : "";
    var fallback = d.fallback ? '<div class="alert-row a" style="margin-top:10px"><span class="dot a"></span>' + esc(d.fallback) + "</div>" : "";
    return filter + renderTableData({ cols: d.cols, rows: d.rows, action: d.actionBtn ? null : null }) + bulk + fallback + test;
  }

  function renderTabs(d) {
    var nav = d.tabs.map(function (t, i) {
      return '<div class="tab' + (i === 0 ? " active" : "") + '" data-tab="' + i + '">' + esc(t.name) + "</div>";
    }).join("");
    var bodies = d.tabs.map(function (t, i) {
      var inner = "";
      if (t.fields) {
        inner = '<div class="form-grid' + (t.fields.length < 2 ? " one" : "") + '">' + t.fields.map(renderField).join("") + "</div>";
      }
      if (t.tbl) {
        inner = '<div style="max-width:100%;overflow-x:auto">' + renderTableData(t.tbl) + "</div>";
      }
      if (t.note) inner = '<div style="font-size:12.5px;color:var(--muted);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:8px;padding:12px;line-height:1.6">' + esc(t.note) + "</div>";
      if (t.json) inner = '<div class="json-tree">' + esc(t.json) + "</div>";
      if (t.code) inner = '<div class="code-block">' + esc(t.code) + "</div>";
      if (t.nodes) inner = '<div style="display:flex;gap:6px;flex-wrap:wrap">' + t.nodes.split("→").map(function (n) { return '<button class="chip gray">' + esc(n.trim()) + "</button>"; }).join('<span style="color:var(--faint)">→</span>') + "</div>";
      if (t.matrix) inner = '<div style="font-size:12.5px;color:var(--muted);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:8px;padding:12px">' + esc(t.matrix) + "</div>";
      if (t.suggest) {
        inner = t.suggest.map(function (su) {
          return '<div style="border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--brand-soft)"><div style="font-size:13px;font-weight:700;color:var(--brand)">' + esc(su.n) + ' <span style="font-weight:400;color:var(--muted)">· ' + su.occ + " unhandled</span></div>" +
            '<div style="font-size:12px;color:var(--muted);margin:4px 0 8px">' + esc(su.reason) + "</div>" +
            su.accept.map(function (a) { return '<button class="btn sm">' + esc(a) + "</button>"; }).join(" ") + "</div>";
        }).join("");
      }
      if (t.embed) {
        inner = '<div class="code-block">' + esc('<script src="https://cdn.nextbot.example/widget.js"></script>\n<script>\n  NextBot.init({ tenantId: "your-tenant-id", ... });\n</script>') + '</div><button class="btn sm" style="margin-top:10px">Copy embed code</button>';
      }
      return '<div class="tabbody" data-tabbody="' + i + '"' + (i === 0 ? "" : ' style="display:none"') + ">" + inner + "</div>";
    }).join("");
    return '<div class="tabs">' + nav + "</div>" + bodies;
  }

  function renderWizard(d) {
    var steps = d.steps.map(function (st, i) {
      return '<div class="step' + (i === 0 ? " cur" : "") + '" data-step="' + i + '"><span class="num">' + (i + 1) + "</span>" + esc(st.name) + "</div>" +
        (i < d.steps.length - 1 ? '<div class="conn"></div>' : "");
    }).join("");
    var bodies = d.steps.map(function (st, i) {
      var inner = "";
      if (st.tpl) {
        inner = '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">' + st.tpl.map(function (t) {
          return '<div class="kpi" style="cursor:pointer;text-align:center"><div style="width:34px;height:34px;border-radius:9px;margin:0 auto 8px;background:' + (t.custom ? "var(--amber-soft)" : "var(--blue-soft)") + ';color:' + (t.custom ? "var(--amber)" : "var(--blue)") + ';display:grid;place-items:center;font-weight:800;font-size:13px">' + esc(t.logo) + "</div>" +
            '<div style="font-size:13px;font-weight:700">' + esc(t.n) + '</div><div style="font-size:10.5px;color:var(--faint)">' + esc(t.type) + ' · ' + esc(t.tools) + '</div><div style="font-size:11px;color:var(--muted);margin-top:5px">' + esc(t.d) + "</div></div>";
        }).join("") + "</div>";
      }
      if (st.fields) inner = '<div class="form-grid one">' + st.fields.map(renderField).join("") + "</div>";
      if (st.discover) {
        inner = '<div class="section-label">Tools discovered via list_tools</div>' + st.tools.map(function (t) {
          return '<div style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border-soft);border-radius:8px;padding:9px 11px;margin-bottom:6px">' +
            '<input type="checkbox" style="accent-color:var(--brand)"' + (t.on ? " checked" : "") + ">" +
            '<div style="flex:1"><div style="font-size:12.5px;font-weight:700;font-family:var(--mono)">' + esc(t.n) + '</div><div style="font-size:11px;color:var(--muted)">' + esc(t.d) + "</div></div>" +
            '<span class="status-pill ' + (t.rw === "Write" ? "a" : "g") + '">' + esc(t.rw) + "</span></div>";
        }).join("") + '<button class="btn sm pri" style="margin-top:8px">Discover</button>';
      }
      if (st.note) inner = '<div style="font-size:12.5px;color:var(--muted);background:var(--panel-2);border:1px solid var(--border-soft);border-radius:8px;padding:12px;line-height:1.6">' + esc(st.note) + "</div>";
      if (st.tbl) inner = renderTableData(st.tbl);
      if (st.test) inner = renderTest(st.test);
      if (st.code) inner = '<div class="code-block">' + esc(st.code) + "</div>";
      if (st.source) {
        inner = st.source.map(function (s2, j) {
          return '<div style="display:flex;gap:10px;align-items:flex-start;background:' + (j === st.sel ? "var(--brand-soft)" : "#fff") + ';border:1px solid ' + (j === st.sel ? "var(--brand-line)" : "var(--border-soft)") + ';border-radius:8px;padding:10px 12px;margin-bottom:6px"><input type="radio" style="accent-color:var(--brand)"' + (j === st.sel ? " checked" : "") + ">" +
            '<div><div style="font-size:12.5px;font-weight:700">' + esc(s2.t) + '</div><div style="font-size:11.5px;color:var(--muted)">' + esc(s2.d) + "</div></div></div>";
        }).join("");
      }
      if (st.summary) {
        inner = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px">' + st.summary.map(function (s3) { return '<div style="padding:6px 0;border-bottom:1px dashed var(--border-soft);font-size:12.5px">' + esc(s3) + "</div>"; }).join("") + "</div>";
      }
      if (st.activate) {
        if (st.summary) inner += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">' + st.summary.map(function (s3) { return '<div style="padding:6px 0;border-bottom:1px dashed var(--border-soft);font-size:12.5px">' + esc(s3) + "</div>"; }).join("") + "</div>";
        inner += '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn pri">Activate</button><button class="btn">Back</button></div>';
      }
      return '<div data-stepbody="' + i + '"' + (i === 0 ? "" : ' style="display:none"') + ">" + inner + "</div>";
    }).join("");
    return '<div class="steps">' + steps + "</div>" + bodies;
  }

  function renderQueue(d) {
    var tbl = renderTableData({ cols: d.cols, rows: d.rows });
    var det = "";
    if (d.detail) {
      det = '<div style="margin-top:14px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px"><div class="section-label">Approval detail</div>' +
        '<div style="font-size:13px;font-weight:700;font-family:var(--mono)">' + esc(d.detail.tool) + "</div>" +
        '<div style="font-size:11.5px;color:var(--muted);margin:4px 0">Goal: <b>' + esc(d.detail.goal) + "</b> · Confidence: " + esc(d.detail.confidence) + "</div>" +
        '<div class="json-tree" style="font-size:11px;margin-top:6px">' + esc(d.detail.args) + "</div>" +
        '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn pri">Approve</button><button class="btn danger">Reject</button><button class="btn">Request More Info</button></div></div>';
    }
    return tbl + det;
  }

  function renderMatrix(d) {
    var head = "<tr><th>Tool</th>" + d.dims.map(function (dim) { return "<th>" + esc(dim) + "</th>"; }).join("") + "</tr>";
    var rows = d.tools.map(function (t) {
      var label = { allow: "Allow", deny: "Deny", req: "Req appr." };
      return "<tr><td>" + esc(t.n) + "</td>" + t.cells.map(function (c) {
        return '<td><span class="mcell ' + c + '">' + label[c] + "</span></td>";
      }).join("") + "</tr>";
    }).join("");
    var rules = (d.rules || []).map(function (r) { return '<div style="font-size:12px;padding:6px 0;border-bottom:1px dashed var(--border-soft)">' + esc(r) + "</div>"; }).join("");
    var trust = (d.trust || []).map(function (r) { return '<div style="font-size:12px;padding:6px 0;border-bottom:1px dashed var(--border-soft)">' + esc(r) + "</div>"; }).join("");
    var audit = (d.audit || []).map(function (r) { return '<div style="font-size:12px;padding:6px 0;border-bottom:1px dashed var(--border-soft)">' + esc(r) + "</div>"; }).join("");
    return '<div class="matrix"><table>' + head + rows + "</table></div>" +
      '<div class="section-label" style="margin-top:16px">Rule builder</div><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px">' + rules + "</div>" +
      (trust ? '<div class="section-label" style="margin-top:16px">Tool trust levels</div><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px">' + trust + "</div>" : "") +
      (audit ? '<div class="section-label" style="margin-top:16px">Detection audit</div><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px">' + audit + "</div>" : "");
  }

  function renderWorkflow(d) {
    var list = d.wf ? '<div class="wtbl-wrap" style="margin-bottom:16px"><table class="wtbl"><thead><tr><th>Workflow</th><th>Trigger condition</th><th>Steps</th><th>Backends</th><th>Status</th><th></th></tr></thead><tbody>' +
      d.wf.map(function (w) {
        return "<tr><td class='cell-main'>" + esc(w.n) + "</td><td>" + esc(w.trig || w.intent || "") + "</td><td>" + w.steps + "</td><td>" + esc(w.backends) + "</td><td>" + pill({ pill: w.st === "Active" ? "g" : "gray", t: w.st }) + "</td><td><button class='btn sm ghost'>Edit</button></td></tr>";
      }).join("") + "</tbody></table></div>" : "";
    var chain = d.demo ? '<div class="section-label">Workflow builder — “Order Refund”</div><div class="node-chain">' + d.demo.map(function (n, i) {
      var tag = n.tag ? '<span class="ntag ' + (n.tag === "T1" ? "t1" : n.tag === "T2" ? "t2" : "t3") + '">' + esc(n.tag) + "</span>" : "";
      return '<div class="node ' + n.cls + '"><div class="nt">' + esc(n.nt) + "</div><div class='nb'>" + esc(n.name) + "</div>" + tag +
        (n.note ? '<div style="font-size:10.5px;color:var(--muted);margin-top:2px">' + esc(n.note) + "</div>" : "") + "</div>" +
        (i < d.demo.length - 1 ? '<div class="node-conn">→</div>' : "");
    }).join("") + "</div>" : "";
    var mapping = d.mapping ? '<div class="section-label" style="margin-top:16px">Cross-backend data passing</div><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--mono);font-size:11.5px">' +
      d.mapping.map(function (m2) { return '<div style="padding:4px 0">' + esc(m2) + "</div>"; }).join("") + "</div>" : "";
    var lib = d.library ? '<div class="section-label" style="margin-top:16px">Flow library</div><div style="display:flex;gap:6px;flex-wrap:wrap">' + d.library.map(function (l) { return '<button class="chip gray">' + esc(l) + "</button>"; }).join("") + "</div>" : "";
    var guards = d.guardrails ? '<div class="alert-row a" style="margin-top:10px"><span class="dot a"></span>' + esc(d.guardrails) + "</div>" : "";
    var nodes = d.nodes ? '<div class="section-label" style="margin-top:16px">Node configuration</div>' + d.nodes.map(function (n) {
      return '<div class="alert-row g" style="margin-bottom:6px"><span class="dot g"></span>' + esc(n) + "</div>";
    }).join("") : "";
    return list + chain + mapping + lib + guards + nodes;
  }

  function renderHealth(d) {
    var cards = d.servers.map(function (s) {
      var color = s.st === "Online" ? "g" : s.st === "Degraded" ? "a" : "r";
      return '<div class="kpi" style="cursor:pointer"><div class="kt" style="display:flex;align-items:center;gap:6px"><span class="dot ' + color + '"></span>' + esc(s.n) + '</div><div style="font-size:11px;color:var(--muted);margin:2px 0">' + esc(s.url) + "</div>" +
        '<div class="kv" style="font-size:16px">' + esc(s.st) + "</div><div class='ks'>uptime " + esc(s.up) + " · avg " + esc(s.avg) + " · " + esc(s.calls) + " calls</div></div>";
    }).join("");
    var toolRows = d.tools.map(function (t) {
      var spark = sparkline(t.trend);
      return "<tr><td class='cell-main mono'>" + esc(t.t) + "</td><td>" + esc(t.sr) + "</td><td><span class='mono'>" + esc(t.p) + "</span></td><td>" + t.errs + "</td><td>" + spark + "</td></tr>";
    }).join("");
    var cb = d.cb.map(function (c) { return '<div class="alert-row r"><span class="dot r"></span><div style="flex:1">' + esc(c) + '</div><button class="btn sm">Reset</button></div>'; }).join("");
    var al = d.alerts.map(function (a) { return '<div style="font-size:12px;padding:5px 0;border-bottom:1px dashed var(--border-soft)">' + esc(a) + "</div>"; }).join("");
    return '<div class="kpi-grid">' + cards + "</div>" +
      '<div class="section-label" style="margin-top:18px">Tool-level health (sorted by error rate)</div>' +
      '<div class="wtbl-wrap"><table class="wtbl"><thead><tr><th>Tool</th><th>Success rate</th><th>p50 / p95 / p99</th><th>Errors (24h)</th><th>Volume trend</th></tr></thead><tbody>' + toolRows + "</tbody></table></div>" +
      '<div class="grid-2" style="margin-top:16px"><div><div class="section-label">Circuit breakers</div>' + (cb || '<div class="empty-hint">No breakers tripped</div>') + "</div>" +
      '<div><div class="section-label">Alert configuration</div><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px">' + al + "</div></div></div>";
  }

  function renderSchema(d) {
    return '<div class="section-label">' + esc(d.name) + " — full schema</div>" +
      '<div class="json-tree">' + esc(d.json) + "</div>" +
      '<div class="section-label" style="margin-top:16px">Version history</div><div class="alert-row g"><span class="dot g"></span>' + esc(d.diff) + "</div>" +
      '<div class="section-label" style="margin-top:12px">AI agent view</div><div style="background:var(--blue-soft);border:1px solid #c8d8f8;border-radius:8px;padding:10px 12px;font-size:12.5px;color:var(--blue)">' + esc(d.aiView) + "</div>";
  }

  function renderReport(d) {
    var f = d.filters ? '<div class="filterbar">' + d.filters.map(function (x) { return '<span class="f">' + esc(x) + " <b>▾</b></span>"; }).join("") + '<span class="spacer"></span><button class="btn sm">Export</button></div>' : "";
    var k = d.kpis ? '<div class="kpi-grid">' + d.kpis.map(function (k2) {
      return '<div class="kpi"><div class="kt">' + esc(k2.t) + '</div><div class="kv">' + esc(k2.v) + '</div><div class="ks">' + k2.s + "</div></div>";
    }).join("") + "</div>" : "";
    var c = d.charts.map(function (ch) {
      var inner = "";
      if (ch.bars) {
        if (ch.stacked && Array.isArray(ch.bars[0])) {
          var max = Math.max.apply(null, ch.bars.map(function (b) { return b[0] + b[1]; }));
          inner = '<div class="chart-plot" style="height:150px;align-items:stretch;flex-direction:row;gap:10px;padding:16px 14px 8px">' +
            ch.bars.map(function (b) {
              var p1 = Math.round((b[0] / max) * 100), p2 = Math.round((b[1] / max) * 100);
              return '<div style="display:flex;flex-direction:column;justify-content:flex-end;flex:1;gap:1px"><div style="height:' + p1 + '%;background:var(--brand);border-radius:3px 3px 0 0"></div><div style="height:' + p2 + '%;background:var(--amber);border-radius:0 0 3px 3px"></div></div>';
            }).join("") + "</div>" +
            '<div style="display:flex;gap:16px;justify-content:center;font-size:11px;color:var(--muted);margin-top:8px"><span><span class="dot g" style="margin-right:4px"></span>AI-resolved</span><span><span class="dot a" style="margin-right:4px"></span>Escalated</span></div>';
        } else {
          var mx = Math.max.apply(null, ch.bars);
          inner = '<div class="chart-plot">' + ch.bars.map(function (b, i) {
            var h = Math.max(3, Math.round((b / mx) * 100));
            return '<div class="bar' + (i % 3 === 2 ? " alt" : "") + '" style="height:' + h + '%" title="' + b + '"></div>';
          }).join("") + "</div>" +
            (ch.labels ? '<div style="display:flex;gap:8px;justify-content:space-around;font-size:10px;color:var(--faint);margin-top:6px">' + ch.labels.map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("") + "</div>" : "") +
            (ch.cap ? '<div style="font-size:10.5px;color:var(--amber);margin-top:6px">──── monthly cap $200</div>' : "");
        }
      } else if (ch.donut) {
        inner = '<div style="display:flex;align-items:center;gap:18px"><div class="donut"></div><div style="font-size:11.5px;display:flex;flex-direction:column;gap:4px">' + ch.donut.map(function (s) { return "<div><b>" + esc(s[0]) + "</b> — " + s[1] + "%</div>"; }).join("") + "</div></div>";
      }
      return '<div class="chart-card"><h5>' + esc(ch.title) + '</h5><div class="cs">' + esc(ch.sub) + "</div>" + inner + "</div>";
    }).join("");
    var t = d.tbl ? '<div style="margin-top:16px">' + renderTableData(d.tbl) + "</div>" : "";
    var gaps = d.gaps ? '<div class="section-label" style="margin-top:16px">Gap analysis — suggested actions</div>' + d.gaps.map(function (g) { return '<div class="alert-row a"><span class="dot a"></span>' + esc(g) + "</div>"; }).join("") : "";
    var budget = d.budget ? '<div class="alert-row a" style="margin-top:14px"><span class="dot a"></span>' + esc(d.budget) + "</div>" : "";
    return f + k + (d.charts.length ? '<div class="grid-2" style="margin-top:14px">' + c + "</div>" : "") + t + gaps + budget;
  }

  function renderLogin(d) {
    return '<div class="login-wrap"><div class="login-card"><div class="logo3">N</div><h3>' + esc(d.title) + "</h3>" +
      '<div class="sub">Sign in to manage your NextBot platform.</div>' +
      '<div class="frow"><label>Email</label><div class="in" data-ph="you@company.com"></div></div>' +
      '<div class="frow" style="margin-top:10px"><label>Password</label><div class="in mask"></div></div>' +
      '<div style="display:flex;justify-content:space-between;margin:10px 0"><span style="font-size:11px;color:var(--blue);font-weight:600">Forgot password?</span><span style="font-size:11px;display:flex;align-items:center;gap:4px;color:var(--muted)"><input type="checkbox" checked style="accent-color:var(--brand)"> Remember device</span></div>' +
      '<button class="btn pri block">Sign in</button>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:14px 0"><div style="flex:1;height:1px;background:var(--border-soft)"></div><span style="font-size:11px;color:var(--faint)">or</span><div style="flex:1;height:1px;background:var(--border-soft)"></div></div>' +
      '<button class="btn block">Sign in with SSO</button>' +
      (d.note ? '<div style="margin-top:14px;font-size:11.5px;color:var(--muted);background:var(--panel-2);border-radius:8px;padding:9px 11px;line-height:1.5">' + esc(d.note) + "</div>" : "") +
      "</div></div>";
  }

  function renderTrace(d) {
    var left = "";
    (d.left || []).forEach(function (m) {
      if (m.kind === "tool") {
        left += '<div class="tool-call-card"><div class="tt"><span class="dot ' + (m.ok ? "g" : "r") + '"></span><span class="mono">' + esc(m.tool) + "</span><span class='status-pill " + (m.ok ? "g" : "r") + "'>" + (m.ok ? "OK" : "FAIL") + "</span></div>" +
          (m.lat ? '<div style="font-size:10.5px;color:var(--muted)">latency ' + esc(m.lat) + "</div>" : "") +
          (m.err ? '<div style="font-size:10.5px;color:var(--red)">' + esc(m.err) + "</div>" : "") + "</div>";
      } else if (m.kind === "msg" || m.kind === "ai" || m.kind === "agent") {
        var who = m.kind === "agent" ? '<span style="color:var(--violet)">Agent</span>' : (m.kind === "ai" ? '<span style="color:var(--brand)">AI</span>' : '<span style="color:var(--muted)">Customer</span>');
        var conf = m.conf ? '<span class="status-pill ' + (m.conf > 0.85 ? "g" : m.conf > 0.6 ? "a" : "r") + '">conf ' + m.conf.toFixed(2) + "</span>" : "";
        var goal = m.goal ? '<span class="status-pill b" style="margin-left:4px">goal: ' + esc(m.goal) + "</span>" : "";
        left += '<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--faint);margin-bottom:2px">' + who + " " + conf + goal + "</div>" +
          '<div class="bubble" style="display:inline-block;background:' + (m.kind === "ai" ? "var(--brand-soft)" : m.kind === "agent" ? "#f5f1fb" : "#fff") + ';border:1px solid var(--border-soft);border-radius:8px;padding:6px 9px;font-size:11.5px;max-width:100%">' + inline(m.text) + "</div></div>";
      } else if (m.kind === "draft") {
        left += '<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--blue);margin-bottom:2px">AI draft (editable)</div>' +
          '<div style="border:1.5px dashed var(--blue);border-radius:8px;padding:6px 9px;font-size:11.5px;background:#fff">' + esc(m.text) + '</div></div>';
      } else if (m.kind === "sys") {
        left += '<div style="text-align:center;font-size:10.5px;color:var(--muted);margin:6px 0">' + esc(m.text) + "</div>";
      }
    });

    var mid = "";
    if (d.mid && d.mid.length) {
      mid = d.mid.map(function (t) {
        return '<div class="tc-node ' + (t.ok ? "ok" : "fail") + '"><div class="tn mono">' + esc(t.tool) + ' <span class="tbadge ' + (t.ok ? "ok" : "fail") + '">' + (t.ok ? "success" : "failed") + "</span></div>" +
          '<div class="ts">' + esc(t.be) + " · " + esc(t.lat) + "</div>" +
          '<div class="tcj mono" style="font-size:10px;color:var(--muted);margin-top:3px">' + esc(t.args) + "</div></div>";
      }).join("");
    } else {
      mid = "";
    }

    var right = "";
    if (d.right) {
      var cust = d.right.cust ? '<div class="tool-call-card"><div class="tt">' + esc(d.right.cust.name) + ' <span class="status-pill g">' + (d.right.cust.verified ? "verified" : "unverified") + "</span></div>" +
        '<div class="tcj mono">' + esc(d.right.cust.id) + "</div></div>" : "";
      var meta = d.right.meta ? '<div class="tool-call-card">' + d.right.meta.map(function (m2) { return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:var(--muted)">' + esc(m2[0]) + '</span><b>' + esc(m2[1]) + "</b></div>"; }).join("") + "</div>" : "";
      var summary = d.right.summary ? '<div class="tool-call-card" style="font-size:11px;line-height:1.5">' + esc(d.right.summary) + "</div>" : "";
      var tools = d.right.tools ? '<div class="section-label">Tool panel (Agent Tool Registry)</div>' + d.right.tools.map(function (t2) {
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><button class="btn sm" style="flex:1;text-align:left;font-family:var(--mono);font-size:11px">' + esc(t2.t) + '</button><span class="ntag ' + (t2.tier === "T3" ? "t3" : t2.tier === "T2" ? "t2" : "t1") + '">' + esc(t2.tier) + "</span></div>";
      }).join("") : "";
      var actions = d.right.actions ? '<div class="section-label">Actions</div><div style="display:flex;flex-wrap:wrap;gap:6px">' + d.right.actions.map(function (a, i) {
        return '<button class="btn sm ' + (i === 0 ? "pri" : "") + '">' + esc(a) + "</button>";
      }).join("") + "</div>" : "";
      var escal = d.right.escal ? '<div class="tool-call-card" style="font-size:11px">' + esc(d.right.escal) + "</div>" : "";
      right = cust + meta + summary + escal + tools + actions;
    }

    var replay = d.replay ? '<button class="btn sm blue">Replay in Test Console →</button>' : "";

    var leftPanel = '<div class="trace-panel trace-left"><div class="tp-head">Transcript <span class="status-pill g">conf 0.94</span></div><div class="tp-body">' + left + "</div></div>";
    var midPanel = mid ? '<div class="trace-panel trace-mid"><div class="tp-head">Tool call timeline</div><div class="tp-body">' + mid + "</div></div>" : "";
    var rightPanel = '<div class="trace-panel trace-right"><div class="tp-head">Context ' + replay + "</div><div class='tp-body'>" + right + "</div></div>";
    return '<div class="trace">' + leftPanel + midPanel + rightPanel + "</div>";
  }

  /* ---------- spec panel ---------- */
  function specPanel(s) {
    var rows = s.specRows.map(function (r) {
      return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>";
    }).join("");
    var notes = s.notes.map(function (n) { return '<div style="margin-bottom:5px">• ' + esc(n) + "</div>"; }).join("");
    return '<div class="spec-panel"><h4>Screen spec · ' + esc(s.id) + "</h4>" +
      '<div class="sp-section"><div class="sp-label">Trigger</div><div class="sp-detail">' + esc(s.trigger || "—") + "</div></div>" +
      (s.specRows.length ? '<div class="sp-section"><div class="sp-label">Elements</div><table class="spec-table">' + rows + "</table></div>" : "") +
      (s.notes.length ? '<div class="sp-section"><div class="sp-label">Behavior notes</div><div class="spec-note">' + notes + "</div></div>" : "") +
      (s.prd.length ? '<div class="sp-section"><div class="sp-label">PRD refs</div><div style="display:flex;flex-wrap:wrap;gap:4px">' + s.prd.map(function (p) { return '<span class="badge prd">' + esc(p) + "</span>"; }).join("") + "</div></div>" : "") +
      "</div>";
  }

  /* ---------- header + page render ---------- */
  function headerHTML() {
    return '<div class="screen-head"><div class="crumbs">' + crumbs() + "</div><h2>" + esc(currentTitle()) + "</h2>" +
      '<div class="meta">' + metaBadges() + "</div>" +
      '<div class="screen-blurb">' + esc(currentBlurb()) + "</div></div>";
  }

  function crumbs() {
    if (state.mode === "browse") {
      var s = byId(state.screen);
      var portal = PORTALS.find(function (p) { return p.k === s.portal; });
      return "<b>" + esc(portal ? portal.name : s.portal) + "</b> <span style='color:var(--faint)'>/</span> " + esc(s.id) + " — " + esc(s.title);
    }
    var st = storyById(state.story);
    return "<b>Use Case Patterns → " + esc(st.title) + "</b> <span style='color:var(--faint)'>/</span> Step " + (state.storyStep + 1) + " of " + st.steps.length;
  }

  function currentTitle() {
    if (state.mode === "browse") { var s = byId(state.screen); return s.title; }
    var st = storyById(state.story);
    var s = byId(st.steps[state.storyStep].s);
    return s.title;
  }
  function currentBlurb() {
    if (state.mode === "browse") { return byId(state.screen).blurb; }
    var st = storyById(state.story);
    var s = byId(st.steps[state.storyStep].s);
    return s.blurb;
  }
  function metaBadges() {
    if (state.mode === "story") {
      var st = storyById(state.story);
      var s = byId(st.steps[state.storyStep].s);
      return '<span class="badge ghost">' + esc(s.id) + "</span>" +
        '<span class="badge ' + (s.critical ? "launch" : "post") + '">' + (s.critical ? "Launch-critical" : "Post-launch") + "</span>" +
        s.prd.map(function (p) { return '<span class="badge prd">' + esc(p) + "</span>"; }).join("");
    }
    var sc2 = byId(state.screen);
    return '<span class="badge ghost">' + esc(sc2.id) + "</span>" +
      '<span class="badge ' + (sc2.critical ? "launch" : "post") + '">' + (sc2.critical ? "Launch-critical" : "Post-launch") + "</span>" +
      sc2.prd.map(function (p) { return '<span class="badge prd">' + esc(p) + "</span>"; }).join("");
  }

  /* ---------- story rendering ---------- */
  function renderStoryList() {
    return '<div class="story-side"><h4>Use case stories (' + STORIES.length + ")</h4>" +
      STORIES.map(function (st) {
        return '<div class="story-card' + (st.id === state.story ? " active" : "") + '" data-story="' + st.id + '"><div class="st">' + esc(st.title) + '</div><div class="ss">' + esc(st.desc) + '</div>' +
          '<div class="chip-line">' + st.steps.map(function (sp) { return "<span>" + esc(sp.s) + "</span>"; }).join("") + "</div></div>";
      }).join("") + "</div>";
  }

  function renderStoryMain() {
    var st = storyById(state.story);
    var step = st.steps[state.storyStep];
    var s = byId(step.s);
    var rail = st.steps.map(function (sp, i) {
      var cls = i === state.storyStep ? " cur" : (i < state.storyStep ? " done" : "");
      return '<div class="rs' + cls + '" data-goto="' + i + '"><span class="rnum">' + (i + 1) + "</span>" + esc(sp.s) + "</div>" +
        (i < st.steps.length - 1 ? '<div class="rc"></div>' : "");
    }).join("");
    return '<div class="story-main">' +
      '<div class="story-step-head"><span class="k">Step ' + (state.storyStep + 1) + " of " + st.steps.length + " · " + s.id + "</span></div>" +
      '<div class="story-note blue" style="margin-top:0">' + esc(step.note) + "</div>" +
      '<div class="story-rail">' + rail + "</div>" +
      '<div class="wframe"><div class="wframe-stage">' + renderType(s) + "</div></div>" +
      '<div class="story-nav"><button class="btn" data-stepnav="-1"' + (state.storyStep === 0 ? " disabled" : "") + ">← Previous</button>" +
      '<span class="pos">' + (state.storyStep + 1) + " / " + st.steps.length + "</span>" +
      '<button class="btn pri" data-stepnav="1"' + (state.storyStep === st.steps.length - 1 ? " disabled" : "") + ">Next →</button></div>" +
      (state.storyStep === st.steps.length - 1 ? '<div class="story-note">Flow complete. Explore other stories or browse the full screen inventory.</div>' : "") +
      "</div>";
  }

  function renderType(s) {
    switch (s.type) {
      case "widget": return renderWidget(s.data);
      case "welcome": return renderWelcome(s.data);
      case "chat": return renderChat(s.data);
      case "modal": return renderModal(s.data);
      case "launcher": return renderLauncher(s.data);
      default: return '<div class="empty-hint">' + esc(s.id) + "</div>";
    }
  }

  /* ---------- content render ---------- */
  function render() {
    var content = document.getElementById("content");
    var tb = document.getElementById("tb-title");
    var tc = document.getElementById("tb-count");
    if (state.mode === "story") {
      tb.innerHTML = "<span style='font-size:11px;color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.6px'>Interactive stories</span> — " + esc(storyById(state.story).title);
      tc.innerHTML = STORIES.length + " stories";
      content.innerHTML = '<div class="story-layout">' + renderStoryList() + renderStoryMain() + "</div>";
    } else {
      var s = byId(state.screen);
      tb.innerHTML = esc(s.id) + " <small>" + esc(s.title) + "</small>";
      tc.innerHTML = SCREENS.length + " screens";
      content.innerHTML = headerHTML() + renderScreen(s);
    }
    bindDynamic();
  }

  /* ---------- dynamic event binding ---------- */
  function bindDynamic() {
    var root = document.getElementById("content");

    root.querySelectorAll("[data-tab]").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = el.getAttribute("data-tab");
        root.querySelectorAll("[data-tab]").forEach(function (t) { t.classList.remove("active"); });
        el.classList.add("active");
        root.querySelectorAll("[data-tabbody]").forEach(function (b) { b.style.display = "none"; });
        var target = root.querySelector('[data-tabbody="' + i + '"]');
        if (target) target.style.display = "";
      });
    });

    root.querySelectorAll("[data-step]").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = el.getAttribute("data-step");
        root.querySelectorAll("[data-step]").forEach(function (t) { t.classList.remove("cur"); });
        el.classList.add("cur");
        root.querySelectorAll("[data-stepbody]").forEach(function (b) { b.style.display = "none"; });
        var target = root.querySelector('[data-stepbody="' + i + '"]');
        if (target) target.style.display = "";
      });
    });

    root.querySelectorAll("[data-stepnav]").forEach(function (el) {
      el.addEventListener("click", function () {
        var d = parseInt(el.getAttribute("data-stepnav"), 10);
        var st = storyById(state.story);
        var next = Math.min(st.steps.length - 1, Math.max(0, state.storyStep + d));
        if (next !== state.storyStep) { state.storyStep = next; render(); }
      });
    });

    root.querySelectorAll("[data-goto]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.storyStep = parseInt(el.getAttribute("data-goto"), 10);
        render();
      });
    });

    root.querySelectorAll("[data-story]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.story = el.getAttribute("data-story");
        state.storyStep = 0;
        render();
      });
    });

    root.querySelectorAll(".chip[data-used]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.classList.add("used");
      });
    });

    root.querySelectorAll("[data-select]").forEach(function (el) {
      el.addEventListener("click", function () {
        var row = el.closest(".row");
        if (!row) return;
        var label = row.querySelector(".lt") ? row.querySelector(".lt").textContent : "Selected";
        row.style.opacity = ".5";
        el.textContent = "✓";
        var msg = document.createElement("div");
        msg.className = "msg customer";
        msg.innerHTML = '<div><div class="bubble">' + esc(label) + "</div></div>";
        row.closest(".widget-body").appendChild(msg);
        row.closest(".widget-body").scrollTop = row.closest(".widget-body").scrollHeight;
      });
    });

    /* widget: Chat/Menu mode switcher + guided menu navigation */
    root.querySelectorAll(".phone[data-wkey]").forEach(function (phone) {
      var wk = phone.getAttribute("data-wkey");
      if (wk && window.__WK && window.__WK[wk]) bindMenu(phone, wk);
    });
  }

  /* binds the interactive guided menu inside a widget phone */
  function bindMenu(scope, wkey) {
    var rec = window.__WK && window.__WK[wkey];
    if (!rec) return;

    function reRender(html) {
      var body = scope.querySelector(".widget-body");
      if (body) { body.innerHTML = html; body.scrollTop = 0; }
      bindMenu(scope, wkey);
    }

    scope.querySelectorAll("[data-wmode]").forEach(function (el) {
      el.addEventListener("click", function () {
        var mode = el.getAttribute("data-wmode");
        var wk = el.getAttribute("data-wkey");
        var r = window.__WK && window.__WK[wk];
        var modes = el.closest(".widget-modes");
        if (modes) modes.querySelectorAll("[data-wmode]").forEach(function (b) { b.classList.toggle("active", b === el); });
        var body = scope.querySelector(".widget-body");
        if (!r || !body) return;
        if (mode === "menu") {
          r.stack = []; r.crumb = []; r.level = r.menu ? r.menu.slice() : null;
          body.innerHTML = r.menu ? menuBodyHTML(r.menu, []) : r.welcomeBody;
        } else {
          body.innerHTML = r.chatHtml;
        }
        bindMenu(scope, wk);
      });
    });

    scope.querySelectorAll("[data-menuselect]").forEach(function (el) {
      el.addEventListener("click", function () {
        var kind = el.getAttribute("data-kind");
        var i = parseInt(el.getAttribute("data-i"), 10);
        var level = (rec.level && rec.level.length) ? rec.level : (rec.menu || []);
        var node = level[i];
        if (!node) return;
        if (kind === "sub" && node.sub) {
          rec.stack.push({ level: level.slice(), crumb: rec.crumb.slice() });
          rec.level = node.sub;
          rec.crumb = rec.crumb.concat(node.label);
          reRender(menuBodyHTML(node.sub, rec.crumb));
        } else {
          /* leaf selected → switch to chat and show as customer message */
          var body = scope.querySelector(".widget-body");
          if (body) body.innerHTML = rec.chatHtml + '<div class="msg customer"><div><div class="bubble">' + esc(node.label) + "</div></div></div>";
          var modes = scope.querySelector(".widget-modes");
          if (modes) modes.querySelectorAll("[data-wmode]").forEach(function (b) {
            b.classList.toggle("active", b.getAttribute("data-wmode") === "chat");
          });
          if (body) body.scrollTop = body.scrollHeight;
        }
      });
    });

    scope.querySelectorAll("[data-menuhome]").forEach(function (el) {
      el.addEventListener("click", function () {
        rec.level = rec.menu ? rec.menu.slice() : null;
        rec.stack = []; rec.crumb = [];
        reRender(rec.menu ? menuBodyHTML(rec.menu, []) : rec.welcomeBody);
      });
    });

    scope.querySelectorAll("[data-crumb]").forEach(function (el) {
      el.addEventListener("click", function () {
        var idx = parseInt(el.getAttribute("data-crumb"), 10);
        rec.crumb = rec.crumb.slice(0, idx + 1);
        var level = rec.menu || [];
        for (var j = 0; j < rec.crumb.length; j++) {
          var nd = (level || []).find(function (n) { return n.label === rec.crumb[j]; });
          if (!nd || !nd.sub) break;
          level = nd.sub;
        }
        rec.level = level.slice ? level.slice() : level;
        reRender(menuBodyHTML(level, rec.crumb));
      });
    });
  }

  /* ---------- sidebar ---------- */
  function buildSidebar() {
    var nav = document.getElementById("sb-nav");
    var groups = PORTALS.map(function (p) {
      var items = SCREENS.filter(function (s) { return s.portal === p.k && visible(s); });
      var all = SCREENS.filter(function (s) { return s.portal === p.k; });
      var cls = state.collapsed[p.k] ? " closed" : "";
      var itemHtml = items.map(function (s) {
        return '<div class="sb-item' + (s.id === state.screen && state.mode === "browse" ? " active" : "") + '" data-screen="' + s.id + '">' +
          '<span class="dot ' + (s.critical ? "c" : "p") + '"></span><span class="t">' + esc(s.id) + " · " + esc(s.title) + '</span><span class="n">' + s.prd.length + "</span></div>";
      }).join("");
      return '<div class="sb-group' + cls + '"><div class="sb-group-head" data-group="' + p.k + '"><span class="caret">▼</span>' + esc(p.name) + '<span style="margin-left:auto;font-size:10px;color:#7f8da1">' + items.length + "/" + all.length + "</span></div>" +
        '<div class="sb-items">' + itemHtml + "</div></div>";
    }).join("");
    nav.innerHTML = groups;

    nav.querySelectorAll(".sb-group-head").forEach(function (h) {
      h.addEventListener("click", function () {
        var k = h.getAttribute("data-group");
        state.collapsed[k] = !state.collapsed[k];
        buildSidebar();
      });
    });
    nav.querySelectorAll(".sb-item").forEach(function (it) {
      it.addEventListener("click", function () {
        state.screen = it.getAttribute("data-screen");
        state.mode = "browse";
        document.getElementById("mode-browse").classList.add("active");
        document.getElementById("mode-story").classList.remove("active");
        buildSidebar();
        render();
      });
    });
  }

  function visible(s) {
    if (state.filterText) {
      var q = state.filterText.toLowerCase();
      var hay = (s.id + " " + s.title + " " + s.prd.join(" ") + " " + (s.blurb || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.onlyCritical && !s.critical) return false;
    return true;
  }

  /* ---------- init ---------- */
  function init() {
    document.getElementById("searchBox").addEventListener("input", function (e) {
      state.filterText = e.target.value;
      buildSidebar();
    });
    var crit = document.getElementById("toggle-critical");
    crit.addEventListener("click", function () {
      state.onlyCritical = !state.onlyCritical;
      crit.classList.toggle("on", state.onlyCritical);
      buildSidebar();
    });
    document.getElementById("mode-browse").addEventListener("click", function () {
      state.mode = "browse";
      document.getElementById("mode-browse").classList.add("active");
      document.getElementById("mode-story").classList.remove("active");
      render();
    });
    document.getElementById("mode-story").addEventListener("click", function () {
      if (!STORIES.length) return;
      state.mode = "story";
      if (!state.story) state.story = STORIES[0].id;
      document.getElementById("mode-story").classList.add("active");
      document.getElementById("mode-browse").classList.remove("active");
      render();
    });
    buildSidebar();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);

  window.NB = {
    SCREENS: SCREENS,
    STORIES: STORIES,
    state: state,
    render: render,
    renderScreen: renderScreen,
    renderScreenHTML: function (id) { return renderScreen(byId(id)); },
    buildSidebar: buildSidebar
  };
})();