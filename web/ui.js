// ui.js — componentes próprios no lugar dos controles nativos (select, range, checkbox, color, details, confirm).
// O comportamento de teclado segue os padrões WAI-ARIA: listbox, slider, switch, radiogroup, tabs e dialog.
// Cada componente expõe .value / .checked no próprio elemento e dispara "input"/"change", como um controle nativo.
(() => {
  const icon = window.icon;
  let uid = 0;
  const nextId = p => `${p}-${++uid}`;
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // fecha popovers ao clicar fora; cada um registra a própria função de fechar
  const openPopovers = new Set();
  document.addEventListener("pointerdown", e => {
    for (const p of [...openPopovers]) if (!p.contains(e.target)) p.close();
  });

  // ---------- select (botão + listbox) ----------
  // items: [{ value, label, hint? }]
  function select(host, items, { placeholder = "Escolher…" } = {}) {
    host.classList.add("ui-select");
    const listId = nextId("lb");
    host.innerHTML =
      `<button type="button" class="ui-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}">` +
      `<span class="ui-select-value"></span>${icon("chevron-down", 16)}</button>` +
      `<div class="ui-popover ui-listbox" role="listbox" id="${listId}" tabindex="-1" hidden></div>`;
    const trigger = host.firstElementChild, list = host.lastElementChild, valEl = trigger.firstElementChild;
    if (host.getAttribute("aria-label")) trigger.setAttribute("aria-label", host.getAttribute("aria-label"));
    let value = null, active = -1, typed = "", typedAt = 0;

    list.innerHTML = items.map((it, i) =>
      `<div role="option" class="ui-option" id="${listId}-${i}" data-i="${i}" aria-selected="false">` +
      (it.hint !== undefined ? `<span class="ui-option-num">${it.hint}</span>` : "") +
      `<span class="ui-option-label">${it.label}</span>${icon("check", 14)}</div>`).join("");
    const opts = [...list.children];

    function render() {
      const i = items.findIndex(it => it.value === value);
      valEl.innerHTML = i < 0 ? `<span class="ui-placeholder">${placeholder}</span>`
        : (items[i].hint !== undefined ? `<span class="ui-option-num">${items[i].hint}</span>` : "") + items[i].label;
      opts.forEach((o, j) => o.setAttribute("aria-selected", j === i));
    }
    function setActive(i) {
      active = clamp(i, 0, opts.length - 1);
      opts.forEach((o, j) => o.classList.toggle("active", j === active));
      list.setAttribute("aria-activedescendant", opts[active].id);
      opts[active].scrollIntoView({ block: "nearest" });
    }
    function open() {
      if (host.disabled) return;
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      host.classList.add("open");
      openPopovers.add(host);
      setActive(Math.max(0, items.findIndex(it => it.value === value)));
      list.focus();
    }
    function close(refocus = true) {
      if (list.hidden) return;
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      host.classList.remove("open");
      openPopovers.delete(host);
      if (refocus) trigger.focus();
    }
    function choose(i) {
      const changed = items[i].value !== value;
      value = items[i].value;
      render();
      close();
      if (changed) fire(host, "change");
    }
    host.close = () => close(false);

    trigger.addEventListener("click", () => (list.hidden ? open() : close()));
    trigger.addEventListener("keydown", e => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
    });
    list.addEventListener("click", e => {
      const o = e.target.closest(".ui-option");
      if (o) choose(+o.dataset.i);
    });
    list.addEventListener("pointermove", e => {
      const o = e.target.closest(".ui-option");
      if (o && +o.dataset.i !== active) { active = +o.dataset.i; opts.forEach((x, j) => x.classList.toggle("active", j === active)); }
    });
    list.addEventListener("keydown", e => {
      const k = e.key;
      if (k === "ArrowDown") setActive(active + 1);
      else if (k === "ArrowUp") setActive(active - 1);
      else if (k === "Home") setActive(0);
      else if (k === "End") setActive(opts.length - 1);
      else if (k === "PageDown") setActive(active + 8);
      else if (k === "PageUp") setActive(active - 8);
      else if (k === "Enter" || k === " ") choose(active);
      else if (k === "Escape") close();
      else if (k === "Tab") { close(false); return; }
      else if (k.length === 1) {
        // busca por digitação: número do efeito ou começo do nome
        const now = Date.now();
        typed = (now - typedAt < 700 ? typed : "") + k.toLowerCase();
        typedAt = now;
        const hit = items.findIndex(it => String(it.hint ?? "") === typed) >= 0
          ? items.findIndex(it => String(it.hint ?? "") === typed)
          : items.findIndex(it => it.label.toLowerCase().startsWith(typed));
        if (hit >= 0) setActive(hit);
      } else return;
      e.preventDefault();
    });

    Object.defineProperty(host, "value", {
      get: () => (value === null ? "" : String(value)),
      set: v => { const it = items.find(x => String(x.value) === String(v)); value = it ? it.value : null; render(); },
    });
    host.has = v => items.some(x => String(x.value) === String(v));
    render();
    return host;
  }

  // ---------- slider em degraus ----------
  function slider(host, { min = 0, max = 4, value = max, label = "", icon: ic = null, valueText = v => String(v) } = {}) {
    host.classList.add("ui-slider");
    const steps = max - min;
    const labelId = nextId("sl");
    host.innerHTML =
      `<div class="ui-slider-head"><span class="ui-slider-label" id="${labelId}">${ic ? icon(ic, 14) : ""}${label}</span>` +
      `<span class="ui-slider-val"></span></div>` +
      `<div class="ui-slider-track" role="slider" tabindex="0" aria-labelledby="${labelId}" aria-valuemin="${min}" aria-valuemax="${max}">` +
      `<div class="ui-slider-fill"></div>` +
      Array.from({ length: steps + 1 }, (_, i) => `<span class="ui-slider-tick" style="left:${(i / steps) * 100}%"></span>`).join("") +
      `<div class="ui-slider-thumb"></div></div>`;
    const track = host.querySelector(".ui-slider-track"), valEl = host.querySelector(".ui-slider-val");
    let v = value;

    function render() {
      const p = ((v - min) / steps) * 100;
      host.style.setProperty("--p", p + "%");
      track.setAttribute("aria-valuenow", v);
      track.setAttribute("aria-valuetext", valueText(v));
      valEl.textContent = valueText(v);
      host.querySelectorAll(".ui-slider-tick").forEach((t, i) => t.classList.toggle("on", i <= v - min));
    }
    function set(n, user) {
      n = clamp(Math.round(n), min, max);
      if (n === v) return;
      v = n; render();
      if (user) fire(host, "input");
    }
    const fromX = x => {
      const r = track.getBoundingClientRect();
      return min + ((x - r.left) / r.width) * steps;
    };
    track.addEventListener("pointerdown", e => {
      if (host.disabled) return;
      track.setPointerCapture(e.pointerId);
      track.focus();
      set(fromX(e.clientX), true);
      host.classList.add("dragging");
    });
    track.addEventListener("pointermove", e => { if (track.hasPointerCapture(e.pointerId)) set(fromX(e.clientX), true); });
    const end = () => host.classList.remove("dragging");
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
    track.addEventListener("keydown", e => {
      const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 };
      if (e.key in map) set(v + map[e.key], true);
      else if (e.key === "Home") set(min, true);
      else if (e.key === "End") set(max, true);
      else return;
      e.preventDefault();
    });
    Object.defineProperty(host, "value", { get: () => v, set: n => { v = clamp(+n || 0, min, max); render(); } });
    render();
    return host;
  }

  // ---------- switch ----------
  function switchEl(btn) {
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.classList.add("ui-switch");
    btn.insertAdjacentHTML("afterbegin", `<span class="ui-switch-track" aria-hidden="true"><span class="ui-switch-thumb"></span></span>`);
    Object.defineProperty(btn, "checked", {
      get: () => btn.getAttribute("aria-checked") === "true",
      set: c => btn.setAttribute("aria-checked", String(!!c)),
    });
    btn.addEventListener("click", () => { btn.checked = !btn.checked; fire(btn, "change"); });
    return btn;
  }

  // ---------- botão liga/desliga (chips de modificador) ----------
  function toggle(btn) {
    btn.type = "button";
    if (!btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", "false");
    Object.defineProperty(btn, "pressed", {
      get: () => btn.getAttribute("aria-pressed") === "true",
      set: c => btn.setAttribute("aria-pressed", String(!!c)),
    });
    btn.addEventListener("click", () => { btn.pressed = !btn.pressed; fire(btn, "change"); });
    return btn;
  }

  // ---------- grupo segmentado (radiogroup) ----------
  // O estado visual é a classe .on (o app já a usa); aqui só sincroniza o ARIA e as setas.
  function segmented(host) {
    host.setAttribute("role", "radiogroup");
    const btns = () => [...host.querySelectorAll("button")];
    const sync = () => btns().forEach(b => {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", b.classList.contains("on"));
      b.tabIndex = b.classList.contains("on") ? 0 : -1;
    });
    new MutationObserver(sync).observe(host, { subtree: true, attributes: true, attributeFilter: ["class"] });
    host.addEventListener("keydown", e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const all = btns(), live = all.filter(b => !b.disabled);
      const i = live.indexOf(document.activeElement);
      const next = live[(i + d + live.length) % live.length];
      next.focus(); next.click();
    });
    sync();
    return host;
  }

  // ---------- abas ----------
  function tabs(list, { storageKey } = {}) {
    list.setAttribute("role", "tablist");
    const tabsEls = [...list.querySelectorAll("[data-tab]")];
    function show(name, focus) {
      tabsEls.forEach(t => {
        const on = t.dataset.tab === name;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        if (on && focus) t.focus();
      });
      try { storageKey && localStorage.setItem(storageKey, name); } catch {}
    }
    tabsEls.forEach(t => {
      t.setAttribute("role", "tab");
      t.addEventListener("click", () => show(t.dataset.tab));
    });
    list.addEventListener("keydown", e => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const i = tabsEls.findIndex(t => t.getAttribute("aria-selected") === "true");
      show(tabsEls[(i + d + tabsEls.length) % tabsEls.length].dataset.tab, true);
      e.preventDefault();
    });
    let first = tabsEls[0].dataset.tab;
    try { const s = storageKey && localStorage.getItem(storageKey); if (tabsEls.some(t => t.dataset.tab === s)) first = s; } catch {}
    show(first);
    return { show };
  }

  // ---------- seção recolhível (no lugar de <details>) ----------
  function disclosure(btn) {
    btn.type = "button";
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
    return btn;
  }

  // ---------- seletor de cor (um popover para todos os quadradinhos) ----------
  const hexOk = s => /^#?[0-9a-f]{6}$/i.test(s.trim());
  const normHex = s => "#" + s.trim().replace("#", "").toLowerCase();
  function hexToHsv(h) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hue = 0;
    if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hue * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
  }
  function hsvToHex({ h, s, v }) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return "#" + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }
  // cores puras rendem melhor nos LEDs; preto = apagado
  const PRESETS = ["#ffffff", "#ff0000", "#ff6000", "#ffd000", "#00ff00", "#00ffff", "#0000ff", "#8000ff", "#ff00ff", "#000000"];

  let picker = null;
  function buildPicker() {
    const el = document.createElement("div");
    el.className = "ui-popover ui-color";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Escolher cor");
    el.hidden = true;
    el.innerHTML =
      `<div class="ui-color-sv" role="slider" tabindex="0" aria-label="Saturação e brilho"><div class="ui-color-sv-thumb"></div></div>` +
      `<div class="ui-color-hue" role="slider" tabindex="0" aria-label="Matiz" aria-valuemin="0" aria-valuemax="360"><div class="ui-color-hue-thumb"></div></div>` +
      `<div class="ui-color-row"><span class="ui-color-preview"></span>` +
      `<input class="ui-input mono ui-color-hex" type="text" spellcheck="false" maxlength="7" aria-label="Cor em hexadecimal"></div>` +
      `<div class="ui-color-presets">${PRESETS.map(c => `<button type="button" class="ui-color-preset" style="--c:${c}" data-c="${c}" aria-label="${c === "#000000" ? "Apagado" : c}"></button>`).join("")}</div>`;
    document.body.appendChild(el);
    const sv = el.querySelector(".ui-color-sv"), hue = el.querySelector(".ui-color-hue"), hexIn = el.querySelector(".ui-color-hex");
    const st = { hsv: { h: 0, s: 0, v: 0 }, target: null };

    function paint(fromInput) {
      const { h, s, v } = st.hsv, hx = hsvToHex(st.hsv);
      el.style.setProperty("--hue", `hsl(${h} 100% 50%)`);
      el.style.setProperty("--c", hx);
      el.style.setProperty("--sx", s * 100 + "%");
      el.style.setProperty("--sy", (1 - v) * 100 + "%");
      el.style.setProperty("--hx", (h / 360) * 100 + "%");
      hue.setAttribute("aria-valuenow", Math.round(h));
      sv.setAttribute("aria-valuetext", `saturação ${Math.round(s * 100)}%, brilho ${Math.round(v * 100)}%`);
      if (!fromInput) hexIn.value = hx;
      if (st.target && st.target.value !== hx) { st.target.value = hx; fire(st.target, "input"); }
    }
    function drag(area, onMove) {
      area.addEventListener("pointerdown", e => {
        area.setPointerCapture(e.pointerId);
        const at = ev => { const r = area.getBoundingClientRect(); onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); paint(); };
        at(e);
        const mv = ev => at(ev);
        const up = () => { area.removeEventListener("pointermove", mv); area.removeEventListener("pointerup", up); };
        area.addEventListener("pointermove", mv);
        area.addEventListener("pointerup", up);
      });
    }
    drag(sv, (x, y) => { st.hsv.s = x; st.hsv.v = 1 - y; });
    drag(hue, x => { st.hsv.h = Math.min(x * 360, 359.9); });
    sv.addEventListener("keydown", e => {
      const d = 0.05, m = { ArrowRight: ["s", d], ArrowLeft: ["s", -d], ArrowUp: ["v", d], ArrowDown: ["v", -d] }[e.key];
      if (!m) return;
      st.hsv[m[0]] = clamp(st.hsv[m[0]] + m[1], 0, 1); paint(); e.preventDefault();
    });
    hue.addEventListener("keydown", e => {
      const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
      if (!d) return;
      st.hsv.h = (st.hsv.h + d + 360) % 360; paint(); e.preventDefault();
    });
    hexIn.addEventListener("input", () => { if (hexOk(hexIn.value)) { st.hsv = hexToHsv(normHex(hexIn.value)); paint(true); } });
    hexIn.addEventListener("blur", () => (hexIn.value = hsvToHex(st.hsv)));
    el.querySelectorAll(".ui-color-preset").forEach(b => b.addEventListener("click", () => { st.hsv = hexToHsv(b.dataset.c); paint(); }));

    el.close = () => {
      if (el.hidden) return;
      el.hidden = true;
      openPopovers.delete(el);
      st.target?.setAttribute("aria-expanded", "false");
      st.target?.focus();
      st.target = null;
    };
    el.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); el.close(); } });
    el.openFor = target => {
      if (!el.hidden && st.target === target) return el.close();
      el.close();
      st.target = target;
      st.hsv = hexToHsv(target.value);
      paint();
      el.hidden = false;
      target.setAttribute("aria-expanded", "true");
      // abaixo do quadradinho, sem sair da tela
      const r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8);
      const top = r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8;
      el.style.left = left + scrollX + "px";
      el.style.top = Math.max(8, top) + scrollY + "px";
      openPopovers.add(el);
      setTimeout(() => sv.focus(), 0);
    };
    return el;
  }

  function swatch(btn, value = "#000000") {
    btn.type = "button";
    btn.classList.add("ui-swatch");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    let v = value;
    const render = () => { btn.style.setProperty("--c", v); btn.classList.toggle("off", v === "#000000"); btn.dataset.hex = v; };
    Object.defineProperty(btn, "value", { get: () => v, set: x => { v = hexOk(x) ? normHex(x) : v; render(); } });
    btn.addEventListener("click", e => {
      e.stopPropagation();
      picker ??= buildPicker();
      picker.openFor(btn);
    });
    // o pointerdown fora fecha o popover; neste próprio botão o click decide
    btn.addEventListener("pointerdown", e => e.stopPropagation());
    render();
    return btn;
  }

  // ---------- diálogo de confirmação (no lugar de confirm()) ----------
  // A 1ª linha da mensagem vira o título; o resto, o corpo. Diálogos que gravam no teclado levam o aviso.
  const DISCLAIMER = "Feito a partir da análise e do estudo do software original do teclado. " +
    "O autor não se responsabiliza por danos ao teclado: use por sua conta e risco.";
  function ask(message, { confirm = "Gravar", cancel = "Cancelar", danger = false, disclaimer = true } = {}) {
    const [title, ...rest] = message.split("\n");
    const body = rest.join("\n").trim();
    return new Promise(resolve => {
      const prev = document.activeElement;
      const tid = nextId("dlg");
      const ov = document.createElement("div");
      ov.className = "ui-overlay";
      ov.innerHTML =
        `<div class="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${tid}" ${body ? `aria-describedby="${tid}-b"` : ""}>` +
        `<div class="ui-dialog-icon${danger ? " danger" : ""}">${icon(danger ? "triangle-alert" : "save", 18)}</div>` +
        `<h2 id="${tid}"></h2>${body ? `<div class="ui-dialog-body" id="${tid}-b"></div>` : ""}` +
        (disclaimer ? `<p class="disclaimer">${icon("triangle-alert", 14)}<span>${DISCLAIMER}</span></p>` : "") +
        `<div class="ui-dialog-actions"><button type="button" class="btn ghost" data-r="0">${cancel}</button>` +
        `<button type="button" class="btn ${danger ? "danger" : "primary"}" data-r="1">${confirm}</button></div></div>`;
      ov.querySelector("h2").textContent = title;
      if (body) ov.querySelector(".ui-dialog-body").textContent = body;
      document.body.appendChild(ov);
      document.body.classList.add("modal-open");
      const btns = [...ov.querySelectorAll("button")];
      const done = r => {
        ov.classList.add("closing");
        document.body.classList.remove("modal-open");
        setTimeout(() => ov.remove(), 120);
        prev?.focus?.();
        resolve(r);
      };
      btns.forEach(b => b.addEventListener("click", () => done(b.dataset.r === "1")));
      ov.addEventListener("pointerdown", e => { if (e.target === ov) done(false); });
      ov.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.preventDefault(); done(false); }
        if (e.key === "Tab") { // foco preso no diálogo
          const i = btns.indexOf(document.activeElement);
          btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
          e.preventDefault();
        }
      });
      btns[danger ? 0 : 1].focus(); // ação perigosa: o foco começa no Cancelar
    });
  }

  // ---------- avisos rápidos ----------
  let toastBox = null;
  function toast(msg, kind = "info") {
    toastBox ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "ui-toasts" });
    toastBox.setAttribute("role", "status");
    toastBox.setAttribute("aria-live", "polite");
    const t = document.createElement("div");
    t.className = `ui-toast ${kind}`;
    t.innerHTML = icon({ ok: "circle-check", err: "circle-x", warn: "triangle-alert" }[kind] ?? "info", 16) + `<span></span>`;
    t.lastChild.textContent = msg;
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    const bye = () => { t.classList.add("closing"); setTimeout(() => t.remove(), 160); };
    t.addEventListener("click", bye);
    setTimeout(bye, kind === "err" ? 7000 : 4000);
  }

  window.UI = { select, slider, switch: switchEl, toggle, segmented, tabs, disclosure, swatch, ask, toast };
})();
