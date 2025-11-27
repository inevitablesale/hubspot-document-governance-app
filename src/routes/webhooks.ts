import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { documentGovernanceService } from '../services/document-governance';
import { hubspotOAuthService } from '../services/hubspot-oauth';
import { microsoftOAuthService } from '../services/microsoft-oauth';
import { authSessionRepository } from '../services/database';
import { verifyHubSpotWebhook } from '../middleware';

const router = Router();

interface WebhookEvent {
  subscriptionType: string;
  portalId: number;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  occurredAt: number;
}

/**
 * POST /webhooks/hubspot
 * Handle HubSpot webhook events for file attachments
 */
router.post('/hubspot', verifyHubSpotWebhook, async (req: Request, res: Response) => {
  const events: WebhookEvent[] = Array.isArray(req.body) ? req.body : [req.body];

  // Acknowledge webhook immediately
  res.status(200).json({ received: true });

  // Process events asynchronously
  for (const event of events) {
    try {
      await processHubSpotWebhook(event);
    } catch (error) {
      console.error('Error processing webhook event:', error);
    }
  }
});

/**
 * Process HubSpot webhook event
 */
async function processHubSpotWebhook(event: WebhookEvent): Promise<void> {
  const { subscriptionType, portalId, objectId } = event;

  // Get session for this portal
  const session = authSessionRepository.findByPortalId(portalId.toString());
  if (!session) {
    console.log(`No session found for portal ${portalId}`);
    return;
  }

  const sessionId = session.id as string;
  const hubspotToken = await hubspotOAuthService.getValidAccessToken(sessionId);
  const microsoftToken = await microsoftOAuthService.getValidAccessToken(sessionId);

  if (!hubspotToken || !microsoftToken) {
    console.log(`Missing tokens for session ${sessionId}`);
    return;
  }

  // Handle different subscription types
  switch (subscriptionType) {
    case 'deal.creation':
    case 'deal.propertyChange':
      // Check for new file attachments on deals
      await checkObjectForNewFiles(
        hubspotToken,
        microsoftToken,
        'deal',
        objectId.toString()
      );
      break;

    case 'contact.creation':
    case 'contact.propertyChange':
      // Check for new file attachments on contacts
      await checkObjectForNewFiles(
        hubspotToken,
        microsoftToken,
        'contact',
        objectId.toString()
      );
      break;

    default:
      console.log(`Unhandled subscription type: ${subscriptionType}`);
  }
}

/**
 * Check object for new files and process them
 */
async function checkObjectForNewFiles(
  hubspotToken: string,
  microsoftToken: string,
  objectType: 'deal' | 'contact',
  objectId: string
): Promise<void> {
  // This would be triggered by file attachment webhooks
  // For now, we log the event - actual file detection would use HubSpot APIs
  console.log(`Checking ${objectType} ${objectId} for new files`);
}

/**
 * POST /webhooks/file-ingestion
 * Custom endpoint for manual file uploads or integrations
 */
router.post('/file-ingestion', async (req: Request, res: Response) => {
  const { sessionId, objectType, objectId, filename, content, mimeType, metadata } = req.body;

  if (!sessionId || !objectType || !objectId || !filename || !content) {
    res.status(400).json({
      error: 'sessionId, objectType, objectId, filename, and content are required',
    });
    return;
  }

  if (objectType !== 'deal' && objectType !== 'contact') {
    res.status(400).json({ error: 'objectType must be "deal" or "contact"' });
    return;
  }

  try {
    const hubspotToken = await hubspotOAuthService.getValidAccessToken(sessionId);
    const microsoftToken = await microsoftOAuthService.getValidAccessToken(sessionId);

    if (!hubspotToken || !microsoftToken) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const fileBuffer = Buffer.from(content, 'base64');

    const result = await documentGovernanceService.processDocument({
      hubspotAccessToken: hubspotToken,
      microsoftAccessToken: microsoftToken,
      objectType,
      objectId,
      file: {
        buffer: fileBuffer,
        filename,
        mimeType: mimeType || 'application/octet-stream',
        size: fileBuffer.length,
      },
      metadata,
    });

    res.status(result.success ? 201 : 400).json(result);
  } catch (error) {
    console.error('File ingestion error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

/**
 * POST /webhooks/link-sync
 * Endpoint to trigger link synchronization
 */
router.post('/link-sync', async (req: Request, res: Response) => {
  const { sessionId, documentId } = req.body;

  if (!sessionId || !documentId) {
    res.status(400).json({ error: 'sessionId and documentId are required' });
    return;
  }

  try {
    const hubspotToken = await hubspotOAuthService.getValidAccessToken(sessionId);
    const microsoftToken = await microsoftOAuthService.getValidAccessToken(sessionId);

    if (!hubspotToken || !microsoftToken) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const result = await documentGovernanceService.refreshLink(
      hubspotToken,
      microsoftToken,
      documentId
    );

    res.json(result);
  } catch (error) {
    console.error('Link sync error:', error);
    res.status(500).json({ error: 'Failed to sync link' });
  }
});

/**
 * POST /webhooks/compliance-check
 * Trigger compliance check for all documents
 */
router.post('/compliance-check', async (req: Request, res: Response) => {
  const { complianceService } = await import('../services/compliance');

  try {
    const result = await complianceService.runPeriodicCheck();
    res.json({
      success: true,
      documentsChecked: result.checked,
      issuesFound: result.issuesFound,
    });
  } catch (error) {
    console.error('Compliance check error:', error);
    res.status(500).json({ error: 'Failed to run compliance check' });
  }
});

export default router;
