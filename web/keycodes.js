// keycodes.js — Decodificação da matriz de teclas (resposta do GetMatrix, cmd 0x84)
// Formato confirmado com dump ao vivo do K652 (ver analysis/protocol-notes.md).
//
// Matriz = 0x400 bytes (resp[7..]):
//   +0x000  KeyMatrix:  132 entradas (camada base, indexada pelo "matrix" do layout)
//   +0x210  FnBase:      48 entradas (o que a tecla faz sem Fn, quando a base é tipo 2)
//   +0x2D0  FnLayer:     48 entradas (o que a tecla faz com Fn pressionado)
// Cada entrada = 4 bytes [tipo][b1][param][código].

const KEY_TYPE = {
  KEY: 0x00,        // tecla HID (page 0x07); param = máscara de modificadores (combo)
  CONSUMER: 0x04,   // mídia (page 0x0C); usage de 16 bits = (param << 8) | código
  MODIFIER: 0x06,   // modificador: código E0..E7 (E3 = Fn neste teclado)
  DUAL: 0x02,       // tecla com camada Fn: código = índice nas tabelas FnBase/FnLayer
  LED_BRIGHT: 0x0c, // param 1 = +, 2 = − (inferido: Fn+↑/↓)
  LED_SPEED: 0x0d,  // param 1 = +, 2 = − (inferido: Fn+→/←)
  INTERNAL: 0x0e,   // função interna do firmware (sem nome no app original)
  FN: 0x20,         // a própria tecla Fn (tabela do modo Mac, D8)
};

const HID_NAMES = (() => {
  const t = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => (t[0x04 + i] = c));
  "1234567890".split("").forEach((c, i) => (t[0x1e + i] = c));
  Object.assign(t, {
    // símbolos com a legenda ABNT2 (o que sai com o teclado configurado como "Brasileiro" no macOS)
    0x28: "Enter", 0x29: "Esc", 0x2a: "Backspace", 0x2b: "Tab", 0x2c: "Space", 0x2d: "- _", 0x2e: "= +",
    0x2f: "´ `", 0x30: "[ {", 0x31: "] }", 0x32: "] } (ISO)", 0x33: "Ç", 0x34: "~ ^", 0x35: "' \"",
    0x36: ", <", 0x37: ". >", 0x38: "; :", 0x39: "CapsLock", 0x46: "PrtSc", 0x47: "ScrollLock", 0x48: "Pause",
    0x49: "Insert", 0x4a: "Home", 0x4b: "PgUp", 0x4c: "Delete", 0x4d: "End", 0x4e: "PgDn",
    0x4f: "→", 0x50: "←", 0x51: "↓", 0x52: "↑", 0x53: "NumLock", 0x54: "KP/", 0x55: "KP*",
    0x56: "KP-", 0x57: "KP+", 0x58: "KPEnter", 0x63: "KP.", 0x64: "\\ |", 0x65: "Menu",
    0x85: "KP,", 0x87: "/ ?", 0x88: "Intl2(Kana)", 0x89: "Intl3(Yen)", 0x8a: "Intl4(Henkan)",
    0x8b: "Intl5(Muhenkan)", 0x90: "Lang1", 0x91: "Lang2",
    // modificadores: nome do Mac primeiro, do Windows entre parênteses
    0xe0: "Control", 0xe1: "Shift", 0xe2: "Option (Alt)", 0xe3: "Command (Win)", 0xe4: "Control dir.",
    0xe5: "Shift dir.", 0xe6: "Option dir. (AltGr)", 0xe7: "Command dir.",
  });
  for (let i = 0; i < 12; i++) t[0x3a + i] = "F" + (i + 1);
  for (let i = 0; i < 12; i++) t[0x68 + i] = "F" + (i + 13);
  for (let i = 0; i < 9; i++) t[0x59 + i] = "KP" + (i + 1);
  t[0x62] = "KP0";
  return t;
})();

const CONSUMER_NAMES = Object.fromEntries(["0x006f", "0x0070", "0x00b5", "0x00b6", "0x00b7", "0x00cd", "0x00cf", "0x00e2", "0x00e9", "0x00ea", "0x0183", "0x018a", "0x0192", "0x0194", "0x0221", "0x0223", "0x0224", "0x0225", "0x0227", "0x022a"].map(h => [parseInt(h, 16), t("consumer." + h)]));

// Funções internas (tipo 0x0e): nomes das legendas dos keycaps (foto teclado-azure.jpg) e do manual (Fn+Esc, Fn+Espaço)
const INTERNAL_NAMES = Object.fromEntries(["0x05", "0x0c", "0x0d", "0x0e", "0x0f", "0x16"].map(h => [parseInt(h, 16), t("internal." + h)]));

// bits do param de uma tecla tipo 0 (máscara de modificadores HID); exibidos na ordem do Mac ⌃⌥⇧⌘
const MOD_BITS = [
  { bit: 0, sym: "⌃" }, { bit: 2, sym: "⌥" }, { bit: 1, sym: "⇧" }, { bit: 3, sym: "⌘" },
  { bit: 4, sym: "⌃dir" }, { bit: 6, sym: "⌥dir" }, { bit: 5, sym: "⇧dir" }, { bit: 7, sym: "⌘dir" },
];

function hexb(n, w = 2) { return n.toString(16).padStart(w, "0"); }

// Decodifica uma entrada [tipo][b1][param][código] num texto curto.
function describeEntry(e) {
  const [type, , param, code] = e;
  switch (type) {
    case KEY_TYPE.KEY: {
      if (!code && !param) return "—";
      const mods = MOD_BITS.filter(m => param & (1 << m.bit)).map(m => m.sym).join("");
      return mods + (HID_NAMES[code] ?? `HID 0x${hexb(code)}`);
    }
    case KEY_TYPE.MODIFIER: return HID_NAMES[code] ?? `Mod 0x${hexb(code)}`;
    case KEY_TYPE.CONSUMER: {
      const u = (param << 8) | code;
      return CONSUMER_NAMES[u] ?? t("entry.media", { code: hexb(u, 4) });
    }
    case KEY_TYPE.LED_BRIGHT: return t("entry.ledBright", { v: param === 1 ? "+" : param === 2 ? "−" : param });
    case KEY_TYPE.LED_SPEED: return t("entry.ledSpeed", { v: param === 1 ? "+" : param === 2 ? "−" : param });
    case KEY_TYPE.FN: return "Fn";
    case KEY_TYPE.INTERNAL: return INTERNAL_NAMES[code] ?? t("entry.internal", { code: hexb(code) });
    // manual + teste ao vivo: Fn+PgUp troca o efeito, Fn+End grava luz por tecla, Fn+PgDn muda a cor
    case 0x0b: return param === 3 ? t("entry.ledNext") : param === 0 && code === 0x20 ? t("entry.ledPerKey") : `tipo 0x0b [${hexb(param)} ${hexb(code)}]`;
    case 0x12: return param === 3 ? t("entry.ledColor") : `tipo 0x12 [${hexb(param)} ${hexb(code)}]`;
    default: return `tipo 0x${hexb(type)} [${hexb(param)} ${hexb(code)}]`;
  }
}

// data = 0x400 bytes a partir de resp[7]
// Cada tecla diz onde mora a sua função normal (normalOff) e, se tiver camada Fn, a do Fn (fnOff).
function parseMatrix(data) {
  const entry = off => [...data.slice(off, off + 4)];
  const table = (base, n) => Array.from({ length: n }, (_, i) => entry(base + i * 4));
  const fnBase = table(0x210, 48);
  const fnLayer = table(0x2d0, 48);
  const keys = table(0x000, 132).map((raw, idx) => {
    if (raw[0] === KEY_TYPE.DUAL && raw[3] < 48) {
      const i = raw[3];
      return {
        raw, dualIndex: i, normal: describeEntry(fnBase[i]), fn: describeEntry(fnLayer[i]),
        normalOff: 0x210 + i * 4, fnOff: 0x2d0 + i * 4,
      };
    }
    return { raw, normal: describeEntry(raw), fn: null, normalOff: idx * 4, fnOff: null };
  });
  return { keys, fnBase, fnLayer };
}

// ---------- catálogo de funções para o remapeador ----------
// bytes = entrada pronta [tipo][b1][param][código]; combo = aceita modificadores (só tipo 0)
const CATALOG = (() => {
  const out = [];
  const key = (group, code) => out.push({ group, label: HID_NAMES[code], bytes: [0, 0, 0, code], combo: true });
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((_, i) => key(t("group.letters"), 0x04 + i));
  for (let i = 0; i < 10; i++) key(t("group.numbers"), 0x1e + i);
  [0x35, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x36, 0x37, 0x38, 0x87, 0x64].forEach(c => key(t("group.symbols"), c));
  [0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x39, 0x4c, 0x49, 0x65].forEach(c => key(t("group.editing"), c));
  [0x52, 0x51, 0x50, 0x4f, 0x4a, 0x4d, 0x4b, 0x4e].forEach(c => key(t("group.navigation"), c));
  for (let i = 0; i < 12; i++) key(t("group.f1"), 0x3a + i);
  for (let i = 0; i < 8; i++) key(t("group.f13"), 0x68 + i);
  [0x46, 0x47, 0x48].forEach(c => key(t("group.system"), c));
  // Fn: na tabela do modo Mac (D8) a tecla Fn é a entrada tipo 0x20. Na do Windows (D4) a posição do Fn
  // guarda um E3 e, ligado no Mac, ela manda Command (teste 2026-10-22). Gravar 0x20 em D4 é experimental.
  out.push({ group: t("group.modifiers"), label: "Fn", bytes: [KEY_TYPE.FN, 0, 0, 0] });
  for (let c = 0xe0; c <= 0xe7; c++) out.push({ group: t("group.modifiers"), label: HID_NAMES[c], bytes: [KEY_TYPE.MODIFIER, 0, 0, c] });
  for (const u of [0xcd, 0xb6, 0xb5, 0xe2, 0xea, 0xe9, 0x6f, 0x70, 0xcf, 0x221, 0x223, 0x224, 0x225, 0x192])
    out.push({ group: t("group.media"), label: CONSUMER_NAMES[u], bytes: [KEY_TYPE.CONSUMER, 0, u >> 8, u & 0xff] });
  out.push({ group: t("group.other"), label: t("entry.disable"), bytes: [0, 0, 0, 0] });
  return out;
})();

// modificadores escolhidos (bits) + item do catálogo → entrada de 4 bytes
function encodeChoice(item, modMask = 0) {
  const b = [...item.bytes];
  if (item.combo && b[3]) b[2] = modMask;
  return b;
}

window.K652Keys = { KEY_TYPE, HID_NAMES, describeEntry, parseMatrix, CATALOG, encodeChoice, MOD_BITS };
