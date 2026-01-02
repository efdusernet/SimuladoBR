# Funcionalidade de Imagem em Questões

## Visão Geral
Foi implementada a capacidade de adicionar imagens às questões no formulário de cadastro.

## Como Usar

### 1. Adicionar Imagem (Aba Nova questão)

Após o campo "Enunciado", há um novo campo "Imagem (URL ou Base64)" com três opções:

- **Colar URL**: Cole diretamente o endereço de uma imagem hospedada na internet
- **Escolher arquivo**: Clique no botão para selecionar uma imagem do seu computador (será convertida para base64)
- **Limpar**: Remove a imagem selecionada

### 2. Preview
Assim que você adicionar uma URL ou selecionar um arquivo, um preview da imagem aparecerá abaixo do campo.

### 3. Limitações
- Tamanho máximo do arquivo: 5MB
- Formatos aceitos: todos os formatos de imagem suportados pelo navegador (jpg, png, gif, etc.)

### 4. Editar Imagem (Aba Navegação)
A funcionalidade também está disponível na aba de navegação para editar questões existentes.

## Implementação Técnica

### Frontend
- Campo de input para URL/Base64
- Input file hidden com botão personalizado
- Preview automático da imagem
- Validação de tamanho e tipo

### Backend
Foi adicionado suporte ao campo `imagem_url` em:
- `createQuestion` (POST /api/questions)
- `updateQuestion` (PUT /api/questions/:id)
- `getQuestionById` (GET /api/questions/:id)

### Banco de Dados
É necessário executar a migração SQL para adicionar a coluna:

```sql
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS imagem_url TEXT;
```

**Arquivo de migração**: `backend/sql/024_alter_questao_add_imagem_url.sql`

**Para aplicar** (requer permissões de ALTER TABLE):
```bash
cd backend
node scripts/migrate_024.js
```

**Nota**: Se você encontrar erro de permissão, peça ao administrador do banco de dados para executar o SQL manualmente.

## Observações
- A imagem é armazenada como texto (URL ou base64)
- Base64 é recomendado apenas para imagens pequenas
- Para melhor performance, use URLs de imagens hospedadas externamente
