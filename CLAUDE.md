@DESIGN.md

# Teclado Azure (K652) — configurador web

- App estático em `web/` (sem build). Rodar: `cd web && python3 -m http.server 8765`. WebHID exige Chrome/Edge e HTTPS ou localhost.
- Visual segue o DESIGN.md (Raycast): só tema escuro, tokens em `web/styles.css` (`:root`).
- Não usar controles nativos do navegador (select, range, checkbox, color, details, confirm). Usar os componentes de `web/ui.js`.
- Ícones: só Lucide (ISC), SVG inline. Exceção: logos de plataforma (brand-apple, brand-windows) do Tabler (MIT), porque o Lucide não tem marcas.
- Ao mudar CSS/JS, subir o `?v=` em `web/index.html`.
- Nunca usar Fn+Esc (reset de fábrica) nos testes.
