import request from 'supertest';
import { createApp } from '../../src/app';
import { Application } from 'express';

describe('API Integration Tests', () => {
  let app: Application;

  beforeAll(() => {
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();
  });

  describe('Health Check', () => {
    it('GET /health should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('HubSpot App Descriptor', () => {
    it('GET /.well-known/hubspot-app.json should return app descriptor', async () => {
      const response = await request(app)
        .get('/.well-known/hubspot-app.json')
        .expect(200);

      expect(response.body.name).toBe('Document Governance');
      expect(response.body.scopes).toBeDefined();
      expect(response.body.webhooks).toBeDefined();
      expect(response.body.cards).toBeDefined();
    });
  });

  describe('OAuth Routes', () => {
    it('GET /oauth/hubspot should redirect to HubSpot', async () => {
      const response = await request(app)
        .get('/oauth/hubspot')
        .expect(302);

      expect(response.headers.location).toContain('app.hubspot.com/oauth/authorize');
    });

    it('GET /oauth/status without sessionId should return 400', async () => {
      const response = await request(app)
        .get('/oauth/status')
        .expect(400);

      expect(response.body.error).toBe('Session ID required');
    });

    it('GET /oauth/status with unknown sessionId should return disconnected status', async () => {
      const response = await request(app)
        .get('/oauth/status?sessionId=unknown-session')
        .expect(200);

      expect(response.body.hubspot.connected).toBe(false);
      expect(response.body.microsoft.connected).toBe(false);
    });
  });

  describe('Document Routes', () => {
    it('GET /api/documents without params should return 400', async () => {
      const response = await request(app)
        .get('/api/documents')
        .expect(400);

      expect(response.body.error).toContain('objectType and objectId are required');
    });

    it('GET /api/documents with invalid objectType should return 400', async () => {
      const response = await request(app)
        .get('/api/documents?objectType=invalid&objectId=123')
        .expect(400);

      expect(response.body.error).toContain('objectType must be "deal" or "contact"');
    });

    it('GET /api/documents with valid params should return empty list', async () => {
      const response = await request(app)
        .get('/api/documents?objectType=deal&objectId=123')
        .expect(200);

      expect(response.body.documents).toEqual([]);
    });

    it('GET /api/documents/:id for non-existent document should return 404', async () => {
      const response = await request(app)
        .get('/api/documents/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('Document not found');
    });

    it('POST /api/documents without auth should return 401', async () => {
      const response = await request(app)
        .post('/api/documents')
        .send({
          objectType: 'deal',
          objectId: '123',
          filename: 'test.pdf',
          content: 'base64content',
        })
        .expect(401);

      expect(response.body.error).toContain('Session ID required');
    });
  });

  describe('CRM Card Routes', () => {
    it('GET /api/crm-card without params should return setup action', async () => {
      const response = await request(app)
        .get('/api/crm-card')
        .expect(400);

      expect(response.body.results).toEqual([]);
      expect(response.body.primaryAction).toBeDefined();
      expect(response.body.primaryAction.label).toContain('Setup');
    });

    it('GET /api/crm-card with valid params should return card data', async () => {
      const response = await request(app)
        .get('/api/crm-card?objectType=deal&objectId=123')
        .expect(200);

      expect(response.body.results).toBeDefined();
      expect(response.body.primaryAction).toBeDefined();
    });

    it('GET /api/crm-card/timeline without params should return 400', async () => {
      const response = await request(app)
        .get('/api/crm-card/timeline')
        .expect(400);

      expect(response.body.error).toContain('objectType and objectId are required');
    });

    it('GET /api/crm-card/timeline with valid params should return events', async () => {
      const response = await request(app)
        .get('/api/crm-card/timeline?objectType=deal&objectId=123')
        .expect(200);

      expect(response.body.events).toBeDefined();
    });
  });

  describe('Webhook Routes', () => {
    it('POST /webhooks/file-ingestion without required params should return 400', async () => {
      const response = await request(app)
        .post('/webhooks/file-ingestion')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('sessionId');
    });

    it('POST /webhooks/compliance-check should trigger check', async () => {
      const response = await request(app)
        .post('/webhooks/compliance-check')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.documentsChecked).toBeDefined();
    });
  });

  describe('Static Pages', () => {
    it('GET /setup should return setup page', async () => {
      const response = await request(app)
        .get('/setup')
        .expect(200);

      expect(response.text).toContain('Document Governance Setup');
      expect(response.text).toContain('Connect HubSpot');
      expect(response.text).toContain('Connect Microsoft');
    });

    it('GET /governance-panel should return governance panel', async () => {
      const response = await request(app)
        .get('/governance-panel?objectType=deal&objectId=123')
        .expect(200);

      expect(response.text).toContain('Document Governance');
      expect(response.text).toContain('deal ID: 123');
    });
  });
});
