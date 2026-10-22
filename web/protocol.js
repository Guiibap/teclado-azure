// protocol.js — Camada de protocolo HID do Redragon K652 RGB PRO
// Recuperado por engenharia reversa do keyboarddrv.exe V1.6.6 (REA + Hopper).
// Ver analysis/protocol-notes.md para detalhes e evidências.

const K652 = {
  vendorId: 0x258a,   // SinoWealth
  productId: 0x0049,  // Redragon K652 RGB PRO
};

// Tamanhos de feature report declarados pelo dispositivo (bytes, sem o report ID)
const SIZES = {
  MAIN_FEATURE: 0x407,  // 1031 — coleção principal hDevice (report 6)
  DATA_OFFSET: 7,       // GetProfile/GetMatrix: dados começam em resp[7] (após [eco][addr][00 40 00 00 00])
  MUSIC_FEATURE: 0x17a, // 378  — coleção de música (report 8)
};

const REPORT = {
  CMD_SHORT: 0x05, // comando curto / handshake (coleção hCmd)
  WRITE: 0x06,     // escrita/comando longo (coleção hDevice)
  READ_RESP: 0x06, // resposta de leitura: GetFeature report 6 em hDevice (confirmado no asm 0x4457af/0x445aaf)
  MUSIC: 0x08,     // dados de música
};

const CMD = {
  GET_PASSWORD: 0x81, // sub-comando após 0x05
  GET_PROFILE: 0x83,
  GET_MATRIX: 0x84,
  SET_PROFILE: 0x03,
  SET_KEY_MATRIX: 0x04,
  SET_LED_RGB_TAB: 0x08,
  SET_LED_MATRIX_PAGE: 0x09,
};

// Endereços "flash" default do cfg.ini
const ADDR = {
  PRO: 0xb6,
  RGB_TAB: 0xb8,
  GAME: 0xbc,
  KEY: 0xd4,
};

function hex(buf, sep = " ") {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(sep);
}

function parseHex(str) {
  const bytes = str.replace(/0x/gi, " ").replace(/[^0-9a-fA-F ]/g, " ").trim().split(/\s+/)
    .filter(Boolean).map(s => {
      if (s.length > 2) { // permite "dwords" como 04d40040
        const out = [];
        for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
        return out;
      }
      return [parseInt(s, 16)];
    }).flat();
  return new Uint8Array(bytes);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// No Windows cada coleção top-level vira um handle (hDevice, hCmd...). No WebHID o
// teclado aparece como vários HIDDevice (um por interface USB); o report 5 (hCmd) e o
// report 6 (hDevice) podem estar em objetos diferentes, então abrimos todos e
// roteamos cada report ID para o HIDDevice que o declara.
const isK652 = d => d.vendorId === K652.vendorId && d.productId === K652.productId;

function featureIds(d) {
  return d.collections.flatMap(c => (c.featureReports || []).map(r => r.reportId));
}

// Tamanho do feature report em bytes (sem o ID), somando os itens do descritor.
// Equivale ao FeatureReportByteLength-1 que o Windows usa no HidD_SetFeature.
function featureLength(d, reportId) {
  for (const c of d.collections)
    for (const r of c.featureReports || [])
      if (r.reportId === reportId)
        return Math.ceil(r.items.reduce((n, it) => n + it.reportSize * it.reportCount, 0) / 8);
  return null;
}

class K652Device {
  constructor() {
    this.devices = [];
    this.log = () => {};
  }

  async _openAll(list) {
    for (const d of list) {
      if (d.opened) continue;
      try {
        await d.open();
      } catch (e) {
        // NotAllowedError/InvalidStateError aqui quase sempre = outra aba ou outro app já abriu o teclado
        throw new Error(`${e.message} Outra aba com esta página (ou outro app de teclado) pode estar ` +
          `com ele aberto: feche-a, ou desconecte e reconecte o cabo USB, e tente de novo.`);
      }
    }
    this.devices = list;
    list.forEach((d, i) =>
      this.log(`HIDDevice #${i}: ${d.productName} — feature reports [${featureIds(d).map(id => `${id}:${featureLength(d, id)}B`).join(", ") || "nenhum"}]`));
  }

  async connect() {
    const picked = await navigator.hid.requestDevice({
      filters: [{ vendorId: K652.vendorId, productId: K652.productId }],
    });
    if (!picked.length) throw new Error("Nenhum dispositivo selecionado.");
    // requestDevice pode devolver só a interface clicada; getDevices traz todas as autorizadas
    const all = (await navigator.hid.getDevices()).filter(isK652);
    await this._openAll(all.length ? all : picked);
    return this.devices[0];
  }

  async reconnectExisting() {
    const all = (await navigator.hid.getDevices()).filter(isK652);
    if (!all.length) return null;
    await this._openAll(all);
    return this.devices[0];
  }

  // compat: app.js compara dev.device com o device do evento disconnect
  get device() { return this.devices[0] || null; }
  owns(d) { return this.devices.includes(d); }

  get connected() { return this.devices.some(d => d.opened); }

  deviceFor(reportId) {
    const d = this.devices.find(x => x.opened && featureIds(x).includes(reportId));
    if (!d) throw new Error(`Nenhuma interface aberta declara o feature report ${reportId}.`);
    return d;
  }

  describeCollections() {
    return this.devices.map((d, i) => ({
      hidDevice: i,
      collections: d.collections.map(c => ({
        usagePage: "0x" + c.usagePage.toString(16),
        usage: "0x" + (c.usage ?? 0).toString(16),
        // WebHID não expõe comprimento; inferimos pelo uso
        featureReports: (c.featureReports || []).map(r => `${r.reportId} (${featureLength(d, r.reportId)} bytes)`),
        outputReports: (c.outputReports || []).map(r => r.reportId),
        inputReports: (c.inputReports || []).map(r => r.reportId),
      })),
    }));
  }

  // ---------- primitivos (espelham sub_445270 / sub_4451e0) ----------

  async sendFeature(reportId, payload) {
    const d = this.deviceFor(reportId);
    // O Windows manda sempre o tamanho declarado no descritor (o app passa buffers maiores
    // para o report 5, que o hidclass corta). Aqui ajustamos: completa com zeros ou corta.
    const len = featureLength(d, reportId);
    if (len && payload.length !== len) {
      const fixed = new Uint8Array(len);
      fixed.set(payload.slice(0, len));
      this.log(`(payload ajustado de ${payload.length} para ${len} bytes, tamanho do report ${reportId})`);
      payload = fixed;
    }
    await d.sendFeatureReport(reportId, payload);
    this.log(`→ SetFeature ID=${reportId} [#${this.devices.indexOf(d)}] len=${payload.length}: ${hex(payload.slice(0, 24))}${payload.length > 24 ? " …" : ""}`);
  }

  async getFeature(reportId) {
    const d = this.deviceFor(reportId);
    const dv = await d.receiveFeatureReport(reportId);
    let buf = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    // Chrome/macOS: resposta de tamanho cheio vem sem o ID (1031 B, GetMatrix), mas resposta
    // curta vem com o ID no byte 0 (262 B começando em 06, GetProfile). Normaliza para [payload...].
    if (buf.length && buf[0] === reportId && buf.length !== featureLength(d, reportId)) buf = buf.slice(1);
    this.log(`← GetFeature ID=${reportId} [#${this.devices.indexOf(d)}] len=${buf.length}: ${hex(buf.slice(0, 24))}${buf.length > 24 ? " …" : ""}`);
    return buf;
  }

  // SendCommand: report 6 + payload, 3 tentativas, Sleep(200) — como o app original
  async sendCommand(payload, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        await this.sendFeature(REPORT.WRITE, payload);
        return true;
      } catch (e) {
        this.log(`SendCommand tentativa ${i + 1} falhou: ${e.message}`);
        await sleep(200);
      }
    }
    return false;
  }

  // GetCommand: GetFeature com 3 tentativas, Sleep(200)
  async getCommand(reportId, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        return await this.getFeature(reportId);
      } catch (e) {
        this.log(`GetCommand tentativa ${i + 1} falhou: ${e.message}`);
        await sleep(200);
      }
    }
    return null;
  }

  // ---------- comandos de alto nível ----------

  // GetPassword (sub_4454a0): SetFeature ID5 [05 81 00×6], Sleep(20), GetFeature ID5 → [status][pwd×6]
  // ATENÇÃO: no 1º teste (macOS/Chrome) o GetFeature ID5 falhou e o teclado re-enumerou.
  // Só serve para o app original conferir o modelo; não é pré-requisito para os outros comandos.
  async getPassword() {
    const payload = new Uint8Array([0x05, 0x81, 0, 0, 0, 0, 0, 0]);
    await this.sendFeature(REPORT.CMD_SHORT, payload);
    await sleep(20);
    const resp = await this.getCommand(REPORT.CMD_SHORT);
    if (!resp) return null;
    const status = resp[0];
    const pwd = resp.slice(1, 7);
    return { status, pwd, ok: status === 0x01, raw: resp };
  }

  // GetProfile (sub_4456d0): ID5 [83 ProAddr 00×4], Sleep(20), GetFeature ID6 len 0x407;
  // valida resp[0]==0x83 e copia 0x88 bytes de resp[7]
  async getProfile(addr = ADDR.PRO) {
    const payload = new Uint8Array([CMD.GET_PROFILE, addr, 0, 0, 0, 0]);
    await this.sendFeature(REPORT.CMD_SHORT, payload);
    await sleep(20);
    const raw = await this.getCommand(REPORT.READ_RESP);
    if (!raw) return null;
    const off = SIZES.DATA_OFFSET;
    return { raw, echoOk: raw[0] === CMD.GET_PROFILE, data: raw.slice(off, off + 0x88) };
  }

  // GetMatrix (sub_4459d0): ID5 [84 KeyAddr 00×4], Sleep(20), GetFeature ID6 len 0x407;
  // copia 0x400 bytes de resp[7] (sem checagem de eco no original)
  async getMatrix(addr = ADDR.KEY) {
    const payload = new Uint8Array([CMD.GET_MATRIX, addr, 0, 0, 0, 0]);
    await this.sendFeature(REPORT.CMD_SHORT, payload);
    await sleep(20);
    const raw = await this.getCommand(REPORT.READ_RESP);
    if (!raw) return null;
    const off = SIZES.DATA_OFFSET;
    return { raw, data: raw.slice(off, off + 0x400) };
  }

  // ---------- escritas (montam buffer 0x407 e usam SendCommand) ----------

  _writeBuf(header, data, dataOffset) {
    const buf = new Uint8Array(SIZES.MAIN_FEATURE); // 0x407 zeros
    buf.set(header, 0);
    if (data) buf.set(data.slice(0, SIZES.MAIN_FEATURE - dataOffset), dataOffset);
    return buf;
  }

  // SetProfile (sub_4455d0): [03][ProAddr][00×5][dados 0x88] — dados em +7 (asm: memcpy em buf+0x17,
  // cabeçalho em buf+0x10), mesmo offset em que o GetProfile devolve
  async setProfile(profileData, addr = ADDR.PRO) {
    if (profileData.length !== 0x88) throw new Error(`Perfil deve ter 0x88 bytes (veio ${profileData.length}).`);
    const buf = this._writeBuf(new Uint8Array([CMD.SET_PROFILE, addr, 0, 0, 0, 0, 0]), profileData, 7);
    const ok = await this.sendCommand(buf);
    if (ok) await sleep(20); // retry gap do original
    return ok;
  }

  // SetKeyMatrix (sub_4458b0): [04][KeyAddr][00][40][00 00 00][matrix 0x400]
  async setKeyMatrix(matrix1024, addr = ADDR.KEY) {
    const buf = this._writeBuf(
      new Uint8Array([CMD.SET_KEY_MATRIX, addr, 0x00, 0x40, 0x00, 0x00, 0x00]),
      matrix1024, 7);
    return await this.sendCommand(buf);
  }

  // SetLedRgbTab (sub_445af0): [08][RgbTabAddr][00][40][00 00 00][tabela ≤ 1003]
  async setLedRgbTab(table, addr = ADDR.RGB_TAB) {
    if (table.length > 0x3eb) throw new Error("Tabela RGB > 1003 bytes");
    const buf = this._writeBuf(
      new Uint8Array([CMD.SET_LED_RGB_TAB, addr, 0x00, 0x40, 0x00, 0x00, 0x00]),
      table, 7);
    return await this.sendCommand(buf);
  }

  // SetLedMatrixPage (sub_445800): [09][page][00][40][00 00 00][1024 bytes]
  async setLedMatrixPage(page, data1024) {
    const buf = this._writeBuf(
      new Uint8Array([CMD.SET_LED_MATRIX_PAGE, page, 0x00, 0x40, 0x00, 0x00, 0x00]),
      data1024, 7);
    return await this.sendCommand(buf);
  }

  // SendMusicData (sub_4453b0): report ID 8, 378 bytes
  async sendMusicData(data378) {
    const buf = new Uint8Array(SIZES.MUSIC_FEATURE);
    buf.set(data378.slice(0, SIZES.MUSIC_FEATURE), 0);
    await this.sendFeature(REPORT.MUSIC, buf);
  }
}

window.K652 = { K652Device, K652, REPORT, CMD, ADDR, SIZES, hex, parseHex };
