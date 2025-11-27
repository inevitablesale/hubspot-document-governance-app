import { v4 as uuidv4 } from 'uuid';
import { documentRepository, versionRepository, complianceIssueRepository } from './database';
import { sharepointService } from './sharepoint';
import { complianceService } from './compliance';
import { timelineService } from './timeline';
import { hubspotFileService, HubSpotFile } from './hubspot-files';
import { DocumentMetadata, DocumentSummary, CRMCardData, ComplianceIssueSummary } from '../types';

export interface ProcessDocumentOptions {
  hubspotAccessToken: string;
  microsoftAccessToken: string;
  objectType: 'deal' | 'contact';
  objectId: string;
  file: HubSpotFile | { buffer: Buffer; filename: string; mimeType: string; size: number };
  metadata?: DocumentMetadata;
}

export interface ProcessDocumentResult {
  success: boolean;
  documentId?: string;
  sharepointUrl?: string;
  secureLink?: string;
  complianceScore?: number;
  issues?: Array<{ type: string; severity: string; message: string }>;
  error?: string;
}

export class DocumentGovernanceService {
  /**
   * Process a new document: upload to SharePoint, create version, check compliance
   */
  async processDocument(options: ProcessDocumentOptions): Promise<ProcessDocumentResult> {
    const docId = uuidv4();
    let fileBuffer: Buffer;
    let filename: string;
    let mimeType: string;
    let size: number;

    try {
      // Get file content
      if ('buffer' in options.file) {
        fileBuffer = options.file.buffer;
        filename = options.file.filename;
        mimeType = options.file.mimeType;
        size = options.file.size;
      } else {
        const downloaded = await hubspotFileService.downloadFile(
          options.hubspotAccessToken,
          options.file.id
        );
        fileBuffer = downloaded.buffer;
        filename = downloaded.filename;
        mimeType = downloaded.mimeType;
        size = fileBuffer.length;
      }

      // Run compliance checks before upload
      const complianceResult = await complianceService.checkDocument(filename, size, options.metadata);

      // Create document record
      documentRepository.create({
        id: docId,
        hubspotObjectType: options.objectType,
        hubspotObjectId: options.objectId,
        hubspotFileId: 'buffer' in options.file ? undefined : options.file.id,
        originalFilename: filename,
        mimeType,
        size,
        metadata: options.metadata as Record<string, unknown> | undefined,
      });

      // Log upload event
      await timelineService.logDocumentUploaded(
        options.hubspotAccessToken,
        options.objectType,
        options.objectId,
        docId,
        filename
      );

      // If there are critical compliance issues, don't upload
      const criticalIssues = complianceResult.issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        documentRepository.update(docId, {
          status: 'error',
          complianceScore: complianceResult.score,
        });

        await complianceService.createIssues(docId, complianceResult.issues);

        // Log compliance issues
        for (const issue of criticalIssues) {
          await timelineService.logComplianceIssue(
            options.hubspotAccessToken,
            options.objectType,
            options.objectId,
            docId,
            filename,
            issue.type,
            issue.severity,
            issue.message
          );
        }

        return {
          success: false,
          documentId: docId,
          complianceScore: complianceResult.score,
          issues: complianceResult.issues,
          error: 'Document blocked due to critical compliance issues',
        };
      }

      // Upload to SharePoint
      const { document, version } = await sharepointService.syncDocument(
        options.microsoftAccessToken,
        docId,
        fileBuffer,
        filename,
        options.objectType,
        options.objectId
      );

      // Create any non-critical compliance issues
      if (complianceResult.issues.length > 0) {
        await complianceService.createIssues(docId, complianceResult.issues);
      }

      // Update compliance score
      documentRepository.update(docId, {
        complianceScore: complianceResult.score,
      });

      // Log sync event
      await timelineService.logDocumentSynced(
        options.hubspotAccessToken,
        options.objectType,
        options.objectId,
        docId,
        filename,
        document?.sharepointWebUrl || ''
      );

      // Replace HubSpot attachment with secure link
      if (document?.secureLink) {
        await hubspotFileService.replaceAttachmentWithLink(
          options.hubspotAccessToken,
          options.objectType,
          options.objectId,
          filename,
          document.secureLink
        );
      }

      return {
        success: true,
        documentId: docId,
        sharepointUrl: document?.sharepointWebUrl,
        secureLink: document?.secureLink,
        complianceScore: complianceResult.score,
        issues: complianceResult.issues.length > 0 ? complianceResult.issues : undefined,
      };
    } catch (error) {
      // Update document status to error
      documentRepository.update(docId, { status: 'error' });

      return {
        success: false,
        documentId: docId,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Refresh secure link for a document
   */
  async refreshLink(
    hubspotAccessToken: string,
    microsoftAccessToken: string,
    documentId: string
  ): Promise<{ success: boolean; newLink?: string; newExpiry?: Date; error?: string }> {
    const doc = documentRepository.findById(documentId);
    if (!doc || !doc.sharepointDriveItemId) {
      return { success: false, error: 'Document not found or not synced to SharePoint' };
    }

    try {
      const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const { link } = await sharepointService.createSharingLink(
        microsoftAccessToken,
        doc.sharepointDriveItemId,
        'view',
        expiryDate
      );

      documentRepository.update(documentId, {
        secureLink: link,
        secureLinkExpiry: expiryDate.toISOString(),
      });

      // Log the event
      await timelineService.logLinkRefreshed(
        hubspotAccessToken,
        doc.hubspotObjectType,
        doc.hubspotObjectId,
        documentId,
        doc.originalFilename,
        expiryDate
      );

      // Resolve any link expiry compliance issues
      const issues = complianceIssueRepository.findByDocumentId(documentId);
      const linkIssue = issues.find(i => i.type === 'link_expired' && i.status === 'open');
      if (linkIssue) {
        await complianceService.resolveIssue(linkIssue.id);
      }

      return { success: true, newLink: link, newExpiry: expiryDate };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh link',
      };
    }
  }

  /**
   * Get CRM card data for an object
   */
  async getCRMCardData(objectType: 'deal' | 'contact', objectId: string): Promise<CRMCardData> {
    // Get documents for the object
    const documents = documentRepository.findByHubSpotObject(objectType, objectId);

    // Get stats
    const stats = documentRepository.getStats(objectType, objectId);

    // Get open compliance issues
    const issues = complianceIssueRepository.findOpenByHubSpotObject(objectType, objectId, 5);

    // Map to summaries
    const documentSummaries: DocumentSummary[] = documents.map(doc => ({
      id: doc.id,
      filename: doc.originalFilename,
      status: doc.status as DocumentSummary['status'],
      complianceScore: doc.complianceScore,
      sharepointWebUrl: doc.sharepointWebUrl,
      lastModified: doc.updatedAt,
      versionCount: versionRepository.getVersionCount(doc.id),
    }));

    const issueSummaries: ComplianceIssueSummary[] = issues.map(issue => ({
      id: issue.id,
      documentFilename: (issue as unknown as { documentFilename: string }).documentFilename,
      type: issue.type as ComplianceIssueSummary['type'],
      severity: issue.severity,
      message: issue.message,
      createdAt: issue.createdAt,
    }));

    return {
      objectType,
      objectId,
      documents: documentSummaries,
      complianceScore: stats.averageComplianceScore,
      recentIssues: issueSummaries,
      stats: {
        totalDocuments: stats.totalDocuments,
        totalSize: stats.totalSize,
        averageComplianceScore: stats.averageComplianceScore,
        issueCount: stats.issueCount,
        lastActivity: stats.lastActivity ? new Date(stats.lastActivity) : undefined,
      },
    };
  }

  /**
   * Get document details with versions
   */
  async getDocumentDetails(documentId: string): Promise<{
    document: ReturnType<typeof documentRepository.findById>;
    versions: ReturnType<typeof versionRepository.findByDocumentId>;
    issues: ReturnType<typeof complianceIssueRepository.findByDocumentId>;
  } | null> {
    const document = documentRepository.findById(documentId);
    if (!document) return null;

    const versions = versionRepository.findByDocumentId(documentId);
    const issues = complianceIssueRepository.findByDocumentId(documentId);

    return { document, versions, issues };
  }

  /**
   * Delete a document
   */
  async deleteDocument(
    hubspotAccessToken: string,
    microsoftAccessToken: string,
    documentId: string
  ): Promise<{ success: boolean; error?: string }> {
    const doc = documentRepository.findById(documentId);
    if (!doc) {
      return { success: false, error: 'Document not found' };
    }

    try {
      // Delete from SharePoint if synced
      if (doc.sharepointDriveItemId) {
        await sharepointService.deleteFile(microsoftAccessToken, doc.sharepointDriveItemId);
      }

      // Delete from database
      documentRepository.delete(documentId);

      // Log event
      await timelineService.createEvent({
        accessToken: hubspotAccessToken,
        objectType: doc.hubspotObjectType,
        objectId: doc.hubspotObjectId,
        documentId,
        eventType: 'document_deleted',
        title: 'Document Deleted',
        body: `Document "${doc.originalFilename}" has been deleted from the system.`,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete document',
      };
    }
  }
}

export const documentGovernanceService = new DocumentGovernanceService();
