# Proteção de conteúdo (best-effort) — Frontend

Este documento descreve a “proteção de conteúdo” aplicada em páginas sensíveis (simulados/revisão/dicas/flashcards), com foco em:

- reduzir cópia/cola acidental (ou casual)
- reduzir impressão/exportação direta via navegador
- avisar/mitigar tentativa de PrintScreen (observação: não é bloqueável de verdade)

> Importante: isso é **fricção no cliente**, não “segurança real”. Qualquer conteúdo exibido no browser pode ser capturado por ferramentas externas, extensões, DevTools, gravação de tela, etc.

---

## Onde fica

- Utilitário: `frontend/utils/contentProtection.js`

## Onde está habilitado

Atualmente, as páginas que incluem e habilitam o utilitário são:

- `frontend/pages/exam.html`
- `frontend/pages/examFull.html`
- `frontend/pages/examReviewQuiz.html`
- `frontend/pages/examReviewFull.html`
- `frontend/pages/flashcards.html`
- `frontend/pages/admin/dicas.html`
- `frontend/pages/admin/flashcards.html`

---

## Como habilitar em uma página

1) Incluir o script:

```html
<script src="/utils/contentProtection.js"></script>
```

2) Habilitar (idealmente logo no `head` ou no início do `body`, antes de renderizar conteúdo sensível):

```html
<script>
  if (window.ContentProtection && typeof window.ContentProtection.enable === 'function') {
    window.ContentProtection.enable({
      disableCopyPaste: true,
      disableContextMenu: true,
      disableSelection: true,
      disablePrint: true,
      warnOnPrintScreen: true,
      printMessage: 'Impressão desativada nesta página.'
    });
  }
</script>
```

---

## Opções e defaults

Todas as flags abaixo são **opt-out** (por padrão ficam ligadas):

- `disableCopyPaste` (default: `true`)
  - bloqueia eventos `copy`, `cut`, `paste` fora de elementos editáveis.
  - bloqueia atalhos `Ctrl/Cmd + C/X/V` fora de elementos editáveis.

- `disableContextMenu` (default: `true`)
  - bloqueia `contextmenu` (botão direito) fora de elementos editáveis.

- `disableSelection` (default: `true`)
  - aplica `user-select: none` ao `body`.
  - exceção: mantém seleção habilitada em `input`, `textarea`, `select` e `[contenteditable="true"]`.

- `disablePrint` (default: `true`)
  - injeta CSS `@media print` que oculta o conteúdo e mostra uma mensagem.
  - tenta interceptar `window.print()`.
  - bloqueia `Ctrl/Cmd + P`.
  - escuta `beforeprint` para exibir aviso.

- `warnOnPrintScreen` (default: `true`)
  - tenta detectar `PrintScreen` (`e.key === 'PrintScreen'` / `keyCode === 44`) e aplicar mitigação.

- `printMessage` (default: `Impressão desativada nesta página.`)
  - texto exibido quando o usuário tenta imprimir.

---

## O que o utilitário faz (detalhes)

### 1) Bloqueio de copiar/colar

- Eventos `copy/cut/paste`: `preventDefault()` + toast informativo.
- Atalhos de teclado: bloqueia `Ctrl/Cmd + C/X/V`.
- Exceção: **não bloqueia** dentro de elementos editáveis.

### 2) Bloqueio do menu de contexto

- Bloqueia o botão direito fora de elementos editáveis.

### 3) Bloqueio de impressão

- CSS em `@media print`:
  - oculta todos os elementos do `body`
  - exibe apenas uma mensagem (`#printBlockMessage`)

- Interceptações best-effort:
  - override de `window.print()`
  - bloqueio de `Ctrl/Cmd + P`
  - handler de `beforeprint`

### 4) PrintScreen (limitação do browser)

Não existe API confiável para “desabilitar PrintScreen” em browser.

O máximo que é feito é:

- toast “Captura de tela não permitida.”
- tentativa de limpar clipboard (quando permitido)
- aplicar blur temporário no `body` (`filter: blur(10px)`) como mitigação visual

---

## UX e acessibilidade

- `disableSelection` pode piorar a experiência para usuários que dependem de seleção (ex.: copiar um código de erro, leitores, etc.).
- Se precisar, desabilite apenas `disableSelection` mantendo os outros bloqueios.

---

## Recomendações de segurança (quando necessário)

Se a exigência for proteção “real” de conteúdo, precisa combinar fricção no cliente com controles do servidor e do produto, por exemplo:

- watermarking por usuário (nome/email + timestamp) em áreas sensíveis
- limitar exportações no servidor (PDF/print routes)
- rate limiting de endpoints sensíveis
- auditoria (logs de acesso, tentativas de exportação)
- termos de uso e mecanismos de enforcement
