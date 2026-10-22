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
    0x28: "Enter", 0x29: "Esc", 0x2a: "Backspace", 0x2b: "Tab", 0x2c: "Space", 0x2d: "-", 0x2e: "=",
    0x2f: "[", 0x30: "]", 0x31: "\\", 0x32: "#(ISO)", 0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",",
    0x37: ".", 0x38: "/", 0x39: "CapsLock", 0x46: "PrtSc", 0x47: "ScrollLock", 0x48: "Pause",
    0x49: "Insert", 0x4a: "Home", 0x4b: "PgUp", 0x4c: "Delete", 0x4d: "End", 0x4e: "PgDn",
    0x4f: "→", 0x50: "←", 0x51: "↓", 0x52: "↑", 0x53: "NumLock", 0x54: "KP/", 0x55: "KP*",
    0x56: "KP-", 0x57: "KP+", 0x58: "KPEnter", 0x63: "KP.", 0x64: "\\(ISO)", 0x65: "Menu",
    0x85: "KP,", 0x87: "Intl1(Ro)", 0x88: "Intl2(Kana)", 0x89: "Intl3(Yen)", 0x8a: "Intl4(Henkan)",
    0x8b: "Intl5(Muhenkan)", 0x90: "Lang1", 0x91: "Lang2",
    0xe0: "LCtrl", 0xe1: "LShift", 0xe2: "LAlt", 0xe3: "LWin/Fn", 0xe4: "RCtrl", 0xe5: "RShift",
    0xe6: "RAlt", 0xe7: "RWin",
  });
  for (let i = 0; i < 12; i++) t[0x3a + i] = "F" + (i + 1);
  for (let i = 0; i < 9; i++) t[0x59 + i] = "KP" + (i + 1);
  t[0x62] = "KP0";
  return t;
})();

const CONSUMER_NAMES = {
  0x006f: "Brilho tela +", 0x0070: "Brilho tela −", 0x00b5: "Próxima", 0x00b6: "Anterior",
  0x00b7: "Stop", 0x00cd: "Play/Pause", 0x00cf: "Ditado (Siri)", 0x00e2: "Mudo", 0x00e9: "Volume +", 0x00ea: "Volume −",
  0x0183: "Player", 0x018a: "E-mail", 0x0192: "Calculadora", 0x0194: "Meu computador",
  0x0221: "Pesquisar", 0x0223: "Página inicial", 0x0224: "Voltar", 0x0225: "Avançar",
  0x0227: "Atualizar", 0x022a: "Favoritos",
};

// Funções internas (tipo 0x0e) com nome tirado das legendas dos keycaps (foto teclado-azure.jpg)
const INTERNAL_NAMES = { 0x0c: "BT1", 0x0d: "BT2", 0x0e: "BT3", 0x0f: "2.4G" };

const MOD_BITS = ["Ctrl", "Shift", "Alt", "Win", "RCtrl", "RShift", "RAlt", "RWin"];

function hexb(n, w = 2) { return n.toString(16).padStart(w, "0"); }

// Decodifica uma entrada [tipo][b1][param][código] num texto curto.
function describeEntry(e) {
  const [type, , param, code] = e;
  switch (type) {
    case KEY_TYPE.KEY: {
      if (!code && !param) return "—";
      const mods = MOD_BITS.filter((_, i) => param & (1 << i));
      return [...mods, HID_NAMES[code] ?? `HID 0x${hexb(code)}`].join("+");
    }
    case KEY_TYPE.MODIFIER: return HID_NAMES[code] ?? `Mod 0x${hexb(code)}`;
    case KEY_TYPE.CONSUMER: {
      const u = (param << 8) | code;
      return CONSUMER_NAMES[u] ?? `Mídia 0x${hexb(u, 4)}`;
    }
    case KEY_TYPE.LED_BRIGHT: return `LED brilho ${param === 1 ? "+" : param === 2 ? "−" : param}`;
    case KEY_TYPE.LED_SPEED: return `LED velocidade ${param === 1 ? "+" : param === 2 ? "−" : param}`;
    case KEY_TYPE.FN: return "Fn";
    case KEY_TYPE.INTERNAL: return INTERNAL_NAMES[code] ?? `Interna 0x${hexb(code)}`;
    default: return `tipo 0x${hexb(type)} [${hexb(param)} ${hexb(code)}]`;
  }
}

// data = 0x400 bytes a partir de resp[7]
function parseMatrix(data) {
  const entry = off => [...data.slice(off, off + 4)];
  const table = (base, n) => Array.from({ length: n }, (_, i) => entry(base + i * 4));
  const fnBase = table(0x210, 48);
  const fnLayer = table(0x2d0, 48);
  const keys = table(0x000, 132).map(raw => {
    if (raw[0] === KEY_TYPE.DUAL && raw[3] < 48) {
      const i = raw[3];
      return { raw, dualIndex: i, normal: describeEntry(fnBase[i]), fn: describeEntry(fnLayer[i]) };
    }
    return { raw, normal: describeEntry(raw), fn: null };
  });
  return { keys, fnBase, fnLayer };
}

window.K652Keys = { KEY_TYPE, HID_NAMES, describeEntry, parseMatrix };
