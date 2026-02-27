# Catálogo de Features Disponíveis (gerado)

Data de geração: 2026-01-18

Escopo (conforme pedido):
- Inclui **todos** os arquivos `.html` do repo, **exceto** os que estão dentro de pastas `components/` e `layouts/`.
- Inclui **todos** os arquivos `.js` do repo, **exceto** os que estão dentro de pastas `components/` e `layouts/`.
- Campo “data criação”: preenchido via Git (data do commit que adicionou o caminho do arquivo ao repositório).

Formato: 
`Página (arquivo html ou .js onde a feature se encontra) --> nome_feature, data_criacao`

---

## Frontend (HTML)

- [frontend/index.html](frontend/index.html) --> home_dashboard_shell, 2025-10-28
- [frontend/login.html](frontend/login.html) --> auth_login_register_ui, 2025-10-31
- [frontend/offline.html](frontend/offline.html) --> pwa_offline_fallback_page, 2025-12-06

- [frontend/pages/admin/feedbackResponses.html](frontend/pages/admin/feedbackResponses.html) --> admin_feedback_responses_review, 2025-11-30
- [frontend/pages/admin/notifications.html](frontend/pages/admin/notifications.html) --> admin_notifications_management_ui, 2025-11-30
- [frontend/pages/admin/questionBulk.html](frontend/pages/admin/questionBulk.html) --> admin_questions_bulk_import_ui, 2025-11-02
- [frontend/pages/admin/questionForm.html](frontend/pages/admin/questionForm.html) --> admin_question_create_edit_ui, 2025-11-02

- [frontend/pages/exam.html](frontend/pages/exam.html) --> exam_quiz_runner_ui, 2025-10-28
- [frontend/pages/examFull.html](frontend/pages/examFull.html) --> exam_full_runner_ui, 2025-10-28
- [frontend/pages/examPmiResults.html](frontend/pages/examPmiResults.html) --> exam_pmi_results_report_ui, 2025-11-24
- [frontend/pages/examReviewFull.html](frontend/pages/examReviewFull.html) --> exam_attempt_review_full_ui, 2025-11-30
- [frontend/pages/examReviewQuiz.html](frontend/pages/examReviewQuiz.html) --> exam_attempt_review_quiz_ui, 2025-11-30
- [frontend/pages/examSetup.html](frontend/pages/examSetup.html) --> exam_setup_select_mode_config_ui, 2025-10-28
- [frontend/pages/grid.html](frontend/pages/grid.html) --> questions_grid_review_ui, 2025-10-31
- [frontend/pages/Indicadores.html](frontend/pages/Indicadores.html) --> indicators_dashboard_ui, 2025-11-13
- [frontend/pages/InsightsIA.html](frontend/pages/InsightsIA.html) --> ai_insights_ui, 2025-12-24
- [frontend/pages/payment.html](frontend/pages/payment.html) --> payment_upgrade_premium_ui, 2025-10-28
- [frontend/pages/progressoGeral.html](frontend/pages/progressoGeral.html) --> overall_progress_radar_ui, 2025-11-24
- [frontend/pages/results.html](frontend/pages/results.html) --> exam_results_summary_ui, 2025-10-28
- [frontend/pages/settings.html](frontend/pages/settings.html) --> user_settings_ui, 2025-12-06

## Chat-service (HTML)

- [chat-service/admin/index.html](chat-service/admin/index.html) --> support_chat_admin_panel_ui, 2026-01-02
- [chat-service/widget-host/index.html](chat-service/widget-host/index.html) --> support_chat_widget_host_page, 2026-01-02

---

## Frontend (JS)

- [frontend/script.js](frontend/script.js) --> frontend_app_bootstrap_nav_auth, 2025-10-28
- [frontend/script_exam.js](frontend/script_exam.js) --> exam_engine_submit_and_review_redirect, 2025-10-28
- [frontend/script_ai_insights.js](frontend/script_ai_insights.js) --> ai_insights_client_flow, 2025-12-24
- [frontend/script_indicadores.js](frontend/script_indicadores.js) --> indicators_client_flow, 2025-11-24
- [frontend/sw.js](frontend/sw.js) --> pwa_service_worker_cache_offline, 2025-10-28

- [frontend/utils/chatWidgetGate.js](frontend/utils/chatWidgetGate.js) --> chat_widget_visibility_and_gate, 2026-01-02
- [frontend/utils/csrf.js](frontend/utils/csrf.js) --> csrf_token_client_support, 2025-12-11
- [frontend/utils/layoutManager.js](frontend/utils/layoutManager.js) --> layout_responsive_loader_manager, 2025-12-07
- [frontend/utils/logger.js](frontend/utils/logger.js) --> frontend_logging_wrapper, 2025-12-11
- [frontend/utils/logout.js](frontend/utils/logout.js) --> logout_flow_client, 2025-12-09
- [frontend/utils/matchColumns.js](frontend/utils/matchColumns.js) --> table_column_matching_helper, 2026-01-16
- [frontend/utils/offlineDB.js](frontend/utils/offlineDB.js) --> offline_storage_indexeddb_layer, 2025-12-06
- [frontend/utils/sanitize.js](frontend/utils/sanitize.js) --> input_sanitization_client, 2025-12-11
- [frontend/utils/secureStorage.js](frontend/utils/secureStorage.js) --> secure_storage_client, 2025-12-11
- [frontend/utils/syncManager.js](frontend/utils/syncManager.js) --> offline_sync_manager_client, 2025-12-06

---

## Backend (JS)

### Bootstrap / execução

- [backend/index.js](backend/index.js) --> api_server_bootstrap_routing_security, 2025-10-28
- [backend/syncStart.js](backend/syncStart.js) --> api_sync_startup_runner, 2025-10-28

### Config

- [backend/config/database.js](backend/config/database.js) --> db_connection_config, 2025-10-28
- [backend/config/examPolicies.js](backend/config/examPolicies.js) --> exam_policies_rules_config, 2025-11-24
- [backend/config/fixtureSpec.js](backend/config/fixtureSpec.js) --> fixture_data_spec_config, 2025-11-24
- [backend/config/security.js](backend/config/security.js) --> security_settings_config, 2025-12-11
- [backend/config/validateEnv.js](backend/config/validateEnv.js) --> env_validation_boot, 2025-12-11

### Middleware

- [backend/middleware/auth.js](backend/middleware/auth.js) --> auth_middleware_jwt_session, 2025-10-28
- [backend/middleware/csrfProtection.js](backend/middleware/csrfProtection.js) --> csrf_protection_middleware, 2025-12-11
- [backend/middleware/errorHandler.js](backend/middleware/errorHandler.js) --> error_handling_middleware, 2025-12-11
- [backend/middleware/errors.js](backend/middleware/errors.js) --> errors_catalog_and_helpers, 2025-12-11
- [backend/middleware/logging.js](backend/middleware/logging.js) --> request_logging_middleware, 2025-12-11
- [backend/middleware/requireAdmin.js](backend/middleware/requireAdmin.js) --> require_admin_guard, 2025-11-02
- [backend/middleware/requireUserSession.js](backend/middleware/requireUserSession.js) --> require_user_session_guard, 2025-11-24
- [backend/middleware/validation.js](backend/middleware/validation.js) --> request_validation_middleware, 2025-12-11

### Controllers (API)

- [backend/controllers/aiController.js](backend/controllers/aiController.js) --> ai_general_endpoints_controller, 2025-12-24
- [backend/controllers/aiMasterdataController.js](backend/controllers/aiMasterdataController.js) --> ai_masterdata_generation_controller, 2025-12-31
- [backend/controllers/aiWebController.js](backend/controllers/aiWebController.js) --> ai_web_context_controller, 2025-12-31
- [backend/controllers/examController.js](backend/controllers/examController.js) --> exams_attempts_submit_review_admin_purge_controller, 2025-10-28
- [backend/controllers/indicatorController.js](backend/controllers/indicatorController.js) --> indicators_aggregation_controller, 2025-11-14
- [backend/controllers/integrityController.js](backend/controllers/integrityController.js) --> data_integrity_checks_controller, 2025-10-31
- [backend/controllers/metaController.js](backend/controllers/metaController.js) --> meta_health_version_controller, 2025-10-28
- [backend/controllers/paymentController.js](backend/controllers/paymentController.js) --> payments_status_webhooks_controller, 2025-10-28
- [backend/controllers/questionController.js](backend/controllers/questionController.js) --> questions_crud_and_search_controller, 2025-10-28
- [backend/controllers/userController.js](backend/controllers/userController.js) --> users_auth_profile_admin_controller, 2025-10-28

### Routes (API)

- [backend/routes/admin_communication.js](backend/routes/admin_communication.js) --> api_admin_communication_management, 2026-01-14
- [backend/routes/admin_db.js](backend/routes/admin_db.js) --> api_admin_database_tools, 2026-01-18
- [backend/routes/admin_feedback.js](backend/routes/admin_feedback.js) --> api_admin_feedback_management, 2025-11-30
- [backend/routes/admin_notifications.js](backend/routes/admin_notifications.js) --> api_admin_notifications_management, 2025-11-30
- [backend/routes/admin_users.js](backend/routes/admin_users.js) --> api_admin_users_management, 2025-11-30
- [backend/routes/ai.js](backend/routes/ai.js) --> api_ai_endpoints, 2025-12-24
- [backend/routes/auth.js](backend/routes/auth.js) --> api_auth_login_register_logout, 2025-10-28
- [backend/routes/chatProxy.js](backend/routes/chatProxy.js) --> api_chat_proxy_to_chat_service, 2026-01-02
- [backend/routes/debug.js](backend/routes/debug.js) --> api_debug_tools, 2025-10-28
- [backend/routes/exams.js](backend/routes/exams.js) --> api_exams_attempts_submit_results, 2025-10-28
- [backend/routes/exams_admin.js](backend/routes/exams_admin.js) --> api_admin_exams_management_and_purge, 2025-11-24
- [backend/routes/feedback.js](backend/routes/feedback.js) --> api_feedback_submission_and_review, 2025-11-30
- [backend/routes/indicators.js](backend/routes/indicators.js) --> api_indicators_data, 2025-11-14
- [backend/routes/integrity.js](backend/routes/integrity.js) --> api_integrity_checks, 2025-10-31
- [backend/routes/meta.js](backend/routes/meta.js) --> api_meta_health_and_version, 2025-10-28
- [backend/routes/notifications.js](backend/routes/notifications.js) --> api_notifications_user_delivery, 2025-11-30
- [backend/routes/payments.js](backend/routes/payments.js) --> api_payments_upgrade_status, 2025-10-28
- [backend/routes/questions.js](backend/routes/questions.js) --> api_questions_catalog, 2025-10-28
- [backend/routes/users.js](backend/routes/users.js) --> api_users_me_profile_settings, 2025-10-28

### Models (dados)

- [backend/models/CategoriaFeedback.js](backend/models/CategoriaFeedback.js) --> data_model_feedback_category, 2025-11-30
- [backend/models/CommunicationRecipient.js](backend/models/CommunicationRecipient.js) --> data_model_communication_recipient, 2026-01-14
- [backend/models/EmailVerification.js](backend/models/EmailVerification.js) --> data_model_email_verification, 2025-10-28
- [backend/models/Exam.js](backend/models/Exam.js) --> data_model_exam_definition, 2025-10-28
- [backend/models/ExamAttempt.js](backend/models/ExamAttempt.js) --> data_model_exam_attempt, 2025-11-01
- [backend/models/ExamAttemptAnswer.js](backend/models/ExamAttemptAnswer.js) --> data_model_exam_attempt_answer, 2025-11-01
- [backend/models/ExamAttemptPurgeLog.js](backend/models/ExamAttemptPurgeLog.js) --> data_model_exam_attempt_purge_log, 2025-11-24
- [backend/models/ExamAttemptQuestion.js](backend/models/ExamAttemptQuestion.js) --> data_model_exam_attempt_question, 2025-11-01
- [backend/models/ExamAttemptUserStats.js](backend/models/ExamAttemptUserStats.js) --> data_model_exam_attempt_user_daily_stats, 2025-11-24
- [backend/models/ExamType.js](backend/models/ExamType.js) --> data_model_exam_type, 2025-11-01
- [backend/models/Feedback.js](backend/models/Feedback.js) --> data_model_feedback, 2025-11-30
- [backend/models/Indicator.js](backend/models/Indicator.js) --> data_model_indicator, 2025-11-14
- [backend/models/index.js](backend/models/index.js) --> sequelize_models_registry, 2025-10-28
- [backend/models/Notification.js](backend/models/Notification.js) --> data_model_notification, 2025-11-30
- [backend/models/Payment.js](backend/models/Payment.js) --> data_model_payment, 2025-10-28
- [backend/models/Question.js](backend/models/Question.js) --> data_model_question, 2025-10-28
- [backend/models/QuestionType.js](backend/models/QuestionType.js) --> data_model_question_type, 2025-11-02
- [backend/models/RetornoFeedback.js](backend/models/RetornoFeedback.js) --> data_model_feedback_response, 2025-11-30
- [backend/models/Simulation.js](backend/models/Simulation.js) --> data_model_simulation, 2025-10-28
- [backend/models/User.js](backend/models/User.js) --> data_model_user, 2025-10-28
- [backend/models/UserActiveSession.js](backend/models/UserActiveSession.js) --> data_model_user_active_session, 2026-01-16
- [backend/models/UserNotification.js](backend/models/UserNotification.js) --> data_model_user_notification, 2025-11-30

### Services

- [backend/services/SessionManager.js](backend/services/SessionManager.js) --> session_management_single_session, 2025-12-11
- [backend/services/UserStatsService.js](backend/services/UserStatsService.js) --> user_stats_aggregation_service, 2025-11-24
- [backend/services/geminiClient.js](backend/services/geminiClient.js) --> ai_provider_gemini_client, 2026-01-01
- [backend/services/llmClient.js](backend/services/llmClient.js) --> ai_provider_client_router, 2026-01-01
- [backend/services/masterdataService.js](backend/services/masterdataService.js) --> masterdata_loading_service, 2025-12-31
- [backend/services/webContext.js](backend/services/webContext.js) --> ai_web_context_fetch_service, 2025-12-31

- [backend/services/exams/ExamRegistry.js](backend/services/exams/ExamRegistry.js) --> exams_registry_catalog_service, 2025-11-01

### Utils

- [backend/utils/codegen.js](backend/utils/codegen.js) --> code_generation_helpers, 2025-10-28
- [backend/utils/examProgress.js](backend/utils/examProgress.js) --> exam_progress_calculation, 2025-11-24
- [backend/utils/jsonParseLenient.js](backend/utils/jsonParseLenient.js) --> lenient_json_parse_helper, 2026-01-01
- [backend/utils/logger.js](backend/utils/logger.js) --> backend_logging_wrapper, 2025-12-11
- [backend/utils/mailer.js](backend/utils/mailer.js) --> email_sending_helper, 2025-10-28
- [backend/utils/matchColumns.js](backend/utils/matchColumns.js) --> data_columns_matching_helper, 2026-01-16
- [backend/utils/singleSession.js](backend/utils/singleSession.js) --> single_session_enforcement_helper, 2026-01-16

### Scripts / manutenção / testes

- [backend/scripts/add_meta_column.js](backend/scripts/add_meta_column.js) --> maintenance_db_add_meta_column, 2025-12-06
- [backend/scripts/apply_sql.js](backend/scripts/apply_sql.js) --> maintenance_apply_sql_runner, 2025-11-02
- [backend/scripts/check_dominio_tables.js](backend/scripts/check_dominio_tables.js) --> maintenance_check_domain_tables, 2025-11-16
- [backend/scripts/check_nivel_table.js](backend/scripts/check_nivel_table.js) --> maintenance_check_nivel_table, 2025-11-19
- [backend/scripts/check_principio_table.js](backend/scripts/check_principio_table.js) --> maintenance_check_principio_table, 2025-11-16
- [backend/scripts/cleanupNonMasterdata.js](backend/scripts/cleanupNonMasterdata.js) --> maintenance_cleanup_non_masterdata, 2026-01-18
- [backend/scripts/create_dummy_attempt.js](backend/scripts/create_dummy_attempt.js) --> maintenance_create_dummy_exam_attempt, 2025-11-30
- [backend/scripts/create_fixture_attempt.js](backend/scripts/create_fixture_attempt.js) --> maintenance_create_fixture_exam_attempt, 2025-11-24
- [backend/scripts/fix_email_matching.js](backend/scripts/fix_email_matching.js) --> maintenance_fix_email_matching, 2025-12-11
- [backend/scripts/inspectTable.js](backend/scripts/inspectTable.js) --> maintenance_inspect_table, 2026-01-18
- [backend/scripts/listPublicTables.js](backend/scripts/listPublicTables.js) --> maintenance_list_public_tables, 2026-01-18
- [backend/scripts/list_attempts_by_user.js](backend/scripts/list_attempts_by_user.js) --> maintenance_list_attempts_by_user, 2025-11-30
- [backend/scripts/list_cols.js](backend/scripts/list_cols.js) --> maintenance_list_table_columns, 2025-11-30
- [backend/scripts/list_gemini_models.js](backend/scripts/list_gemini_models.js) --> maintenance_list_gemini_models, 2026-01-01
- [backend/scripts/list_users.js](backend/scripts/list_users.js) --> maintenance_list_users, 2025-11-30
- [backend/scripts/mark_abandoned.js](backend/scripts/mark_abandoned.js) --> maintenance_mark_abandoned_attempts, 2025-11-24
- [backend/scripts/migrate_024.js](backend/scripts/migrate_024.js) --> maintenance_migration_024, 2025-11-16
- [backend/scripts/purge_abandoned.js](backend/scripts/purge_abandoned.js) --> maintenance_purge_abandoned_attempts, 2025-11-24
- [backend/scripts/reconcile_user_stats.js](backend/scripts/reconcile_user_stats.js) --> maintenance_reconcile_user_stats, 2025-11-24
- [backend/scripts/reset_exam_data.js](backend/scripts/reset_exam_data.js) --> maintenance_reset_exam_data, 2025-11-13
- [backend/scripts/seed_test_user.js](backend/scripts/seed_test_user.js) --> maintenance_seed_test_user, 2025-11-30
- [backend/scripts/unlock_user.js](backend/scripts/unlock_user.js) --> maintenance_unlock_user, 2026-01-02

- [backend/test-validation.js](backend/test-validation.js) --> dev_test_validation_suite, 2025-12-11
- [backend/test_expire_tokens.js](backend/test_expire_tokens.js) --> dev_test_expire_tokens, 2025-12-07

---

## Chat-service (JS)

### UI/Widget

- [chat-service/admin/panel.js](chat-service/admin/panel.js) --> support_chat_admin_ui_logic, 2026-01-02
- [chat-service/widget/chat-widget.js](chat-service/widget/chat-widget.js) --> support_chat_widget_embed_client, 2026-01-02

### Bootstrap

- [chat-service/src/index.js](chat-service/src/index.js) --> support_chat_service_entrypoint, 2026-01-02
- [chat-service/src/app.js](chat-service/src/app.js) --> support_chat_http_app, 2026-01-02

### Config/DB

- [chat-service/src/config/env.js](chat-service/src/config/env.js) --> support_chat_env_config, 2026-01-02
- [chat-service/src/db/communicationPool.js](chat-service/src/db/communicationPool.js) --> support_chat_db_communication_pool, 2026-01-14
- [chat-service/src/db/migrate.js](chat-service/src/db/migrate.js) --> support_chat_db_migrations, 2026-01-02
- [chat-service/src/db/pool.js](chat-service/src/db/pool.js) --> support_chat_db_pool, 2026-01-02

### Middleware

- [chat-service/src/middleware/adminAuth.js](chat-service/src/middleware/adminAuth.js) --> support_chat_admin_auth_middleware, 2026-01-02
- [chat-service/src/middleware/authOptional.js](chat-service/src/middleware/authOptional.js) --> support_chat_optional_auth_middleware, 2026-01-02
- [chat-service/src/middleware/errorHandler.js](chat-service/src/middleware/errorHandler.js) --> support_chat_error_handler_middleware, 2026-01-02
- [chat-service/src/middleware/requestId.js](chat-service/src/middleware/requestId.js) --> support_chat_request_id_middleware, 2026-01-02

### Realtime

- [chat-service/src/realtime/adminEvents.js](chat-service/src/realtime/adminEvents.js) --> support_chat_admin_realtime_events, 2026-01-02
- [chat-service/src/realtime/adminWs.js](chat-service/src/realtime/adminWs.js) --> support_chat_admin_websocket, 2026-01-02

### Routes

- [chat-service/src/routes/admin.js](chat-service/src/routes/admin.js) --> support_chat_admin_api, 2026-01-02
- [chat-service/src/routes/conversations.js](chat-service/src/routes/conversations.js) --> support_chat_conversations_api, 2026-01-02
- [chat-service/src/routes/health.js](chat-service/src/routes/health.js) --> support_chat_healthcheck, 2026-01-02

### Services

- [chat-service/src/services/adminTokens.js](chat-service/src/services/adminTokens.js) --> support_chat_admin_token_service, 2026-01-02
- [chat-service/src/services/geminiClient.js](chat-service/src/services/geminiClient.js) --> support_chat_ai_gemini_client, 2026-01-02
- [chat-service/src/services/jwt.js](chat-service/src/services/jwt.js) --> support_chat_jwt_helpers, 2026-01-02
- [chat-service/src/services/llmClient.js](chat-service/src/services/llmClient.js) --> support_chat_ai_provider_router, 2026-01-02
- [chat-service/src/services/mailer.js](chat-service/src/services/mailer.js) --> support_chat_email_sender, 2026-01-02
- [chat-service/src/services/supportContactNotifier.js](chat-service/src/services/supportContactNotifier.js) --> support_chat_support_contact_notifications, 2026-01-14
- [chat-service/src/services/supportMailer.js](chat-service/src/services/supportMailer.js) --> support_chat_support_mailer, 2026-01-14

### Stores

- [chat-service/src/store/adminUsersStore.js](chat-service/src/store/adminUsersStore.js) --> support_chat_admin_users_store, 2026-01-02
- [chat-service/src/store/conversationsStore.js](chat-service/src/store/conversationsStore.js) --> support_chat_conversations_store, 2026-01-02
- [chat-service/src/store/messagesStore.js](chat-service/src/store/messagesStore.js) --> support_chat_messages_store, 2026-01-02
- [chat-service/src/store/supportTopicsStore.js](chat-service/src/store/supportTopicsStore.js) --> support_chat_support_topics_store, 2026-01-02
- [chat-service/src/store/visitorsStore.js](chat-service/src/store/visitorsStore.js) --> support_chat_visitors_store, 2026-01-02

### Scripts

- [chat-service/scripts/dbCheck.js](chat-service/scripts/dbCheck.js) --> support_chat_maintenance_db_check, 2026-01-02
- [chat-service/scripts/purgeConversations.js](chat-service/scripts/purgeConversations.js) --> support_chat_maintenance_purge_conversations, 2026-01-02
- [chat-service/scripts/smokeAuth.js](chat-service/scripts/smokeAuth.js) --> support_chat_smoke_auth, 2026-01-02
