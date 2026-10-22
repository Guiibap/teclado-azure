// app.js — UI do configurador web (WebHID)
(() => {
  const { K652Device, hex, parseHex } = window.K652;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const layout = window.KB_LAYOUT;
  const { parseMatrix } = window.K652Keys;
  const dev = new K652Device();
  let matrix = null; // parseMatrix() da matriz do modo selecionado

  const $ = id => document.getElementById(id);
  const logEl = $("log");

  // full = texto completo (bytes inteiros, listas): vai para a exportação, a tela mostra só msg
  const logEntries = [];
  function log(msg, cls, full = null) {
    const time = new Date().toLocaleTimeString();
    logEntries.push({ time, msg, full });
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = `[${time}] ${msg}`;
    if (full) line.title = "Texto completo vai na exportação do log";
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  dev.log = (m, full) => log(m, m.startsWith("←") ? "rx" : m.startsWith("→") ? "tx" : undefined, full && `bytes: ${full}`);

  function fullLogText() {
    return logEntries.map(e => `[${e.time}] ${e.msg}` + (e.full ? "\n    " + e.full.replace(/\n/g, "\n    ") : "")).join("\n") + "\n";
  }

  function exportLog() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([fullLogText()], { type: "text/plain" }));
    a.download = `k652-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- teclado ----------
  function renderKeyboard() {
    const kb = $("keyboard");
    const scale = 1.5;
    const canvas = document.createElement("div");
    canvas.id = "kbCanvas";
    canvas.style.width = layout.width * scale + "px";
    canvas.style.height = layout.height * scale + "px";
    for (const k of layout.keys) {
      const el = document.createElement("div");
      el.className = "key";
      el.dataset.id = k.id;
      el.style.left = k.x1 * scale + "px";
      el.style.top = k.y1 * scale + "px";
      el.style.width = (k.x2 - k.x1) * scale + "px";
      el.style.height = (k.y2 - k.y1) * scale + "px";
      if (k.shape === "iso-enter") {
        // Enter ISO/ABNT2: 1.5u em cima, 1.25u embaixo (recorte no canto inferior esquerdo)
        const w = (k.x2 - k.x1) * scale, h = (k.y2 - k.y1) * scale;
        const cut = 0.25 * 36 * scale, mid = (h + 4 * scale) / 2;
        el.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, ${cut}px 100%, ${cut}px ${mid - 4 * scale}px, 0 ${mid - 4 * scale}px)`;
        el.style.justifyContent = "flex-start";
        el.style.paddingTop = (h / 4 - 6) + "px";
        el.style.width = w + "px";
      }
      el.innerHTML = `<span class="key-name">${esc(k.name)}</span><span class="matrix-val"></span><span class="fn-val"></span>`;
      el.title = `${k.name}\nmatriz=${k.matrix} LED=${k.led ?? "?"}`;
      el.addEventListener("click", () => selectKey(el, k));
      canvas.appendChild(el);
    }
    kb.innerHTML = "";
    kb.appendChild(canvas);
  }

  function esc(s) { return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

  const short = s => s.replace(/\s*\(.*\)/, "");
  const KEYCAP_ALIASES = { del: "delete", ctrl: "control" };
  function sameLabel(keycap, fn) {
    const norm = s => short(s).replace(/\s+/g, "").toLowerCase();
    const a = norm(keycap), f = norm(fn);
    // "1 !" e "1" contam como iguais (legenda com símbolo de Shift)
    return (KEYCAP_ALIASES[a] ?? a) === f || keycap.split(" ")[0].toLowerCase() === f;
  }

  // rótulos nas teclas + marca das alteradas em relação à cópia original do modo
  function showMatrixValues() {
    const show = $("chkShowMatrix").checked;
    const orig = matrix && loadBackup(modeAddr)?.data;
    document.querySelectorAll(".key").forEach(el => {
      const mv = el.querySelector(".matrix-val"), fv = el.querySelector(".fn-val");
      const k = layout.keys.find(x => x.id === +el.dataset.id);
      const m = matrix && k && matrix.keys[k.matrix];
      if (!m) { mv.textContent = fv.textContent = ""; el.classList.remove("lit", "has-fn", "changed"); return; }
      // 2ª linha só quando a função difere da legenda impressa; 3ª linha = função com Fn
      mv.textContent = show && sameLabel(k.name, m.normal) ? "" : show ? short(m.normal) : "";
      fv.textContent = show && m.fn ? "Fn " + short(m.fn) : "";
      el.title = `${k.name} — ${m.normal}${m.fn ? `\nCom Fn: ${m.fn}` : ""}`;
      el.classList.toggle("lit", show && m.normal !== "—");
      el.classList.toggle("has-fn", show && !!m.fn);
      const changed = orig && [m.normalOff, m.fnOff].some(o => o !== null && !sameEntry(entryAt(matrixData, o), entryAt(orig, o)));
      el.classList.toggle("changed", !!changed);
    });
  }

  // ---------- dumps ----------
  function dumpHex(buf, title) {
    const bytes = new Uint8Array(buf);
    let out = `${title} (${bytes.length} bytes)\n`;
    for (let i = 0; i < bytes.length; i += 16) {
      const row = [...bytes.slice(i, i + 16)].map(b => b.toString(16).padStart(2, "0")).join(" ");
      const asc = [...bytes.slice(i, i + 16)].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : ".").join("");
      out += i.toString(16).padStart(4, "0") + "  " + row.padEnd(48) + "  " + asc + "\n";
    }
    $("dump").textContent = out;
  }

  // ---------- conexão ----------
  async function connect() {
    try {
      if (!("hid" in navigator)) { log("WebHID não suportado neste navegador (use Chrome/Edge).", "err"); return; }
      let d = await dev.reconnectExisting();
      if (!d) d = await dev.connect();
      $("status").textContent = "conectado: " + d.productName;
      $("status").className = "status on";
      $("collections").textContent = JSON.stringify(dev.describeCollections(), null, 1);
      await loadMode();
    } catch (e) {
      log("Falha ao conectar: " + e.message, "err");
    }
  }

  function needDevice() {
    if (!dev.connected) { log("Conecte o teclado primeiro.", "err"); return false; }
    return true;
  }

  // ---------- ações do lab ----------
  async function act(fn) {
    if (!needDevice()) return;
    try { await fn(); } catch (e) { log("Erro: " + e.message, "err"); }
  }

  const actions = {
    btnConnect: connect,
    btnPassword: () => act(async () => {
      const r = await dev.getPassword();
      if (!r) return log("GetPassword: sem resposta.", "err");
      log(`GetPassword → status=0x${r.status.toString(16)} ok=${r.ok} senha=[${hex(r.pwd, ",")}]` +
        (r.ok ? ` (esperado cfg PSD=2,0,0,0,1,ab → ${hex(new Uint8Array([2,0,0,0,1,0xab]), ",")})` : ""));
      dumpHex(r.raw, "GetPassword resposta bruta");
    }),
    btnProfile: () => act(async () => {
      const r = await dev.getProfile();
      if (!r) return log("GetProfile: sem resposta.", "err");
      dumpHex(r.raw, "GetProfile (cmd 0x83) resposta — dados do perfil a partir de 0x07");
      log(`GetProfile — eco=0x${r.raw[0]?.toString(16)} (${r.echoOk ? "ok" : "esperado 0x83"}), 0x88 bytes de perfil em resp[7..].`,
        r.echoOk ? undefined : "err");
    }),
    btnMatrix: () => act(async () => {
      const addr = labAddr();
      const r = await dev.getMatrix(addr);
      if (!r) return log("GetMatrix: sem resposta.", "err");
      dumpHex(r.raw, `GetMatrix (cmd 0x84, endereço 0x${addr.toString(16)}) resposta — matriz a partir de 0x07`);
      appendDecoded(r.data);
      if (addr === modeAddr) setMatrix(r.data);
    }),
    btnRawSend: () => act(async () => {
      const id = +$("rawId").value;
      const payload = parseHex($("rawPayload").value);
      await dev.sendFeature(id, payload);
      log(`SendFeature ID=${id} enviado (${payload.length} bytes).`);
    }),
    btnRawGet: () => act(async () => {
      const id = +$("rawRespId").value;
      const r = await dev.getCommand(id, 1);
      if (r) dumpHex(r, `GetFeature ID=${id}`);
      else log("GetFeature: sem resposta/erro.", "err");
    }),
    btnWrUndo: () => act(restoreBackup),
    ltRead: () => act(async () => {
      const data = await readProfileData();
      log("Perfil lido.", undefined, showProfile(data));
    }),
    // paleta por efeito (lida em 88 B8, gravada por SetLedRgbTab 08 B8): linha n = efeito n, 7 cores RGB.
    // Confirmado ao vivo: bate com o Profile1.bk exportado (efeito 1 com branco no slot 0).
    ltColors: () => act(async () => {
      const r = await dev.readTable(0x88, 0xb8);
      if (!r) return log("Tabela de cores (88 B8): sem resposta.", "err");
      let out = `eco 0x${hx(r.raw[0])} (${r.echoOk ? "ok" : "esperado 88"}) · ${r.raw.length} bytes\n`;
      const used = r.data.findLastIndex(b => b !== 0) + 1;
      for (let i = 0; i < Math.max(used, 0x15); i += 0x15) {
        const row = [...r.data.slice(i, i + 0x15)];
        const cores = Array.from({ length: 7 }, (_, c) => row.slice(c * 3, c * 3 + 3).map(hx).join("")).join(" ");
        const n = i / 0x15;
        out += `${String(n).padStart(2)} ${(K652Lighting.LED_EFFECTS[n] ?? "—").padEnd(18)} ${cores}\n`;
      }
      $("ltOut").textContent = out;
      log(`Tabela de cores lida (88 B8): ${used} bytes não-zero.`, r.echoOk ? undefined : "err", out);
    }),
    ltPalTest: () => act(async () => {
      const cur = await readPalette();
      if (!loadPalBackup()) savePalBackup(cur);
      // testes 1 e 2 (2026-10-22): o Fixo do Mac lê a linha em 0x20d, então a paleta do Mac é a do Windows
      // deslocada para PAL_MAC_BASE (efeito n em 0x1f8 + 0x15·n). Copia as 23 linhas do Windows e zera o resto.
      const next = cur.slice();
      next.fill(0, PAL_MAC_FROM);
      next.set(cur.slice(0, PAL_MAC_FROM), PAL_MAC_BASE);
      const changed = [...next].filter((b, i) => b !== cur[i]).length;
      const msg = `Gravar na tabela de cores (08 B8)?\n\n` +
        `• 0x000–0x${(PAL_MAC_FROM - 1).toString(16)} (paleta do Windows): fica igual.\n` +
        `• 0x${PAL_MAC_BASE.toString(16)}–0x${(PAL_MAC_BASE + PAL_MAC_FROM - 1).toString(16)}: cópia da paleta do Windows; o resto da 2ª metade volta a zero (${changed} bytes mudam).\n\n` +
        `Backup da tabela de antes dos testes salvo neste navegador; “Restaurar paleta” desfaz.`;
      log(`Prévia: cabeçalho 08 b8 00 40 00 00 00, Fixo do Mac em 0x${(PAL_MAC_BASE + 0x15).toString(16)}: ` +
        hex(next.slice(PAL_MAC_BASE + 0x15, PAL_MAC_BASE + 0x2a)), "note");
      if (!confirm(msg)) return log("Cancelado, nada foi gravado.");
      if (await writePalette(next, "cópia da paleta do Windows para o Mac"))
        log("No modo Mac, Fixo + Fn+PgDn deve passar pelas mesmas cores do Windows (branco, azul, verde…).", "note");
    }),
    macRead: () => act(async () => {
      const pal = await readPalette();
      const fx = macEffect();
      setMacColors(pal.slice(macRow(fx), macRow(fx) + 0x15));
      log(`Cores do efeito ${fx} (${effectName(fx)}) no modo Mac, 0x${macRow(fx).toString(16)}: ` +
        hex(pal.slice(macRow(fx), macRow(fx) + 0x15)));
    }),
    macWrite: () => act(async () => {
      const cur = await readPalette();
      if (!loadPalBackup()) savePalBackup(cur);
      const fx = macEffect(), off = macRow(fx), row = getMacColors();
      const old = cur.slice(off, off + 0x15);
      if (row.every((b, i) => b === old[i])) return log("As cores escolhidas já são as gravadas. Nada a fazer.");
      const next = cur.slice();
      next.set(row, off);
      log(`Prévia (efeito ${fx}, 0x${off.toString(16)}–0x${(off + 0x14).toString(16)}):\n  antes  ${hex(old)}\n  depois ${hex(row)}`, "note");
      if (!confirm(`Gravar as 7 cores do efeito ${fx} (${effectName(fx)}) no modo Mac?\n\n` +
        `Só os 21 bytes em 0x${off.toString(16)}–0x${(off + 0x14).toString(16)} mudam; o resto da tabela fica igual.\n` +
        `Para desfazer, grave as cores antigas (estão no log) ou use “Restaurar paleta”.`)) return log("Cancelado, nada foi gravado.");
      if (await writePalette(next, `cores do efeito ${fx} no Mac`))
        log("No modo Mac, nesse efeito, Fn+PgDn passa pelas 7 cores na ordem dos quadradinhos.", "note");
    }),
    ltPalRestore: () => act(async () => {
      const b = loadPalBackup();
      if (!b) return log("Não há backup da paleta neste navegador.", "err");
      if (!confirm(`Restaurar a tabela de cores para a cópia salva em ${b.ts}?`)) return;
      await writePalette(b.data, "restauração da paleta");
    }),
    ltSnap: () => act(async () => {
      profileSnap = await readProfileData();
      log("Perfil guardado. Mude a iluminação pelo teclado, anote o que fez e clique em “Comparar”.", undefined, showProfile(profileSnap));
    }),
    ltDiff: () => act(async () => {
      if (!profileSnap) return log("Clique em “Guardar para comparar” primeiro.", "err");
      const now = await readProfileData();
      const diffs = [];
      for (let i = 0; i < Math.max(now.length, profileSnap.length); i++)
        if (now[i] !== profileSnap[i]) diffs.push(i);
      const lines = diffs.map(i => `0x${i.toString(16).padStart(3, "0")}  ${hx(profileSnap[i])} → ${hx(now[i])}   ${describeOffset(i)}`);
      const note = $("ltNote").value.trim();
      const head = `Diferenças em relação ao guardado (${diffs.length} bytes):\n` + (lines.join("\n") || "nenhuma") + "\n\n";
      const decoded = showProfile(now, head);
      log(`Comparação${note ? ` [${note}]` : ""}: ${diffs.length} bytes mudaram.`, "note", decoded);
      if (!note) log("Dica: escreva no campo “O que você fez” antes de comparar, para a anotação ir junto no log.");
      // a próxima comparação parte daqui
      profileSnap = now;
      $("ltNote").value = "";
    }),
    rmApply: () => act(applyChoice),
    rmResetKey: () => act(resetKey),
  };

  // ---------- modo (tabela de teclas) ----------
  // Endereços da matriz: D4 = modo Windows, D8 = modo Mac, DC = macros (só leitura no lab).
  const MODES = { 0xd8: "Mac", 0xd4: "Windows" };
  let modeAddr = 0xd8;
  try { if (MODES[+localStorage.getItem("k652.mode")]) modeAddr = +localStorage.getItem("k652.mode"); } catch {}
  let matrixData = null; // 0x400 bytes da matriz do modo selecionado (última leitura)

  function labAddr() {
    const a = parseInt($("mxAddr").value, 16);
    if (!(a >= 0 && a <= 0xff)) throw new Error("Endereço da matriz deve ser 00–FF.");
    return a;
  }

  function setMode(addr) {
    modeAddr = addr;
    try { localStorage.setItem("k652.mode", String(addr)); } catch {}
    document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", parseInt(b.dataset.addr, 16) === addr));
    $("mxAddr").value = addr.toString(16);
    matrix = null; matrixData = null;
    showMatrixValues(); renderPanel(); showBackupInfo();
    if (dev.connected) act(loadMode);
  }

  async function loadMode() {
    const data = await readMatrixChecked(modeAddr);
    if (!loadBackup(modeAddr)) { saveBackup(data, modeAddr); log(`Cópia original do modo ${MODES[modeAddr]} salva neste navegador.`); }
    setMatrix(data);
    showBackupInfo();
    log(`Modo ${MODES[modeAddr]} carregado (matriz 0x${modeAddr.toString(16)}).`);
  }

  function setMatrix(data) {
    matrixData = data;
    matrix = parseMatrix(data);
    showMatrixValues();
    renderPanel();
  }

  // ---------- backup (cópia original por modo) ----------
  // A 1ª leitura de cada modo fica salva no navegador; serve para "voltar ao original" por tecla,
  // marcar teclas alteradas e restaurar o modo inteiro.
  const BACKUP_PREFIX = "k652.matrixBackup.";
  const backupKey = addr => BACKUP_PREFIX + addr.toString(16);
  try { // migra o backup único da versão anterior (sempre D4)
    const legacy = localStorage.getItem("k652.matrixBackup");
    if (legacy) { localStorage.setItem(backupKey(0xd4), legacy); localStorage.removeItem("k652.matrixBackup"); }
  } catch {}

  function loadBackup(addr) {
    try {
      const b = JSON.parse(localStorage.getItem(backupKey(addr)));
      return b && { ts: b.ts, addr, data: parseHex(b.hex) };
    } catch { return null; }
  }

  function saveBackup(data, addr) {
    const b = { ts: new Date().toLocaleString(), addr, hex: hex(data, "") };
    try { localStorage.setItem(backupKey(addr), JSON.stringify(b)); } catch (e) { log("Não consegui salvar o backup no navegador: " + e.message, "err"); }
    return b;
  }

  function showBackupInfo() {
    const b = loadBackup(modeAddr);
    $("wrBackupInfo").textContent = b
      ? `Cópia original do modo ${MODES[modeAddr]} salva em ${b.ts}, neste navegador.`
      : `Ainda sem cópia original do modo ${MODES[modeAddr]} — ela é salva na 1ª leitura.`;
  }

  async function readMatrixChecked(addr) {
    const r = await dev.getMatrix(addr);
    if (!r) throw new Error("GetMatrix sem resposta.");
    // trava de segurança: só escrevemos em cima de uma leitura que parece válida
    const filled = parseMatrix(r.data).keys.filter(k => k.normal !== "—").length;
    if (r.raw[0] !== 0x84 || r.raw[1] !== addr || r.data.length !== 0x400 || filled < 30)
      throw new Error(`Leitura suspeita (eco ${hex(r.raw.slice(0, 2))}, ${r.data.length} bytes, ${filled} teclas). Nada foi gravado.`);
    return r.data;
  }

  // SetKeyMatrix (sub_4458b0) com a matriz inteira, depois relê e compara byte a byte
  async function writeAndVerify(data, label, addr) {
    log(`Gravando: ${label} (modo ${MODES[addr] ?? "?"}, matriz 0x${addr.toString(16)})…`, "tx");
    if (!(await dev.setKeyMatrix(data, addr))) throw new Error("SetKeyMatrix falhou nas 3 tentativas.");
    await sleep(300);
    const back = (await dev.getMatrix(addr))?.data;
    if (!back) throw new Error("Gravou, mas a releitura não respondeu. Leia o modo de novo.");
    if (addr === modeAddr) setMatrix(back);
    const bad = [...data].map((b, i) => b !== back[i] ? i : -1).filter(i => i >= 0);
    if (bad.length) {
      log(`Releitura difere em ${bad.length} bytes (1º offset 0x${bad[0].toString(16)}).`, "err");
      return false;
    }
    log("OK: gravado e conferido. Aperte a tecla para testar.");
    return true;
  }

  // (Reenviar perfil foi removido: o teclado não devolve o perfil no mesmo formato em que recebe —
  //  no teste de 2026-10-21 o reenvio "idêntico" mudou o modo de LED. Ver protocol-notes.md.)

  async function restoreBackup() {
    const b = loadBackup(modeAddr);
    if (!b || b.data.length !== 0x400) return log(`Não há cópia original do modo ${MODES[modeAddr]} neste navegador.`, "err");
    if (!confirm(`Restaurar o modo ${MODES[modeAddr]} inteiro para a cópia salva em ${b.ts}?`)) return;
    await writeAndVerify(b.data, `restauração completa do modo ${MODES[modeAddr]}`, modeAddr);
  }

  // ---------- iluminação (leitura) ----------
  const { parseProfile, effectName, describeOffset } = window.K652Lighting;
  let profileSnap = null;
  const hx = b => b === undefined ? "--" : b.toString(16).padStart(2, "0");

  // ---------- paleta (tabela de cores 88/08 B8) ----------
  // 0x000–0x1e2: linhas 0..22 (paleta do modo Windows, confirmada). Depois disso está zerado: suspeita de ser
  // a paleta do modo Mac, onde as cores 0..6 saem apagadas.
  const PAL_MAC_FROM = 0x1e3;
  const PAL_BACKUP = "k652.paletteBackup";
  const PAL_MAC_BASE = 0x1f8; // linha 0 da paleta do Mac (Fixo = linha 1 em 0x20d)

  // ---------- cores do modo Mac: uma linha de 7 × RGB por efeito ----------
  const macRow = fx => PAL_MAC_BASE + 0x15 * fx;
  const macEffect = () => parseInt($("macFx").value, 10);
  const toHex = (r, g, b) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  function setMacColors(row) {
    document.querySelectorAll("#macColors input").forEach((el, i) => (el.value = toHex(row[i * 3], row[i * 3 + 1], row[i * 3 + 2])));
  }
  function getMacColors() {
    const row = new Uint8Array(0x15);
    document.querySelectorAll("#macColors input").forEach((el, i) =>
      [1, 3, 5].forEach((p, c) => (row[i * 3 + c] = parseInt(el.value.slice(p, p + 2), 16))));
    return row;
  }

  async function readPalette() {
    const r = await dev.readTable(0x88, 0xb8);
    if (!r || !r.echoOk || r.data.length !== 0x400 || !r.data.slice(0x15, 0x2a).some(b => b))
      throw new Error("Leitura da tabela de cores suspeita. Nada foi gravado.");
    return r.data;
  }
  function loadPalBackup() {
    try { const b = JSON.parse(localStorage.getItem(PAL_BACKUP)); return b && { ts: b.ts, data: new Uint8Array(b.data) }; }
    catch { return null; }
  }
  function savePalBackup(data) {
    try { localStorage.setItem(PAL_BACKUP, JSON.stringify({ ts: new Date().toLocaleString("pt-BR"), data: [...data] })); }
    catch (e) { throw new Error("Não consegui salvar o backup da paleta: " + e.message); }
    log("Backup da tabela de cores salvo neste navegador.");
  }
  async function writePalette(data, label) {
    log(`Gravando: ${label} (08 B8)…`, "tx");
    if (!(await dev.setLedRgbTab(data))) throw new Error("SetLedRgbTab falhou nas 3 tentativas.");
    await sleep(300);
    const back = await readPalette();
    const bad = [...data].map((b, i) => b !== back[i] ? i : -1).filter(i => i >= 0);
    if (bad.length) { log(`Releitura difere em ${bad.length} bytes (1º offset 0x${bad[0].toString(16)}).`, "err"); return false; }
    log("OK: paleta gravada e conferida.");
    return true;
  }

  async function readProfileData() {
    const r = await dev.getProfile();
    if (!r || !r.echoOk) throw new Error("GetProfile sem resposta válida.");
    return r.raw.slice(7); // perfil inteiro (8 globais + 2 × 0x7B), não só os 0x88 do app original
  }

  function showProfile(data, prefix = "") {
    const { global, profiles } = parseProfile(data);
    let out = prefix + `Globais: ${global.map(hx).join(" ")} · bloco ativo: ${global[0] + 1}\n`;
    profiles.forEach((p, n) => {
      out += `\nBloco ${n + 1}${p.active ? " (ATIVO)" : ""}: efeito ${p.effect} (${effectName(p.effect)})` +
        (p.custom ? " · modo personalizado" : "") + ` · grupo ${p.group}` + (p.marker ? "" : " · SEM marcador 5a a5") +
        (p.brightness !== null ? `\n  parâmetros do efeito atual: cor ${p.color} · direção ${p.direction} · brilho ${p.brightness} · velocidade ${p.speed}` : "") + "\n";
      for (let i = 0; i < p.raw.length; i += 16)
        out += `  ${i.toString(16).padStart(2, "0")}  ${[...p.raw.slice(i, i + 16)].map(hx).join(" ")}\n`;
    });
    $("ltOut").textContent = out;
    return out;
  }

  // ---------- remapeador ----------
  const { CATALOG, encodeChoice, describeEntry } = window.K652Keys;
  let sel = null;    // { k, layer: "normal" | "fn" }
  let choice = null; // item do CATALOG

  const entryAt = (data, off) => [...data.slice(off, off + 4)];
  const sameEntry = (a, b) => a.every((x, i) => x === b[i]);

  function slotOf(k, layer) {
    const m = matrix?.keys[k.matrix];
    if (!m) return null;
    return layer === "fn" ? m.fnOff : m.normalOff;
  }

  // outras teclas que apontam para o mesmo índice das tabelas Fn (mudar uma mudaria a outra)
  function sharedWith(k) {
    const i = matrix.keys[k.matrix].dualIndex;
    if (i === undefined) return [];
    return layout.keys.filter(x => x !== k && matrix.keys[x.matrix]?.dualIndex === i);
  }

  function selectKey(el, k) {
    document.querySelectorAll(".key.selected").forEach(x => x.classList.remove("selected"));
    el.classList.add("selected");
    sel = { k, layer: "normal" };
    choice = null;
    renderPanel();
    if (!matrix) return;
    const m = matrix.keys[k.matrix];
    log(`Tecla "${k.name}" (posição ${k.matrix}) — normal: ${m.normal}${m.fn ? ` · com Fn: ${m.fn}` : ""}`);
  }

  function renderPanel() {
    const ready = !!(sel && matrix);
    $("rmEmpty").hidden = ready;
    $("rmBody").hidden = !ready;
    if (!ready) {
      $("rmEmpty").textContent = !dev.connected ? "Conecte o teclado e clique numa tecla do desenho."
        : !matrix ? `Lendo o modo ${MODES[modeAddr]}…` : "Clique numa tecla do desenho.";
      return;
    }
    const { k, layer } = sel;
    const m = matrix.keys[k.matrix];
    if (layer === "fn" && m.fnOff === null) sel.layer = "normal";
    const off = slotOf(k, sel.layer);
    const cur = entryAt(matrixData, off);
    const orig = loadBackup(modeAddr)?.data;
    const origEntry = orig && entryAt(orig, off);

    $("rmKey").innerHTML = `<strong>${esc(k.name)}</strong> <span class="hint">posição ${k.matrix} · modo ${MODES[modeAddr]}</span>`;
    document.querySelectorAll("#layerSeg button").forEach(b => {
      b.classList.toggle("on", b.dataset.layer === sel.layer);
      b.disabled = b.dataset.layer === "fn" && m.fnOff === null;
      b.title = b.disabled ? "Esta tecla não tem camada Fn no firmware" : "";
    });
    $("rmCurrent").innerHTML =
      `Agora: <strong>${esc(describeEntry(cur))}</strong>` +
      (origEntry && !sameEntry(cur, origEntry) ? ` <span class="hint">(original: ${esc(describeEntry(origEntry))})</span>` : "");
    $("rmResetKey").disabled = !origEntry || sameEntry(cur, origEntry);
    renderList();
    renderPreview();
  }

  function modMask() {
    return [...document.querySelectorAll("#rmMods input:checked")].reduce((m, i) => m | (1 << +i.dataset.bit), 0);
  }

  function renderList() {
    const q = $("rmSearch").value.trim().toLowerCase();
    const list = $("rmList");
    list.innerHTML = "";
    let group = null;
    for (const item of CATALOG) {
      if (item.modes && !item.modes.includes(modeAddr)) continue;
      if (q && !`${item.label} ${item.group}`.toLowerCase().includes(q)) continue;
      if (item.group !== group) {
        group = item.group;
        const h = document.createElement("div");
        h.className = "rm-group";
        h.textContent = group;
        list.appendChild(h);
      }
      const b = document.createElement("button");
      b.className = "rm-item" + (item === choice ? " on" : "");
      b.textContent = item.label;
      b.addEventListener("click", () => {
        if (choice !== item) document.querySelectorAll("#rmMods input").forEach(i => (i.checked = false));
        choice = item; renderList(); renderPreview();
      });
      list.appendChild(b);
    }
    if (!list.children.length) list.innerHTML = `<div class="hint">Nada encontrado.</div>`;
  }

  // teclas (posição do layout) cuja função normal é Fn, olhando a matriz atual
  function fnKeys() {
    return layout.keys.filter(x => {
      const m = matrix.keys[x.matrix];
      return m && matrixData[m.normalOff] === window.K652Keys.KEY_TYPE.FN;
    });
  }

  function renderPreview() {
    // atalho só faz sentido para teclas comuns (letras, números, símbolos, F-keys, navegação)
    $("rmCombo").hidden = !(choice && choice.combo && choice.bytes[3]);
    if (choice) $("rmComboHint").textContent =
      `Marque os modificadores que devem ir junto: ex. ⌘ + ⇧ com “${choice.label}” faz a tecla mandar ⇧⌘${choice.label.split(" ")[0]} com um toque só.`;
    if (!choice) {
      $("rmPreview").textContent = "Escolha a nova função na lista.";
      $("rmApply").disabled = true;
      return;
    }
    const off = slotOf(sel.k, sel.layer);
    const cur = entryAt(matrixData, off);
    const next = encodeChoice(choice, modMask());
    const shared = sharedWith(sel.k);
    const layerName = sel.layer === "fn" ? "Com Fn" : "Normal";
    const FN = window.K652Keys.KEY_TYPE.FN;
    // tirar o Fn da última tecla que o tem deixa sem mídia/LED/Bluetooth até colocar o Fn em outra
    const losesFn = sel.layer === "normal" && cur[0] === FN && next[0] !== FN && fnKeys().length <= 1;
    const warns = [];
    if (shared.length) warns.push(`Compartilha a tabela Fn com ${shared.map(x => esc(x.name)).join(", ")}, que também muda.`);
    if (next[0] === FN && modeAddr === 0xd4) warns.push("Experimental: o modo Windows de fábrica não tem Fn nesta tabela. Se depois de gravar o Fn não funcionar, use “Voltar ao original”.");
    if (losesFn) warns.push("Esta é a única tecla Fn: depois de gravar, as funções com Fn (mídia, LED, Bluetooth) só voltam quando você puser o Fn em outra tecla. Dá para fazer isso aqui mesmo, sem precisar do Fn.");
    $("rmPreview").innerHTML =
      `${layerName}: <strong>${esc(describeEntry(cur))}</strong> → <strong>${esc(describeEntry(next))}</strong>` +
      warns.map(w => `<br><span class="warn">${w}</span>`).join("");
    $("rmApply").disabled = sameEntry(cur, next);
  }

  // grava uma entrada na matriz do modo atual (relê antes, troca só 4 bytes, grava e confere)
  async function writeSlot(k, layer, entry, label) {
    const cur = await readMatrixChecked(modeAddr);
    if (!loadBackup(modeAddr)) saveBackup(cur, modeAddr);
    const fresh = parseMatrix(cur).keys[k.matrix];
    const off = layer === "fn" ? fresh.fnOff : fresh.normalOff;
    if (off === null) throw new Error("Esta tecla não tem camada Fn.");
    if (sameEntry(entryAt(cur, off), entry)) { setMatrix(cur); return log("Nada a gravar: a tecla já está assim."); }
    const next = cur.slice();
    next.set(entry, off);
    await writeAndVerify(next, label, modeAddr);
  }

  async function applyChoice() {
    if (!sel || !choice) return;
    const entry = encodeChoice(choice, modMask());
    const before = describeEntry(entryAt(matrixData, slotOf(sel.k, sel.layer)));
    await writeSlot(sel.k, sel.layer, entry,
      `"${sel.k.name}" ${sel.layer === "fn" ? "com Fn" : "normal"}: ${before} → ${describeEntry(entry)}`);
    choice = null;
    renderPanel();
  }

  async function resetKey() {
    const orig = loadBackup(modeAddr)?.data;
    if (!sel || !orig) return;
    const entry = entryAt(orig, slotOf(sel.k, sel.layer));
    await writeSlot(sel.k, sel.layer, entry, `"${sel.k.name}" de volta ao original (${describeEntry(entry)})`);
  }

  // texto decodificado no dump do laboratório
  function appendDecoded(data) {
    const mx = parseMatrix(data);
    const lines = [];
    for (const k of [...layout.keys].sort((a, b) => a.matrix - b.matrix)) {
      const m = mx.keys[k.matrix];
      if (!m) continue;
      lines.push(`${String(k.matrix).padStart(3)}  ${k.name.padEnd(10)} ${m.normal.padEnd(14)}${m.fn ? " Fn: " + m.fn : ""}`);
    }
    $("dump").textContent += "\n\nDecodificado (matriz  tecla  normal  Fn):\n" + lines.join("\n");
  }

  // ---------- caixas de texto: copiar e Cmd/Ctrl+A local ----------
  function setupCopyBoxes() {
    for (const el of document.querySelectorAll(".copyable")) {
      el.tabIndex = 0; // clicar foca a caixa, e o Cmd+A passa a valer só para ela
      const wrap = document.createElement("div");
      wrap.className = "copy-wrap";
      el.replaceWith(wrap);
      wrap.appendChild(el);
      const btns = document.createElement("div");
      btns.className = "copy-btns";
      // o log mostra os bytes cortados; copiar/exportar levam o texto completo
      const isLog = el === logEl;
      const label = isLog ? "Copiar completo" : "Copiar";
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(isLog ? fullLogText() : el.innerText);
          btn.textContent = "Copiado ✓";
        } catch (e) {
          btn.textContent = "Falhou";
          log("Falha ao copiar: " + e.message, "err");
        }
        setTimeout(() => (btn.textContent = label), 1200);
      });
      if (isLog) {
        const exp = document.createElement("button");
        exp.className = "copy-btn";
        exp.textContent = "Exportar .txt";
        exp.addEventListener("click", exportLog);
        btns.appendChild(exp);
      }
      btns.appendChild(btn);
      wrap.appendChild(btns);
    }
    document.addEventListener("keydown", e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      const box = document.activeElement?.closest?.(".copyable");
      if (!box) return; // fora das caixas, Cmd+A continua normal (inputs etc.)
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  // ---------- testador de teclas físicas ----------
  // Ao apertar uma tecla, acende no mockup a posição da matriz que gera esse código HID.
  // Serve para conferir o layout ABNT2 (ex.: o que a tecla "/ ?" realmente manda).
  const CODE_TO_HID = (() => {
    const t = {};
    for (let i = 0; i < 26; i++) t["Key" + String.fromCharCode(65 + i)] = 0x04 + i;
    for (let i = 1; i <= 9; i++) t["Digit" + i] = 0x1d + i;
    t.Digit0 = 0x27;
    for (let i = 1; i <= 12; i++) t["F" + i] = 0x39 + i;
    Object.assign(t, {
      Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
      BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34,
      Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46,
      ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d,
      PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
      IntlBackslash: 0x64, ContextMenu: 0x65, IntlRo: 0x87, IntlYen: 0x89,
      ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3,
      ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
    });
    return t;
  })();

  function baseCode(i) {
    // código HID que a posição i da matriz manda sem Fn (tipo 0/6, ou FnBase se for tipo 2)
    const raw = matrix.keys[i].raw;
    const e = raw[0] === 0x02 && raw[3] < 48 ? matrix.fnBase[raw[3]] : raw;
    return e[0] === 0x00 || e[0] === 0x06 ? e[3] : null;
  }

  document.addEventListener("keydown", e => {
    // só depois do GetMatrix: antes disso não há como localizar a tecla e o log viraria ruído
    // modificador sozinho (Cmd, Ctrl…) passa; atalho com modificador (Cmd+A etc.) não
    const comboWithMod = (e.metaKey || e.ctrlKey) && !["Meta", "Control"].includes(e.key);
    if (!matrix || e.target.closest?.("input, textarea") || comboWithMod || e.repeat) return;
    const hid = CODE_TO_HID[e.code];
    const tag = `${e.code} (key "${e.key}")`;
    if (hid === undefined) return log(`Tecla física: ${tag} — sem código HID mapeado.`);
    const idx = matrix.keys.map((_, i) => i).filter(i => baseCode(i) === hid);
    const names = idx.map(i => `${i}${layout.keys.find(k => k.matrix === i) ? "" : " (fora do mockup)"}`);
    log(`Tecla física: ${tag} = HID 0x${hid.toString(16)} → matriz ${names.join(", ") || "nenhuma"}`);
    for (const i of idx) {
      const k = layout.keys.find(x => x.matrix === i);
      const el = k && document.querySelector(`.key[data-id="${k.id}"]`);
      if (!el) continue;
      el.classList.remove("pressed");
      void el.offsetWidth;
      el.classList.add("pressed");
    }
  });

  // ---------- boot ----------
  setupCopyBoxes();
  renderKeyboard();
  for (const [id, fn] of Object.entries(actions)) $(id).addEventListener("click", fn);
  K652Lighting.LED_EFFECTS.forEach((name, n) => { if (n) $("macFx").add(new Option(`${n} ${name}`, n)); });
  $("macColors").innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<label>${i + 1}<input type="color" value="#000000" title="Cor ${i + 1} (Fn+PgDn)"></label>`).join("");
  $("macFx").addEventListener("change", () => dev.connected && actions.macRead());
  $("ltNote").addEventListener("keydown", e => { if (e.key === "Enter") actions.ltDiff(); });
  $("chkShowMatrix").addEventListener("change", () => showMatrixValues());
  document.querySelectorAll("#modeSeg button").forEach(b =>
    b.addEventListener("click", () => setMode(parseInt(b.dataset.addr, 16))));
  document.querySelectorAll("#layerSeg button").forEach(b =>
    b.addEventListener("click", () => { if (sel) { sel.layer = b.dataset.layer; choice = null; renderPanel(); } }));
  $("rmSearch").addEventListener("input", renderList);
  $("rmMods").addEventListener("change", renderPreview);
  setMode(modeAddr);

  navigator.hid?.addEventListener?.("disconnect", e => {
    if (dev.owns(e.device)) {
      $("status").textContent = "desconectado";
      $("status").className = "status off";
      log("Teclado desconectado.", "err");
    }
  });

  log("App pronto. Clique em “Conectar teclado” (Chrome/Edge, servido via http://localhost ou https).");
})();
