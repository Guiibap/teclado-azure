// lighting.js — Decodificação do perfil de iluminação (resposta do GetProfile, cmd 0x83)
//
// Leitura (resp[7..], 254 bytes) = 8 bytes globais + 2 perfis de 0x7B bytes.
// Os primeiros 0x40 bytes de cada perfil têm o formato que o app original monta em sub_40d240:
//   [4]  1 = modo personalizado (cfg GaoshouIndex) / 0 = efeito pronto
//   [5]  efeito (1º campo da linha LedOptN do cfg.ini = índice do efeito na interface)
//   [6]  0x20 + grupo (cfg StartGp = 0x20)
//   [0x14..0x15] ff ff
//   [0x16 + 2·(efeito−1)] 2 bytes de parâmetros por efeito:
//        A: nibble baixo = cor, nibble alto = direção (tabela 0x5e028c)
//        B: nibble baixo = brilho, nibble alto = velocidade (tabelas LightHW / SpeedHW)
//   [0x3e..0x3f] 5a a5 (marcador)
// Os 0x3B bytes restantes de cada perfil ainda não foram decifrados.

const PROFILE_STRIDE = 0x7b;

// tc_led_mode1..22 do text.xml, na ordem das linhas LedOpt1..22 do cfg.ini
const LED_EFFECTS = [
  null, "Fixo", "Respirar", "Arco-íris", "Flash que some", "Gotas de chuva", "Roda arco-íris",
  "Ondas brilhando", "Estrelas piscando", "Sombra sumindo", "Cobra retrô", "Fluxo neon", "Reação",
  "Onda senoidal", "Varredura", "Moinho girando", "Cascata colorida", "Florescer", "Tempestade girando",
  "Colisão", "Perfeito", "Personalizado", "Desligado",
];

function effectName(i) { return LED_EFFECTS[i] ?? `efeito ${i}`; }

// data = resp[7..] inteiro (não só os 0x88 bytes que o app original copia)
function parseProfile(data) {
  const global = [...data.slice(0, 8)];
  const profiles = [];
  for (let n = 0; 8 + (n + 1) * PROFILE_STRIDE <= data.length; n++) {
    const p = data.slice(8 + n * PROFILE_STRIDE, 8 + (n + 1) * PROFILE_STRIDE);
    const effect = p[5];
    const param = i => ({ a: p[0x16 + 2 * (i - 1)], b: p[0x17 + 2 * (i - 1)] });
    const cur = effect >= 1 && effect <= 20 ? param(effect) : null;
    profiles.push({
      raw: p, effect, custom: p[4], group: p[6] - 0x20, marker: p[0x3e] === 0x5a && p[0x3f] === 0xa5,
      color: cur && cur.a & 0xf, direction: cur && cur.a >> 4,
      brightness: cur && cur.b & 0xf, speed: cur && cur.b >> 4,
    });
  }
  return { global, profiles };
}

// rótulo de um offset dentro da leitura, para a comparação
function describeOffset(off) {
  if (off < 8) return `global[${off}]`;
  const n = Math.floor((off - 8) / PROFILE_STRIDE), o = (off - 8) % PROFILE_STRIDE;
  const name = o === 4 ? "personalizado" : o === 5 ? "efeito" : o === 6 ? "grupo"
    : o >= 0x16 && o < 0x3e ? `parâmetro ${(o - 0x16) % 2 ? "B (brilho/veloc.)" : "A (cor/direção)"} do efeito ${Math.floor((o - 0x16) / 2) + 1}`
    : o >= 0x40 ? "parte extra (não decifrada)" : "";
  return `perfil ${n + 1} [0x${o.toString(16).padStart(2, "0")}]${name ? " " + name : ""}`;
}

window.K652Lighting = { LED_EFFECTS, effectName, parseProfile, describeOffset, PROFILE_STRIDE };
