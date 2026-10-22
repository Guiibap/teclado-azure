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
    const time = I18N.fmtTime();
    logEntries.push({ time, msg, full });
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = `[${time}] ${msg}`;
    if (full) line.title = t("log.fullTitle");
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    // o que importa para quem não está olhando o registro sobe como aviso
    if (cls === "err") UI.toast(msg.split("\n")[0], "err");
    else if (cls === "ok") UI.toast(msg, "ok");
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
      el.title = t("key.title.raw", { name: k.name, matrix: k.matrix, led: k.led ?? "?" });
      el.addEventListener("click", () => selectKey(el, k));
      canvas.appendChild(el);
    }
    const sizer = document.createElement("div");
    sizer.className = "kb-sizer";
    sizer.appendChild(canvas);
    kb.innerHTML = "";
    kb.appendChild(sizer);
    fitKeyboard();
  }

  // o desenho é feito em escala 1.5 e reduzido com transform; abaixo de 0.6 a moldura rola na horizontal
  function fitKeyboard() {
    const canvas = $("kbCanvas"), sizer = canvas?.parentElement;
    if (!canvas) return;
    const w = layout.width * 1.5, h = layout.height * 1.5;
    const s = Math.max(0.6, Math.min(1, $("keyboard").clientWidth / w));
    canvas.style.transform = `scale(${s})`;
    sizer.style.width = w * s + "px";
    sizer.style.height = h * s + "px";
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
      el.title = t(m.fn ? "key.title.fn" : "key.title", { name: k.name, normal: m.normal, fn: m.fn });
      el.classList.toggle("lit", show && m.normal !== "—");
      el.classList.toggle("has-fn", show && !!m.fn);
      const changed = orig && [m.normalOff, m.fnOff].some(o => o !== null && !sameEntry(entryAt(matrixData, o), entryAt(orig, o)));
      el.classList.toggle("changed", !!changed);
    });
  }

  // ---------- dumps ----------
  function dumpHex(buf, title) {
    const bytes = new Uint8Array(buf);
    let out = t("dump.bytes", { title, n: bytes.length }) + "\n";
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
      if (!("hid" in navigator)) { log(t("log.nohid"), "err"); return; }
      let d = await dev.reconnectExisting();
      if (!d) d = await dev.connect();
      setStatus(true, d.productName || t("status.connected"));
      $("collections").textContent = JSON.stringify(dev.describeCollections(), null, 1);
      await loadMode();
    } catch (e) {
      log(t("log.connectFail", { msg: e.message }), "err");
    }
  }

  function setStatus(on, text) {
    $("status").className = "status " + (on ? "on" : "off");
    $("status").querySelector(".status-text").textContent = text;
    $("btnConnect").lastChild.textContent = t(on ? "header.reconnect" : "header.connect");
    $("btnConnect").classList.toggle("primary", !on);
  }

  function needDevice() {
    if (!dev.connected) { log(t("log.needDevice"), "err"); return false; }
    return true;
  }

  // ---------- ações do lab ----------
  async function act(fn) {
    if (!needDevice()) return;
    try { await fn(); } catch (e) { log(t("log.error", { msg: e.message }), "err"); }
  }

  const actions = {
    btnConnect: connect,
    btnPassword: () => act(async () => {
      const r = await dev.getPassword();
      if (!r) return log(t("log.noResponse", { cmd: "GetPassword" }), "err");
      log(t("log.password", { status: r.status.toString(16), ok: r.ok, pwd: hex(r.pwd, ",") }) +
        (r.ok ? " " + t("log.password.expected", { pwd: hex(new Uint8Array([2,0,0,0,1,0xab]), ",") }) : ""));
      dumpHex(r.raw, t("dump.password"));
    }),
    btnProfile: () => act(async () => {
      const r = await dev.getProfile();
      if (!r) return log(t("log.noResponse", { cmd: "GetProfile" }), "err");
      dumpHex(r.raw, t("dump.profile"));
      log(t("log.profile", { echo: r.raw[0]?.toString(16), state: r.echoOk ? t("common.ok") : t("common.expected", { v: "0x83" }) }),
        r.echoOk ? undefined : "err");
    }),
    btnMatrix: () => act(async () => {
      const addr = labAddr();
      const r = await dev.getMatrix(addr);
      if (!r) return log(t("log.noResponse", { cmd: "GetMatrix" }), "err");
      dumpHex(r.raw, t("dump.matrix", { addr: addr.toString(16) }));
      appendDecoded(r.data);
      if (addr === modeAddr) setMatrix(r.data);
    }),
    btnRawSend: () => act(async () => {
      const id = +$("rawId").value;
      const payload = parseHex($("rawPayload").value);
      await dev.sendFeature(id, payload);
      log(t("log.rawSent", { id, n: payload.length }));
    }),
    btnRawGet: () => act(async () => {
      const id = +$("rawRespId").value;
      const r = await dev.getCommand(id, 1);
      if (r) dumpHex(r, t("dump.feature", { id }));
      else log(t("log.rawNone"), "err");
    }),
    btnWrUndo: () => act(restoreBackup),
    ltRead: () => act(async () => {
      const data = await readProfileData();
      log(t("log.profileRead"), undefined, showProfile(data));
    }),
    // paleta por efeito (lida em 88 B8, gravada por SetLedRgbTab 08 B8): linha n = efeito n, 7 cores RGB.
    // Confirmado ao vivo: bate com o Profile1.bk exportado (efeito 1 com branco no slot 0).
    ltColors: () => act(async () => {
      const r = await dev.readTable(0x88, 0xb8);
      if (!r) return log(t("log.colors.none"), "err");
      let out = t("ltColors.head", { echo: hx(r.raw[0]), state: r.echoOk ? t("common.ok") : t("common.expected", { v: "88" }), n: r.raw.length }) + "\n";
      const used = r.data.findLastIndex(b => b !== 0) + 1;
      for (let i = 0; i < Math.max(used, 0x15); i += 0x15) {
        const row = [...r.data.slice(i, i + 0x15)];
        const cores = Array.from({ length: 7 }, (_, c) => row.slice(c * 3, c * 3 + 3).map(hx).join("")).join(" ");
        const n = i / 0x15;
        out += `${String(n).padStart(2)} ${(K652Lighting.LED_EFFECTS[n] ?? "—").padEnd(18)} ${cores}\n`;
      }
      $("ltOut").textContent = out;
      log(t("log.colors.read", { n: used }), r.echoOk ? undefined : "err", out);
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
      const msg = t("dialog.palCopy", { a: (PAL_MAC_FROM - 1).toString(16), b: PAL_MAC_BASE.toString(16),
        c: (PAL_MAC_BASE + PAL_MAC_FROM - 1).toString(16), n: changed });
      log(t("log.palCopy.preview", { off: (PAL_MAC_BASE + 0x15).toString(16), hex: hex(next.slice(PAL_MAC_BASE + 0x15, PAL_MAC_BASE + 0x2a)) }), "note");
      if (!(await UI.ask(msg))) return log(t("log.cancelled"));
      autoBackup({ palette: cur }, { key: "history.palCopy" });
      if (await writePalette(next, t("label.palCopy")))
        log(t("log.palCopy.done"), "note");
    }),
    macRead: () => act(async () => {
      const pal = await readPalette();
      const fx = macEffect();
      setMacColors(pal.slice(macRow(fx), macRow(fx) + 0x15));
      log(t("log.macRead", { fx, name: effectName(fx), off: macRow(fx).toString(16), hex: hex(pal.slice(macRow(fx), macRow(fx) + 0x15)) }));
    }),
    macWrite: () => act(async () => {
      const cur = await readPalette();
      if (!loadPalBackup()) savePalBackup(cur);
      const fx = macEffect(), off = macRow(fx), row = getMacColors();
      const old = cur.slice(off, off + 0x15);
      if (row.every((b, i) => b === old[i])) return log(t("log.macSame"));
      const next = cur.slice();
      next.set(row, off);
      const range = { a: off.toString(16), b: (off + 0x14).toString(16) };
      log(t("log.macWrite.preview", { fx, ...range, old: hex(old), new: hex(row) }), "note");
      if (!(await UI.ask(t("dialog.macWrite", { fx, name: effectName(fx), ...range })))) return log(t("log.cancelled"));
      autoBackup({ palette: cur }, { key: "history.macWrite", vars: { fx } });
      if (await writePalette(next, t("label.macWrite", { fx })))
        log(t("log.macWrite.done"), "note");
    }),
    bsRead: () => act(async () => {
      const cur = parseProfile(await readProfileData()).profiles.find(p => p.active);
      if (!cur || cur.brightness === null) return log(t("log.noActive"), "err");
      $("bsBright").value = cur.brightness;
      $("bsSpeed").value = cur.speed;
      if ($("fxSel").has(cur.effect)) $("fxSel").value = cur.effect;
      showBs(cur);
    }),
    fxWrite: () => act(async () => {
      const data = await readProfileData();
      const n = data[0], blk = 8 + n * PROFILE_STRIDE, fx = parseInt($("fxSel").value, 10);
      if (n > 1 || !(fx >= 0 && fx <= 20)) return log(t("log.fx.unexpected", { block: n + 1, fx }), "err");
      if (data[blk + 5] === fx && data[blk + 4] === 0) return log(t("log.fx.same", { name: effectName(fx) }));
      // [4] = 0: sai do modo personalizado (Fn+End), como o sub_40d240 faz para qualquer efeito pronto
      const want = data.slice(); want[blk + 5] = fx; want[blk + 4] = 0;
      await writeProfile(data, want, t("label.fx", { from: effectName(data[blk + 5]), to: effectName(fx), block: n + 1 }),
        { desc: { key: "history.fx", vars: { fxFrom: data[blk + 5], fxTo: fx } } });
    }),
    bsWrite: () => act(async () => {
      const data = await readProfileData();
      const n = data[0], blk = 8 + n * PROFILE_STRIDE, fx = data[blk + 5];
      if (n > 1 || fx < 1 || fx > 29) return log(t("log.bs.unexpected", { block: n + 1, fx }), "err");
      const off = blk + 0x15 + 2 * fx; // byte B do efeito atual: brilho | velocidade << 4
      const b = clampBs($("bsBright").value) | (clampBs($("bsSpeed").value) << 4);
      if (data[off] === b) return log(t("log.bs.same"));
      const want = data.slice(); want[off] = b;
      await writeProfile(data, want, t("label.bs", { bright: b & 0xf, speed: b >> 4, fx, name: effectName(fx), block: n + 1 }),
        { desc: { key: "history.bs", vars: { fx } } });
    }),
    bsUndo: () => act(async () => {
      if (!bsBefore) return log(t("log.nothingUndo"), "err");
      await writeProfile(await readProfileData(), bsBefore, t("label.undo"),
        { desc: { key: "history.undo" } });
    }),
    bsRestore: () => act(async () => {
      const b = loadProfileBackup();
      if (!b) return log(t("log.noProfileBackup"), "err");
      await writeProfile(await readProfileData(), b.data, t("label.profileRestore", { ts: fmtTs(b.ts) }),
        { desc: { key: "history.profileRestore" } });
    }),
    ltPalRestore: () => act(async () => {
      const b = loadPalBackup();
      if (!b) return log(t("log.noPalBackup"), "err");
      if (!(await UI.ask(t("dialog.palRestore", { ts: fmtTs(b.ts) }), { confirm: t("common.restore"), danger: true }))) return;
      autoBackup(await readParts(["palette"]), { key: "history.palRestore" });
      await writePalette(b.data, t("label.palRestore"));
    }),
    ltSnap: () => act(async () => {
      profileSnap = await readProfileData();
      log(t("log.snap"), undefined, showProfile(profileSnap));
    }),
    ltDiff: () => act(async () => {
      if (!profileSnap) return log(t("log.snapFirst"), "err");
      const now = await readProfileData();
      const diffs = [];
      for (let i = 0; i < Math.max(now.length, profileSnap.length); i++)
        if (now[i] !== profileSnap[i]) diffs.push(i);
      const lines = diffs.map(i => `0x${i.toString(16).padStart(3, "0")}  ${hx(profileSnap[i])} → ${hx(now[i])}   ${describeOffset(i)}`);
      const note = $("ltNote").value.trim();
      const head = t("diff.head", { n: diffs.length }) + "\n" + (lines.join("\n") || t("diff.none")) + "\n\n";
      const decoded = showProfile(now, head);
      log(t("log.diff", { note: note ? ` [${note}]` : "", n: diffs.length }), "note", decoded);
      if (!note) log(t("log.diffTip"));
      // a próxima comparação parte daqui
      profileSnap = now;
      $("ltNote").value = "";
    }),
    rmApply: () => act(applyChoice),
    rmResetKey: () => act(resetKey),
    bkNew: () => act(manualBackup),
  };

  // ---------- modo (tabela de teclas) ----------
  // Endereços da matriz: D4 = modo Windows, D8 = modo Mac, DC = macros (só leitura no lab).
  const MODES = { 0xd8: "Mac", 0xd4: "Windows" }; // nomes de plataforma: não se traduzem
  let modeAddr = 0xd8;
  try { if (MODES[+localStorage.getItem("k652.mode")]) modeAddr = +localStorage.getItem("k652.mode"); } catch {}
  let matrixData = null; // 0x400 bytes da matriz do modo selecionado (última leitura)

  function labAddr() {
    const a = parseInt($("mxAddr").value, 16);
    if (!(a >= 0 && a <= 0xff)) throw new Error(t("error.mxAddr"));
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
    if (!loadBackup(modeAddr)) { saveBackup(data, modeAddr); log(t("log.origSaved", { mode: MODES[modeAddr] })); }
    setMatrix(data);
    showBackupInfo();
    log(t("log.modeLoaded", { mode: MODES[modeAddr], addr: modeAddr.toString(16) }));
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
    const b = { ts: new Date().toISOString(), addr, hex: hex(data, "") };
    try { localStorage.setItem(backupKey(addr), JSON.stringify(b)); } catch (e) { log(t("log.saveFail", { msg: e.message }), "err"); }
    return b;
  }

  function showBackupInfo() {
    const b = loadBackup(modeAddr);
    $("wrBackupInfo").textContent = b
      ? t("factory.saved", { mode: MODES[modeAddr], ts: fmtTs(b.ts) })
      : t("factory.notYet", { mode: MODES[modeAddr] });
  }

  async function readMatrixChecked(addr) {
    const r = await dev.getMatrix(addr);
    if (!r) throw new Error(t("error.matrixNone"));
    // trava de segurança: só escrevemos em cima de uma leitura que parece válida
    const filled = parseMatrix(r.data).keys.filter(k => k.normal !== "—").length;
    if (r.raw[0] !== 0x84 || r.raw[1] !== addr || r.data.length !== 0x400 || filled < 30)
      throw new Error(t("error.suspect", { echo: hex(r.raw.slice(0, 2)), n: r.data.length, keys: filled }));
    return r.data;
  }

  // SetKeyMatrix (sub_4458b0) com a matriz inteira, depois relê e compara byte a byte
  async function writeAndVerify(data, label, addr) {
    log(t("log.writing", { label, mode: MODES[addr] ?? "?", addr: addr.toString(16) }), "tx");
    if (!(await dev.setKeyMatrix(data, addr))) throw new Error(t("error.setMatrix"));
    await sleep(300);
    const back = (await dev.getMatrix(addr))?.data;
    if (!back) throw new Error(t("error.reread"));
    if (addr === modeAddr) setMatrix(back);
    const bad = [...data].map((b, i) => b !== back[i] ? i : -1).filter(i => i >= 0);
    if (bad.length) {
      log(t("log.rereadDiff", { n: bad.length, off: bad[0].toString(16) }), "err");
      return false;
    }
    log(t("log.okWritten"), "ok");
    return true;
  }

  // (Reenviar perfil foi removido: o teclado não devolve o perfil no mesmo formato em que recebe —
  //  no teste de 2026-10-21 o reenvio "idêntico" mudou o modo de LED. Ver protocol-notes.md.)

  async function restoreBackup() {
    const b = loadBackup(modeAddr);
    if (!b || b.data.length !== 0x400) return log(t("log.noOrig", { mode: MODES[modeAddr] }), "err");
    if (!(await UI.ask(t("dialog.modeRestore", { mode: MODES[modeAddr], ts: fmtTs(b.ts) }), { confirm: t("common.restore"), danger: true }))) return;
    autoBackup(await readParts([matrixPart(modeAddr)]), { key: "history.modeRestore", vars: { addr: modeAddr } });
    await writeAndVerify(b.data, t("label.modeRestore", { mode: MODES[modeAddr] }), modeAddr);
  }

  // ---------- iluminação (leitura) ----------
  const { parseProfile, effectName, describeOffset, PROFILE_STRIDE } = window.K652Lighting;
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
    document.querySelectorAll("#macColors .ui-swatch").forEach((el, i) => (el.value = toHex(row[i * 3], row[i * 3 + 1], row[i * 3 + 2])));
  }
  function getMacColors() {
    const row = new Uint8Array(0x15);
    document.querySelectorAll("#macColors .ui-swatch").forEach((el, i) =>
      [1, 3, 5].forEach((p, c) => (row[i * 3 + c] = parseInt(el.value.slice(p, p + 2), 16))));
    return row;
  }

  async function readPalette() {
    const r = await dev.readTable(0x88, 0xb8);
    if (!r || !r.echoOk || r.data.length !== 0x400 || !r.data.slice(0x15, 0x2a).some(b => b))
      throw new Error(t("error.palSuspect"));
    return r.data;
  }
  function loadPalBackup() {
    try { const b = JSON.parse(localStorage.getItem(PAL_BACKUP)); return b && { ts: b.ts, data: new Uint8Array(b.data) }; }
    catch { return null; }
  }
  function savePalBackup(data) {
    try { localStorage.setItem(PAL_BACKUP, JSON.stringify({ ts: new Date().toISOString(), data: [...data] })); }
    catch (e) { throw new Error(t("error.palSave", { msg: e.message })); }
    log(t("log.palBackup"));
  }
  async function writePalette(data, label) {
    log(t("log.writingPal", { label }), "tx");
    if (!(await dev.setLedRgbTab(data))) throw new Error(t("error.setPal"));
    await sleep(300);
    const back = await readPalette();
    const bad = [...data].map((b, i) => b !== back[i] ? i : -1).filter(i => i >= 0);
    if (bad.length) { log(t("log.rereadDiff", { n: bad.length, off: bad[0].toString(16) }), "err"); return false; }
    log(t("log.okPal"), "ok");
    return true;
  }

  async function readProfileData() {
    const r = await dev.getProfile();
    if (!r || !r.echoOk) throw new Error(t("error.profileNone"));
    return r.raw.slice(7); // perfil inteiro (8 globais + 2 × 0x7B), não só os 0x88 do app original
  }

  // ---------- gravação do perfil (SetProfile 03 B6) ----------
  // O app original (v1.6.6) grava 0x88 bytes = 8 globais + 1 bloco de 0x40 terminado em 5a a5 (sub_40d240), o
  // formato de um firmware antigo de 1 perfil. Este firmware lê 8 globais + 2 blocos de 0x7B, cada um terminado em
  // 5a a5 em [0x79..0x7a]. As 3 tentativas com 0x88 bytes (21/10 e 22/10) deixaram o fim dos blocos zerado e o
  // teclado voltou a luz ao padrão (efeito 0x0b, todos 07 44). Agora grava de volta exatamente o formato lido.
  let bsBefore = null;
  function loadProfileBackup() {
    try { const b = JSON.parse(localStorage.getItem(PROFILE_BACKUP)); return b && { ts: b.ts, data: new Uint8Array(b.data) }; }
    catch { return null; }
  }
  const clampBs = v => Math.max(0, Math.min(4, parseInt(v, 10) || 0));
  const PROFILE_BACKUP = "k652.profileBackup";
  const PROFILE_LEN = 8 + 2 * PROFILE_STRIDE; // 0xFE
  function packProfile(data) {
    const out = data.slice(0, PROFILE_LEN);
    if (out.length !== PROFILE_LEN) throw new Error(t("error.profileLen", { n: out.length, want: PROFILE_LEN }));
    const bad = [6, ...[0, 1].map(n => 8 + n * PROFILE_STRIDE + 0x79)].filter(i => out[i] !== 0x5a || out[i + 1] !== 0xa5);
    if (bad.length) throw new Error(t("error.markers", { at: bad.map(i => "0x" + i.toString(16)).join(", ") }));
    return out;
  }
  function showBs(p) {
    $("bsInfo").textContent = t("bs.info", { fx: p.effect, name: effectName(p.effect), bright: p.brightness, speed: p.speed });
  }
  // desc: descrição do backup automático (null = quem chamou já fez o backup); confirmed: pula o diálogo
  async function writeProfile(before, want, label, { desc = { key: "history.profile", vars: { label } }, confirmed = false } = {}) {
    try { if (!localStorage.getItem(PROFILE_BACKUP))
      localStorage.setItem(PROFILE_BACKUP, JSON.stringify({ ts: new Date().toISOString(), data: [...before] })); } catch {}
    const changes = [...want].map((b, i) => b !== before[i] ? i : -1).filter(i => i >= 0);
    const pkt = packProfile(want);
    log(t("log.profilePreview", { n: pkt.length }) + "\n" +
      Array.from({ length: Math.ceil(pkt.length / 16) }, (_, r) => "  " + hex(pkt.slice(r * 16, r * 16 + 16))).join("\n") +
      "\n" + t("log.profileChanges") + " " + changes.map(i => `0x${i.toString(16)} ${hx(before[i])}→${hx(want[i])} (${describeOffset(i)})`).join(", "), "note");
    if (!confirmed && !(await UI.ask(t("dialog.profile", { label }), { danger: true })))
      return log(t("log.cancelled"));
    if (desc) autoBackup({ profile: before }, desc);
    log(t("log.writingProfile", { label }), "tx");
    if (!(await dev.setProfile(pkt))) throw new Error(t("error.setProfile"));
    await sleep(300);
    const back = await readProfileData();
    const diff = [...back.slice(0, PROFILE_LEN)].map((b, i) => b !== want[i] ? i : -1).filter(i => i >= 0);
    if (!diff.length) bsBefore = before; // só vira ponto de desfazer se a gravação bateu
    if (!diff.length) log(t("log.okProfile"), "ok");
    else log(t("log.profileDiff", { n: diff.length }) + "\n" + diff.map(i =>
      "  " + t("log.profileDiff.row", { off: i.toString(16).padStart(3, "0"), want: hx(want[i]), got: hx(back[i]), what: describeOffset(i) })).join("\n") +
      "\n" + t("log.profileDiff.tip"), "err");
    const p = parseProfile(back).profiles.find(q => q.active);
    if (p) showBs(p);
  }

  function showProfile(data, prefix = "") {
    const { global, profiles } = parseProfile(data);
    let out = prefix + t("profile.globals", { g: global.map(hx).join(" "), n: global[0] + 1 }) + "\n";
    profiles.forEach((p, n) => {
      out += "\n" + t("profile.block", { n: n + 1, active: p.active ? t("profile.active") : "", fx: p.effect, name: effectName(p.effect) }) +
        (p.custom ? t("profile.custom") : "") + t("profile.group", { g: p.group }) + (p.marker ? "" : t("profile.noMarker")) +
        (p.brightness !== null ? "\n  " + t("profile.params", { color: p.color, dir: p.direction, bright: p.brightness, speed: p.speed }) : "") + "\n";
      for (let i = 0; i < p.raw.length; i += 16)
        out += `  ${i.toString(16).padStart(2, "0")}  ${[...p.raw.slice(i, i + 16)].map(hx).join(" ")}\n`;
    });
    $("ltOut").textContent = out;
    return out;
  }

  // ---------- histórico de backups (aba Backup) ----------
  // Antes de cada gravação o app guarda o estado que vai mudar ("Antes de …"); o backup manual lê tudo.
  // Fica no localStorage deste navegador, o mais recente primeiro. As cópias originais (1ª leitura) aparecem no fim.
  const HISTORY = "k652.history";
  const HISTORY_MAX = 60;
  const PARTS = { d8: t("part.d8"), d4: t("part.d4"), palette: t("part.palette"), profile: t("part.profile") };
  const matrixPart = addr => addr.toString(16); // "d8" | "d4"
  const fmtTs = ts => I18N.fmtDate(ts); // aceita ISO e o texto já formatado das cópias antigas (vira o próprio texto)
  // descrição do backup: texto livre (nome digitado) ou { key, vars } que segue o idioma na hora de mostrar
  function expandVars(v = {}) {
    const o = { ...v };
    for (const k of Object.keys(v)) {
      if (k.startsWith("fx")) o[k + "Name"] = effectName(v[k]);
      if (k === "addr") o.mode = MODES[v[k]] ?? "?";
    }
    return o;
  }
  const descText = b => b.descKey ? t(b.descKey, expandVars(b.descVars)) : b.desc;

  function loadHistory() {
    try { const h = JSON.parse(localStorage.getItem(HISTORY)); return Array.isArray(h) ? h : []; } catch { return []; }
  }
  // sem espaço no navegador: descarta o automático mais antigo e tenta de novo
  function saveHistory(h) {
    for (;;) {
      try { localStorage.setItem(HISTORY, JSON.stringify(h)); return true; }
      catch (e) {
        const i = h.findLastIndex(b => b.auto);
        if (i < 0) { log(t("log.saveFail", { msg: e.message }), "err"); return false; }
        h.splice(i, 1);
      }
    }
  }
  function addBackup(parts, desc, auto) {
    const h = loadHistory();
    const text = typeof desc === "string" ? { desc } : { descKey: desc.key, descVars: desc.vars };
    h.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), auto, ...text,
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hex(v, "")])) });
    while (h.length > HISTORY_MAX) { const i = h.findLastIndex(b => b.auto); h.splice(i < 0 ? h.length - 1 : i, 1); }
    if (saveHistory(h)) log(t("log.backupSaved", { desc: descText(h[0]) }));
    renderHistory();
  }
  const autoBackup = (parts, desc) => addBackup(parts, desc, true);

  // strict: só aceita leituras que passam nas travas (backup manual); senão guarda o que vier (estado antes de restaurar)
  async function readParts(keys, strict = false) {
    const out = {};
    for (const k of keys) {
      if (k === "palette") out[k] = strict ? await readPalette() : (await dev.readTable(0x88, 0xb8))?.data;
      else if (k === "profile") out[k] = await readProfileData();
      else out[k] = strict ? await readMatrixChecked(parseInt(k, 16)) : (await dev.getMatrix(parseInt(k, 16)))?.data;
      if (!out[k]?.length) throw new Error(t("error.readPart", { part: PARTS[k] }));
    }
    return out;
  }

  function originals() {
    return [
      ...Object.keys(MODES).map(a => [loadBackup(+a), matrixPart(+a), t("orig.keys", { mode: MODES[a] })]),
      [loadPalBackup(), "palette", t("orig.palette")],
      [loadProfileBackup(), "profile", t("orig.profile")],
    ].filter(([b]) => b?.data?.length).map(([b, k, desc]) => ({ id: "orig-" + k, ts: b.ts, orig: true, desc, parts: { [k]: hex(b.data, "") } }));
  }

  function renderHistory() {
    const h = loadHistory(), orig = originals();
    const item = b => `<li class="bk-item"><div class="bk-main">` +
      `<div class="bk-top"><span class="bk-badge">${esc(t(b.orig ? "bk.original" : b.auto ? "bk.auto" : "bk.manual"))}</span><time>${esc(fmtTs(b.ts))}</time></div>` +
      `<div class="bk-desc">${esc(descText(b))}</div><div class="bk-parts">${Object.keys(b.parts).map(k => PARTS[k]).join(" · ")}</div></div>` +
      `<div class="bk-actions"><button type="button" class="btn sm" data-restore="${b.id}">${icon("archive-restore", 14)}${esc(t("common.restore"))}</button>` +
      (b.orig ? "" : `<button type="button" class="btn ghost sm" data-del="${b.id}" aria-label="${esc(t("bk.delete.aria"))}" title="${esc(t("bk.delete"))}">${icon("trash-2", 14)}</button>`) +
      `</div></li>`;
    $("bkList").innerHTML =
      (h.length ? h.map(item).join("") : `<li class="bk-empty">${esc(t("bk.empty"))}</li>`) +
      (orig.length ? `<li class="bk-head">${esc(t("bk.originals"))}</li>` + orig.map(item).join("") : "");
  }

  async function restoreEntry(b) {
    const keys = Object.keys(b.parts);
    if (!(await UI.ask(t("dialog.restoreEntry", { ts: fmtTs(b.ts), desc: descText(b), parts: keys.map(k => PARTS[k]).join(", ") }),
      { confirm: t("common.restore"), danger: true }))) return log(t("log.cancelled"));
    const now = await readParts(keys);
    autoBackup(now, { key: "history.restoreEntry", vars: { ts: fmtTs(b.ts) } });
    for (const k of keys) {
      const data = parseHex(b.parts[k]);
      if (k === "palette") await writePalette(data, t("label.restoreColors", { ts: fmtTs(b.ts) }));
      else if (k === "profile") await writeProfile(now.profile, data, t("label.restoreEffect", { ts: fmtTs(b.ts) }), { desc: null, confirmed: true });
      else await writeAndVerify(data, t("label.restoreKeys", { ts: fmtTs(b.ts) }), parseInt(k, 16));
    }
  }

  async function manualBackup() {
    const name = $("bkName").value.trim();
    log(t("log.readingAll"), "tx");
    addBackup(await readParts(["d8", "d4", "palette", "profile"], true), name || t("bk.defaultName"), false);
    $("bkName").value = "";
  }

  $("bkList").addEventListener("click", async e => {
    const r = e.target.closest("[data-restore]"), d = e.target.closest("[data-del]");
    const find = id => [...loadHistory(), ...originals()].find(b => b.id === id);
    if (r) { const b = find(r.dataset.restore); if (b) act(() => restoreEntry(b)); }
    if (d) {
      const b = find(d.dataset.del);
      if (!b || !(await UI.ask(t("dialog.delete", { ts: fmtTs(b.ts), desc: descText(b) }), { confirm: t("bk.delete"), danger: true, disclaimer: false }))) return;
      saveHistory(loadHistory().filter(x => x.id !== b.id));
      renderHistory();
    }
  });

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
    log(t(m.fn ? "log.keySel.fn" : "log.keySel", { name: k.name, pos: k.matrix, normal: m.normal, fn: m.fn }));
  }

  function renderPanel() {
    const ready = !!(sel && matrix);
    $("rmEmpty").hidden = ready;
    $("rmBody").hidden = !ready;
    if (!ready) {
      $("rmEmptyText").textContent = !dev.connected ? t("remap.empty.disconnected")
        : !matrix ? t("remap.empty.reading", { mode: MODES[modeAddr] }) : t("remap.empty.pick");
      return;
    }
    const { k, layer } = sel;
    const m = matrix.keys[k.matrix];
    if (layer === "fn" && m.fnOff === null) sel.layer = "normal";
    const off = slotOf(k, sel.layer);
    const cur = entryAt(matrixData, off);
    const orig = loadBackup(modeAddr)?.data;
    const origEntry = orig && entryAt(orig, off);

    $("rmKey").innerHTML = `<span class="rm-keycap">${esc(k.name)}</span>` +
      `<div><div class="field-label">${esc(t("remap.selected"))}</div><div class="rm-key-meta">${esc(t("remap.keyMeta", { pos: k.matrix, mode: MODES[modeAddr] }))}</div></div>`;
    document.querySelectorAll("#layerSeg button").forEach(b => {
      b.classList.toggle("on", b.dataset.layer === sel.layer);
      b.disabled = b.dataset.layer === "fn" && m.fnOff === null;
      b.title = b.disabled ? t("remap.noFnLayer") : "";
    });
    $("rmCurrent").innerHTML =
      `<span class="field-label">${esc(t("remap.now"))}</span><strong>${esc(describeEntry(cur))}</strong>` +
      (origEntry && !sameEntry(cur, origEntry) ? `<span class="hint">${esc(t("remap.original", { v: describeEntry(origEntry) }))}</span>` : "");
    $("rmResetKey").disabled = !origEntry || sameEntry(cur, origEntry);
    renderList();
    renderPreview();
  }

  function modMask() {
    return [...document.querySelectorAll("#rmMods .chip[aria-pressed=true]")].reduce((m, i) => m | (1 << +i.dataset.bit), 0);
  }

  function renderList() {
    const q = $("rmSearch").value.trim().toLowerCase();
    const list = $("rmList");
    list.innerHTML = "";
    let group = null, box = null;
    for (const item of CATALOG) {
      if (item.modes && !item.modes.includes(modeAddr)) continue;
      if (q && !`${item.label} ${item.group}`.toLowerCase().includes(q)) continue;
      if (item.group !== group) {
        group = item.group;
        const h = document.createElement("div");
        h.className = "rm-group";
        h.textContent = group;
        list.appendChild(h);
        box = document.createElement("div");
        box.className = "rm-items";
        list.appendChild(box);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rm-item";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(item === choice));
      b.textContent = item.label;
      b.title = item.label;
      b.addEventListener("click", () => {
        if (choice !== item) document.querySelectorAll("#rmMods .chip").forEach(c => (c.pressed = false));
        const top = list.scrollTop;
        choice = item; renderList(); renderPreview();
        list.scrollTop = top;
      });
      box.appendChild(b);
    }
    if (!list.children.length) list.innerHTML = `<div class="hint">${esc(t("remap.notFound"))}</div>`;
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
      t("remap.comboHint", { label: choice.label, first: choice.label.split(" ")[0] });
    if (!choice) {
      $("rmPreview").textContent = t("remap.choose");
      $("rmApply").disabled = true;
      return;
    }
    const off = slotOf(sel.k, sel.layer);
    const cur = entryAt(matrixData, off);
    const next = encodeChoice(choice, modMask());
    const shared = sharedWith(sel.k);
    const layerName = t(sel.layer === "fn" ? "remap.layer.fn" : "remap.layer.normal");
    const FN = window.K652Keys.KEY_TYPE.FN;
    // tirar o Fn da última tecla que o tem deixa sem mídia/LED/Bluetooth até colocar o Fn em outra
    const losesFn = sel.layer === "normal" && cur[0] === FN && next[0] !== FN && fnKeys().length <= 1;
    const warns = [];
    if (shared.length) warns.push(tHtml("warn.shared", { names: shared.map(x => x.name).join(", ") }));
    if (next[0] === FN && modeAddr === 0xd4) warns.push(tHtml("warn.fnWindows"));
    if (losesFn) warns.push(tHtml("warn.lastFn"));
    $("rmPreview").innerHTML =
      `<div class="arrow"><span class="muted">${layerName}</span><span class="pill">${esc(describeEntry(cur))}</span>` +
      `<span class="muted">→</span><span class="pill new">${esc(describeEntry(next))}</span></div>` +
      warns.map(w => `<p class="warn">${icon("triangle-alert", 14)}<span>${w}</span></p>`).join("");
    $("rmApply").disabled = sameEntry(cur, next);
  }

  // grava uma entrada na matriz do modo atual (relê antes, troca só 4 bytes, grava e confere)
  async function writeSlot(k, layer, entry, label) {
    const cur = await readMatrixChecked(modeAddr);
    if (!loadBackup(modeAddr)) saveBackup(cur, modeAddr);
    const fresh = parseMatrix(cur).keys[k.matrix];
    const off = layer === "fn" ? fresh.fnOff : fresh.normalOff;
    if (off === null) throw new Error(t("error.noFn"));
    if (sameEntry(entryAt(cur, off), entry)) { setMatrix(cur); return log(t("log.keySame")); }
    if (!(await UI.ask(t("dialog.writeKey", { label, mode: MODES[modeAddr] })))) return log(t("log.cancelled"));
    autoBackup({ [matrixPart(modeAddr)]: cur }, { key: "history.key", vars: { label, addr: modeAddr } });
    const next = cur.slice();
    next.set(entry, off);
    await writeAndVerify(next, label, modeAddr);
  }

  async function applyChoice() {
    if (!sel || !choice) return;
    const entry = encodeChoice(choice, modMask());
    const before = describeEntry(entryAt(matrixData, slotOf(sel.k, sel.layer)));
    await writeSlot(sel.k, sel.layer, entry,
      t(sel.layer === "fn" ? "label.key.fn" : "label.key.normal", { name: sel.k.name, from: before, to: describeEntry(entry) }));
    choice = null;
    renderPanel();
  }

  async function resetKey() {
    const orig = loadBackup(modeAddr)?.data;
    if (!sel || !orig) return;
    const entry = entryAt(orig, slotOf(sel.k, sel.layer));
    await writeSlot(sel.k, sel.layer, entry, t("label.key.reset", { name: sel.k.name, to: describeEntry(entry) }));
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
    $("dump").textContent += "\n\n" + t("dump.decoded") + "\n" + lines.join("\n");
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
      const label = t(isLog ? "copy.full" : "copy.copy");
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(isLog ? fullLogText() : el.innerText);
          btn.innerHTML = icon("check", 12) + esc(t("copy.done"));
        } catch (e) {
          btn.textContent = t("copy.failed");
          log(t("log.copyFail", { msg: e.message }), "err");
        }
        setTimeout(() => (btn.textContent = label), 1200);
      });
      if (isLog) {
        const exp = document.createElement("button");
        exp.className = "copy-btn";
        exp.textContent = t("copy.export");
        exp.addEventListener("click", exportLog);
        btns.appendChild(exp);
      }
      btns.appendChild(btn);
      // com cabeçalho de card logo acima, os botões vão para ele e não cobrem o texto
      const head = wrap.previousElementSibling;
      (head?.classList.contains("card-head") ? head : wrap).appendChild(btns);
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
    // controles da página usam as setas, Enter e espaço: essas teclas não entram no testador
    const inControl = e.target.closest?.("input, textarea, [role=slider], [role=listbox], [role=radiogroup], [role=tablist], .ui-color") ||
      (e.target.closest?.("button") && [" ", "Enter"].includes(e.key));
    if (!matrix || inControl || document.body.classList.contains("modal-open") || comboWithMod || e.repeat) return;
    const hid = CODE_TO_HID[e.code];
    const tag = t("phys.tag", { code: e.code, key: e.key });
    if (hid === undefined) return log(t("log.phys.unmapped", { tag }));
    const idx = matrix.keys.map((_, i) => i).filter(i => baseCode(i) === hid);
    const names = idx.map(i => layout.keys.find(k => k.matrix === i) ? String(i) : t("phys.outside", { n: i }));
    log(t("log.phys", { tag, hid: hid.toString(16), matrix: names.join(", ") || t("phys.none") }));
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
  I18N.apply(document); // antes dos ícones: texto e ícone podem dividir o mesmo botão (em spans separados)
  document.querySelectorAll("[data-icon]").forEach(el => (el.innerHTML = icon(el.dataset.icon)));
  if (!("hid" in navigator)) $("noHid").hidden = false;
  if (I18N.langs.length > 1) { // seletor de idioma: só aparece com mais de um dicionário
    const sel = $("langSel");
    UI.select(sel, I18N.langs.map(l => ({ value: l, label: I18N.name(l) }))).value = I18N.lang;
    sel.querySelector(".ui-select-trigger").insertAdjacentHTML("afterbegin", icon("languages", 16));
    sel.hidden = false;
    sel.addEventListener("change", () => I18N.set(sel.value));
  }
  UI.tabs($("tabs"), { storageKey: "k652.tab" });
  UI.segmented($("modeSeg"));
  UI.segmented($("layerSeg"));
  UI.switch($("chkShowMatrix")).checked = true;
  document.querySelectorAll("#rmMods .chip").forEach(UI.toggle);
  document.querySelectorAll(".disclosure").forEach(UI.disclosure);
  UI.select($("macFx"), K652Lighting.LED_EFFECTS.map((name, n) => ({ value: n, label: name, hint: n })).slice(1)).value = 1;
  UI.select($("fxSel"), [...Array(20).keys()].map(i => i + 1).concat(0).map(n => ({ value: n, label: effectName(n), hint: n })),
    { placeholder: t("lighting.pick") });
  UI.slider($("bsBright"), { label: t("slider.bright"), icon: "sun", value: 4 });
  UI.slider($("bsSpeed"), { label: t("slider.speed"), icon: "gauge", value: 2 });
  for (let i = 0; i < 7; i++) {
    const b = document.createElement("button");
    b.title = t("mac.color.title", { n: i + 1 });
    b.setAttribute("aria-label", t("mac.color.aria", { n: i + 1 }));
    b.innerHTML = `<span class="swatch-n">${i + 1}</span>`;
    $("macColors").appendChild(UI.swatch(b));
  }
  setupCopyBoxes();
  renderKeyboard();
  new ResizeObserver(fitKeyboard).observe($("keyboard"));
  for (const [id, fn] of Object.entries(actions)) $(id).addEventListener("click", fn);
  $("macFx").addEventListener("change", () => dev.connected && actions.macRead());
  $("ltNote").addEventListener("keydown", e => { if (e.key === "Enter") actions.ltDiff(); });
  $("chkShowMatrix").addEventListener("change", () => showMatrixValues());
  document.querySelectorAll("#modeSeg button").forEach(b =>
    b.addEventListener("click", () => setMode(parseInt(b.dataset.addr, 16))));
  document.querySelectorAll("#layerSeg button").forEach(b =>
    b.addEventListener("click", () => { if (sel) { sel.layer = b.dataset.layer; choice = null; renderPanel(); } }));
  $("rmSearch").addEventListener("input", renderList);
  $("rmMods").addEventListener("change", renderPreview);
  $("bkName").addEventListener("keydown", e => { if (e.key === "Enter") actions.bkNew(); });
  setMode(modeAddr);
  renderHistory();

  navigator.hid?.addEventListener?.("disconnect", e => {
    if (dev.owns(e.device)) {
      setStatus(false, t("status.disconnected"));
      log(t("log.disconnected"), "err");
    }
  });

  log(t("log.ready"));
})();
