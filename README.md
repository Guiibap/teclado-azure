# teclado-azure

Configurador web (WebHID) para o teclado Redragon K652 RGB PRO ("Azure"), feito por engenharia reversa do software oficial do fabricante, que só existe para Windows.

Funciona no Chrome ou no Edge, sem instalar nada:

- leitura e gravação do perfil: efeito, brilho e velocidade;
- cores personalizadas por tecla;
- remapeamento de teclas.

## Como rodar

O WebHID só funciona em `localhost` ou HTTPS. Sirva a pasta `web/`:

```bash
cd web && python3 -m http.server 8765
```

Abra http://localhost:8765 no Chrome, clique em conectar e escolha o teclado.

## Estrutura

- `web/`: o app (HTML, CSS e JS puro, sem build).
- `tools/gen-layout.js`: gera o layout das teclas.
- `analysis/protocol-notes.md`: anotações do protocolo HID descoberto (comandos, formato do perfil, tabelas de cor).

## Aviso

Projeto pessoal, sem relação com a Redragon. Gravar dados errados no teclado pode bagunçar a iluminação ou o mapeamento; o app mostra os bytes e pede confirmação antes de cada gravação. Use por sua conta.
