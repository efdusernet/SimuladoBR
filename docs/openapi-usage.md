# OpenAPI / Swagger Usage

## Viewing the Spec
- The spec is available at `docs/openapi.yaml`.
- Use Swagger UI locally:
  1. Install Swagger UI Express
     ```powershell
     cd "c:\Users\efdus\OneDrive\App PMP\SimuladosBR\backend";
     npm install swagger-ui-express yamljs
     ```
  2. Mount in `backend/index.js` (optional):
     ```js
     const swaggerUi = require('swagger-ui-express');
     const YAML = require('yamljs');
     const openapiDocument = YAML.load(require('path').join(__dirname, '..', 'docs', 'openapi.yaml'));
     app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
     ```
  3. Navigate to `http://localhost:3000/api-docs`.

## Notes
- This is an initial draft covering key endpoints; extend schemas as backend evolves.
- Security: endpoints that require admin include `X-Session-Token` in header.
- Versioning: current routes include both `/api/` and `/api/v1/`; update the spec as versioning stabilizes.
