/* ───────────────────────────────────────────────────────────────────────────
   YOLICARDS — Moteur de formulaire (data-driven)
   renderForm(spec, mountEl) construit un questionnaire à partir d'une spec JS.
   - code testeur : lu dans l'URL (?code=TEST-001) sinon saisi à la main
   - types : single, multi (option "max"), long, text, scale (min..max), email
   - validation des questions "required"
   - sauvegarde de brouillon par (form,code) dans localStorage (best-effort)
   - envoi POST vers YOLI_CONFIG.WEBAPP_URL ; sinon mode démo
─────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  function qs(name) {
    try { return new URLSearchParams(location.search).get(name) || ""; }
    catch (e) { return ""; }
  }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }

  window.renderForm = function (spec, mount) {
    var CFG = window.YOLI_CONFIG || {};
    var urlCode = (qs("code") || "").trim().toUpperCase();
    var urlEmail = (qs("email") || "").trim();
    var draftKey = "yoli_" + spec.id + "_" + (urlCode || "anon");
    var saved = load(draftKey) || {};
    var answers = saved.answers || {};
    var codeVal = urlCode || saved.code || "";

    // ── garde-fou : le post-test exige que le pré-test soit fait ────────────
    // Actif seulement si spec.requirePretest, un code en URL et une Web App branchée.
    if (spec.requirePretest && urlCode && CFG.WEBAPP_URL) {
      mount.innerHTML = '<div class="done"><p style="margin:14px 0">Vérification de votre accès…</p></div>';
      fetch(CFG.WEBAPP_URL + (CFG.WEBAPP_URL.indexOf("?") === -1 ? "?" : "&") + "check=pretest&code=" + encodeURIComponent(urlCode))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          mount.innerHTML = "";
          if (res && res.pretest === false) return blockGate(mount, urlCode);
          build();
        })
        .catch(function () { mount.innerHTML = ""; build(); }); // en cas d'échec réseau, on n'empêche pas de répondre
      return;
    }
    build();

    function blockGate(mount, code) {
      var d = el("div", { class: "done" });
      d.innerHTML =
        '<div class="check" style="background:#FBE9E3"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#B4441F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16h.01"></path></svg></div>' +
        '<h2>Commencez par le pré-test</h2>' +
        '<div class="code-echo">' + escapeHtml(code) + '</div>' +
        '<p>Nous n\'avons pas encore votre formulaire pré-test pour ce code. Le questionnaire final s\'ouvrira une fois votre pré-test enregistré. Utilisez d\'abord le lien de pré-test qui vous a été envoyé.</p>';
      mount.appendChild(d);
    }

    function build() {
    var form = el("form");
    form.setAttribute("novalidate", "novalidate");

    // progress bar
    var bar = el("div", { class: "progress" });
    bar.innerHTML = '<div class="bar"><i></i></div><div class="bar-label"><span class="p-txt">0 %</span><span class="p-cnt"></span></div>';
    form.appendChild(bar);

    // code box
    var cb = el("div", { class: "codebox" });
    cb.innerHTML =
      '<label for="codein">' + (spec.codeLabel || "Votre code testeur") + '</label>' +
      '<input id="codein" autocomplete="off" spellcheck="false" placeholder="TEST-001" value="' + escapeHtml(codeVal) + '">' +
      (spec.codeHint ? '<p class="hint">' + spec.codeHint + '</p>' : '');
    form.appendChild(cb);
    var codeInput = cb.querySelector("#codein");
    if (urlCode) { codeInput.value = urlCode; codeInput.setAttribute("readonly", "readonly"); codeInput.style.opacity = ".85"; }

    // email box (pré-test seulement, si spec.askEmail)
    var emailInput = null;
    if (spec.askEmail) {
      var eb = el("div", { class: "codebox" });
      eb.style.marginTop = "-8px";
      eb.innerHTML =
        '<label for="emailin">Votre e-mail <span style="color:#fff;opacity:.7">(pour recevoir le questionnaire final à J+' + (CFG.DUREE_JOURS || 14) + ')</span></label>' +
        '<input id="emailin" type="email" autocomplete="email" placeholder="prenom@exemple.com" value="' + escapeHtml(urlEmail || saved.email || "") + '">' +
        '<p class="hint">Utilisé uniquement pour vous envoyer le lien du questionnaire final, au bon moment.</p>';
      form.appendChild(eb);
      emailInput = eb.querySelector("#emailin");
      // pré-rempli par le lien ?email= : on verrouille comme le code
      if (urlEmail) { emailInput.value = urlEmail; emailInput.setAttribute("readonly", "readonly"); emailInput.style.opacity = ".85"; }
    }

    var allQ = [];
    spec.sections.forEach(function (sec, si) {
      var s = el("section", { class: "section" });
      s.appendChild(el("h2", null, '<span class="idx">' + (si + 1) + '</span>' + escapeHtml(sec.title)));
      if (sec.lead) s.appendChild(el("p", { class: "lead" }, escapeHtml(sec.lead)));
      if (sec.callout) s.appendChild(el("div", { class: "callout" }, sec.callout));
      sec.questions.forEach(function (q) {
        allQ.push(q);
        s.appendChild(buildQ(q));
      });
      form.appendChild(s);
    });

    // actions
    var act = el("div", { class: "actions" });
    act.innerHTML =
      '<button type="submit" class="btn btn-primary">Envoyer mes réponses</button>' +
      '<p class="err" id="formerr"></p>' +
      '<button type="button" class="btn btn-ghost" id="clearbtn">Effacer mon brouillon</button>' +
      '<p class="saved-note" id="savenote">Brouillon enregistré sur cet appareil.</p>';
    form.appendChild(act);

    mount.appendChild(form);

    // ── question renderer ──────────────────────────────────────────────────
    function buildQ(q) {
      var wrap = el("div", { class: "q", "data-q": q.n });
      var head = '<div class="qh"><span class="qn">Q' + q.n + ".</span><span>" + escapeHtml(q.label) +
        (q.required ? '<span class="req">*</span>' : "") + "</span></div>";
      wrap.innerHTML = head;

      if (q.type === "single" || q.type === "multi") {
        var box = el("div", { class: "opts" });
        if (q.type === "multi" && q.max) wrap.appendChild(el("div", { class: "meta" }, "Maximum " + q.max + " choix."));
        q.options.forEach(function (opt, oi) {
          var isOther = q.other && /précisez|precisez/i.test(opt);
          var lab = el("label", { class: "opt" });
          var inType = q.type === "single" ? "radio" : "checkbox";
          lab.innerHTML = '<input type="' + inType + '" name="q' + q.n + '" value="' + escapeHtml(opt) + '">' +
            "<span>" + escapeHtml(opt) + (isOther ? '<input class="other-in" placeholder="Précisez…" data-other="q' + q.n + '">' : "") + "</span>";
          box.appendChild(lab);
        });
        wrap.appendChild(box);
        // restore
        var prev = answers["q" + q.n];
        if (prev) {
          var arr = Array.isArray(prev) ? prev : [prev];
          box.querySelectorAll("input[type=radio],input[type=checkbox]").forEach(function (inp) {
            var match = arr.indexOf(inp.value) > -1;
            // "Autre: xxx" restore
            if (!match) arr.forEach(function (a) { if (a.indexOf(inp.value) === 0 && /précisez|precisez/i.test(inp.value)) { inp.checked = true; markSel(inp); var oi = inp.closest("label").querySelector(".other-in"); if (oi) oi.value = a.slice(inp.value.length).replace(/^:\s*/, ""); } });
            if (match) { inp.checked = true; markSel(inp); }
          });
        }
        box.addEventListener("change", function (ev) {
          if (q.type === "single") box.querySelectorAll(".opt").forEach(function (l) { l.classList.remove("sel"); });
          if (q.type === "multi" && q.max) {
            var checked = box.querySelectorAll("input:checked");
            if (checked.length > q.max) { ev.target.checked = false; }
          }
          box.querySelectorAll("input:checked").forEach(function (i) { markSel(i); });
          box.querySelectorAll("input:not(:checked)").forEach(function (i) { i.closest(".opt").classList.remove("sel"); });
          persist();
        });
        box.addEventListener("input", function (e2) { if (e2.target.classList.contains("other-in")) persist(); });
      }
      else if (q.type === "scale") {
        var sc = el("div", { class: "scale" });
        for (var v = q.min; v <= q.max; v++) {
          var b = el("button", { type: "button", "data-v": v }, String(v));
          sc.appendChild(b);
        }
        wrap.appendChild(sc);
        wrap.appendChild(el("div", { class: "scale-ends" }, "<span>" + escapeHtml(q.endLow || q.min) + "</span><span>" + escapeHtml(q.endHigh || q.max) + "</span>"));
        if (answers["q" + q.n] != null) {
          var bb = sc.querySelector('[data-v="' + answers["q" + q.n] + '"]'); if (bb) bb.classList.add("sel");
        }
        sc.addEventListener("click", function (ev) {
          if (ev.target.tagName !== "BUTTON") return;
          sc.querySelectorAll("button").forEach(function (x) { x.classList.remove("sel"); });
          ev.target.classList.add("sel");
          persist();
        });
      }
      else { // long / text / email
        var ta = q.type === "long" ? el("textarea") : el("input", { class: "txt", type: "text" });
        ta.setAttribute("data-free", "q" + q.n);
        if (answers["q" + q.n]) ta.value = answers["q" + q.n];
        ta.addEventListener("input", persist);
        wrap.appendChild(ta);
      }
      return wrap;
    }

    function markSel(inp) { var l = inp.closest(".opt"); if (l) l.classList.add("sel"); }

    // ── collect answers ────────────────────────────────────────────────────
    function collect() {
      var out = {};
      allQ.forEach(function (q) {
        var root = form.querySelector('.q[data-q="' + q.n + '"]');
        if (q.type === "single") {
          var sel = root.querySelector("input:checked");
          if (sel) {
            var val = sel.value;
            var oi = sel.closest("label").querySelector(".other-in");
            if (oi && oi.value.trim()) val = val + ": " + oi.value.trim();
            out["q" + q.n] = val;
          }
        } else if (q.type === "multi") {
          var vals = [];
          root.querySelectorAll("input:checked").forEach(function (c) {
            var val = c.value;
            var oi = c.closest("label").querySelector(".other-in");
            if (oi && oi.value.trim()) val = val + ": " + oi.value.trim();
            vals.push(val);
          });
          if (vals.length) out["q" + q.n] = vals;
        } else if (q.type === "scale") {
          var b = root.querySelector("button.sel");
          if (b) out["q" + q.n] = b.getAttribute("data-v");
        } else {
          var f = root.querySelector("[data-free]");
          if (f && f.value.trim()) out["q" + q.n] = f.value.trim();
        }
      });
      return out;
    }

    function persist() {
      answers = collect();
      store(draftKey, { code: codeInput.value.trim().toUpperCase(), email: emailInput ? emailInput.value.trim() : "", answers: answers });
      updateProgress();
    }

    function updateProgress() {
      var total = allQ.length, done = 0;
      allQ.forEach(function (q) { if (answers["q" + q.n] != null && String(answers["q" + q.n]).length) done++; });
      var pct = total ? Math.round(done / total * 100) : 0;
      bar.querySelector("i").style.width = pct + "%";
      bar.querySelector(".p-txt").textContent = pct + " %";
      bar.querySelector(".p-cnt").textContent = done + " / " + total;
    }

    // ── validation ─────────────────────────────────────────────────────────
    function validate() {
      var errBox = form.querySelector("#formerr");
      errBox.classList.remove("show");
      if (!codeInput.value.trim()) return fail("Merci d'indiquer votre code testeur.", codeInput);
      if (emailInput) {
        var em = emailInput.value.trim();
        if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return fail("Merci d'indiquer un e-mail valide (pour recevoir le questionnaire final).", emailInput);
      }
      for (var i = 0; i < allQ.length; i++) {
        var q = allQ[i];
        if (q.required && answers["q" + q.n] == null) {
          var node = form.querySelector('.q[data-q="' + q.n + '"]');
          return fail("Merci de répondre à la question Q" + q.n + " (obligatoire).", node);
        }
      }
      return true;
      function fail(msg, node) {
        errBox.textContent = msg; errBox.classList.add("show");
        if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
    }

    // ── submit ─────────────────────────────────────────────────────────────
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      persist();
      if (!validate()) return;
      var payload = { form: spec.id, code: codeInput.value.trim().toUpperCase(), data: Object.assign({}, answers) };
      if (emailInput) payload.data.email = emailInput.value.trim();
      var btn = form.querySelector(".btn-primary");
      btn.disabled = true; btn.textContent = "Envoi…";

      var url = (window.YOLI_CONFIG || {}).WEBAPP_URL;
      if (!url) { // mode démo
        console.log("[DÉMO] payload =", payload);
        setTimeout(function () { done(payload.code); }, 500);
        return;
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // évite le preflight CORS
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().catch(function () { return { ok: true }; }); })
        .then(function (res) {
          if (res && res.ok === false) throw new Error(res.error || "refus serveur");
          try { localStorage.removeItem(draftKey); } catch (e) {}
          done(payload.code);
        })
        .catch(function (err) {
          btn.disabled = false; btn.textContent = "Envoyer mes réponses";
          var errBox = form.querySelector("#formerr");
          errBox.textContent = "L'envoi a échoué (" + err.message + "). Vérifiez votre connexion et réessayez — votre brouillon est conservé.";
          errBox.classList.add("show");
        });
    });

    form.querySelector("#clearbtn").addEventListener("click", function () {
      try { localStorage.removeItem(draftKey); } catch (e) {}
      location.reload();
    });

    function done(code) {
      mount.innerHTML = "";
      var d = el("div", { class: "done" });
      var btn = "";
      if (spec.doneLink) {
        // lien de suite de parcours (ex. page téléchargement), avec le code en paramètre
        var sep = spec.doneLink.indexOf("?") === -1 ? "?" : "&";
        var href = spec.doneLink + sep + "code=" + encodeURIComponent(code);
        btn = '<a class="btn btn-primary" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-top:4px" href="' + href + '">' + escapeHtml(spec.doneLinkLabel || "Continuer") + '</a>';
      }
      d.innerHTML =
        '<div class="check"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#7A5B0C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-11"></path></svg></div>' +
        "<h2>" + escapeHtml(spec.doneTitle || "Merci, c'est enregistré !") + "</h2>" +
        '<div class="code-echo">' + escapeHtml(code) + "</div>" +
        "<p>" + escapeHtml(spec.doneText || "") + "</p>" +
        btn;
      mount.appendChild(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    updateProgress();
    } // end build()

    function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  };
})();
