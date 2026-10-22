# Plano: suporte a vários idiomas (i18n)

Status: **planejado, não implementado.** Esta etapa só prepara o app. Nenhum texto é traduzido: o único idioma continua sendo o pt-BR, e a interface deve ficar idêntica ao que é hoje.

## Decisão

Os textos saem do HTML e do JS e vão para **dicionários separados, um arquivo por idioma**. A alternativa seria deixar tudo embutido na interface e ramificar por idioma, mas aí cada idioma novo obrigaria a mexer em vários arquivos, e textos esquecidos passariam despercebidos. Com dicionários, traduzir vira preencher um arquivo, e um script consegue apontar as chaves que faltam.

O formato é **JS, não JSON**. O app não tem build e carrega tudo com `<script>`. Um `fetch` de JSON seria assíncrono e obrigaria a reorganizar a inicialização. Um arquivo `.js` que preenche `window.STRINGS` carrega antes do `app.js`, do mesmo jeito que `icons.js` já faz.

## Onde estão os textos hoje

| Arquivo | O que tem | Volume aproximado |
|---|---|---|
| `web/index.html` | rótulos, títulos, dicas, `aria-label` (13), `placeholder` (3), `title` (2), banner de WebHID, rodapé, aviso | ~100 textos |
| `web/app.js` | mensagens de log (`log(`, 64 chamadas), diálogos (`UI.ask`, 8), descrições de backup, `MODES`, `PARTS`, avisos montados com template string | ~150 textos, muitos com variáveis |
| `web/ui.js` | `DISCLAIMER`, botões padrão do `ask` ("Gravar", "Cancelar"), `aria-label` do seletor de cor | ~10 textos |
| `web/keycodes.js` | nomes de funções de mídia e sistema (`"Brilho tela +"`, `"Mudo"`, `"Calculadora"`…) | ~40 nomes |
| `web/lighting.js` | `LED_EFFECTS` ("Desligado", "Fixo", "Respirar"…) | ~25 nomes |
| `web/layout.js` | legendas físicas das teclas (ABNT2) | **não traduzir**: é o que está impresso no teclado |

Datas usam `"pt-BR"` fixo em `app.js:482`, `529` e `575`. O `app.js:16` e o `app.js:394` não passam idioma nenhum. O `<html lang="pt-BR">` também é fixo.

## Estrutura proposta

```
web/
  i18n.js            # t(), aplicação no DOM, escolha de idioma
  i18n/
    pt-BR.js         # dicionário de referência (completo)
    en.js            # futuro
```

Ordem dos scripts em `index.html`: `icons.js` → `i18n/pt-BR.js` (e os demais dicionários) → `i18n.js` → `ui.js` → … → `app.js`. Todos os dicionários são carregados de uma vez. São poucos KB cada, e assim a troca de idioma não depende de carregamento sob demanda.

### Dicionário

```js
// web/i18n/pt-BR.js
window.STRINGS = window.STRINGS || {};
window.STRINGS["pt-BR"] = {
  "meta.name": "Português (Brasil)",
  "tabs.keys": "Teclas",
  "tabs.lighting": "Iluminação",
  "tabs.advanced": "Avançado",
  "tabs.backup": "Backup",
  "backup.before.key": "Antes de alterar a tecla {label} (modo {mode})",
  "backup.count": { one: "{n} backup", other: "{n} backups" },
  "effects.0": "Desligado",
  "consumer.0x00e2": "Mudo",
  // …
};
```

- Chaves planas, com pontos separando as áreas: `common.*`, `header.*`, `tabs.*`, `keys.*`, `remap.*`, `lighting.*`, `advanced.*`, `backup.*`, `dialog.*`, `log.*`, `effects.*`, `consumer.*`, `errors.*`.
- Variáveis entre chaves: `{label}`, `{mode}`, `{n}`.
- Plural, só onde for necessário: um objeto com as categorias de `Intl.PluralRules` (`one`, `other`…).
- O texto que hoje contém HTML (por exemplo `<strong>`) fica no dicionário como texto simples sempre que possível. O HTML só fica onde não houver alternativa, numa chave com sufixo `.html` para deixar claro que ela é inserida como HTML.

### API (`web/i18n.js`)

- `t(key, vars)` devolve o texto do idioma atual, com as variáveis substituídas.
  - Se a chave faltar, usa o `pt-BR`. Se faltar também no pt-BR, devolve a própria chave e avisa uma vez no console.
  - As variáveis são escapadas por padrão quando o texto vai para HTML. Hoje o app usa `esc()` para isso.
- `I18N.lang`: o idioma atual.
- `I18N.set(lang)`: troca o idioma.
  1. Grava `k652.lang` no `localStorage`.
  2. Atualiza `<html lang>`.
  3. Chama `I18N.apply(document)` e dispara o evento `i18n:change`.
- `I18N.apply(root)`: percorre os elementos com estes atributos:
  - `data-i18n` → `textContent`;
  - `data-i18n-html` → `innerHTML` (só para chaves `.html`);
  - `data-i18n-placeholder`, `data-i18n-aria-label` e `data-i18n-title` → os atributos correspondentes.
- `I18N.fmtDate(date, opts)` e `I18N.fmtNumber(n)`: chamam o `Intl` com o idioma atual.

### Escolha do idioma

1. Se houver `localStorage["k652.lang"]` e o idioma existir nos dicionários, usa esse.
2. Senão, usa o primeiro de `navigator.languages` que bater: primeiro exato (`pt-BR`), depois só pela língua (`pt` → `pt-BR`).
3. Senão, usa `pt-BR`.

Seletor na interface: só aparece quando houver mais de um dicionário, então nesta etapa fica escondido. Ele deve usar um componente de `ui.js` (o projeto não usa `<select>` nativo) e o ícone `languages` do Lucide. Fica no cabeçalho ou no fim da aba Avançado.

## Passo a passo da migração

Cada passo pode virar um commit próprio. Ao fim de cada um, a interface deve continuar idêntica.

1. **Infraestrutura.** Criar `i18n.js` e `i18n/pt-BR.js` vazio, carregá-los no `index.html`, subir o `?v=`. Nada muda na tela.
2. **HTML estático.**
   - Passar os textos do `index.html` para `data-i18n*`, deixando o texto atual dentro do elemento como fallback.
   - Chamar `I18N.apply(document)` na inicialização, antes do laço de `data-icon`, porque o ícone e o texto podem dividir o mesmo botão. Nesses casos, o texto vai num `<span data-i18n>` separado do `<span data-icon>`.
3. **`ui.js`.** Trocar `DISCLAIMER`, os botões padrão do `ask` e os `aria-label` internos por `t()`.
4. **Nomes vindos do teclado.**
   - `LED_EFFECTS` passa a ser uma lista de chaves (`effects.N`) e ganha uma função `effectName(i)` que chama `t()`.
   - Os nomes de consumer/sistema do `keycodes.js` viram `consumer.0xNNNN`.
   - Os nomes HID de teclas (`Enter`, `Esc`, letras, símbolos ABNT2) **não** mudam.
   - `MODES` e `PARTS` passam a usar `t()`.
5. **`app.js`: diálogos e avisos.** Passar os 8 `UI.ask` e os avisos montados por template string. Isso vale para o texto todo da frase, não só para as palavras soltas, porque a ordem das palavras muda entre idiomas.
6. **`app.js`: logs.** Os 64 `log(`. Prioridade menor: dá para fazer depois e deixar os logs em pt-BR por um tempo, porque o fallback cobre isso.
7. **Datas e números.**
   - Trocar `toLocaleString("pt-BR")`, `toLocaleString()` e `toLocaleTimeString()` por `I18N.fmtDate`.
   - As cópias originais (`k652.matrixBackup.*`, `k652.paletteBackup`, `k652.profileBackup`) guardam `ts` como texto já formatado. Novas cópias passam a gravar ISO, e a leitura aceita os dois formatos (o `fmtTs` atual já faz isso).
8. **Backups com chave em vez de texto.**
   - As novas entradas de `k652.history` gravam `descKey` e `descVars` em vez de `desc`.
   - A lista monta o texto na hora de mostrar, então os backups seguem o idioma atual.
   - Entradas antigas com `desc` em texto continuam aparecendo como estão.
   - Exceção: o nome digitado no backup manual é do usuário e fica como texto.
9. **Troca de idioma em tempo real.**
   - Tudo que o JS desenha (lista de backups, painel da tecla, legenda de efeitos, sliders) escuta `i18n:change` e se redesenha.
   - Alternativa mais simples, se o redesenho ficar trabalhoso: `I18N.set()` grava o idioma e recarrega a página. O estado não se perde, porque vem do teclado e do `localStorage`.
10. **Verificação de cobertura.** Um script simples (`node scripts/i18n-check.js`, sem dependências) que:
    - lista as chaves usadas no código (`t("…")` e `data-i18n*="…"`) que não estão no `pt-BR`;
    - lista as chaves do `pt-BR` que nenhum código usa;
    - para cada outro dicionário, lista as chaves que faltam em relação ao `pt-BR`.

## Cuidados

- **Frases inteiras, não pedaços.** Nada de `t("antes") + " " + t("alterar")`. Cada mensagem completa é uma chave com variáveis.
- **Tamanho dos textos.** Alemão e francês costumam ser 30–40% mais longos. Abas, botões pequenos (`.btn.sm`) e o seletor Mac/Windows precisam aguentar isso em 375px. Conferir com um pseudo-idioma (passo de teste abaixo).
- **Legendas físicas.** O layout desenhado é ABNT2 e continua assim em qualquer idioma. Layouts físicos diferentes são outra feature.
- **Nomes do app original.** Os efeitos que hoje têm nome em português foram traduzidos do app original ("Light"). Em inglês, vale usar os nomes originais do `text.xml` da Redragon.
- **Aviso de risco.** O texto do aviso entra no dicionário, mas cada tradução deve manter o mesmo sentido jurídico ("use por sua conta e risco"), não uma versão mais branda.
- **README.** Fica fora do i18n do app. Se for traduzido, vira um arquivo separado (`README.en.md`) com link no topo.
- **`?v=`.** Os dicionários também levam `?v=`. Subir junto com o resto sempre que mudarem.

## Testes

- **Pseudo-idioma** (`i18n/xx.js`, só em desenvolvimento): o mesmo texto do pt-BR entre colchetes e com ~35% de caracteres a mais (`[Teclas~~~]`).
  - Qualquer texto da tela que não aparecer entre colchetes ainda está embutido.
  - Qualquer quebra de layout mostra onde falta espaço.
  - Ativar com `?lang=xx` na URL.
- Rodar o `i18n-check` antes de cada commit que mexer em textos.
- Conferir em 375px e no desktop: cabeçalho, as quatro abas, os diálogos de gravar e excluir, a lista de backups e o painel de remapeamento.
- Os testes não exigem gravar nada no teclado (e nunca usar Fn+Esc).

## Fora do escopo desta etapa

- Escrever qualquer tradução.
- Idiomas da direita para a esquerda (árabe, hebraico).
- Detectar o layout físico do teclado.
