// i18n.js — textos da interface: t(), aplicação no DOM e escolha do idioma (ver PLANO-I18N.md).
// Os dicionários (i18n/*.js) preenchem window.STRINGS[idioma] e carregam antes deste arquivo.
(() => {
  const S = (window.STRINGS = window.STRINGS || {});
  const FALLBACK = "pt-BR";
  const STORE = "k652.lang";
  const warned = new Set();

  // Pseudo-idioma para teste (?lang=xx): o pt-BR entre colchetes e ~35% mais longo; variáveis {x} ficam intactas.
  function pseudo(src) {
    const stretch = s => s.split(/(\{\w+\})/).map(p => /^\{\w+\}$/.test(p) ? p
      : p.replace(/[^\s<>]+/g, w => w + "~".repeat(Math.round(w.length * 0.35)))).join("");
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === "meta.name") out[k] = "Pseudo [xx]";
      else if (typeof v === "string") out[k] = "[" + stretch(v) + "]";
      else out[k] = Object.fromEntries(Object.entries(v).map(([c, s]) => [c, "[" + stretch(s) + "]"]));
    }
    return out;
  }
  let wantPseudo = false;
  try { wantPseudo = new URLSearchParams(location.search).get("lang") === "xx"; } catch {}
  if (wantPseudo && S[FALLBACK]) S.xx = pseudo(S[FALLBACK]);

  const langs = () => Object.keys(S).filter(l => l !== "xx" || wantPseudo);

  function pick() {
    const have = langs();
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q && have.includes(q)) return q;
      const saved = localStorage.getItem(STORE);
      if (saved && have.includes(saved)) return saved;
    } catch {}
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const p of prefs) if (p && have.includes(p)) return p;
    for (const p of prefs) {
      const base = p?.split("-")[0].toLowerCase();
      const hit = have.find(l => l.split("-")[0].toLowerCase() === base);
      if (hit) return hit;
    }
    return FALLBACK;
  }

  let lang = pick();

  function lookup(key) {
    let v = S[lang]?.[key];
    if (v === undefined) v = S[FALLBACK]?.[key];
    if (v === undefined && !warned.has(key)) { warned.add(key); console.warn(`[i18n] chave sem texto: ${key}`); }
    return v;
  }

  const escHtml = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  function fill(v, vars, escape) {
    return v.replace(/\{(\w+)\}/g, (m, name) => {
      if (!vars || vars[name] === undefined) return m;
      const x = String(vars[name]);
      return escape ? escHtml(x) : x;
    });
  }

  function render(key, vars, escape) {
    let v = lookup(key);
    if (v === undefined) return key;
    if (typeof v === "object") { // plural: categorias do Intl.PluralRules, "other" como reserva
      const cat = new Intl.PluralRules(lang).select(Number(vars?.n));
      v = v[cat] ?? v.other ?? "";
    }
    return fill(v, vars, escape);
  }

  // texto simples (textContent, atributos, log, diálogos)
  const t = (key, vars) => render(key, vars, false);
  // texto que vai para innerHTML: as variáveis são escapadas (o texto do dicionário é confiável)
  const tHtml = (key, vars) => render(key, vars, true);

  const ATTRS = { placeholder: "placeholder", "aria-label": "aria-label", title: "title", content: "content" };

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-i18n-html]").forEach(el => (el.innerHTML = t(el.dataset.i18nHtml)));
    for (const [name, attr] of Object.entries(ATTRS)) {
      const ds = "i18n" + name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()); // data-i18n-aria-label → i18nAriaLabel
      root.querySelectorAll(`[data-i18n-${name}]`).forEach(el => el.setAttribute(attr, t(el.dataset[ds])));
    }
  }

  function setLang(next) {
    if (!langs().includes(next) || next === lang) return;
    try { localStorage.setItem(STORE, next); } catch {}
    // tudo que o JS desenha (teclas, lista de funções, efeitos) é montado na carga: recarregar é o caminho simples
    location.reload();
  }

  const fmtDate = (date, opts = { dateStyle: "short", timeStyle: "medium" }) => {
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d) ? String(date) : d.toLocaleString(lang, opts);
  };
  const fmtTime = (date = new Date()) => date.toLocaleTimeString(lang);
  const fmtNumber = n => Number(n).toLocaleString(lang);

  document.documentElement.lang = lang;

  window.t = t;
  window.tHtml = tHtml;
  window.I18N = {
    get lang() { return lang; },
    get langs() { return langs(); },
    name: l => S[l]?.["meta.name"] ?? l,
    set: setLang, apply, fmtDate, fmtTime, fmtNumber,
  };
})();
