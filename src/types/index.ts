/**
 * Document Governance Types
 */

export interface Document {
  id: string;
  hubspotObjectType: 'deal' | 'contact';
  hubspotObjectId: string;
  hubspotFileId?: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  sharepointFileId?: string;
  sharepointDriveItemId?: string;
  sharepointWebUrl?: string;
  secureLink?: string;
  secureLinkExpiry?: Date;
  currentVersionId: string;
  status: DocumentStatus;
  complianceScore: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  metadata: DocumentMetadata;
}

export type DocumentStatus = 
  | 'pending_upload'
  | 'uploading'
  | 'uploaded'
  | 'synced'
  | 'error'
  | 'archived'
  | 'deleted';

export interface DocumentMetadata {
  description?: string;
  tags?: string[];
  category?: string;
  confidentiality?: 'public' | 'internal' | 'confidential' | 'restricted';
  retentionDate?: Date;
  customProperties?: Record<string, unknown>;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  sharepointVersionId?: string;
  filename: string;
  size: number;
  checksum: string;
  changedBy?: string;
  changeNotes?: string;
  createdAt: Date;
}

export interface ComplianceIssue {
  id: string;
  documentId: string;
  type: ComplianceIssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details?: Record<string, unknown>;
  status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  resolvedAt?: Date;
  resolvedBy?: string;
  createdAt: Date;
}

export type ComplianceIssueType = 
  | 'file_too_large'
  | 'disallowed_file_type'
  | 'expired_document'
  | 'missing_metadata'
  | 'retention_policy_violation'
  | 'access_policy_violation'
  | 'version_limit_exceeded'
  | 'scan_failed'
  | 'link_expired';

export interface TimelineEvent {
  id: string;
  hubspotObjectType: 'deal' | 'contact';
  hubspotObjectId: string;
  documentId?: string;
  eventType: TimelineEventType;
  title: string;
  body: string;
  timestamp: Date;
  hubspotTimelineEventId?: string;
}

export type TimelineEventType = 
  | 'document_uploaded'
  | 'document_synced'
  | 'document_version_created'
  | 'document_deleted'
  | 'document_archived'
  | 'compliance_issue_detected'
  | 'compliance_issue_resolved'
  | 'link_refreshed'
  | 'access_granted'
  | 'access_revoked';

export interface GovernancePolicy {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyRule {
  type: 'file_size' | 'file_type' | 'retention' | 'metadata' | 'access';
  condition: Record<string, unknown>;
  action: 'block' | 'warn' | 'flag';
  message: string;
}

export interface CRMCardData {
  objectType: 'deal' | 'contact';
  objectId: string;
  documents: DocumentSummary[];
  complianceScore: number;
  recentIssues: ComplianceIssueSummary[];
  stats: DocumentStats;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  status: DocumentStatus;
  complianceScore: number;
  sharepointWebUrl?: string;
  lastModified: Date;
  versionCount: number;
}

export interface ComplianceIssueSummary {
  id: string;
  documentFilename: string;
  type: ComplianceIssueType;
  severity: string;
  message: string;
  createdAt: Date;
}

export interface DocumentStats {
  totalDocuments: number;
  totalSize: number;
  averageComplianceScore: number;
  issueCount: number;
  lastActivity?: Date;
}
