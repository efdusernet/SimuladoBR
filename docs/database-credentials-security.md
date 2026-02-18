# Database Credentials Security Guide

This document explains how database credentials and other sensitive configuration are protected in SimuladosBR.

## Overview

Issue #7 from the improvement proposal addressed several security concerns:
- ✅ Environment variable validation on startup
- ✅ Sanitized error messages (no credential exposure)
- ✅ Connection pool configuration
- ✅ Safe logging utilities
- ✅ `.env` ignored by git

## Environment Variable Validation

### Automatic Validation

The application validates all required environment variables on startup using `backend/config/validateEnv.js`:

```javascript
const { validateOnLoad } = require('./config/validateEnv');
validateOnLoad(); // Throws error if validation fails
```

**Required Variables:**
- `DB_NAME` - Database name
- `DB_USER` - Database username  
- `DB_PASSWORD` - Database password
- `DB_HOST` - Database host
- `JWT_SECRET` - At least 32 characters
- `APP_BASE_URL` - Valid URL
- `FRONTEND_URL` - Valid URL

**Validated if Present:**
- `DB_PORT` - Must be 1-65535
- `SMTP_*` - All required if SMTP_HOST is set
- `REDIS_URL` - Required if USE_REDIS=true

### What Happens on Validation Failure

If validation fails, the application:
1. Prints detailed error messages to console
2. Lists all validation failures
3. Exits immediately with error code 1
4. Prevents server from starting with invalid configuration

**Example Output:**
```
❌ ENVIRONMENT CONFIGURATION ERRORS:

  1. DB_PASSWORD is required but not set
  2. JWT_SECRET must be at least 32 characters for security
  3. REDIS_URL is required when USE_REDIS=true

💡 Please check your .env file and ensure all required variables are set.
```

## Credential Exposure Prevention

### Safe Logging

The `validateEnv.js` module provides utilities to sanitize sensitive information:

```javascript
const { getSafeDbConfig, maskSensitiveValue } = require('./config/validateEnv');

// Safe logging - excludes password
console.log('DB Config:', getSafeDbConfig());
// Output: { host: 'localhost', port: 5432, database: 'Simulados', user: 'po***' }

// Mask individual values
console.log('User:', maskSensitiveValue('postgres'));
// Output: po***
```

### Error Handling

Database connection errors are handled without exposing credentials:

```javascript
sequelize.authenticate()
  .catch(err => {
    console.error('❌ Unable to connect to database:', err.message);
    console.error('   Check your database credentials and ensure PostgreSQL is running');
    // Full stack trace only in development mode with explicit logging enabled
  });
```

### Connection String Sanitization

If you need to log connection strings for debugging:

```javascript
const { sanitizeConnectionString } = require('./config/validateEnv');

const connStr = 'postgres://myuser:secretpass@localhost:5432/mydb';
console.log(sanitizeConnectionString(connStr));
// Output: postgres://my***:***@localhost:5432/mydb
```

## Setup Instructions

### Initial Setup

1. **Create your local environment file:**
   - Create `backend/.env` (this repo ignores it via `.gitignore`).
   - Fill in the required variables listed above.

2. **Generate a secure JWT secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Edit .env with your actual credentials:**
   ```bash
   # Use a secure editor, never commit this file
   nano .env  # or your preferred editor
   ```

4. **Verify configuration:**
   ```bash
   npm start
   # Should see: ✓ Environment variables validated successfully
   ```

### Security Checklist

- [ ] `.env` is listed in `.gitignore`
- [ ] JWT_SECRET is at least 32 characters
- [ ] Database password is strong (12+ chars, mixed case, numbers, symbols)
- [ ] Production uses separate credentials from development
- [ ] SEQUELIZE_LOG=false in production (no SQL logging)
- [ ] DB_SSL=true in production environments

## Connection Pool Configuration

The database configuration now includes connection pooling for better performance and resource management:

```javascript
pool: {
  max: 20,      // Maximum connections in pool
  min: 5,       // Minimum connections maintained
  acquire: 30000, // Max time (ms) to get connection
  idle: 10000    // Max time (ms) connection can be idle
}
```

**Benefits:**
- Prevents connection exhaustion under load
- Reuses connections efficiently
- Automatic connection health checks
- Better scalability

## Production Deployment

### Environment Variables in Production

**Option 1: Environment Variable Injection (Recommended)**
```bash
# Set via hosting platform (Heroku, AWS, etc.)
DB_PASSWORD=<secure-value>
JWT_SECRET=<secure-value>
```

**Option 2: Secrets Management System**
```javascript
// Future enhancement: AWS Secrets Manager, HashiCorp Vault
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function loadSecrets() {
  const secret = await secretsManager.getSecretValue({
    SecretId: 'simulados/db-credentials'
  }).promise();
  
  return JSON.parse(secret.SecretString);
}
```

### Credential Rotation

To rotate database credentials:

1. **Create new credentials in database:**
   ```sql
   CREATE USER new_user WITH PASSWORD 'new_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE Simulados TO new_user;
   ```

2. **Update .env file:**
   ```bash
   DB_USER=new_user
   DB_PASSWORD=new_secure_password
   ```

3. **Restart application:**
   ```bash
   npm restart
   # Validation will confirm new credentials
   ```

4. **Revoke old credentials:**
   ```sql
   DROP USER old_user;
   ```

### SSL/TLS for Database Connections

Enable SSL for production:

```bash
# .env
DB_SSL=true
```

The configuration automatically applies SSL when enabled:
```javascript
dialectOptions: {
  ssl: process.env.DB_SSL === 'true' ? {
    require: true,
    rejectUnauthorized: false  // Adjust based on your certificate setup
  } : false
}
```

## Troubleshooting

### "Environment validation failed" Error

**Problem:** Application exits immediately on startup

**Solution:** Check error messages and ensure all required variables are set in `.env`

### Database Connection Fails After Validation Passes

**Problem:** Validation succeeds but connection fails

**Possible Causes:**
1. PostgreSQL not running: `sudo service postgresql start`
2. Wrong host/port: Verify `DB_HOST` and `DB_PORT`
3. User doesn't have access: Check PostgreSQL user permissions
4. Firewall blocking connection: Check network settings

### Scripts Fail with Validation Errors

**Problem:** Maintenance scripts can't connect to database

**Solution:** Scripts use the same validation. Ensure `.env` is properly configured. For special cases:
```bash
SKIP_ENV_VALIDATION=true node backend/scripts/apply_sql.js
```

## Future Enhancements

Potential improvements for credential management:

1. **Secrets Management Integration**
   - AWS Secrets Manager
   - HashiCorp Vault
   - Azure Key Vault

2. **Credential Rotation Automation**
   - Scheduled rotation
   - Zero-downtime rotation
   - Audit logging

3. **Enhanced Encryption**
   - Encrypt credentials at rest in .env
   - Key derivation functions
   - Hardware security modules (HSM)

4. **Certificate-Based Authentication**
   - Client certificates for database
   - Mutual TLS authentication
   - Certificate pinning

## References

- [OWASP Secrets Management](https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password)
- [PostgreSQL Security Best Practices](https://www.postgresql.org/docs/current/auth-password.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Sequelize Security](https://sequelize.org/docs/v6/core-concepts/raw-queries/#bind-parameter)

## Summary

The implementation addresses all issues from Issue #7:

| Issue | Solution | Status |
|-------|----------|--------|
| Hardcoded credentials risk | .env with validation | ✅ |
| No env validation | validateEnv.js module | ✅ |
| Connection string exposure | Sanitized error logging | ✅ |
| Difficult credential rotation | Clear rotation process | ✅ |
| Connection pool issues | Optimized pool config | ✅ |

The application now fails fast with clear error messages if credentials are missing or invalid, and never exposes sensitive information in logs or error messages.
