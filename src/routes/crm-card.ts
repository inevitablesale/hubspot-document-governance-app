import { Router, Request, Response } from 'express';
import { documentGovernanceService } from '../services/document-governance';
import { documentRepository, complianceIssueRepository } from '../services/database';
import { timelineService } from '../services/timeline';

const router = Router();

/**
 * GET /api/crm-card
 * Get CRM card data for HubSpot
 * This endpoint is called by HubSpot when rendering the CRM card
 */
router.get('/', async (req: Request, res: Response) => {
  const { objectType, objectId, portalId } = req.query;

  if (!objectType || !objectId) {
    res.status(400).json({
      results: [],
      primaryAction: {
        type: 'IFRAME',
        width: 800,
        height: 600,
        uri: '/setup',
        label: 'Setup Document Governance',
      },
    });
    return;
  }

  if (objectType !== 'deal' && objectType !== 'contact') {
    res.status(400).json({ error: 'objectType must be "deal" or "contact"' });
    return;
  }

  try {
    const cardData = await documentGovernanceService.getCRMCardData(
      objectType as 'deal' | 'contact',
      objectId as string
    );

    // Format response for HubSpot CRM card
    const results = [];

    // Summary section
    results.push({
      objectId: 1,
      title: 'Document Governance Summary',
      properties: [
        {
          label: 'Total Documents',
          dataType: 'NUMERIC',
          value: cardData.stats.totalDocuments,
        },
        {
          label: 'Compliance Score',
          dataType: 'NUMERIC',
          value: cardData.stats.averageComplianceScore,
        },
        {
          label: 'Open Issues',
          dataType: 'NUMERIC',
          value: cardData.stats.issueCount,
        },
        {
          label: 'Total Size',
          dataType: 'STRING',
          value: formatFileSize(cardData.stats.totalSize),
        },
      ],
    });

    // Recent documents
    for (const doc of cardData.documents.slice(0, 5)) {
      results.push({
        objectId: doc.id,
        title: doc.filename,
        link: doc.sharepointWebUrl,
        properties: [
          {
            label: 'Status',
            dataType: 'STATUS',
            value: doc.status,
            optionType: getStatusOptionType(doc.status),
          },
          {
            label: 'Compliance',
            dataType: 'NUMERIC',
            value: doc.complianceScore,
          },
          {
            label: 'Versions',
            dataType: 'NUMERIC',
            value: doc.versionCount,
          },
          {
            label: 'Last Modified',
            dataType: 'DATE',
            value: doc.lastModified.getTime(),
          },
        ],
        actions: [
          {
            type: 'IFRAME',
            width: 800,
            height: 600,
            uri: `/document-details?id=${doc.id}`,
            label: 'View Details',
          },
        ],
      });
    }

    // Recent issues
    if (cardData.recentIssues.length > 0) {
      results.push({
        objectId: 'issues',
        title: '⚠️ Recent Compliance Issues',
        properties: cardData.recentIssues.slice(0, 3).map(issue => ({
          label: issue.documentFilename,
          dataType: 'STRING',
          value: `[${issue.severity.toUpperCase()}] ${issue.message}`,
        })),
      });
    }

    res.json({
      results,
      primaryAction: {
        type: 'IFRAME',
        width: 900,
        height: 700,
        uri: `/governance-panel?objectType=${objectType}&objectId=${objectId}`,
        label: 'Open Governance Panel',
      },
      secondaryActions: [
        {
          type: 'IFRAME',
          width: 600,
          height: 500,
          uri: `/upload?objectType=${objectType}&objectId=${objectId}`,
          label: 'Upload Document',
        },
      ],
    });
  } catch (error) {
    console.error('CRM card error:', error);
    res.status(500).json({ error: 'Failed to load CRM card data' });
  }
});

/**
 * GET /api/crm-card/timeline
 * Get timeline events for an object
 */
router.get('/timeline', (req: Request, res: Response) => {
  const { objectType, objectId } = req.query;

  if (!objectType || !objectId) {
    res.status(400).json({ error: 'objectType and objectId are required' });
    return;
  }

  if (objectType !== 'deal' && objectType !== 'contact') {
    res.status(400).json({ error: 'objectType must be "deal" or "contact"' });
    return;
  }

  const events = timelineService.getObjectEvents(
    objectType as 'deal' | 'contact',
    objectId as string
  );

  res.json({ events });
});

/**
 * Helper function to format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Helper function to get status option type for HubSpot
 */
function getStatusOptionType(status: string): string {
  switch (status) {
    case 'synced':
      return 'SUCCESS';
    case 'error':
      return 'DANGER';
    case 'uploading':
    case 'pending_upload':
      return 'WARNING';
    default:
      return 'DEFAULT';
  }
}

export default router;
