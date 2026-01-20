# Guia de navegação e menu (Sidebar)

Este guia descreve como o **menu lateral (sidebar)** funciona no SimuladosBR, como ele é carregado, como ele decide exibir itens (ex.: **Admin**), e qual é o checklist para adicionar novos itens sem criar regressões.

## 1) Onde o menu mora

- Componente do menu: [frontend/components/sidebar.html](../frontend/components/sidebar.html)
  - Contém **HTML + CSS + um script grande** com toda a lógica de navegação.
- O menu é carregado em modo desktop pelo LayoutManager: [frontend/utils/layoutManager.js](../frontend/utils/layoutManager.js)
  - Quando `data-layout="desktop"`, ele faz `fetch('/components/sidebar.html')` e injeta no `#sidebarMount`.

### Consequência importante
- Se uma página **não tiver** `<div id="sidebarMount"></div>`, o sidebar não aparece.
- Se estiver em **mobile**, o `LayoutManager` **esconde** o sidebar (e a navegação pode ser diferente).

## 2) Dois “modos” de navegação: Index embutido vs páginas dedicadas

O projeto tem dois estilos de navegação:

### A) Navegação “embutida” dentro do `index.html` (desktop)
- Algumas seções são renderizadas **dentro do `index.html`** (sem sair da página).
- Isso é feito via `navigateToSection(section, subsection)` no script do sidebar.
- O caso mais sensível é `section = 'indicadores'`:
  - Se estiver no `index.html` e existir `#indicadores`, o sidebar chama `loadIndicadoresIntoSection(tab)`.
  - Caso contrário, ele redireciona para `/index.html` e deixa o estado salvo em `sessionStorage`.

### B) Páginas dedicadas
- Ex.: `/pages/flashcards.html`, `/pages/Indicadores.html`, `/pages/InsightsIA.html`, etc.
- Nelas, a navegação normalmente deve ser **link normal** (`<a href="...">`) ou redirecionamento explícito.

### Regra prática
- **Somente o `index.html` deve “restaurar” navegação embutida** automaticamente.
- Por isso existe proteção no sidebar para não executar restore em páginas dedicadas.

## 3) Estado de navegação (sessionStorage)

O sidebar usa `sessionStorage` para lembrar o que está aberto:

- `currentSection`: ex.: `indicadores`, `simulados`, `progresso-geral`.
- `currentSubsection`: ex.: `prob`, `flashcards`, etc.

Também usa flags auxiliares:

- `sidebarIndicadoresExpanded`: se o accordion “Indicadores” está expandido.
- `sidebarFlashcardsExpanded`: se o accordion “Flashcards” está expandido.

### Armadilha clássica (a que causou “voltar pro index”)
Se você estiver no `index.html` vendo Indicadores e tiver:
- `currentSection = indicadores`

Ao abrir uma página dedicada como `/pages/flashcards.html`, se o sidebar tentar restaurar o estado como se estivesse no index, ele pode **forçar redirecionamentos**.

✅ Solução adotada: o `restoreNavigationState()` só roda quando a URL atual é `/` ou `/index.html`.

## 4) Por que o menu “Admin” some em algumas páginas?

No HTML, o menu Admin inicia assim:

- `#sidebarAdminAccordion` começa com `style="display: none;"`
- Ele só aparece se `checkAdminAccess()` decidir que o usuário é admin.

### Como o sidebar decide se é admin
- Função: `ensureAdminAccess()`
- Ela chama `GET /api/users/me` e verifica `user.TipoUsuario === 'admin'`.
- Ela usa headers baseados em localStorage:
  - `X-Session-Token`: `nomeUsuario` ou `sessionToken`
  - `Authorization`: `jwtTokenType` + `jwtToken` (se existir)

### Diagnóstico rápido quando Admin não aparece
1) Confira se você está em **desktop** (o sidebar só aparece no desktop).
2) Abra o DevTools > Network e veja se `GET /api/users/me` está retornando **200**.
   - Se der **401/403** ou falhar, o sidebar vai manter o Admin escondido.
3) Confira no localStorage se existem:
   - `sessionToken` (ou `nomeUsuario`)
   - `jwtToken` (quando aplicável)
4) Confira se o backend realmente retorna `TipoUsuario: "admin"`.

## 5) Click interception (o que é interceptado e o que não é)

O script do sidebar intercepta alguns cliques para controlar UX e premium gating.

### Indicadores (Accordion)
Os links dentro do accordion `#sidebarIndicadoresAccordion` são capturados por JS:
- `e.preventDefault()`
- Decide premium gating (ex.: tabs premium)
- Em desktop + index, carrega embutido; fora do index, redireciona.

### Flashcards (Accordion)
O item “Abrir” em Flashcards é um `<a href="/pages/flashcards.html">`.
- **Idealmente** ele deve funcionar como navegação normal.
- Ele não deveria ser reprocessado como “Indicadores”.

## 6) Checklist para adicionar um novo item de menu (sem confusão)

### Passo 0 — Decidir o tipo
Escolha qual desses 3 você está criando:

1) **Link para página dedicada** (recomendado para páginas completas)
   - Ex.: `/pages/flashcards.html`
2) **Aba dentro de Indicadores**
   - Ex.: `Indicadores -> Flashcards` usando `loadIndicadoresIntoSection('flashcards')`
3) **Ação admin**
   - Ex.: botões com `data-admin-action="..."`

### Passo 1 — Alterar o HTML do menu
Arquivo: [frontend/components/sidebar.html](../frontend/components/sidebar.html)

- Adicione o item no accordion correto.
- Prefira `<a href="...">` para páginas dedicadas.

### Passo 2 — Se for Indicadores: atualizar o handler
Ainda em [frontend/components/sidebar.html](../frontend/components/sidebar.html):

- `setupNavigation()`
  - Se a nova aba for premium, inclua no `premiumTabs`.
- `loadIndicadoresIntoSection(tab)`
  - Adicione o branch `else if (key === '...') { ... }`.
- `navigateToSection('indicadores', tab)`
  - Garanta que o seletor de item ativo inclui `tab=...`.

### Passo 3 — Se for página dedicada: evitar “embed por engano”
- Não use `navigateToSection('indicadores', ...)` para links que deveriam ser páginas dedicadas.
- Não reutilize `currentSection=indicadores` como efeito colateral.

### Passo 4 — Se for Admin: garantir visibilidade e ação
- `#sidebarAdminAccordion` só aparece após `checkAdminAccess()`.
- Para novo botão admin:
  - Adicionar `<button data-admin-action="...">` no HTML.
  - Adicionar handler em `handleAdminAction(action)`.

### Passo 5 — Teste mínimo obrigatório
1) Desktop no `index.html`: clique no item novo e confirme que não redireciona indevidamente.
2) Desktop em uma página dedicada (ex.: `/pages/flashcards.html`): clique em **outros menus** e confirme que não volta pro index sem motivo.
3) Se for Admin: validar `GET /api/users/me` e se o accordion aparece para admin.

## 7) Convenções recomendadas (para evitar bugs futuros)

- Páginas dedicadas devem ter navegação por `<a href>` quando possível.
- Só o `index.html` deve renderizar “seções embutidas”.
- `restoreNavigationState()` deve ser conservador (evitar rodar fora do index).
- Toda aba nova de Indicadores deve existir em:
  - Menu (`href="/pages/Indicadores.html?tab=..."`)
  - Loader embutido (`loadIndicadoresIntoSection`)
  - Página dedicada `Indicadores.html` (allowed list + section)

---

## Nota do problema reportado (referência)
Sintoma: “estou no Indicadores → Flashcards (no index) e ao clicar Flashcards → Abrir volta pro index”.

Causa raiz típica: `restoreNavigationState()` rodando em páginas dedicadas, vendo `currentSection=indicadores` e forçando a renderização embutida/redirecionamento.

Correção aplicada: o restore agora só acontece quando a URL atual é `/` ou `/index.html`.
