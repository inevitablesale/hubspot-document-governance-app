import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { documentRepository, complianceIssueRepository, versionRepository } from './database';
import { ComplianceIssueType, DocumentMetadata } from '../types';
import path from 'path';

export interface ComplianceCheckResult {
  passed: boolean;
  issues: Array<{
    type: ComplianceIssueType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  }>;
  score: number;
}

export class ComplianceService {
  /**
   * Run all compliance checks on a document
   */
  async checkDocument(
    filename: string,
    size: number,
    metadata?: DocumentMetadata
  ): Promise<ComplianceCheckResult> {
    const issues: ComplianceCheckResult['issues'] = [];
    let score = 100;

    // Check file size
    const sizeIssue = this.checkFileSize(size);
    if (sizeIssue) {
      issues.push(sizeIssue);
      score -= sizeIssue.severity === 'critical' ? 40 : sizeIssue.severity === 'high' ? 25 : 10;
    }

    // Check file type
    const typeIssue = this.checkFileType(filename);
    if (typeIssue) {
      issues.push(typeIssue);
      score -= typeIssue.severity === 'critical' ? 50 : typeIssue.severity === 'high' ? 30 : 15;
    }

    // Check metadata completeness
    const metadataIssues = this.checkMetadata(metadata);
    for (const issue of metadataIssues) {
      issues.push(issue);
      score -= issue.severity === 'high' ? 10 : 5;
    }

    // Check retention policy
    if (metadata?.retentionDate) {
      const retentionIssue = this.checkRetention(new Date(metadata.retentionDate));
      if (retentionIssue) {
        issues.push(retentionIssue);
        score -= retentionIssue.severity === 'critical' ? 30 : 20;
      }
    }

    return {
      passed: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
      score: Math.max(0, score),
    };
  }

  /**
   * Check file size against policy
   */
  private checkFileSize(size: number): ComplianceCheckResult['issues'][0] | null {
    const maxSizeBytes = config.compliance.maxFileSizeMB * 1024 * 1024;

    if (size > maxSizeBytes) {
      const actualMB = (size / (1024 * 1024)).toFixed(2);
      return {
        type: 'file_too_large',
        severity: size > maxSizeBytes * 2 ? 'critical' : 'high',
        message: `File size (${actualMB}MB) exceeds maximum allowed (${config.compliance.maxFileSizeMB}MB)`,
        details: {
          actualSize: size,
          maxSize: maxSizeBytes,
        },
      };
    }

    return null;
  }

  /**
   * Check file type against allowed types
   */
  private checkFileType(filename: string): ComplianceCheckResult['issues'][0] | null {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    
    if (!ext) {
      return {
        type: 'disallowed_file_type',
        severity: 'high',
        message: 'File has no extension',
        details: { filename },
      };
    }

    if (!config.compliance.allowedFileTypes.includes(ext)) {
      return {
        type: 'disallowed_file_type',
        severity: 'critical',
        message: `File type ".${ext}" is not allowed. Allowed types: ${config.compliance.allowedFileTypes.join(', ')}`,
        details: {
          fileType: ext,
          allowedTypes: config.compliance.allowedFileTypes,
        },
      };
    }

    return null;
  }

  /**
   * Check metadata completeness
   */
  private checkMetadata(metadata?: DocumentMetadata): ComplianceCheckResult['issues'] {
    const issues: ComplianceCheckResult['issues'] = [];

    if (!metadata) {
      issues.push({
        type: 'missing_metadata',
        severity: 'medium',
        message: 'Document has no metadata',
      });
      return issues;
    }

    if (!metadata.category) {
      issues.push({
        type: 'missing_metadata',
        severity: 'low',
        message: 'Document is missing category',
        details: { missingField: 'category' },
      });
    }

    if (!metadata.confidentiality) {
      issues.push({
        type: 'missing_metadata',
        severity: 'medium',
        message: 'Document is missing confidentiality classification',
        details: { missingField: 'confidentiality' },
      });
    }

    return issues;
  }

  /**
   * Check document retention policy
   */
  private checkRetention(retentionDate: Date): ComplianceCheckResult['issues'][0] | null {
    const now = new Date();
    const daysUntilExpiry = Math.floor((retentionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return {
        type: 'expired_document',
        severity: 'critical',
        message: `Document has expired (expired ${Math.abs(daysUntilExpiry)} days ago)`,
        details: {
          retentionDate: retentionDate.toISOString(),
          daysExpired: Math.abs(daysUntilExpiry),
        },
      };
    }

    if (daysUntilExpiry <= 30) {
      return {
        type: 'retention_policy_violation',
        severity: 'high',
        message: `Document will expire in ${daysUntilExpiry} days`,
        details: {
          retentionDate: retentionDate.toISOString(),
          daysUntilExpiry,
        },
      };
    }

    return null;
  }

  /**
   * Check if link has expired
   */
  checkLinkExpiry(expiryDate?: Date): ComplianceCheckResult['issues'][0] | null {
    if (!expiryDate) return null;

    const now = new Date();
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return {
        type: 'link_expired',
        severity: 'high',
        message: 'Secure link has expired',
        details: {
          expiryDate: expiryDate.toISOString(),
          daysExpired: Math.abs(daysUntilExpiry),
        },
      };
    }

    if (daysUntilExpiry <= 7) {
      return {
        type: 'link_expired',
        severity: 'medium',
        message: `Secure link will expire in ${daysUntilExpiry} days`,
        details: {
          expiryDate: expiryDate.toISOString(),
          daysUntilExpiry,
        },
      };
    }

    return null;
  }

  /**
   * Check version count
   */
  checkVersionCount(documentId: string, maxVersions = 50): ComplianceCheckResult['issues'][0] | null {
    const count = versionRepository.getVersionCount(documentId);
    
    if (count > maxVersions) {
      return {
        type: 'version_limit_exceeded',
        severity: 'medium',
        message: `Document has ${count} versions, exceeding the recommended limit of ${maxVersions}`,
        details: {
          versionCount: count,
          maxVersions,
        },
      };
    }

    return null;
  }

  /**
   * Create compliance issues in database
   */
  async createIssues(documentId: string, issues: ComplianceCheckResult['issues']): Promise<void> {
    for (const issue of issues) {
      complianceIssueRepository.create({
        id: uuidv4(),
        documentId,
        type: issue.type,
        severity: issue.severity,
        message: issue.message,
        details: issue.details,
      });
    }
  }

  /**
   * Resolve a compliance issue
   */
  async resolveIssue(issueId: string, resolvedBy?: string): Promise<void> {
    complianceIssueRepository.update(issueId, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy,
    });
  }

  /**
   * Acknowledge a compliance issue
   */
  async acknowledgeIssue(issueId: string): Promise<void> {
    complianceIssueRepository.update(issueId, {
      status: 'acknowledged',
    });
  }

  /**
   * Run periodic compliance check on all documents
   */
  async runPeriodicCheck(): Promise<{ checked: number; issuesFound: number }> {
    const db = require('./database').getDatabase();
    const documents = db.prepare('SELECT * FROM documents WHERE status = ?').all('synced') as Record<string, unknown>[];
    
    let issuesFound = 0;

    for (const doc of documents) {
      const metadata = doc.metadata ? JSON.parse(doc.metadata as string) : undefined;
      const result = await this.checkDocument(
        doc.original_filename as string,
        doc.size as number,
        metadata
      );

      // Check link expiry
      if (doc.secure_link_expiry) {
        const linkIssue = this.checkLinkExpiry(new Date(doc.secure_link_expiry as string));
        if (linkIssue) {
          result.issues.push(linkIssue);
        }
      }

      // Check version count
      const versionIssue = this.checkVersionCount(doc.id as string);
      if (versionIssue) {
        result.issues.push(versionIssue);
      }

      // Create new issues (avoiding duplicates)
      const existingIssues = complianceIssueRepository.findByDocumentId(doc.id as string);
      const existingTypes = new Set(existingIssues.filter(i => i.status === 'open').map(i => i.type));

      const newIssues = result.issues.filter(i => !existingTypes.has(i.type));
      if (newIssues.length > 0) {
        await this.createIssues(doc.id as string, newIssues);
        issuesFound += newIssues.length;
      }

      // Update document compliance score
      documentRepository.update(doc.id as string, {
        complianceScore: result.score,
      });
    }

    return { checked: documents.length, issuesFound };
  }

  /**
   * Calculate compliance score for an object (deal/contact)
   */
  calculateObjectComplianceScore(objectType: string, objectId: string): number {
    const stats = documentRepository.getStats(objectType, objectId);
    return stats.averageComplianceScore;
  }
}

export const complianceService = new ComplianceService();
