# Input Validation Implementation Guide

This document explains how input validation protects SimuladosBR from security vulnerabilities including SQL injection, XSS, type confusion, and buffer overflow attacks.

## Overview

Issue #8 from the improvement proposal addressed critical input validation gaps by implementing comprehensive Joi-based validation across all critical endpoints.

## Security Improvements

### ✅ Vulnerabilities Addressed

1. **SQL Injection Prevention**
   - All numeric IDs validated as integers
   - Array inputs validated for type and length
   - String inputs sanitized and length-limited
   - Enum validation for fixed value sets (exam types, etc.)

2. **XSS (Cross-Site Scripting) Prevention**
   - Email validation with proper format checking
   - HTML/script tag injection blocked in all text fields
   - Character whitelisting for usernames and names
   - Maximum length enforcement prevents payload injection

3. **Type Confusion Prevention**
   - Strict type checking on all inputs
   - Automatic type coercion with validation
   - Rejection of unexpected data types
   - Object schema enforcement

4. **Buffer Overflow Prevention**
   - Maximum length limits on all string fields
   - Email: 255 characters max
   - Names: 100 characters max
   - Usernames: 50 characters max
   - Passwords: 128 characters max (before hashing)

5. **Denial of Service Prevention**
   - Array size limits (max 200 items)
   - Request payload size validation
   - Question count limits (1-200)
   - Time value validation (0-300 seconds)

## Implementation Details

### Validation Middleware

Location: `backend/middleware/validation.js`

**Features:**
- Centralized validation schemas
- Reusable common field validators
- Automatic data sanitization
- Detailed error messages
- Multiple validation sources (body, query, params)

**Usage Pattern:**
```javascript
const { validate, authSchemas } = require('../middleware/validation');

router.post('/login', validate(authSchemas.login), async (req, res) => {
  // req.body is now validated and sanitized
  const { Email, SenhaHash } = req.body;
  // ... safe to use
});
```

### Validation Schemas

#### Authentication Schemas

**Login:**
```javascript
{
  Email: string (email format, max 255 chars, required),
  SenhaHash: string (64 hex chars - SHA256, required)
}
```

**Registration:**
```javascript
{
  Email: string (email format, max 255 chars, required),
  SenhaHash: string (64 hex chars - SHA256, required),
  Nome: string (2-100 chars, letters/spaces/hyphens only, optional),
  NomeUsuario: string (3-50 chars, lowercase alphanumeric/._-, optional)
}
```

**Password Reset:**
```javascript
{
  email: string (email format, required),
  token: string (6-64 alphanumeric uppercase, required),
  senhaHash: string (64 hex chars, required)
}
```

**Email Verification:**
```javascript
{
  token: string (6-64 alphanumeric uppercase, required)
}
```

#### Exam Schemas

**Select Questions:**
```javascript
{
  examType: string (enum: 'PMP', 'CPM', 'CAPM', required),
  dominios: array of integers (1-10 items, optional),
  nivel: integer (1-3, optional),
  questionCount: integer (1-200, optional)
}
```

**Submit Answers:**
```javascript
{
  sessionToken: string (20-500 chars, required),
  answers: array (1-200 items, required) [
    {
      questionId: integer (positive, required),
      selectedOption: integer (1-5, required),
      timeTaken: integer (0-300 seconds, optional)
    }
  ]
}
```

**Start On-Demand Exam:**
```javascript
{
  examTypeId: integer (positive, required),
  selectedDomains: array of integers (1-10 items, optional),
  questionCount: integer (10-200, optional)
}
```

**Get Question:**
```javascript
{
  sessionToken: string (20-500 chars, required),
  questionIndex: integer (0-199, required)
}
```

### Protected Endpoints

#### Auth Routes (`/api/auth/*`)
- ✅ `POST /login` - Login validation
- ✅ `POST /verify` - Token validation
- ✅ `POST /forgot-password` - Email validation
- ✅ `POST /reset-password` - Reset validation

#### Exam Routes (`/api/exams/*`)
- ✅ `POST /select` - Question selection validation
- ✅ `POST /start-on-demand` - Exam start validation
- ✅ `POST /submit` - Answer submission validation
- ✅ `POST /resume` - Session resume validation
- ✅ `POST /:id/start` - Exam start validation
- ✅ `POST /:sessionId/pause/start` - Pause validation
- ✅ `POST /:sessionId/pause/skip` - Pause skip validation
- ✅ `GET /result/:attemptId` - Result ID validation

#### User Routes (`/api/users/*`)
- ✅ `POST /` - User registration validation

## Testing Results

### SQL Injection Protection
```javascript
// Attack attempt
{ examType: 'PMP', dominios: ['1; DROP TABLE questao;--'] }
// Result: BLOCKED
// Error: "dominios[0]" must be a number

// Valid input
{ examType: 'PMP', dominios: [1, 2, 3] }
// Result: PASSED
```

### XSS Protection
```javascript
// Attack attempt
{ Email: 'test@example.com<script>alert(1)</script>', SenhaHash: '...' }
// Result: BLOCKED
// Error: E-mail deve ser válido
```

### Buffer Overflow Protection
```javascript
// Attack attempt (200 char name)
{ Nome: 'A'.repeat(200), Email: 'test@example.com', SenhaHash: '...' }
// Result: BLOCKED
// Error: Nome não pode ter mais de 100 caracteres
```

### Type Confusion Protection
```javascript
// Attack attempt
{ examType: 123 } // Should be string
// Result: BLOCKED
// Error: "examType" must be a string
```

## Error Response Format

When validation fails, the API returns a standardized error response:

```javascript
{
  "success": false,
  "message": "Dados inválidos",
  "errors": [
    {
      "field": "Email",
      "message": "E-mail deve ser válido"
    },
    {
      "field": "SenhaHash",
      "message": "Hash de senha deve ter 64 caracteres"
    }
  ]
}
```

**HTTP Status Codes:**
- `400 Bad Request` - Validation failed
- `401 Unauthorized` - Authentication failed (after validation)
- `403 Forbidden` - Access denied (after validation)
- `404 Not Found` - Resource not found
- `409 Conflict` - Duplicate resource (e.g., email exists)
- `500 Internal Server Error` - Server error (after validation)

## Validation Options

The validation middleware uses these Joi options:

```javascript
{
  abortEarly: false,    // Return all errors, not just first
  stripUnknown: true,   // Remove fields not in schema
  convert: true         // Automatic type conversion
}
```

**Benefits:**
- **Complete Error Reporting**: Users see all validation issues at once
- **Attack Surface Reduction**: Unknown fields automatically stripped
- **Type Safety**: Automatic conversion with validation (e.g., "123" → 123)

## Adding New Validation

### Step 1: Define Schema

Add to `backend/middleware/validation.js`:

```javascript
const newEndpointSchema = Joi.object({
  fieldName: Joi.string()
    .min(3)
    .max(50)
    .required()
    .messages({
      'string.min': 'Campo deve ter pelo menos 3 caracteres',
      'any.required': 'Campo é obrigatório'
    })
});

// Export in appropriate category
const mySchemas = {
  newEndpoint: newEndpointSchema
};
```

### Step 2: Apply to Route

In your route file:

```javascript
const { mySchemas, validate } = require('../middleware/validation');

router.post('/my-endpoint', 
  validate(mySchemas.newEndpoint), 
  async (req, res) => {
    // req.body is validated and sanitized
    const { fieldName } = req.body;
    // ... handle request
  }
);
```

### Step 3: Test Validation

```javascript
const { mySchemas } = require('./middleware/validation');

// Test valid input
const valid = { fieldName: 'test123' };
const result1 = mySchemas.newEndpoint.validate(valid);
console.log('Valid:', result1.error ? 'NO' : 'YES');

// Test invalid input
const invalid = { fieldName: 'ab' }; // Too short
const result2 = mySchemas.newEndpoint.validate(invalid);
console.log('Invalid caught:', result2.error ? 'YES' : 'NO');
```

## Common Validation Patterns

### Email Validation
```javascript
email: Joi.string()
  .email({ minDomainSegments: 2, tlds: { allow: false } })
  .max(255)
  .trim()
  .lowercase()
  .required()
```

### Password Hash (SHA-256)
```javascript
passwordHash: Joi.string()
  .length(64)
  .hex()
  .required()
```

### Positive Integer ID
```javascript
id: Joi.number()
  .integer()
  .positive()
  .required()
```

### Enum Validation
```javascript
examType: Joi.string()
  .valid('PMP', 'CPM', 'CAPM')
  .required()
```

### Array with Limits
```javascript
items: Joi.array()
  .items(Joi.number().integer().positive())
  .min(1)
  .max(10)
  .optional()
```

### String with Pattern
```javascript
username: Joi.string()
  .pattern(/^[a-z0-9_.-]+$/)
  .min(3)
  .max(50)
  .lowercase()
  .required()
```

## Best Practices

### 1. Validate Early
Apply validation middleware before any business logic:
```javascript
router.post('/endpoint',
  validate(schema),        // ✅ Validation first
  authenticate,             // Then auth
  authorize,                // Then authz
  async (req, res) => {    // Then logic
    // ...
  }
);
```

### 2. Use Specific Messages
Provide clear, actionable error messages:
```javascript
.messages({
  'string.min': 'Nome deve ter pelo menos 2 caracteres',
  'string.pattern.base': 'Nome contém caracteres inválidos',
  'any.required': 'Nome é obrigatório'
})
```

### 3. Whitelist, Don't Blacklist
Define what IS allowed, not what isn't:
```javascript
// ✅ Good: Only allow specific characters
.pattern(/^[a-zA-Z0-9_-]+$/)

// ❌ Bad: Try to block specific characters
.pattern(/^[^<>'"]+$/)
```

### 4. Layer Validation
Combine multiple validation layers:
1. **Schema validation** (Joi) - Data type and format
2. **Business validation** (Controller) - Business rules
3. **Database constraints** - Final safety net

### 5. Strip Unknown Fields
Always enable `stripUnknown: true` to prevent:
- Mass assignment vulnerabilities
- Unexpected field injection
- Data leakage

## Security Checklist

- [x] All POST endpoints have validation
- [x] All PUT/PATCH endpoints have validation
- [x] Param validation for IDs in URLs
- [x] Query param validation where applicable
- [x] Email format validation
- [x] Password strength validation (hash length)
- [x] Maximum length limits on all strings
- [x] Integer range validation
- [x] Array size limits
- [x] Enum validation for fixed sets
- [x] Pattern matching for usernames/names
- [x] Type coercion with validation
- [x] Unknown field stripping
- [x] Detailed error messages
- [x] Consistent error response format

## Performance Considerations

**Validation Overhead:**
- Typical validation: < 1ms per request
- Complex schemas: 1-3ms per request
- Negligible compared to database queries (10-100ms)

**Optimization Tips:**
1. Compile schemas once at startup (done automatically)
2. Use `abortEarly: true` if only first error needed
3. Cache validation results for idempotent requests
4. Consider validation at API gateway for high-traffic APIs

## Monitoring & Logging

**Validation Failures to Monitor:**
1. High validation failure rates (> 10%) - possible attack
2. Same IP with repeated failures - rate limit
3. Specific field failures - adjust UI validation
4. SQL injection attempts - security alert

**Example Logging:**
```javascript
if (error) {
  console.warn('[Validation Failed]', {
    endpoint: req.path,
    ip: req.ip,
    errors: error.details,
    timestamp: new Date()
  });
}
```

## Migration Notes

### Backward Compatibility

Validation changes are **non-breaking** for valid requests:
- Valid requests pass through unchanged
- Invalid requests that previously crashed now return 400
- Error response format is new but consistent

### Frontend Updates

Frontend may need updates to:
1. Handle new structured error format
2. Display field-specific errors
3. Adjust max length limits to match backend
4. Add client-side validation matching backend rules

## References

- [Joi Documentation](https://joi.dev/api/)
- [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [Express Validation Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

## Summary

| Issue | Solution | Status |
|-------|----------|--------|
| SQL Injection | Type validation + integer checking | ✅ |
| XSS Attacks | Email validation + character whitelisting | ✅ |
| Type Confusion | Strict type checking + coercion | ✅ |
| Buffer Overflow | Maximum length limits on all strings | ✅ |
| DoS via Malformed Input | Array limits + request size validation | ✅ |
| Mass Assignment | Unknown field stripping | ✅ |
| Inconsistent Errors | Standardized error format | ✅ |

**All critical endpoints are now protected with comprehensive input validation.**
