import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { documentGovernanceService } from '../services/document-governance';
import { documentRepository, versionRepository, complianceIssueRepository } from '../services/database';
import { complianceService } from '../services/compliance';
import { ensureHubSpotAuth, ensureMicrosoftAuth } from '../middleware';

const router = Router();

/**
 * GET /api/documents
 * List documents for a HubSpot object
 */
router.get('/', async (req: Request, res: Response) => {
  const { objectType, objectId } = req.query;

  if (!objectType || !objectId) {
    res.status(400).json({ error: 'objectType and objectId are required' });
    return;
  }

  if (objectType !== 'deal' && objectType !== 'contact') {
    res.status(400).json({ error: 'objectType must be "deal" or "contact"' });
    return;
  }

  const documents = documentRepository.findByHubSpotObject(objectType, objectId as string);
  res.json({ documents });
});

/**
 * GET /api/documents/:id
 * Get document details with versions and issues
 */
router.get('/:id', async (req: Request, res: Response) => {
  const details = await documentGovernanceService.getDocumentDetails(req.params.id);

  if (!details) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  res.json(details);
});

/**
 * POST /api/documents
 * Upload a new document
 */
router.post(
  '/',
  ensureHubSpotAuth,
  ensureMicrosoftAuth,
  async (req: Request, res: Response) => {
    const { objectType, objectId, filename, content, metadata } = req.body;

    if (!objectType || !objectId || !filename || !content) {
      res.status(400).json({ error: 'objectType, objectId, filename, and content are required' });
      return;
    }

    if (objectType !== 'deal' && objectType !== 'contact') {
      res.status(400).json({ error: 'objectType must be "deal" or "contact"' });
      return;
    }

    try {
      const fileBuffer = Buffer.from(content, 'base64');

      const result = await documentGovernanceService.processDocument({
        hubspotAccessToken: req.hubspotAccessToken!,
        microsoftAccessToken: req.microsoftAccessToken!,
        objectType,
        objectId,
        file: {
          buffer: fileBuffer,
          filename,
          mimeType: req.body.mimeType || 'application/octet-stream',
          size: fileBuffer.length,
        },
        metadata,
      });

      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error('Document upload error:', error);
      res.status(500).json({ error: 'Failed to process document' });
    }
  }
);

/**
 * DELETE /api/documents/:id
 * Delete a document
 */
router.delete(
  '/:id',
  ensureHubSpotAuth,
  ensureMicrosoftAuth,
  async (req: Request, res: Response) => {
    const result = await documentGovernanceService.deleteDocument(
      req.hubspotAccessToken!,
      req.microsoftAccessToken!,
      req.params.id
    );

    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json(result);
    }
  }
);

/**
 * POST /api/documents/:id/refresh-link
 * Refresh the secure sharing link
 */
router.post(
  '/:id/refresh-link',
  ensureHubSpotAuth,
  ensureMicrosoftAuth,
  async (req: Request, res: Response) => {
    const result = await documentGovernanceService.refreshLink(
      req.hubspotAccessToken!,
      req.microsoftAccessToken!,
      req.params.id
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  }
);

/**
 * GET /api/documents/:id/versions
 * Get document versions
 */
router.get('/:id/versions', (req: Request, res: Response) => {
  const versions = versionRepository.findByDocumentId(req.params.id);
  res.json({ versions });
});

/**
 * GET /api/documents/:id/issues
 * Get compliance issues for a document
 */
router.get('/:id/issues', (req: Request, res: Response) => {
  const issues = complianceIssueRepository.findByDocumentId(req.params.id);
  res.json({ issues });
});

/**
 * POST /api/documents/:id/issues/:issueId/resolve
 * Resolve a compliance issue
 */
router.post('/:id/issues/:issueId/resolve', async (req: Request, res: Response) => {
  const { resolvedBy } = req.body;

  await complianceService.resolveIssue(req.params.issueId, resolvedBy);
  res.json({ success: true });
});

/**
 * POST /api/documents/:id/issues/:issueId/acknowledge
 * Acknowledge a compliance issue
 */
router.post('/:id/issues/:issueId/acknowledge', async (req: Request, res: Response) => {
  await complianceService.acknowledgeIssue(req.params.issueId);
  res.json({ success: true });
});

export default router;
