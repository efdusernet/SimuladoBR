# Guia de Manutenção dos ENUMs de Notificações

Este documento descreve o procedimento seguro para adicionar novos valores aos tipos ENUM usados pelas tabelas `notification` e `user_notification` no PostgreSQL, mantendo o Sequelize sincronizado.

## ENUMs Existentes

PostgreSQL (criados manualmente pelos scripts SQL):
- `notificacao_categoria`: `Promocoes`, `Avisos`, `Alertas`
- (Opcional, dependendo do script) `notificacao_target`: `all`, `user`
- `notificacao_status`: `draft`, `sent`
- `user_notification_delivery`: `queued`, `delivered`

No Sequelize (`backend/models/Notification.js` e `backend/models/UserNotification.js`):
- `categoria`: ENUM(`Promocoes`,`Avisos`,`Alertas`)
- `targetType`: ENUM(`all`,`user`)
- `status`: ENUM(`draft`,`sent`)
- `deliveryStatus`: ENUM(`queued`,`delivered`)

## Regra Geral
1. Nunca recrie um ENUM com outro nome para substituir o existente em produção – isto tende a gerar colisões ou exigir DROP TYPE (complexo e arriscado se houver colunas que o referenciam).
2. Para adicionar um novo valor, SEMPRE primeiro executar `ALTER TYPE ... ADD VALUE` diretamente no banco.
3. Somente após o valor existir no banco, atualizar o modelo Sequelize adicionando o literal correspondente à lista do ENUM.
4. Evitar usar `sequelize.sync({ alter: true })` em produção para mexer em ENUMs; faça alterações por migração SQL explícita.

## Passo a Passo: Adicionar Novo Valor

Exemplo: adicionar categoria `Comunicados` em `notificacao_categoria`.

1. Conectar ao banco (psql, DBeaver, etc.).
2. Executar:
   ```sql
   ALTER TYPE notificacao_categoria ADD VALUE 'Comunicados';
   ```
   Observações:
   - A operação é irreversível (não há DROP VALUE). Se precisar “remover”, marcar como obsoleto e filtrar via lógica de aplicação.
   - Ordem de apresentação: o novo valor fica no fim. Se precisar ordenar em UI, ordenar manualmente.
3. Atualizar arquivo `backend/models/Notification.js` adicionando `'Comunicados'` ao array do ENUM em `categoria`.
4. Commit das mudanças de código.
5. Reiniciar a aplicação (deploy) – o Sequelize agora aceitará o novo valor.
6. Se houver validações adicionais (ex: lista usada no frontend), atualizar também:
   - Página admin de notificações: adicionar `<option>` correspondente.
   - Qualquer lógica de filtro.

## Verificação Pós-Alteração

Em psql:
```sql
\dT+ notificacao_categoria
SELECT * FROM notification WHERE categoria = 'Comunicados' LIMIT 5;
```

No Node (linha única):
```bash
node -e "const db=require('./backend/models');db.sequelize.authenticate().then(()=>db.Notification.create({categoria:'Comunicados',titulo:'Teste',mensagem:'Valor novo',targetType:'all',status:'draft',createdBy:1})).then(r=>console.log(r.toJSON())).catch(e=>console.error(e)).finally(()=>db.sequelize.close())"
```

## Erros Comuns

- `invalid input value for enum`: O valor foi usado antes de executar o `ALTER TYPE`.
- `duplicate key value violates ...` ao tentar recriar tipo: significa que um script tentou `CREATE TYPE` para algo já existente.
- Aplicação não sobe após adicionar valor: provavelmente o modelo Sequelize não foi atualizado com o novo literal.

## Boas Práticas

- Documentar cada alteração em CHANGELOG ou RELEASE_NOTES indicando o novo valor.
- Centralizar a lista de categorias visíveis em um único lugar no frontend (evitar listas duplicadas em vários arquivos).
- Em testes automatizados, criar um teste que valida `Object.freeze(['Promocoes','Avisos','Alertas', ...])` contra o retorno de uma rota meta (se for exposta).

## Se Precisar Renomear um Valor

Renomear é mais complexo: PostgreSQL não suporta `ALTER TYPE ... RENAME VALUE` em versões antigas. Estratégias:
1. Adicionar novo valor.
2. Atualizar todas as linhas antigas para o novo valor (`UPDATE notification SET categoria='Novo' WHERE categoria='Antigo';`).
3. Opcional: Manter o antigo para compatibilidade temporária. Não é possível remover cleanly sem recriar tipo.
4. Atualizar código removendo uso do valor antigo (depois de não haver mais linhas).

## Alternativa Flexível

Se precisar mudanças frequentes nos valores, considerar migrar de ENUM para `TEXT` + constraint:
```sql
ALTER TABLE notification ALTER COLUMN categoria TYPE TEXT;
ALTER TABLE notification ADD CONSTRAINT chk_notification_categoria CHECK (categoria IN ('Promocoes','Avisos','Alertas','Comunicados'));
```
Prós: remover/alterar lista facilmente. Contras: perde validação automática do ENUM e pode exigir manutenção da constraint.

## Alinhamento Frontend

Ao adicionar nova categoria:
- Atualizar `<select id="categoria">` em `frontend/pages/admin/notifications.html`.
- Ajustar cores/badges se houver styling condicional por categoria.

## Script de Migração

Para padronizar, crie arquivo `backend/sql/XXX_alter_notificacao_categoria_add_comunicados.sql` contendo:
```sql
ALTER TYPE notificacao_categoria ADD VALUE IF NOT EXISTS 'Comunicados';
```
E execute com `node backend/scripts/apply_sql.js`.

## Resumo Rápido
1. ALTER TYPE (DB).
2. Atualiza modelo.
3. Atualiza frontend.
4. Testa criação/leitura.
5. Documenta no changelog.

---
Qualquer alteração mais invasiva (excluir valores, refatorar para TEXT) deve ser planejada com janela de manutenção e backup prévio.
