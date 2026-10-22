# Protocolo HID — Redragon K652 RGB PRO (keyboarddrv.exe V1.6.6)

Binário: `extracted/app/keyboarddrv.exe` (SHA256 `5aaa81905ec3afb82060803ed4437333668a3273ffd443875bd1e7bef1abfaac`)
Dispositivo: **VID 0x258A (SinoWealth), PID 0x0049**
Transporte: HID **Feature Reports** (`HidD_SetFeature`/`HidD_GetFeature`)
Análise: REA + Hopper (Evidence bundle: `analysis/rea-evidence.json`, 58 records)

## Interfaces HID (4 coleções, identificadas por FeatureReportByteLength)

| Handle app | Filtro | Uso |
|---|---|---|
| hDevice (driver+4) | FeatureReport = 0x408 (1032) | Comandos principais: perfil, matriz, LED |
| hCmd (driver+8) | FeatureReport = 6 (?) | Handshake/password (reports de 8-9 bytes) |
| hMedia | usagePage 0x0C (consumer) | Aberto e fechado — não usado p/ config |
| hMusic (driver+0x1C) | FeatureReport = 0x17E (382) | Dados de música (modo music visualizer) |

## Report IDs

- **0x05** — comando curto (payload 6-8 bytes)
- **0x06** — escrita/comando longo (payload até 0x407 = 1031 bytes)
- ~~0x07~~ — não é usado: as leituras voltam no **report 6** (GetFeature em hDevice, `mov cl,6` em 0x4457af/0x445aaf)
- **0x08** — dados de música (payload 0x17A = 378 bytes)

## Primitivos

- **SendCommand** (`sub_445270`): `SetFeature(hDevice, [0x06][payload])`, 3 tentativas, Sleep(200ms) entre elas
- **GetCommand** (`sub_4451e0`): `GetFeature(handle, [reportID][...len+1])`, 3 tentativas, Sleep(200ms)

## Handshake (FindDev `sub_444ea0` + GetPassword `sub_4454a0`)

1. Enumera dispositivos `VID_%04X&PID_%04X` = `VID_258A&PID_0049`
2. Lê FW version via `HidD_GetAttributes` (BCD, log "FW Version=0x%x"); `VerNeedToUpdate=0x103` no cfg
3. **GetPassword** (handle hCmd):
   - `SetFeature`: report ID **5**, total 9 bytes: `[05][05 81 00 00 00 00 00 00]`
   - `Sleep(20ms)`
   - `GetFeature`: report ID **5**, total 8 bytes: resposta `[status][pwd0..pwd5]`
   - status == 0x01 → OK; senha (6 bytes) comparada com cfg `PSD=2,0,0,0,1,ab` → `{02 00 00 00 01 AB}`
   - Se PSD no cfg == 0, pula verificação

## Leitura

- **GetProfile** (`sub_4456d0`, cmd **0x83**) — conferido no asm (objdump):
  - `SetFeature(hCmd)`: report ID 5, 7 bytes: `[05][83 ProAddr(B6) 00 00 00 00]`
  - `Sleep(20ms)`
  - `GetFeature(hDevice)`: **report ID 6**, len 0x407+1; valida resp[0]==0x83 (sem o report ID)
  - copia **0x88 bytes a partir de resp[7]** (mesmo layout do SetProfile)
- **GetMatrix** (`sub_4459d0`, cmd **0x84**): `[05][84 KeyAddr(D4) 00 00 00 00]` em hCmd, GetFeature report 6 em hDevice,
  copia **0x400 bytes de resp[7]**, sem checar eco

## Escrita (todas report ID 6, total 0x408; 3 tentativas; Sleep(200) entre)

### SetProfile (`sub_4455d0`) — opcode 0x03
```
[06][03][ProAddr(0xB6)][00 00 00 00 00][dados 0x88 = 136 bytes][zeros até 0x407]
```
Conferido no asm: cabeçalho em buf+0x10, dados copiados em buf+0x17 (= offset 7, igual ao GetProfile).
`sub_445300` (troca de modo de LED) faz GetProfile → altera 2 bytes → SetProfile.
Teste ao vivo 2026-10-21: SetKeyMatrix sozinho grava (releitura confere), mas a tecla não muda de
comportamento — hipótese: o firmware só recarrega no SetProfile (último passo do ApplySetting) ou no boot.
FillMatrix (0x40ce80) confirma: tecla tipo 2 → slot real = (dword>>24) + 0x84 (tabela FnBase).
ProAddr vem do cfg (`ProAddr=0xb6`). Buffer do caller: 8 bytes "global" + 0x40 por perfil
(dump de debug: "Cfg(Save-Global)" 8 bytes, "Cfg(Save-Pro1)" 0x40 bytes).

### SetKeyMatrix (`sub_4458b0`) — opcode 0x04
```
[06][04][KeyAddr(0xD4)][00][40][00 00 00][matrix 0x400 bytes]   = 1032 bytes, sem pad
```
Conferido no asm (objdump): cabeçalho em buf+0x10, matriz copiada em buf+0x17, SetFeature(hDevice, 0x408).
A matriz enviada tem o mesmo layout da lida pelo GetMatrix (resp[7..]); o app web relê a matriz e reenvia
tudo igual, trocando só a entrada desejada (tecla tipo 2 → troca a entrada FnBase do índice).
Matrix (0x400 = 1024 bytes):
- `+0x000` KeyMatrix: **132 (0x84) dwords** = 0x210 bytes
- `+0x210` FnMatrix (single-key func): 48 dwords = 0xC0
- `+0x2D0` FnMatrix (Fn combo): 48 dwords = 0xC0
- resto zerado

**Formato do dword de tecla**: little-endian `[b0 b1 b2 b3]`
- b0..b2 = código de função (24-bit). Ex: tipo 6 = modificador com b3 = bitmask HID (0xE0=LCtrl ... 0xE6=RGui)
- b3 = 0x02 → tecla é MACRO: índice real = (dword >> 24) sinalizado; macro buffer ID em b3-1...
  (FillMatrix: `dword |= (macroID << 24) - 0x1000000`; checagem `byte3 == 2` → remapeia índice +0x84)
- Códigos observados (sub_40c2a0): `0x070000F0..F4` = botões de mouse (esq/dir/meio/forward/back?);
  `0xE?000006` = modificadores; `0x13`/`0x20`/`0x21`/`0x1E` = tipos especiais (mídia, fn, desativada...)
- VK→HID: tabela em 0x40c6bc (128 entradas); tecla normal provavelmente = HID usage page 0x07

**Macros**: até 32 buffers (`MaxFnNum=0x30` default), cada um **0x80 (128) bytes**;
escritas em páginas via opcode 0x09 (loop "HwParam: nMacroBuf=%d...").

### SetLedRgbTab (`sub_445af0`) — opcode 0x08
```
[06][08][RgbTabAddr(0xB8)][00][40][00 00 00][tabela RGB ≤ 0x3EB=1003 bytes][zeros]
```
Tabela: N entradas de **0x15 (21) bytes** (N = byte_5e1670, nº de linhas LED do cfg);
construída a partir das cores por tecla (5 chaves × 3 componentes, stride 0x30 na struct de tecla).
"SetLedRgbTab, err=0x%x" em falha.

### SetLedMatrix (`sub_445800`) — opcode 0x09 (paginado)
```
[06][09][pageIndex][00][40][00 00 00][1024 bytes de dados LED]
```
- Loop em ApplySetting: páginas de 0x400; buffer total ~0x762 (1890) bytes copiado de uma vez
- Dados LED por tecla: 3 planos de cor (R,G,B); offsets de plano = cfg `RGBIndex=0,1,2` /
  `GameRGBIndex` (bytes globais 5e16a8..aa / ab..ad); stride entre linhas = **0x7E (126)**;
  base do plano no buffer = **0x164**; nº de grupos = `GaoshouGroupNum=5` (GaoshouKey1..5 no cfg)
- Tecla com MatrixIdx ≤ 0x83 → escreve 3 bytes (R,G,B) nas posições dos 3 planos

### SendMusicData (`sub_4453b0`) — report ID 0x08 (hMusic)
```
[08][dados 0x17A = 378 bytes] → SetFeature(hMusic, buf, 0x17E)
```

## Estrutura de perfil (GetProfile response / SetProfile data)

- Stride **0x7B (123) bytes** por perfil (máx ~8; `StartGp=0x20`)
- Offsets internos (cfg): `LedModeSelectOffset=4` (modo LED selecionado),
  `EffectOffset=0x12` (parâmetros de efeito), `GaoshouAddr=0xAC` (grupos de cor — pode ser
  offset absoluto no buffer global, não no perfil)
- `GaoshouIndex=20` (0x14) = índice do modo "custom/per-key"
- Efeitos: `LedOpt1..22` = `índice,hwEffect,speed,light,dir,random,color` — 21 modos
- `LEDParam=07,44,...` (21 pares: nível UI, nível HW de brilho/velocidade)
- Marcador de perfil válido: bytes `0x5A 0xA5` no fim da struct de perfil UI (sub_40d240)

## Globals do cfg → significado (parser `sub_43eed0`)

| Global | cfg key | Default | Uso |
|---|---|---|---|
| 5e1668 | GaoshouGroupNum | 5 | nº de grupos de cor (máx 10) |
| 5e166b | GaoshouAddr | 0xAC | offset dados de grupos |
| 5e166c | StartGp | 0x20 | perfil inicial |
| 5e166d | SameGp | 0 | |
| 5e166e | LedModeSelectOffset | 4 | offset modo LED no perfil |
| 5e166f | EffectOffset | 0x12 | offset params efeito no perfil |
| 5e1670 | ? | ? | nº de linhas da tabela RGB |
| 5e1671 | DefLedIndex | 10 (cfg) | efeito default |
| 5e0270 | ProAddr | 0xB6 | addr escrita perfil |
| 5e0274 | RgbTabAddr | 0xB8 | addr escrita tabela RGB |
| 5e0278 | GameAddr | 0xBC | addr dados game/grupos |
| 5e027c | KeyAddr | 0xD4 | addr escrita matriz |
| 5e0280 | MaxFnNum | 0x30 | nº máx de macros (48?) |
| 5e02a8 | SyncKB | 1 | sincronizar do teclado ao abrir |
| 5e02c8 | GaoshouIndex | 20 (cfg) | modo custom |
| 5e01e4.. | PSD | 2,0,0,0,1,ab | senha do dispositivo |

## Sequência ApplySetting (fluxo completo de escrita)

1. PostMessage progresso; Sleep variável
2. Se load: GetProfile (0x83) → parse → preencher structs UI
3. SetLedMatrix páginas (0x09) — 1ª vez; retry com Sleep(50) em erro
4. SetLedRgbTab (0x08)
5. FillMatrix: GetMatrix (0x84) se SyncKB → merge → "Matrix (Save)"
6. SetKeyMatrix (0x04) — com retry Sleep(50)
7. SetProfile (0x03) — retry Sleep(20); ao fim: driver+0x18 = 0 (flag busy)
8. PostMessage 0x64 (100) = concluído

## Pendente / empírico (validar com teclado físico via WebHID)

- [x] WebHID/macOS: um único HIDDevice ("Gaming Keyboard") com feature reports **5 (5 B), 6 (1031 B), 8 (381 B)**
- [x] **Report 5 tem só 5 bytes de payload** — o app original passa buffers maiores, mas só os 5 primeiros
      vão para o fio. Mandar 6+ bytes pelo WebHID faz o firmware ignorar o comando (GetFeature 6 falha).
- [x] Chrome/macOS: resposta curta do report 6 (GetProfile, 262 B) vem com o ID 06 no byte 0; a cheia (GetMatrix,
      1031 B) vem sem. `getFeature` normaliza.
- [x] GetMatrix ao vivo: cabeçalho `84 D4 00 84 00 00 00`, dwords a partir de resp[7]. Dword = `[tipo][00][00][código]`:
      tipo 0 = HID usage (` =0x35, Caps=0x39, Q=0x14…), tipo 6 = modificador (LShift=E1, LCtrl=E0, Fn=E3).
- [x] Tipo **2** = tecla com camada Fn: o código é um **índice (0..47)** em duas tabelas de 48 entradas:
      `+0x210` FnBase (o que a tecla faz sem Fn) e `+0x2D0` FnLayer (com Fn). Ex.: Esc → idx 0x0f →
      FnBase `00 00 00 29` (Esc) / FnLayer `0e 00 00 05`. As tabelas vêm do firmware (o app só mescla).
- [x] Formato geral da entrada: `[tipo][b1][param][código]`
      - 0x00 tecla HID; param = máscara de modificadores (bit0 Ctrl, 1 Shift, 2 Alt, 3 Win) → Fn+F3 = Alt+Tab, Fn+F4 = Win+D
      - 0x04 mídia (consumer page 0x0C), usage = (param<<8)|código → F7..F12 = anterior/play/próxima/mudo/vol−/vol+
      - 0x06 modificador (E0..E7). Obs.: LWin e a tecla FN aparecem ambas como E3
      - 0x0c LED brilho (param 1 = +, 2 = −; Fn+↑/↓) · 0x0d LED velocidade (Fn+→/←) — inferido pela posição
      - 0x0e função interna do firmware, sem nome no app: Esc 05, LWin 01, 1..4 0c..0f, G 10, Tab/Caps 1e, Space 16, RShift 12
      - 0x0b / 0x12 (Fn+End/PgUp/PgDn): não decifrado
      Decodificador: `web/keycodes.js`
- [x] Report ID da resposta de leitura: **6** (não 7)
- [ ] GetPassword (GetFeature ID5) no macOS: 1º teste falhou e o teclado re-enumerou — suspeita: Chrome/macOS
      pede o tamanho máximo de feature report da interface (1032) para o report 5, que só tem 8
- [ ] Layout completo da resposta 0x83 (dump hex ao vivo)
- [ ] Código de função 24-bit para teclas normais (confirmar `usage | 0x070000`? ou tipo 4?)
- [ ] Tabela VK→HID em 0x40c6bc (dump parcial obtido)
- [ ] Formato dos dados de música (378 bytes) e efeito por página LED

## Layout físico (versão brasileira, ABNT2)

Foto: `teclado-azure.jpg`. O `cfg.ini` do app descreve a versão ANSI; o mockup (`tools/gen-layout.js`)
usa geometria ABNT2 e os índices de matriz lidos ao vivo (matriz = coluna×6 + linha):
- `\|` ao lado do LShift = matriz **70** (HID 0x64) · `]}` ao lado do Enter = matriz **75** (HID 0x31) — sem LED no cfg
- Enter ISO = matriz 81 (a 80, HID 0x31 na linha do Tab, não tem tecla física; `]}` também manda 0x31)
- `/?` (1.75u) = matriz **76** e **manda RShift (0xE5)** — confirmado no testador em 2026-10-21. Firmware de
  fábrica é ANSI nessa posição; ABNT2 precisa de 0x87 (IntlRo) para digitar `/ ?` no macOS → candidata
  natural ao primeiro teste de escrita (SetKeyMatrix)
- `\|` → matriz 70 = 0x64 (IntlBackslash) e `]}` → matriz 75 = 0x31 — confirmados no testador
- Matriz 23/29/41/47/71 (Lang/Intl JIS) e 96..124 (teclado numérico) existem no firmware mas não no físico

## Teste de escrita 2026-10-21 (remapear `/?`, matriz 76 → 0x87)

1. SetKeyMatrix em D4 trocando FnBase[0x2f] (E5 → 87): gravou (releitura idêntica), **tecla continuou RShift**,
   inclusive após reconectar o USB.
2. "Commit" reenviando o perfil lido (GetProfile → SetProfile idêntico): **o teclado não guardou igual** —
   byte 13 (modo de LED do perfil 0, segundo `sub_445300`) foi de 01 → 0b, parâmetros `00 41` → `07 44`,
   estrutura do 2º perfil mudou. Formato de escrita ≠ formato de leitura. Botão removido do app.
   Leitura: perfil = 8 bytes globais + 2 × 0x7B (bate com 254 = 261 − 7); escrita = 0x88 = 8 + 2 × 0x40 (?).
3. Hipótese atual: keycaps têm CONTROL/OPTION/COMMAND → teclado tem **modo Mac**, que pode usar outra tabela;
   D4 seria a do Windows. Próximos testes: testador nas teclas Win/Alt; GetMatrix em outros endereços;
   gravar direto na entrada base (sem passar pela FnBase).

Fn com nome pelos keycaps: Fn+1..4 = 0e 0c..0f = BT1, BT2, BT3, 2.4G.

## Endereços de matriz (GetMatrix/SetKeyMatrix, 2º byte do comando) — confirmado ao vivo 2026-10-21

| Endereço | Conteúdo |
|---|---|
| **D4** | KeyMatrix do **modo Windows** (o app do Windows só usa este, `KeyAddr=0xD4`) |
| **D8** | KeyMatrix do **modo Mac**: Win→LAlt (Option), Alt→LWin (Command), F-keys = mídia por padrão e F1..F12 com Fn, F3 = Ctrl+↑, F6 = Cmd+Espaço, PrtSc = Shift+Cmd+3, F4 = consumer 0xCF (ditado), tecla Fn = tipo **0x20** |
| **DC** | Buffers de macro, blocos de 0x80 bytes (`20 02 3a 82 3a …` = eventos de tecla down/up) |

Mesmo layout de 0x400 nas duas matrizes (base 132 + FnBase 48 + FnLayer 48). Em D8 as tabelas FnBase/FnLayer
das F-keys aparecem invertidas em relação a D4 (mídia é a função normal). A remapeação da `/?` falhou porque
foi gravada em D4 com o teclado em modo Mac.

## Iluminação — estrutura do perfil (2026-10-21, em andamento)

`sub_40d240` monta 0x40 bytes por perfil para o SetProfile:
`[4]` personalizado (1 se o efeito == GaoshouIndex) · `[5]` efeito (1º campo de LedOptN) · `[6]` 0x20 + grupo ·
`[0x14..0x15]` ff ff · `[0x16 + 2·(efeito−1)]` 2 bytes por efeito (A: cor | direção<<4; B: brilho | velocidade<<4) ·
`[0x3e..0x3f]` 5a a5.

Leitura (GetProfile, resp[7..] = 254 bytes) = 8 bytes globais + 2 × 0x7B. Os primeiros 0x40 de cada perfil batem
com o formato acima; os 0x3B restantes ainda não foram decifrados. `sub_445300` (troca de efeito no app original)
faz GetProfile → muda bytes [12] e [13] (= perfil 1 `[4]` e `[5]`) → SetProfile com os 0x88 bytes lidos.

Efeitos (text.xml tc_led_mode1..22 ↔ cfg LedOpt1..22): 1 Fixo, 2 Respirar, 3 Arco-íris, 4 Flash que some,
5 Gotas, 6 Roda arco-íris, 7 Ondas, 8 Estrelas, 9 Sombra, 10 Cobra, 11 Fluxo neon, 12 Reação, 13 Onda senoidal,
14 Varredura, 15 Moinho, 16 Cascata, 17 Florescer, 18 Tempestade, 19 Colisão, 20 Perfeito, 21 Personalizado, 22 OFF.

Ferramenta de leitura/comparação no app (painel "Iluminação — leitura") para mapear o resto pelos atalhos Fn.

## Perfil de iluminação — leitura ao vivo (2026-10-21)

Leitura (resp[7..], 254 B) = 8 globais + 2 blocos de 0x7B.
- Globais: `[0]` bloco ativo (0/1), `[6..7]` 5a a5. Com o teclado no modo Mac, o ativo é o bloco 2 (hipótese: bloco 1 = Windows, bloco 2 = Mac).
- Bloco: `[4]` personalizado (Fn+End liga), `[5]` efeito (Fn+PgUp muda: 0x12 → 0x01), `[0x14+2n]` par de parâmetros do efeito n (par 0 = ff ff), `[0x50..0x59]` 04×10, `[0x79..0x7a]` 5a a5.
- Fn+PgDn: efeito 01 → 04 e o byte A dos efeitos 1 e 2 foi de 07 → 01 (falta repetir com uma tecla por vez).
- Fn+Espaço (apaga/acende) e Fn+↑/↓ indo e voltando não mudaram nada guardado.

### Manual (manual teclado azure.pdf) cruzado com a camada Fn do D8
- Fn+PgUp = próximo efeito (20 efeitos) → tipo 0x0b [03 00]
- Fn+End = gravação de luz por tecla (A/W/D/S + setas escolhem cor; Fn+End salva, Fn+PgUp sai) → tipo 0x0b [00 20]
- Fn+PgDn → tipo 0x12 [03 00]; o manual diz "Fn+Del muda a cor", mas o Del deste teclado não tem Fn, e no teste o PgDn mudou o byte de cor. Provável: cor.
- Fn+←/→ velocidade (0x0d), Fn+↑/↓ brilho (0x0c), Fn+Espaço liga/desliga (interna 0x16)
- Fn+Esc = reset de fábrica (interna 0x05). NÃO usar nos testes: deve apagar os remapeamentos.
- Fn+1/2/3 = BT, Fn+4 (3 s) = pareamento 2.4G. Fn+Win trava a tecla Win.
- Ainda sem nome: interna 0x1e (Fn+Tab), 0x10 (Fn+G), 0x12 (Fn+/?).

### Teste 2 (log de 23:27) + capturas do app original
- Lista de efeitos do app (captura2.jpeg), na ordem = código do byte [5]: 1 Fixed_on, 2 Respire, 3 Rainbow,
  4 Flash_away, 5 Raindrops, 6 Rainbow_wheel, 7 Ripples_shining, 8 Stars_twinkle, 9 Shadow_disappear,
  10 Retro_snake, 11 Neon_stream, 12 Reaction, 13 Sine_wave, 14 Retinue scanning, 15 Rotating windmill,
  16 Colorful waterfall, 17 Blossoming, 18 Rotating storm, 19 Collision, 20 Self-define, 21 OFF, 22 Music mode.
  Fn+PgUp de 4 a 9 bateu com as descrições do usuário (gotas, roda arco-íris, ondulação a partir da tecla, estrelas, tecla apaga).
- Brilho = nibble baixo do byte B do efeito atual: Fn+↓ 3× levou 4 → 1, Fn+↑ voltou a 4. Faixa provável 0..4.
- Velocidade = nibble alto do byte B: Fn+→ em 4 não mudou nada (4 = máximo); Fn+← levou 4 → 0.
- Fn+PgDn mexe no nibble de cor (byte A) do efeito atual: no efeito 9, 07 → 00 apagou as luzes; depois 00 → 04.
  Numeração das cores ainda incerta. O app tem 9 cores prontas + RGB livre (R/G/B 0..255), então o RGB deve ser gravado em outro comando.
- O app original mostra 3 perfis (Profile 1/2/3), mas a leitura 83 B6 traz só 2 blocos. A hipótese "bloco 1 = Windows, bloco 2 = Mac" fica em aberto.

### Teste de cores (logs_debug/k652-log-2026-10-22-02-54-35.txt)
- No efeito Fixo, Fn+PgDn percorre o nibble de cor 7 → 0 → 1 → … → 6 → 7.
- 7 = colorido (é o "random" do LedOpt / caixa "RGB" do app). De 0 a 6 o teclado ficou totalmente apagado.
- Leitura: 0..6 são índices de uma paleta guardada fora do perfil, provavelmente a tabela RGB (escrita com 08 B8,
  linhas de 0x15 = 21 bytes = 7 cores × RGB). Neste teclado essa paleta parece estar zerada (preta).
- cfg LedOpt `hw,effect,speed,light,dir,random,color`: os efeitos 3, 6, 15, 16 e 17 não aceitam cor.
- Próximo: ler a tabela com 88 B8 (botão "Ler tabela de cores").

## Perfil exportado `.bk` do app Windows (Profile1.bk, branco fixo, 2026-10-22)

28748 bytes, parece um dump direto da struct de perfil do app (os offsets batem com `sub_40d240`).

- 0x000: cabeçalho `95 77 fb fc c8 73 fe 00`; 0x210: nome "Profile1" em UTF-16LE.
- 0x260..0x33e0: 132 registros de 0x60 bytes, um por posição da matriz (retângulo na tela, código, `ff ff ff ff`, índice).
- 0x33e4: efeito selecionado, base 0 (0 = Fixed_on). `sub_40d240` lê `edi[0x33e4]`.
- 0x33ec: 24 registros de efeito com 0x30 bytes cada (efeito 1 em diante):

  | +off | campo | branco fixo (reg. 0) | demais |
  |---|---|---|---|
  | 0x00 | velocidade (u32) | 4 | 4 |
  | 0x04 | brilho (u32) | 1 | 4 |
  | 0x08 | direção (u32) | 0 | 0 |
  | 0x0c | índice da cor na paleta (u32) → nibble baixo do byte A | 0 | 0 |
  | 0x10 | paleta: 7 cores × `RR GG BB 00` | **ffffff**, 0000ff, 00ff00, ffff00, ff00ff, 00ffff, ffffff | **ff0000**, 0000ff, … |
  | 0x2c | aleatório/"RGB" (u32): 1 → nibble = cor colorida (7) | 0 | 1 |

  Os registros 20..23 estão zerados (velocidade/brilho 0).
- 0x386c: `00 00 01 01 01 01 01` (lido por `sub_40d240` como `edi[0x386c]` → byte [2] do bloco, "grupo").
- 0x386c em diante: valores por tecla (`ff`) — provavelmente as cores do modo Personalizado.

**Conclusão:** o perfil do teclado só guarda o *índice* da cor (0..6) ou 7 = colorido. A cor real vem de uma
paleta de 7 cores **por efeito** (7 × RGB = 0x15 bytes por efeito), que o app manda à parte — quase certamente
pela tabela RGB (`08 B8`, SetLedRgbTab). Quando o usuário escolhe uma cor no app, ele escreve essa cor no slot 0
da paleta do efeito e põe o índice 0. Isso explica o teste: Fn+PgDn levou o nibble a 0..6 e o teclado apagou,
porque a paleta gravada no teclado deve estar zerada. Próximo passo: ler `88 B8` e ver se aparecem linhas de 0x15.

### Leitura ao vivo da paleta (`88 B8`, 2026-10-22)

Confirmado: `88 B8` devolve a paleta. data[0..0x14] = linha 0 (zerada, não existe efeito 0); linha n = efeito n,
7 cores em ordem R,G,B. Bate byte a byte com o `.bk`: efeito 1 = ffffff, 0000ff, 00ff00, ffff00, ff00ff, 00ffff,
ffffff; os demais começam com ff0000. São 23 linhas não-zero (483 bytes).

Então a paleta **não** está zerada, e a hipótese anterior para o teclado apagar com o nibble 0..6 cai.
Possível explicação: o app do Windows gravou a paleta depois do teste de cores (quando o perfil branco foi aplicado).
Próximo teste, só leitura: repetir Fn+PgDn no Mac e ver se agora aparecem branco, azul, verde, amarelo, magenta, ciano.

### Modo Windows × Mac (2026-10-22)

- Com o Fn gravado em D4, no modo Windows, Fn+PgDn no Fixo passou por colorido → branco → azul → verde →
  amarelo → magenta → ciano → branco → colorido, exatamente a paleta lida em `88 B8` (ordem R,G,B confirmada).
- Então a 1ª metade da tabela (0x000–0x1e2) é a paleta do **modo Windows**. No modo Mac as cores 0..6 saem apagadas.
  Suspeita: a paleta do Mac é a 2ª metade, que está toda zerada.
- Teste (botão “Preencher 2ª metade”): grava `ff 00 00` repetido de 0x1e3 até 0x3ff, sem mexer na 1ª metade.
  No Mac, se a cor sair vermelha, a paleta do Mac começa num offset com resto 0 na divisão por 3; azul = resto 1;
  verde = resto 2; apagado = a paleta do Mac não está aqui.
- Resultado do teste 1: no Mac, as cores 0..6 do Fixo ficaram todas vermelhas (antes, apagadas). **A paleta do Mac fica
  na 2ª metade** e começa num offset múltiplo de 3. Candidatos: 0x1e3 + 0x15·k.
- Teste 2: a linha k a partir de 0x1e3 recebe a cor k (0 vermelho, 1 verde, 2 azul, 3 amarelo, 4 magenta, 5 ciano,
  6 branco, 7+ laranja). Se o Fixo do Mac sair verde, as linhas espelham as do Windows (Mac linha 0 em 0x1e3,
  efeito n em 0x1e3 + 0x15·n). Se as cores do ciclo mudarem no meio, o início não cai numa linha de 0x15.
- Resultado do teste 2: o Fixo do Mac ficou azul nas 7 cores, ou seja, linha 2 a partir de 0x1e3 = **0x20d**. Como o Fixo é
  o efeito 1, **a paleta do Mac começa em 0x1f8** (= 24 × 0x15), com o mesmo formato da do Windows: efeito n em
  0x1f8 + 0x15·n, e as 23 linhas vão até 0x3da. Ficam livres 0x1e3–0x1f7 (uma linha) e 0x3db–0x3ff.
- Cópia da paleta do Windows para 0x1f8 gravada e testada (2026-10-22): no Mac, o Fixo passou a ciclar pelas mesmas cores
  do Windows. Seletor "Cores do modo Mac" no app: lê e grava só a linha 0x1f8 + 0x15·efeito (7 × RGB).

## Gravação de brilho e velocidade (2026-10-22, experimental)
- O app lê o perfil, muda só o byte B do efeito atual no bloco ativo e grava com SetProfile no formato de escrita
  do app original: 8 globais + os primeiros 0x40 bytes de cada bloco (= 0x88). Depois relê e lista qualquer byte
  que não bata com o esperado. Ainda não testado no teclado.
- Teste 22/10 00:39: gravei globais + 0x40 bytes crus de cada bloco (bloco terminando em `07 44`). O teclado voltou
  **os dois blocos ao padrão**: efeito 0x0b, todos os parâmetros `07 44`, efeito 0 e 16 = `ff ff`. O "Desfazer" no
  mesmo formato deu o mesmo resultado. Igual à falha de 21/10. Causa provável: o bloco de escrita tem que terminar
  em `5a a5` em [0x3e..0x3f] (sub_40d240), e sem o marcador o firmware descarta e carrega o padrão.
- Correção: bloco = leitura[0..0x3d] (globais [4..6] + parâmetros dos efeitos 1..20) + `5a a5`. O backup do perfil de
  antes do teste ficou no navegador ("Restaurar original").
- Teste 22/10 00:43 (bloco = leitura[0..0x3d] + `5a a5`, 0x88 bytes): **mesma falha**, os dois blocos voltaram ao padrão.
  A hipótese do marcador em 0x3e estava errada.
- Releitura do asm (objdump): `sub_4455d0` monta exatamente `03 B6 00 00 00 00 00` + 0x88 bytes, igual ao app web.
  O ApplySetting zera um buffer de 0x88, faz GetProfile nele, põe o byte global [0] e chama `sub_40d240` em buf+8
  (só o 1º bloco, 0x40 bytes). Ou seja, o app v1.6.6 fala com um firmware de **1 perfil de 0x40**. Este teclado
  devolve 8 + 2 × 0x7B (0xFE), com `5a a5` no fim de cada bloco ([0x79..0x7a]); mandando só 0x88, o fim dos blocos
  chega zerado. Nova hipótese: a escrita tem que ter o mesmo formato da leitura (0xFE bytes).
- App ajustado: grava os 0xFE bytes lidos, trocando só o byte desejado, e se recusa a gravar se faltar algum marcador.
- **Confirmado 22/10 00:54:** SetProfile com os 0xFE bytes da leitura (8 globais + 2 × 0x7B) grava certo. Mudança só no
  byte 0x9a (bloco 2, efeito 1 Fixo, `44` → `41` = brilho 1, velocidade 4): releitura idêntica ao enviado e a luz mudou.
  Formato de escrita = formato de leitura; o formato curto de 0x88 do app v1.6.6 não serve para este firmware.
- Seletor de efeito no app (22/10): grava o byte [5] do bloco ativo (códigos 1..20 na ordem da lista, 0 = desligado,
  conforme cfg LedOpt e text.xml) e põe [4] = 0. Lista corrigida: 20 = Perfeito, 21 = Personalizado (não oferecido).
