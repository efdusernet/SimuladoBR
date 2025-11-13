# UI Components

## sb-hbar — Barra horizontal (Web Component)

Componente leve e reutilizável para exibir barras horizontais simples ou múltiplas, com suporte a dataset JSON e sem dependências externas.

- Tag: `<sb-hbar>`
- Arquivo: `frontend/components/sb-hbar.js`
- Compatível: qualquer página HTML (basta importar o script)
- Acessível: usa `role="progressbar"` e atributos ARIA

### Importação

Inclua o script na página onde for usar o componente:

```html
<script type="module" src="/components/sb-hbar.js"></script>
```

### Uso — Barra única (via atributos)

```html
<sb-hbar
  value="72"
  max="100"
  label="Aproveitamento"
  color="#2b8a3e"
  background="#e5e7eb"
  height="14"
  radius="999px"
  show-percent
  unit="%"
></sb-hbar>
```

Atributos suportados (modo barra única):
- `value`: valor atual (número)
- `max`: valor máximo (número, padrão 100)
- `label`: rótulo mostrado à esquerda
- `color`: cor da barra (ex.: `#4f46e5`)
- `background`: cor da trilha (ex.: `#e5e7eb`)
- `height`: altura em px (ex.: `12`, `14`)
- `radius`: borda arredondada (ex.: `999px` ou `6px`)
- `striped`: listras diagonais (booleano; basta declarar)
- `animated`: animação do listrado (booleano)
- `show-percent`: exibe o percentual dentro da barra (booleano)
- `unit`: sufixo para o valor/percentual (ex.: `%`, `pts`)

### Uso — Várias barras (dataset JSON)

Passe um array de objetos via atributo `data` ou via propriedade `.data` em JS.

```html
<!-- Atributo data -->
<sb-hbar
  data='[
    {"label":"Domínio 1","value":45},
    {"label":"Domínio 2","value":80,"color":"#2563eb"},
    {"label":"Domínio 3","value":30,"max":50,"unit":"/50"}
  ]'
  show-percent
  height="12"
></sb-hbar>
```

```html
<!-- Propriedade .data em JavaScript -->
<sb-hbar id="bars" show-percent></sb-hbar>
<script type="module">
  import '/components/sb-hbar.js';
  const el = document.getElementById('bars');
  el.data = [
    { label: 'Inéditas', value: 42, max: 80, color: '#16a34a', unit: '%' },
    { label: 'Respondidas', value: 38, max: 80, color: '#f59e0b' },
    { label: 'Pendente', value: 0, max: 80, color: '#94a3b8' }
  ];
</script>
```

Campos por item do dataset:
- `label`: rótulo (string)
- `value`: valor atual (número)
- `max`: máximo por item (número; se ausente, usa `max` do componente ou 100)
- `color`: cor da barra (string CSS)
- `bg`/`background`: cor da trilha da barra (string CSS)
- `unit`: sufixo (ex.: `%`)
- `tooltip`: texto alternativo (opcional; quando `show-percent` o percentual já aparece como dica)

Atributos do componente também podem complementar o dataset (ex.: `height`, `radius`, `show-percent`, `striped`, `animated`).

### Estilo e personalização

- CSS vars por barra/trilha: `--sb-hbar-color`, `--sb-hbar-track`
- Parts para estilização via `::part()`: `wrap`, `row`, `label`, `value`

Exemplo:
```css
sb-hbar::part(label){ font-weight:600; color:#111827; }
sb-hbar::part(value){ min-width:48px; }
```

### Acessibilidade

- Cada barra recebe `role="progressbar"` com `aria-valuemin`, `aria-valuemax`, `aria-valuenow` e `aria-label` (do `label`).
- `show-percent` exibe um texto sobre a barra para leitura visual rápida.

### Boas práticas

- Para grandes listas, preferir `.data = [...]` (evita parse repetido do atributo `data`).
- Defina `height` e `radius` para manter consistência visual em páginas diferentes.
- Combine `striped` + `animated` para estados de carregamento (skeletons).

### Exemplos rápidos

- Progresso de tentativa: `value=acertos`, `max=total`, `unit='%'` + `show-percent`
- Múltiplos domínios: dataset com `{ label, value, max }` por domínio
- Dark mode: ajuste `color` e `background` conforme tema atual

---

Precisa de um exemplo integrado a uma página existente (ex.: `results.html`)? Posso adicionar um bloco de demonstração com dados mock ou conectando ao backend.
