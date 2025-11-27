import { 
  getDatabase,
  closeDatabase,
  documentRepository,
  versionRepository,
  complianceIssueRepository,
  timelineEventRepository
} from '../../src/services/database';

// Use in-memory database for tests
process.env.DATABASE_PATH = ':memory:';

describe('Database Service', () => {
  beforeAll(() => {
    getDatabase(); // Initialize database
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('documentRepository', () => {
    const testDoc = {
      id: 'test-doc-1',
      hubspotObjectType: 'deal' as const,
      hubspotObjectId: '123456',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    };

    it('should create a document', () => {
      const doc = documentRepository.create(testDoc);
      
      expect(doc).not.toBeNull();
      expect(doc?.id).toBe(testDoc.id);
      expect(doc?.originalFilename).toBe(testDoc.originalFilename);
      expect(doc?.status).toBe('pending_upload');
    });

    it('should find document by id', () => {
      const doc = documentRepository.findById(testDoc.id);
      
      expect(doc).not.toBeNull();
      expect(doc?.originalFilename).toBe(testDoc.originalFilename);
    });

    it('should find documents by HubSpot object', () => {
      const docs = documentRepository.findByHubSpotObject('deal', '123456');
      
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0].hubspotObjectId).toBe('123456');
    });

    it('should update document', () => {
      const updated = documentRepository.update(testDoc.id, {
        status: 'synced',
        sharepointWebUrl: 'https://sharepoint.com/test',
        complianceScore: 95,
      });

      expect(updated?.status).toBe('synced');
      expect(updated?.sharepointWebUrl).toBe('https://sharepoint.com/test');
      expect(updated?.complianceScore).toBe(95);
    });

    it('should get stats for HubSpot object', () => {
      const stats = documentRepository.getStats('deal', '123456');
      
      expect(stats.totalDocuments).toBeGreaterThan(0);
      expect(stats.averageComplianceScore).toBeGreaterThanOrEqual(0);
    });

    it('should delete document', () => {
      documentRepository.delete(testDoc.id);
      const doc = documentRepository.findById(testDoc.id);
      expect(doc).toBeNull();
    });
  });

  describe('versionRepository', () => {
    const testDoc = {
      id: 'test-doc-versions',
      hubspotObjectType: 'contact' as const,
      hubspotObjectId: '789',
      originalFilename: 'versioned.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    };

    const testVersion = {
      id: 'version-1',
      documentId: 'test-doc-versions',
      versionNumber: 1,
      filename: 'versioned.pdf',
      size: 2048,
      checksum: 'abc123',
    };

    beforeAll(() => {
      documentRepository.create(testDoc);
    });

    afterAll(() => {
      documentRepository.delete(testDoc.id);
    });

    it('should create a version', () => {
      const version = versionRepository.create(testVersion);
      
      expect(version).not.toBeNull();
      expect(version?.versionNumber).toBe(1);
    });

    it('should find version by id', () => {
      const version = versionRepository.findById(testVersion.id);
      
      expect(version).not.toBeNull();
      expect(version?.checksum).toBe('abc123');
    });

    it('should find versions by document id', () => {
      // Create another version
      versionRepository.create({
        id: 'version-2',
        documentId: testDoc.id,
        versionNumber: 2,
        filename: 'versioned-v2.pdf',
        size: 2100,
        checksum: 'def456',
      });

      const versions = versionRepository.findByDocumentId(testDoc.id);
      
      expect(versions.length).toBe(2);
      // Should be sorted by version number descending
      expect(versions[0].versionNumber).toBe(2);
    });

    it('should get latest version', () => {
      const latest = versionRepository.getLatestVersion(testDoc.id);
      
      expect(latest?.versionNumber).toBe(2);
    });

    it('should get version count', () => {
      const count = versionRepository.getVersionCount(testDoc.id);
      expect(count).toBe(2);
    });
  });

  describe('complianceIssueRepository', () => {
    const testDoc = {
      id: 'test-doc-compliance',
      hubspotObjectType: 'deal' as const,
      hubspotObjectId: '999',
      originalFilename: 'compliance-test.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    };

    const testIssue = {
      id: 'issue-1',
      documentId: 'test-doc-compliance',
      type: 'file_too_large',
      severity: 'high' as const,
      message: 'File exceeds size limit',
    };

    beforeAll(() => {
      documentRepository.create(testDoc);
    });

    afterAll(() => {
      documentRepository.delete(testDoc.id);
    });

    it('should create a compliance issue', () => {
      const issue = complianceIssueRepository.create(testIssue);
      
      expect(issue).not.toBeNull();
      expect(issue?.type).toBe('file_too_large');
      expect(issue?.status).toBe('open');
    });

    it('should find issue by id', () => {
      const issue = complianceIssueRepository.findById(testIssue.id);
      
      expect(issue).not.toBeNull();
      expect(issue?.severity).toBe('high');
    });

    it('should find issues by document id', () => {
      const issues = complianceIssueRepository.findByDocumentId(testDoc.id);
      expect(issues.length).toBeGreaterThan(0);
    });

    it('should update issue status', () => {
      const updated = complianceIssueRepository.update(testIssue.id, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'test-user',
      });

      expect(updated?.status).toBe('resolved');
      expect(updated?.resolvedBy).toBe('test-user');
    });
  });

  describe('timelineEventRepository', () => {
    it('should create a timeline event', () => {
      const testEvent = {
        id: 'event-create-' + Date.now(),
        hubspotObjectType: 'deal' as const,
        hubspotObjectId: '555',
        eventType: 'document_uploaded',
        title: 'Document Uploaded',
        body: 'Test document was uploaded',
      };
      const event = timelineEventRepository.create(testEvent);
      
      expect(event).not.toBeNull();
      expect(event?.title).toBe('Document Uploaded');
    });

    it('should find event by id', () => {
      const eventId = 'event-find-' + Date.now();
      const testEvent = {
        id: eventId,
        hubspotObjectType: 'deal' as const,
        hubspotObjectId: '555',
        eventType: 'document_uploaded',
        title: 'Document Uploaded',
        body: 'Test document was uploaded',
      };
      timelineEventRepository.create(testEvent);
      const event = timelineEventRepository.findById(eventId);
      
      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('document_uploaded');
    });

    it('should find events by HubSpot object', () => {
      const uniqueObjectId = 'object-' + Date.now();
      
      // Create first event
      timelineEventRepository.create({
        id: 'event-list-1-' + Date.now(),
        hubspotObjectType: 'deal',
        hubspotObjectId: uniqueObjectId,
        eventType: 'document_uploaded',
        title: 'Document Uploaded',
        body: 'Test document was uploaded',
      });

      // Create second event
      timelineEventRepository.create({
        id: 'event-list-2-' + Date.now(),
        hubspotObjectType: 'deal',
        hubspotObjectId: uniqueObjectId,
        eventType: 'document_synced',
        title: 'Document Synced',
        body: 'Document synced to SharePoint',
      });

      const events = timelineEventRepository.findByHubSpotObject('deal', uniqueObjectId);
      
      expect(events.length).toBe(2);
    });
  });
});
