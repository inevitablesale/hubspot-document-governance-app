import { complianceService } from '../../src/services/compliance';
import { config } from '../../src/config';

describe('ComplianceService', () => {
  describe('checkDocument', () => {
    it('should pass compliance check for valid document', async () => {
      const result = await complianceService.checkDocument(
        'test-document.pdf',
        1024 * 1024, // 1MB
        {
          category: 'contracts',
          confidentiality: 'internal',
        }
      );

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.issues.length).toBe(0);
    });

    it('should flag file that exceeds size limit', async () => {
      const maxSize = config.compliance.maxFileSizeMB * 1024 * 1024;
      const result = await complianceService.checkDocument(
        'large-file.pdf',
        maxSize + 1024 * 1024, // 1MB over limit
        {}
      );

      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(i => i.type === 'file_too_large')).toBe(true);
    });

    it('should flag disallowed file types', async () => {
      const result = await complianceService.checkDocument(
        'script.exe',
        1024,
        {}
      );

      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.type === 'disallowed_file_type')).toBe(true);
      expect(result.issues.find(i => i.type === 'disallowed_file_type')?.severity).toBe('critical');
    });

    it('should flag missing metadata', async () => {
      const result = await complianceService.checkDocument(
        'document.pdf',
        1024,
        undefined
      );

      expect(result.issues.some(i => i.type === 'missing_metadata')).toBe(true);
    });

    it('should flag missing category', async () => {
      const result = await complianceService.checkDocument(
        'document.pdf',
        1024,
        { confidentiality: 'internal' }
      );

      expect(result.issues.some(i => 
        i.type === 'missing_metadata' && i.details?.missingField === 'category'
      )).toBe(true);
    });

    it('should flag missing confidentiality', async () => {
      const result = await complianceService.checkDocument(
        'document.pdf',
        1024,
        { category: 'contracts' }
      );

      expect(result.issues.some(i => 
        i.type === 'missing_metadata' && i.details?.missingField === 'confidentiality'
      )).toBe(true);
    });

    it('should allow all configured file types', async () => {
      const allowedTypes = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];

      for (const ext of allowedTypes) {
        const result = await complianceService.checkDocument(
          `test.${ext}`,
          1024,
          { category: 'test', confidentiality: 'internal' }
        );

        expect(result.issues.some(i => i.type === 'disallowed_file_type')).toBe(false);
      }
    });
  });

  describe('checkLinkExpiry', () => {
    it('should return null for valid link', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const result = complianceService.checkLinkExpiry(futureDate);
      expect(result).toBeNull();
    });

    it('should flag expired link', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const result = complianceService.checkLinkExpiry(pastDate);
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('link_expired');
      expect(result?.severity).toBe('high');
    });

    it('should warn about link expiring soon', () => {
      const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
      const result = complianceService.checkLinkExpiry(soonDate);
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('link_expired');
      expect(result?.severity).toBe('medium');
    });
  });

  describe('checkRetention via checkDocument', () => {
    it('should flag expired document', async () => {
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const result = await complianceService.checkDocument(
        'document.pdf',
        1024,
        { 
          category: 'contracts',
          confidentiality: 'internal',
          retentionDate: expiredDate
        }
      );

      expect(result.issues.some(i => i.type === 'expired_document')).toBe(true);
    });

    it('should warn about document expiring soon', async () => {
      const soonDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
      const result = await complianceService.checkDocument(
        'document.pdf',
        1024,
        {
          category: 'contracts',
          confidentiality: 'internal',
          retentionDate: soonDate
        }
      );

      expect(result.issues.some(i => i.type === 'retention_policy_violation')).toBe(true);
    });
  });
});
