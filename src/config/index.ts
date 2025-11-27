import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
  },

  hubspot: {
    clientId: process.env.HUBSPOT_CLIENT_ID || '',
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
    redirectUri: process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/oauth/hubspot/callback',
    scopes: (process.env.HUBSPOT_SCOPES || 'crm.objects.contacts.read,crm.objects.deals.read,files').split(','),
  },

  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/oauth/microsoft/callback',
    sharepointSiteId: process.env.SHAREPOINT_SITE_ID || '',
    sharepointDriveId: process.env.SHAREPOINT_DRIVE_ID || '',
  },

  database: {
    path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'governance.db'),
  },

  security: {
    sessionSecret: process.env.SESSION_SECRET || 'default-session-secret',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!',
  },

  compliance: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
    allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv').split(','),
    documentRetentionDays: parseInt(process.env.DOCUMENT_RETENTION_DAYS || '365', 10),
    complianceCheckIntervalHours: parseInt(process.env.COMPLIANCE_CHECK_INTERVAL_HOURS || '24', 10),
  },
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (config.server.isProduction) {
    if (!config.hubspot.clientId) errors.push('HUBSPOT_CLIENT_ID is required');
    if (!config.hubspot.clientSecret) errors.push('HUBSPOT_CLIENT_SECRET is required');
    if (!config.microsoft.clientId) errors.push('MICROSOFT_CLIENT_ID is required');
    if (!config.microsoft.clientSecret) errors.push('MICROSOFT_CLIENT_SECRET is required');
    if (config.security.sessionSecret === 'default-session-secret') {
      errors.push('SESSION_SECRET must be set in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
