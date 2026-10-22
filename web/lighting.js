// lighting.js — Decodificação do perfil de iluminação (resposta do GetProfile, cmd 0x83)
//
// Leitura (resp[7..], 254 bytes) = 8 bytes globais + 2 blocos de 0x7B bytes (confirmado ao vivo):
//   globais: [0] bloco ativo (0 = bloco 1, 1 = bloco 2) · [1..5] 00 · [6..7] 5a a5
//   bloco:
//     [0..3] 03 03 03 00 (?)
//     [4]  1 = modo personalizado (Fn+End liga) / 0 = efeito pronto
//     [5]  efeito (Fn+PgUp muda)
//     [6]  0x20 + grupo · [7] 01 (?) · [0x0c..0x0d] 55 55 (?) · [0x0e..0x0f] 01 02 (?)
//     [0x14 + 2·n] 2 bytes de parâmetros do efeito n (n = 0..29; o par do efeito 0 é ff ff):
//        A: nibble baixo = cor, nibble alto = direção
//        B: nibble baixo = brilho 0..4 (Fn+↑/↓), nibble alto = velocidade 0..4 (Fn+→/←; 4 = máx.)
//        Fn+PgDn mexe no nibble de cor do efeito atual (07 → 00 → … ; 7 parece ser o padrão colorido)
//     [0x50..0x59] 04 × 10 (?)
//     [0x79..0x7a] 5a a5 (marcador de fim)
// Hipótese: os dois blocos são os modos Windows e Mac (o bloco 2 está ativo e o teclado está no modo Mac).

const PROFILE_STRIDE = 0x7b;

// Ordem da lista "Light" do app original (captura2.jpeg) = código gravado no byte [5] do bloco.
// Confirmado ao vivo de 4 a 9, 11 e 13 (descrições do usuário batem com os nomes). Do 19 em diante vem do cfg
// (LedOpt19..22) e do text.xml: 20 Perfect, 21 Self-define (grava [4] = 1), OFF = código 0.
const LED_EFFECTS = [
  "Desligado", "Fixo", "Respirar", "Arco-íris", "Flash que some", "Gotas de chuva", "Roda arco-íris",
  "Ondulações", "Estrelas piscando", "Sombra que some", "Cobra retrô", "Fluxo neon", "Reação",
  "Onda senoidal", "Varredura", "Moinho girando", "Cascata colorida", "Florescer", "Tempestade girando",
  "Colisão", "Perfeito", "Personalizado", "efeito 22 (?)",
];

function effectName(i) { return LED_EFFECTS[i] ?? `efeito ${i}`; }

// data = resp[7..] inteiro (não só os 0x88 bytes que o app original copia)
function parseProfile(data) {
  const global = [...data.slice(0, 8)];
  const profiles = [];
  for (let n = 0; 8 + (n + 1) * PROFILE_STRIDE <= data.length; n++) {
    const p = data.slice(8 + n * PROFILE_STRIDE, 8 + (n + 1) * PROFILE_STRIDE);
    const effect = p[5];
    const cur = effect >= 1 && effect <= 29 ? { a: p[0x14 + 2 * effect], b: p[0x15 + 2 * effect] } : null;
    profiles.push({
      raw: p, effect, custom: p[4], group: p[6] - 0x20, active: data[0] === n,
      marker: p[0x79] === 0x5a && p[0x7a] === 0xa5,
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
    : o >= 0x14 && o < 0x50 ? `parâmetro ${(o - 0x14) % 2 ? "B (brilho/veloc.)" : "A (cor/direção)"} do efeito ${Math.floor((o - 0x14) / 2)}`
    : o >= 0x50 && o < 0x5a ? "bloco 04 04… (não decifrado)" : "";
  return `bloco ${n + 1} [0x${o.toString(16).padStart(2, "0")}]${name ? " " + name : ""}`;
}

window.K652Lighting = { LED_EFFECTS, effectName, parseProfile, describeOffset, PROFILE_STRIDE };
