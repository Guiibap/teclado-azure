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
