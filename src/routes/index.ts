import { Router } from 'express';
import oauthRoutes from './oauth';
import documentRoutes from './documents';
import crmCardRoutes from './crm-card';
import webhookRoutes from './webhooks';

const router = Router();

// OAuth routes
router.use('/oauth', oauthRoutes);

// API routes
router.use('/api/documents', documentRoutes);
router.use('/api/crm-card', crmCardRoutes);

// Webhook routes
router.use('/webhooks', webhookRoutes);

export default router;
