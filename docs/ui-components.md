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

---

## PassProbability — Card “Probabilidade de passar no exame”

Card exibido na Home (index) que mostra uma barra `<sb-hbar>` com a “probabilidade de aprovação” calculada a partir do indicador IND12.

- Arquivo: `frontend/components/PassProbability.html`
- Integração: carregado como componente HTML dentro do `index.html` (via fetch de `/components/PassProbability.html`).
- Barra: usa `<sb-hbar>` (script `/components/sb-hbar.js`).

### Faixas (classes `perf-*`)

O componente aplica uma classe de performance no elemento raiz `.pass-probability` com base no valor calculado (`data.probability`):

- `perf-gt85`: $\ge 85\%$
- `perf-75-85`: $> 75\%$ e $< 85\%$
- `perf-70-74`: $\ge 70\%$ e $\le 75\%$
- `perf-lt70`: $< 70\%$

Essas classes **não alteram o fundo do card**. Elas aplicam **borda mais espessa** e pintam a borda com a cor da faixa, para evitar perda de contraste com a barra de progresso.

### Cores

- Cor da barra (`sb-hbar`):
  - $\ge 85\%$: `#0A7A0A` (verde escuro)
  - $> 75\%$: `#32CD32` (verde)
  - caso contrário: `#B91C1C` (vermelho “blood red”)

- Cor da borda do card (por faixa `perf-*`):
  - `perf-gt85`: `#0A7A0A`
  - `perf-75-85`: `#32CD32`
  - `perf-70-74`: `#FED7AA`
  - `perf-lt70`: `#FCA5A5`

### Observação de UX

O objetivo das faixas é dar feedback visual rápido de “nível” sem competir com a cor da barra (`--sb-hbar-color`). Se algum tema/layout alterar o background do container pai, manter o card com fundo neutro ajuda a preservar legibilidade do texto e da tooltip da barra.

---

## Calculator — Modal de calculadora

Componente de calculadora exibido como modal (overlay) e usado no runner de exames.

- Arquivo: `frontend/components/calculator.js`
- Uso atual:
  - `frontend/pages/exam.html` e `frontend/pages/examFull.html`: botão “Calc” no topo.
  - O botão fica habilitado apenas quando a questão atual estiver marcada como matemática (`isMath === true` no frontend; originado de `questions[].is_math` no `/api/exams/select`).

### API

- `window.Calculator.open()`: abre o modal.
- `window.Calculator.close()`: fecha o modal.

### UX

- Arrastar: o modal pode ser arrastado pela barra de título (drag com pointer events).
- Limites: a posição é “clampada” para não sair da viewport.
- Persistência: a posição é persistida em `localStorage`.
  - Key: `simulados_calculator_pos_v1`
- Reset: duplo clique na barra de título restaura/centraliza a posição.
