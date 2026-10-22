#!/usr/bin/env node
// Gera web/layout.js: geometria ABNT2 do K652 brasileiro (foto teclado-azure.jpg)
// + LED/VK do extracted/app/cfg.ini (que descreve a versão ANSI) casados pelo índice de matriz.
const fs = require("fs");
const path = require("path");
const ini = fs.readFileSync(path.join(__dirname, "..", "extracted/app/cfg.ini"), "latin1");

const lines = ini.split(/\r?\n/);
const cfgKeys = [];
let pendingName = null;
for (const raw of lines) {
  const line = raw.trim();
  if (/^;/.test(line)) { pendingName = line.replace(/^;+\s*/, ""); continue; }
  const m = line.match(/^K(\d+)\s*=\s*(.+)$/);
  if (m) {
    const parts = m[2].split(",").map(s => s.trim());
    if (parts.length < 9) { continue; }
    const n = (s) => s.startsWith("0x") || s.startsWith("0X") ? parseInt(s, 16) : parseInt(s, 10);
    cfgKeys.push({
      id: parseInt(m[1], 10),
      name: pendingName || ("K" + m[1]),
      type: n(parts[4]), vk: n(parts[5]), extra: n(parts[6]),
      matrix: n(parts[7]), led: n(parts[8]),
    });
    pendingName = null;
  } else if (line && !/^\/\//.test(line)) {
    pendingName = null;
  }
}

// [OPT] valores úteis
const opt = {};
for (const raw of lines) {
  const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (m && !(m[1] in opt)) opt[m[1]] = m[2].trim();
}
const optKeys = ["Title","VID","PID","PSD","GaoshouIndex","GaoshouKey1","GaoshouKey2","GaoshouKey3","GaoshouKey4","GaoshouKey5","DefLedIndex","LEDParam","RGBIndex","GameRGBIndex","LedMask","clrMask","Txt_clr","ClrKeyOv","ClrKeyDn","ClrKeyHasFunc","ProAddr","RgbTabAddr","GameAddr","KeyAddr","MaxFnNum","SyncKB","ShowMusic","GaoshouGroupNum"];
const opts = {};
for (const k of optKeys) if (opt[k] !== undefined) opts[k] = opt[k];
for (let i = 1; i <= 22; i++) if (opt["LedOpt" + i]) opts["LedOpt" + i] = opt["LedOpt" + i];

// ---------- geometria ABNT2 (75%, 16u por linha) ----------
// [rótulo, largura em u, índice de matriz]. Índices confirmados pelo GetMatrix ao vivo:
// a matriz é coluna×6 + linha. Teclas que só existem na versão BR (fora do cfg ANSI):
//   70 = \| (HID 0x64) e 75 = ]} (HID 0x31). "/?" ocupa o índice 76, que o firmware
//   declara como RShift — a confirmar com o testador de teclas da página.
const ROWS = [
  [["Esc",1,0],["F1",1,6],["F2",1,12],["F3",1,18],["F4",1,24],["F5",1,30],["F6",1,36],["F7",1,42],
   ["F8",1,48],["F9",1,54],["F10",1,60],["F11",1,66],["F12",1,72],["PrtSc",1,78],["Pause",1,84],["Del",1,90]],
  [["' \"",1,1],["1 !",1,7],["2 @",1,13],["3 #",1,19],["4 $",1,25],["5 %",1,31],["6 ¨",1,37],["7 &",1,43],
   ["8 *",1,49],["9 (",1,55],["0 )",1,61],["- _",1,67],["= +",1,73],["Backspace",2,79],["Home",1,85]],
  [["Tab",1.5,2],["Q",1,8],["W",1,14],["E",1,20],["R",1,26],["T",1,32],["Y",1,38],["U",1,44],["I",1,50],
   ["O",1,56],["P",1,62],["´ `",1,68],["[ {",1,74],["Enter",1.5,81,"iso-enter"],["End",1,86]],
  [["CapsLock",1.75,3],["A",1,9],["S",1,15],["D",1,21],["F",1,27],["G",1,33],["H",1,39],["J",1,45],
   ["K",1,51],["L",1,57],["Ç",1,63],["~ ^",1,69],["] }",1,75],[null,1.25],["PgUp",1,87]],
  [["Shift",1.25,4],["\\ |",1,70],["Z",1,10],["X",1,16],["C",1,22],["V",1,28],["B",1,34],["N",1,40],
   ["M",1,46],[", <",1,52],[". >",1,58],["; :",1,64],["/ ?",1.75,76],["↑",1,82],["PgDn",1,88]],
  [["Ctrl",1.25,5],["Win",1.25,11],["Alt",1.25,17],["Space",6.25,35],["AltGr",1,53],["Fn",1,59],
   ["Menu",1,65],["←",1,77],["↓",1,83],["→",1,89]],
];

const U = 36, GAP = 4, PAD = 4;
const byMatrix = new Map(cfgKeys.map(k => [k.matrix, k]));
const keys = [];
ROWS.forEach((row, r) => {
  let x = 0;
  for (const [name, w, matrix, shape] of row) {
    if (name !== null) {
      const cfg = byMatrix.get(matrix);
      const h = shape === "iso-enter" ? 2 : 1;
      keys.push({
        id: keys.length + 1, name,
        x1: PAD + x * U, y1: PAD + r * U,
        x2: PAD + (x + w) * U - GAP, y2: PAD + (r + h) * U - GAP,
        type: cfg ? cfg.type : 2, vk: cfg ? cfg.vk : 0, extra: cfg ? cfg.extra : 0,
        matrix, led: cfg ? cfg.led : null,
        ...(shape ? { shape } : {}),
      });
    }
    x += w;
  }
  if (Math.abs(x - 16) > 1e-9) throw new Error(`linha ${r} soma ${x}u, esperado 16u`);
});

const width = Math.max(...keys.map(k => k.x2)) + PAD;
const height = Math.max(...keys.map(k => k.y2)) + PAD;
const out = `// Gerado por tools/gen-layout.js (geometria ABNT2 + LED/VK do cfg.ini) — não editar à mão
window.KB_LAYOUT = ${JSON.stringify({ keys, opts, width, height }, null, 1)};
`;
fs.writeFileSync(path.join(__dirname, "..", "web", "layout.js"), out);
console.log(`OK: ${keys.length} teclas, canvas ${width}x${height}`);
console.log("sem LED no cfg:", keys.filter(k => k.led === null).map(k => `${k.name}(m${k.matrix})`).join(", ") || "nenhuma");
console.log("opts:", Object.keys(opts).length, "keys");
