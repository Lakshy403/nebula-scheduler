/**
 * @file services/api/src/docs/swagger.js
 * @description Swagger/OpenAPI 3.0 configuration and setup for the API Service.
 *
 * Implements interactive API documentation using swagger-ui-express.
 * Configured with a global JWT Bearer Security Scheme for authenticated routes.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi    from 'swagger-ui-express';

// ---------------------------------------------------------------------------
// OpenAPI Definition
// ---------------------------------------------------------------------------

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Nebula Scheduler API',
      version: '1.0.0',
      description: 'Interactive API documentation for Nebula Scheduler. A production-ready, distributed background job scheduling platform.',
      contact: {
        name: 'Platform Engineering Team',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'v1 API (Current)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token to authenticate.',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  // Paths to files containing OpenAPI annotations (JSDoc)
  apis: [
    './services/api/routes/*.js',
    './services/api/controllers/*.js'
  ],
};

const swaggerSpec = swaggerJsdoc(options);

// ---------------------------------------------------------------------------
// Express Setup Function
// ---------------------------------------------------------------------------

/**
 * Mounts the Swagger UI middleware onto the Express application.
 * @param {import('express').Application} app
 */
export function setupSwagger(app) {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Nebula API Docs',
      swaggerOptions: {
        persistAuthorization: true,
      },
    })
  );
}
