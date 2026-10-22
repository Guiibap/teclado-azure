# teclado-azure

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
