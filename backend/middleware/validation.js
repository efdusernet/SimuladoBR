/**
 * Joi Validation Schemas for Input Validation
 * Protects against SQL injection, type confusion, buffer overflow, and malformed input
 */

const Joi = require('joi');
const { logger } = require('../utils/logger');

// Common field validations
const commonSchemas = {
  email: Joi.string()
    .email({ minDomainSegments: 2, tlds: { allow: false } }) // Allow all TLDs
    .max(255)
    .trim()
    .lowercase()
    .required()
    .messages({
      'string.email': 'E-mail deve ser válido',
      'string.max': 'E-mail não pode ter mais de 255 caracteres',
      'any.required': 'E-mail é obrigatório'
    }),
  
  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.min': 'Senha deve ter pelo menos 8 caracteres',
      'string.max': 'Senha não pode ter mais de 128 caracteres',
      'any.required': 'Senha é obrigatória'
    }),
  
  // SHA-256 hash (64 hex characters)
  passwordHash: Joi.string()
    .length(64)
    .hex()
    .required()
    .messages({
      'string.length': 'Hash de senha inválido',
      'string.hex': 'Hash de senha deve ser hexadecimal',
      'any.required': 'Senha é obrigatória'
    }),
  
  token: Joi.string()
    .alphanum()
    .min(6)
    .max(64)
    .uppercase()
    .required()
    .messages({
      'string.alphanum': 'Token deve conter apenas letras e números',
      'string.min': 'Token deve ter pelo menos 6 caracteres',
      'string.max': 'Token não pode ter mais de 64 caracteres',
      'any.required': 'Token é obrigatório'
    }),
  
  userId: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({
      'number.base': 'ID de usuário deve ser um número',
      'number.integer': 'ID de usuário deve ser um inteiro',
      'number.positive': 'ID de usuário deve ser positivo',
      'any.required': 'ID de usuário é obrigatório'
    }),
  
  name: Joi.string()
    .min(2)
    .max(100)
    .trim()
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .messages({
      'string.min': 'Nome deve ter pelo menos 2 caracteres',
      'string.max': 'Nome não pode ter mais de 100 caracteres',
      'string.pattern.base': 'Nome contém caracteres inválidos',
      'any.required': 'Nome é obrigatório'
    }),
  
  username: Joi.string()
    .min(3)
    .max(50)
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9_.-]+$/)
    .messages({
      'string.min': 'Nome de usuário deve ter pelo menos 3 caracteres',
      'string.max': 'Nome de usuário não pode ter mais de 50 caracteres',
      'string.pattern.base': 'Nome de usuário pode conter apenas letras minúsculas, números, _, . e -',
      'any.required': 'Nome de usuário é obrigatório'
    }),
  
  sessionToken: Joi.string()
    .min(20)
    .max(500)
    .required()
    .messages({
      'string.min': 'Token de sessão inválido',
      'string.max': 'Token de sessão inválido',
      'any.required': 'Token de sessão é obrigatório'
    }),
  
  examTypeId: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({
      'number.base': 'ID do tipo de exame deve ser um número',
      'number.integer': 'ID do tipo de exame deve ser um inteiro',
      'number.positive': 'ID do tipo de exame inválido',
      'any.required': 'Tipo de exame é obrigatório'
    }),
  
  attemptId: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({
      'number.base': 'ID da tentativa deve ser um número',
      'number.integer': 'ID da tentativa deve ser um inteiro',
      'number.positive': 'ID da tentativa inválido',
      'any.required': 'ID da tentativa é obrigatório'
    }),
  
  questionId: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({
      'number.base': 'ID da questão deve ser um número',
      'number.integer': 'ID da questão deve ser um inteiro',
      'number.positive': 'ID da questão inválido',
      'any.required': 'ID da questão é obrigatório'
    })
};

// Authentication schemas
const authSchemas = {
  login: Joi.object({
    Email: commonSchemas.email,
    SenhaHash: commonSchemas.passwordHash
  }),
  
  verify: Joi.object({
    token: commonSchemas.token
  }),
  
  forgotPassword: Joi.object({
    email: commonSchemas.email
  }),
  
  resetPassword: Joi.object({
    email: commonSchemas.email,
    token: commonSchemas.token,
    senhaHash: commonSchemas.passwordHash
  }),
  
  register: Joi.object({
    Email: commonSchemas.email,
    SenhaHash: commonSchemas.passwordHash,
    Nome: commonSchemas.name.optional(),
    NomeUsuario: commonSchemas.username.optional()
  })
};

// Exam schemas
const examSchemas = {
  selectQuestions: Joi.object({
    examType: Joi.string()
      .uppercase()
      .valid('PMP', 'CPM', 'CAPM')
      .required()
      .messages({
        'any.only': 'Tipo de exame deve ser PMP, CPM ou CAPM',
        'any.required': 'Tipo de exame é obrigatório'
      }),
    
    count: Joi.number()
      .integer()
      .min(1)
      .max(200)
      .optional()
      .messages({
        'number.min': 'Quantidade deve ser pelo menos 1',
        'number.max': 'Quantidade máxima é 200'
      }),
    
    onlyCount: Joi.boolean()
      .optional(),
    
    onlyNew: Joi.boolean()
      .optional(),

    // Allow dropping exam_type filter (used by some frontend fallbacks)
    ignoreExamType: Joi.boolean()
      .optional(),
    
    sessionToken: Joi.string()
      .optional(),
    
    dominios: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(10)
      .optional()
      .messages({
        'array.min': 'Selecione pelo menos um domínio',
        'array.max': 'Máximo de 10 domínios permitidos'
      }),

    // Filters used by examSetup tabs
    areas: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(20)
      .optional(),

    grupos: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(20)
      .optional(),

    categorias: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(20)
      .optional(),
    
    nivel: Joi.number()
      .integer()
      .min(1)
      .max(3)
      .optional()
      .messages({
        'number.min': 'Nível deve ser entre 1 e 3',
        'number.max': 'Nível deve ser entre 1 e 3'
      }),
    
    questionCount: Joi.number()
      .integer()
      .min(1)
      .max(200)
      .optional()
      .messages({
        'number.min': 'Quantidade de questões deve ser pelo menos 1',
        'number.max': 'Quantidade máxima é 200 questões'
      }),

    // Admin-only emulator: explicit question IDs to start an exam with
    questionIds: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(200)
      .optional()
      .messages({
        'array.min': 'Informe pelo menos 1 questão',
        'array.max': 'Máximo de 200 questões por emulação'
      })
  }),
  
  startExam: Joi.object({
    id: commonSchemas.attemptId
  }),
  
  submitAnswers: Joi.object({
    // Accept either sessionToken (preferred) or legacy sessionId
    sessionToken: commonSchemas.sessionToken.optional(),
    sessionId: Joi.string().optional(),

    // Optional client diagnostics / behavior flags
    clientScriptVersion: Joi.alternatives().try(Joi.string().max(100), Joi.number()).optional(),
    partial: Joi.boolean().optional(),
    
    // Accept multiple answer formats: new (selectedOption index), legacy (optionId/optionIds), and typed (e.g., match_columns)
    answers: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.object({
            questionId: commonSchemas.questionId,
            selectedOption: Joi.number()
              .integer()
              .min(1)
              .max(5)
              .required()
              .messages({
                'number.min': 'Opção deve ser entre 1 e 5',
                'number.max': 'Opção deve ser entre 1 e 5',
                'any.required': 'Opção selecionada é obrigatória'
              }),
            timeTaken: Joi.number()
              .integer()
              .min(0)
              .max(300)
              .optional()
              .messages({
                'number.min': 'Tempo não pode ser negativo',
                'number.max': 'Tempo máximo por questão é 300 segundos'
              })
          }),
          // Typed responses (advanced interactions)
          Joi.object({
            questionId: commonSchemas.questionId,
            // Canonical shape: { response: { pairs: { [leftId]: rightId } } }
            response: Joi.alternatives().try(
              Joi.object({
                pairs: Joi.object()
                  .pattern(
                    Joi.string().max(64),
                    Joi.alternatives().try(
                      Joi.number().integer().positive(),
                      Joi.string().max(64).allow(''),
                      Joi.valid(null)
                    )
                  )
                  .optional()
              }),
              // Backward-compatible: allow response to be a JSON string; backend normalizes.
              Joi.string().max(20000)
            ).optional(),
            // Backward-compatible alias: { pairs: { ... } }
            pairs: Joi.object()
              .pattern(
                Joi.string().max(64),
                Joi.alternatives().try(
                  Joi.number().integer().positive(),
                  Joi.string().max(64).allow(''),
                  Joi.valid(null)
                )
              )
              .optional(),
            timeTaken: Joi.number().integer().min(0).max(300).optional()
          }).or('response', 'pairs'),
          // Legacy format (optionId/optionIds). Keep this last because it's intentionally permissive.
          Joi.object({
            questionId: commonSchemas.questionId,
            optionId: Joi.number().integer().positive().optional(),
            optionIds: Joi.array().items(Joi.number().integer().positive()).optional(),
            timeTaken: Joi.number().integer().min(0).max(300).optional()
          })
        )
      )
      .min(1)
      .max(200)
      .required()
      .messages({
        'array.min': 'Envie pelo menos uma resposta',
        'array.max': 'Máximo de 200 respostas por submissão',
        'any.required': 'Respostas são obrigatórias'
      })
  }),

  checkAnswer: Joi.object({
    questionId: commonSchemas.questionId.required(),
    optionId: Joi.number().integer().positive().optional(),
    optionIds: Joi.array().items(Joi.number().integer().positive()).optional(),
  }),
  
  startOnDemand: Joi.object({
    examTypeId: commonSchemas.examTypeId,
    
    selectedDomains: Joi.array()
      .items(Joi.number().integer().positive())
      .min(1)
      .max(10)
      .optional(),
    
    questionCount: Joi.number()
      .integer()
      .min(10)
      .max(200)
      .optional()
  }),
  
  getQuestion: Joi.object({
    sessionToken: commonSchemas.sessionToken,
    
    questionIndex: Joi.number()
      .integer()
      .min(0)
      .max(199)
      .required()
      .messages({
        'number.min': 'Índice de questão inválido',
        'number.max': 'Índice de questão inválido',
        'any.required': 'Índice da questão é obrigatório'
      })
  }),
  
  pauseSession: Joi.object({
    sessionId: commonSchemas.sessionToken
  }),
  
  resumeSession: Joi.object({
    sessionToken: commonSchemas.sessionToken
  }),
  
  getAttemptResult: Joi.object({
    attemptId: Joi.alternatives()
      .try(
        Joi.number().integer().positive(),
        Joi.string().pattern(/^\d+$/)
      )
      .required()
      .messages({
        'any.required': 'ID da tentativa é obrigatório',
        'alternatives.match': 'ID da tentativa deve ser um número válido'
      })
  })
};

// User management schemas
const userSchemas = {
  updateProfile: Joi.object({
    Nome: commonSchemas.name.optional(),
    NomeUsuario: commonSchemas.username.optional(),
    Email: commonSchemas.email.optional()
  }),
  
  changePassword: Joi.object({
    currentPassword: commonSchemas.passwordHash,
    newPassword: commonSchemas.passwordHash
  })
};

// Admin schemas
const adminSchemas = {
  markAbandoned: Joi.object({
    hoursThreshold: Joi.number()
      .integer()
      .min(1)
      .max(168) // 1 week
      .optional()
      .default(24)
      .messages({
        'number.min': 'Limite deve ser pelo menos 1 hora',
        'number.max': 'Limite máximo é 168 horas (1 semana)'
      })
  }),
  
  purgeAbandoned: Joi.object({
    dryRun: Joi.boolean()
      .optional()
      .default(true),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .messages({
        'number.min': 'Limite deve ser pelo menos 1',
        'number.max': 'Limite máximo é 1000 registros'
      })
  })
};

// Validation middleware factory
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : 
                 source === 'query' ? req.query : 
                 source === 'params' ? req.params : req.body;
    
    const { error, value } = schema.validate(data, {
      abortEarly: false, // Return all errors
      stripUnknown: true, // Remove unknown fields
      convert: true // Type conversion
    });
    
    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      logger.debug('[VALIDATION ERROR] Route:', req.path);
      logger.debug('[VALIDATION ERROR] Data received:', JSON.stringify(data, null, 2));
      logger.debug('[VALIDATION ERROR] Errors:', JSON.stringify(details, null, 2));
      
      const { badRequest } = require('./errors');
      return next(badRequest('Dados inválidos', 'VALIDATION_ERROR', { errors: details }));
    }
    
    // Replace request data with validated/sanitized data
    if (source === 'body') req.body = value;
    else if (source === 'query') req.query = value;
    else if (source === 'params') req.params = value;
    
    next();
  };
}

module.exports = {
  commonSchemas,
  authSchemas,
  examSchemas,
  userSchemas,
  adminSchemas,
  validate
};
