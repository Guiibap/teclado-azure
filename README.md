# teclado-azure

🇧🇷 Português · [🇺🇸 English](#teclado-azure-english)

**Use agora, sem instalar nada: https://guiibap.github.io/teclado-azure/**

Configurador web (WebHID) para o teclado Redragon K652 RGB PRO ("Azure"), feito por engenharia reversa do software oficial do fabricante, que só existe para Windows.

Funciona em navegadores baseados em Chromium (Chrome, Edge, Brave, Opera e outros), sem instalar nada:

- leitura e gravação do perfil: efeito, brilho e velocidade;
- paleta de cores do modo Mac;
- remapeamento de teclas (camada normal e com Fn, modos Mac e Windows).

## Como rodar

O WebHID só funciona em `localhost` ou HTTPS. Sirva a pasta `web/`:

```bash
cd web && python3 -m http.server 8765
```

Abra http://localhost:8765 num navegador baseado em Chromium, clique em conectar e escolha o teclado.

## Estrutura

- `web/`: o app (HTML, CSS e JS puro, sem build).
- `tools/gen-layout.js`: gera o layout das teclas.
- `analysis/protocol-notes.md`: anotações do protocolo HID descoberto (comandos, formato do perfil, tabelas de cor).

## Aviso

Este app foi feito a partir da análise e do estudo do software original do teclado. É um projeto pessoal, sem relação com a Redragon.

O autor não se responsabiliza por nenhum dano causado ao teclado ou a qualquer outro equipamento. Gravar dados errados pode bagunçar a iluminação ou o mapeamento das teclas. O app mostra os bytes e pede confirmação antes de cada gravação, mas **use por sua conta e risco**.

---

# teclado-azure (English)

[🇧🇷 Português](#teclado-azure) · 🇺🇸 English

**Use it now, nothing to install: https://guiibap.github.io/teclado-azure/**

A web configurator (WebHID) for the Redragon K652 RGB PRO ("Azure") keyboard, built by reverse engineering the manufacturer's official software, which only exists for Windows.

It works in Chromium-based browsers (Chrome, Edge, Brave, Opera and others), with nothing to install:

- read and write the profile: effect, brightness and speed;
- the Mac mode color palette;
- key remapping (normal and Fn layers, Mac and Windows modes).

The interface is available in Portuguese (Brazil) and English (US). Use the language selector in the header.

## How to run

WebHID only works on `localhost` or HTTPS. Serve the `web/` folder:

```bash
cd web && python3 -m http.server 8765
```

Open http://localhost:8765 in a Chromium-based browser, click connect, and pick the keyboard.

## Structure

- `web/`: the app (plain HTML, CSS and JS, no build step).
- `web/i18n/`: interface text, one dictionary per language. `node scripts/i18n-check.js` lists missing keys.
- `tools/gen-layout.js`: generates the key layout.
- `analysis/protocol-notes.md`: notes on the HID protocol that was uncovered (commands, profile format, color tables). Written in Portuguese.

## Disclaimer

This app was built from the analysis and study of the keyboard's original software. It is a personal project, not affiliated with Redragon.

The author is not responsible for any damage to the keyboard or any other equipment. Writing wrong data can mess up the lighting or the key mapping. The app shows the bytes and asks for confirmation before every write, but **use it at your own risk**.
