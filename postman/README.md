SimuladosBR - Postman collection

Arquivos:
- `SimuladosBR.postman_collection.json` - Coleção com requests: send-test-email, register, login, verify.
- `SimuladosBR.postman_environment.json` - Environment com variáveis pré-populadas (BACKEND_BASE, testEmail, userEmail, userSenha, etc.).

Como usar:
1. Abra o Postman.
2. Importe `SimuladosBR.postman_collection.json` (File -> Import -> Upload Files).
3. Importe o environment `SimuladosBR.postman_environment.json` e selecione-o.
4. Ajuste `BACKEND_BASE` se sua API estiver em outra porta/endereço.
5. Para criar senhaHash automaticamente, as requests `Register` e `Login` usam um pre-request script com `CryptoJS.SHA256` (o runtime do Postman normalmente fornece `CryptoJS`). Se não gerar, defina `senhaHash` manualmente.
6. Fluxo recomendado:
   - Envie `Send test email` para verificar o envio.
   - Envie `Register user` (vai criar o usuário e possivelmente retornar token em `mailer.token` no debug).
   - Caso receba token no corpo (ou no debug), ele será salvo em `lastVerifyToken` automaticamente. Use `Verify email` para confirmar.
   - Finalmente use `Login` para testar login.

7. Fluxo de Exames (multi-exames):
   - Em `Environment`, ajuste `sessionToken` (pode ser o e-mail do usuário logado) e `examType` (ex.: `pmp`).
   - Use `Exams / List Types (DB)` para ver os tipos disponíveis no banco. Dica: defina `EXAM_TYPES_DISABLE_FALLBACK=true` no backend para forçar leitura do DB.
   - Para uma seleção simples (retorna perguntas e um `sessionId` temporário): `Exams / Select (count=1)`. O teste já salva `lastSessionId`, `lastQuestionId` e `lastOptionId`.
   - Para sessão on-demand com persistência (cria `exam_attempt`): `Exams / Start On Demand (count=3)`. O teste salva `lastOnDemandSessionId` e `lastAttemptId`.
   - Para buscar pergunta da sessão on-demand: `Exams / Get Question (index 0)` — o teste salva `lastQuestionId` e `lastOptionId`.
   - Para submeter respostas:
     - Seleção: `Exams / Submit (from select)` usa `lastSessionId`.
     - On-demand: `Exams / Submit (from on-demand)` usa `lastOnDemandSessionId` e persiste respostas/nota (`exam_attempt_answer`/`exam_attempt`).

   Notas importantes:

   - O código de verificação agora tem 6 caracteres alfanuméricos (A-Z, a-z, 0-9). Procure por esse código no corpo da resposta do endpoint de debug (`mailer.token`) ou no e-mail recebido.
   - Se você estiver em um ambiente de desenvolvimento que intercepta TLS com um certificado autoassinado (ex.: proxies corporativos), adicione a variável `SMTP_ALLOW_SELF_SIGNED=true` no arquivo `backend/.env` apenas para debug local e reinicie o backend. NÃO use essa opção em produção.
   - O endpoint de debug (`Send test email`) retorna um objeto `mailer` que pode incluir `verifyError` quando a verificação TLS falha mas o envio foi tentado; verifique esse campo para diagnóstico.

Observação: a coleção pressupõe que a API está disponível em `{{BACKEND_BASE}}` (ex: `http://localhost:3000`).
