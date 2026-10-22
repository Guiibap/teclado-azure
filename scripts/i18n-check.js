#!/usr/bin/env node
// i18n-check.js — confere as chaves de texto (sem dependências): node scripts/i18n-check.js
const fs = require("fs"), path = require("path");
const web = path.join(__dirname, "..", "web");
const dictDir = path.join(web, "i18n");
const REF = "pt-BR";

const dicts = {};
for (const f of fs.readdirSync(dictDir).filter(f => f.endsWith(".js"))) {
  const window = { STRINGS: {} };
  new Function("window", fs.readFileSync(path.join(dictDir, f), "utf8"))(window);
  Object.assign(dicts, window.STRINGS);
}
const ref = new Set(Object.keys(dicts[REF] || {}));

const used = new Map(); // chave → arquivos
const dynamic = [];     // prefixos montados em tempo de execução: t("effects." + i)
const add = (k, f) => used.set(k, [...(used.get(k) || []), f]);
for (const f of fs.readdirSync(web).filter(f => /\.(js|html)$/.test(f))) {
  const src = fs.readFileSync(path.join(web, f), "utf8");
  for (const m of src.matchAll(/\bt(?:Html)?\(\s*["']([\w.]+)["']\s*([,)+])/g)) m[2] === "+" ? dynamic.push(m[1]) : add(m[1], f);
  for (const m of src.matchAll(/data-i18n(?:-[\w-]+)?="([\w.]+)"/g)) add(m[1], f);
  for (const m of src.matchAll(/(?:header|t)\(\s*on \?/g)) void m;
}
// chaves escolhidas por ternário ou guardadas em dados: qualquer texto entre aspas que seja uma chave do pt-BR conta como uso
for (const f of fs.readdirSync(web).filter(f => /\.(js|html)$/.test(f))) {
  if (f === "i18n.js") continue;
  const src = fs.readFileSync(path.join(web, f), "utf8");
  for (const m of src.matchAll(/["'`]([a-zA-Z][\w]*(?:\.[\w]+)+)["'`]/g)) if (ref.has(m[1])) add(m[1], f);
}
let bad = 0;
const section = (title, list) => { if (!list.length) return; bad++; console.log(`\n${title} (${list.length})`); list.forEach(l => console.log("  " + l)); };

section("Usadas no código e ausentes no " + REF,
  [...used].filter(([k]) => !ref.has(k)).map(([k, f]) => `${k}  [${[...new Set(f)].join(", ")}]`));
section("No " + REF + " e sem uso no código",
  [...ref].filter(k => !used.has(k) && !dynamic.some(p => k.startsWith(p)) && k !== "meta.name"));
for (const [lang, d] of Object.entries(dicts)) {
  if (lang === REF) continue;
  section(`Faltam em ${lang}`, [...ref].filter(k => !(k in d)));
  section(`Sobram em ${lang}`, Object.keys(d).filter(k => !ref.has(k)));
}
console.log(bad ? "\nHá pendências acima." : `OK: ${ref.size} chaves, ${Object.keys(dicts).length} idioma(s).`);
process.exit(bad ? 1 : 0);
