// app.js — UI do configurador web (WebHID)
(() => {
  const { K652Device, hex, parseHex } = window.K652;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const layout = window.KB_LAYOUT;
  const { parseMatrix } = window.K652Keys;
  const dev = new K652Device();
  let matrix = null; // parseMatrix() da última leitura

  const $ = id => document.getElementById(id);
  const logEl = $("log");

  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  dev.log = m => log(m, m.startsWith("←") ? "rx" : m.startsWith("→") ? "tx" : undefined);

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
      el.innerHTML = `<span class="key-name">${esc(k.name)}</span><span class="matrix-val"></span>`;
      el.title = `${k.name}\nmatriz=${k.matrix} LED=${k.led ?? "?"}`;
      el.addEventListener("click", () => selectKey(el, k));
      canvas.appendChild(el);
    }
    kb.innerHTML = "";
    kb.appendChild(canvas);
  }

  function esc(s) { return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

  function selectKey(el, k) {
    document.querySelectorAll(".key.selected").forEach(x => x.classList.remove("selected"));
    el.classList.add("selected");
    let extra = "";
    const m = matrix?.keys[k.matrix];
    if (m) {
      extra = ` — matriz [${hex(new Uint8Array(m.raw))}] → ${m.normal}` +
        (m.fn ? ` | Fn: ${m.fn} (índice Fn 0x${m.dualIndex.toString(16)})` : "");
    }
    log(`Tecla "${k.name}" — matriz ${k.matrix}, LED ${k.led ?? "?"}${extra}`);
  }

  function showMatrixValues(show) {
    document.querySelectorAll(".key").forEach(el => {
      const mv = el.querySelector(".matrix-val");
      if (!show || !matrix) { mv.textContent = ""; el.classList.remove("lit", "has-fn"); return; }
      const k = layout.keys.find(x => x.id === +el.dataset.id);
      const m = k && matrix.keys[k.matrix];
      if (m) {
        mv.textContent = m.fn ? `${m.normal} · Fn:${m.fn}` : m.normal;
        el.classList.toggle("lit", m.normal !== "—");
        el.classList.toggle("has-fn", !!m.fn);
      }
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
      log("Coleções HID listadas no painel.");
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
      const addr = matrixAddr();
      const r = await dev.getMatrix(addr);
      if (!r) return log("GetMatrix: sem resposta.", "err");
      dumpHex(r.raw, `GetMatrix (cmd 0x84, endereço 0x${addr.toString(16)}) resposta — matriz a partir de 0x07`);
      tryParseMatrix(r.data);
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
    btnWrPrepare: () => act(prepareRemap),
    btnWrWrite: () => act(writeRemap),
    btnWrUndo: () => act(restoreBackup),
  };

  // ---------- escrita: remapear tecla (SetKeyMatrix, sub_4458b0) ----------
  // Fluxo: lê a matriz atual → guarda backup (um por endereço; o 1º fica salvo até ser restaurado) →
  // troca só uma entrada → mostra o diff → grava → lê de novo e compara byte a byte.
  // Endereços: D4 = tabela do modo Windows, D8 = modo Mac, DC = macros.
  const BACKUP_PREFIX = "k652.matrixBackup.";
  const backupKey = addr => BACKUP_PREFIX + addr.toString(16);
  try { // migra o backup único da versão anterior (sempre D4)
    const legacy = localStorage.getItem("k652.matrixBackup");
    if (legacy) { localStorage.setItem(backupKey(0xd4), legacy); localStorage.removeItem("k652.matrixBackup"); }
  } catch {}

  function matrixAddr() {
    const a = parseInt($("mxAddr").value, 16);
    if (!(a >= 0 && a <= 0xff)) throw new Error("Endereço da matriz deve ser 00–FF.");
    return a;
  }
  let pendingWrite = null; // { data, label }

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
    const list = [0xd4, 0xd8, 0xdc].map(loadBackup).filter(Boolean);
    $("wrBackupInfo").textContent = list.length
      ? "Backups originais salvos neste navegador: " + list.map(b => `0x${b.addr.toString(16)} (${b.ts})`).join(", ") +
        ". “Desfazer” restaura o do endereço selecionado."
      : "Sem backup salvo ainda — o 1º “Preparar” de cada endereço cria um.";
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

  async function prepareRemap() {
    pendingWrite = null;
    $("btnWrWrite").disabled = true;
    const idx = +$("wrIdx").value;
    const code = parseInt($("wrCode").value, 16);
    if (!(idx >= 0 && idx < 132) || !(code > 0 && code < 0x100)) return log("Matriz deve ser 0–131 e código HID 01–FF.", "err");

    const addr = matrixAddr();
    const cur = await readMatrixChecked(addr);
    tryParseMatrix(cur);
    if (!loadBackup(addr)) { saveBackup(cur, addr); log(`Backup da matriz 0x${addr.toString(16)} salvo neste navegador.`); }
    showBackupInfo();

    // tecla tipo 2 (com camada Fn): troca a entrada FnBase do índice, preservando a função Fn
    const e = cur.slice(idx * 4, idx * 4 + 4);
    const dual = e[0] === 0x02 && e[3] < 48 && !$("wrBase").checked;
    const off = dual ? 0x210 + e[3] * 4 : idx * 4;
    const next = cur.slice();
    next.set([0x00, 0x00, 0x00, code], off);

    const k = layout.keys.find(x => x.matrix === idx);
    const { describeEntry } = window.K652Keys;
    const before = [...cur.slice(off, off + 4)], after = [...next.slice(off, off + 4)];
    const diffs = [...next].reduce((n, b, i) => n + (b !== cur[i]), 0);
    const label = `"${k ? k.name : "?"}" (matriz ${idx}): ${describeEntry(before)} → ${describeEntry(after)}`;
    pendingWrite = { data: next, label, addr };

    const frame = new Uint8Array([0x04, addr, 0x00, 0x40, 0x00, 0x00, 0x00]);
    $("dump").textContent =
      `PRÉVIA DA ESCRITA — nada foi enviado ainda\n\n` +
      `Tecla ${label}\n` +
      (dual ? `Tecla com camada Fn (índice 0x${e[3].toString(16)}): muda a entrada FnBase, a função Fn continua igual.\n` : "") +
      `Offset na matriz: 0x${off.toString(16)}  bytes ${hex(before)} → ${hex(after)}\n` +
      `Bytes diferentes da leitura atual: ${diffs} (o resto é reenviado exatamente como foi lido)\n\n` +
      `Quadro: SetFeature report 6, 1031 bytes = [${hex(frame)}] + matriz 0x400\n` +
      `(formato do app original, sub_4458b0)`;
    $("btnWrWrite").disabled = false;
    log(`Escrita preparada: ${label}. Confira o dump e clique em “Gravar e verificar”.`);
  }

  async function writeAndVerify(data, label, addr) {
    log(`Gravando: ${label} (endereço 0x${addr.toString(16)})…`, "tx");
    if (!(await dev.setKeyMatrix(data, addr))) throw new Error("SetKeyMatrix falhou nas 3 tentativas.");
    await sleep(300);
    const back = (await dev.getMatrix(addr))?.data;
    if (!back) throw new Error("Gravou, mas a releitura não respondeu. Tente GetMatrix manualmente.");
    tryParseMatrix(back);
    const bad = [...data].map((b, i) => b !== back[i] ? i : -1).filter(i => i >= 0);
    if (bad.length) {
      log(`Releitura difere em ${bad.length} bytes (1º offset 0x${bad[0].toString(16)}). Veja o dump.`, "err");
      return false;
    }
    log(`OK: releitura idêntica ao que foi gravado. Aperte a tecla para testar (o testador mostra o código).`);
    return true;
  }

  async function writeRemap() {
    if (!pendingWrite) return log("Prepare a escrita primeiro.", "err");
    if (!confirm(`Gravar no teclado?\n\n${pendingWrite.label}\n\nDá para desfazer com “Desfazer (restaurar backup)”.`)) return;
    $("btnWrWrite").disabled = true;
    const w = pendingWrite;
    pendingWrite = null;
    await writeAndVerify(w.data, w.label, w.addr);
  }

  // (Reenviar perfil foi removido: o teclado não devolve o perfil no mesmo formato em que recebe —
  //  no teste de 2026-10-21 o reenvio "idêntico" mudou o modo de LED. Ver protocol-notes.md.)

  async function restoreBackup() {
    const addr = matrixAddr();
    const b = loadBackup(addr);
    if (!b || b.data.length !== 0x400) return log(`Não há backup do endereço 0x${addr.toString(16)} neste navegador.`, "err");
    if (!confirm(`Restaurar a matriz 0x${addr.toString(16)} salva em ${b.ts}?`)) return;
    if (!(await writeAndVerify(b.data, `restauração do backup de ${b.ts}`, b.addr)))
      return log("Backup mantido no navegador; tente restaurar de novo.", "err");
    try { localStorage.removeItem(backupKey(addr)); } catch {}
    showBackupInfo();
    log("Backup aplicado e removido; o próximo “Preparar” salva um novo.");
  }

  function tryParseMatrix(data) {
    // data = 0x400 bytes copiados de resp[7] (como sub_4459d0)
    matrix = parseMatrix(data);
    const lines = [];
    for (const k of [...layout.keys].sort((a, b) => a.matrix - b.matrix)) {
      const m = matrix.keys[k.matrix];
      if (!m) continue;
      lines.push(`${String(k.matrix).padStart(3)}  ${k.name.padEnd(10)} ${m.normal.padEnd(14)}${m.fn ? " Fn: " + m.fn : ""}`);
    }
    $("dump").textContent += "\n\nDecodificado (matriz  tecla  normal  Fn):\n" + lines.join("\n");
    const nFn = matrix.keys.filter(m => m.fn).length;
    log(`Matriz decodificada: ${layout.keys.length} teclas do layout, ${nFn} com camada Fn. Marque "mostrar valores da matriz" para ver no teclado.`);
    showMatrixValues($("chkShowMatrix").checked);
  }

  // ---------- caixas de texto: copiar e Cmd/Ctrl+A local ----------
  function setupCopyBoxes() {
    for (const el of document.querySelectorAll(".copyable")) {
      el.tabIndex = 0; // clicar foca a caixa, e o Cmd+A passa a valer só para ela
      const wrap = document.createElement("div");
      wrap.className = "copy-wrap";
      el.replaceWith(wrap);
      wrap.appendChild(el);
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copiar";
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(el.innerText);
          btn.textContent = "Copiado ✓";
        } catch (e) {
          btn.textContent = "Falhou";
          log("Falha ao copiar: " + e.message, "err");
        }
        setTimeout(() => (btn.textContent = "Copiar"), 1200);
      });
      wrap.appendChild(btn);
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
  showBackupInfo();
  renderKeyboard();
  for (const [id, fn] of Object.entries(actions)) $(id).addEventListener("click", fn);
  $("chkShowMatrix").addEventListener("change", e => showMatrixValues(e.target.checked));

  navigator.hid?.addEventListener?.("disconnect", e => {
    if (dev.owns(e.device)) {
      $("status").textContent = "desconectado";
      $("status").className = "status off";
      log("Teclado desconectado.", "err");
    }
  });

  log("App pronto. Clique em “Conectar teclado” (Chrome/Edge, servido via http://localhost ou https).");
})();
