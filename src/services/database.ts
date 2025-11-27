import Database from 'better-sqlite3';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure the directory exists
    const dbDir = path.dirname(config.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(config.database.path);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
    -- Auth Sessions
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      hubspot_access_token TEXT,
      hubspot_refresh_token TEXT,
      hubspot_expires_at TEXT,
      hubspot_portal_id TEXT,
      microsoft_access_token TEXT,
      microsoft_refresh_token TEXT,
      microsoft_expires_at TEXT,
      microsoft_tenant_id TEXT,
      microsoft_user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Documents
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      hubspot_object_type TEXT NOT NULL,
      hubspot_object_id TEXT NOT NULL,
      hubspot_file_id TEXT,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sharepoint_file_id TEXT,
      sharepoint_drive_item_id TEXT,
      sharepoint_web_url TEXT,
      secure_link TEXT,
      secure_link_expiry TEXT,
      current_version_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending_upload',
      compliance_score INTEGER DEFAULT 100,
      metadata TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_hubspot ON documents(hubspot_object_type, hubspot_object_id);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

    -- Document Versions
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      sharepoint_version_id TEXT,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      changed_by TEXT,
      change_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);

    -- Compliance Issues
    CREATE TABLE IF NOT EXISTS compliance_issues (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at TEXT,
      resolved_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_issues_document ON compliance_issues(document_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON compliance_issues(status);

    -- Timeline Events
    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      hubspot_object_type TEXT NOT NULL,
      hubspot_object_id TEXT NOT NULL,
      document_id TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hubspot_timeline_event_id TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_timeline_hubspot ON timeline_events(hubspot_object_type, hubspot_object_id);

    -- Governance Policies
    CREATE TABLE IF NOT EXISTS governance_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      rules TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Repository functions for Documents
export const documentRepository = {
  create(doc: {
    id: string;
    hubspotObjectType: string;
    hubspotObjectId: string;
    hubspotFileId?: string;
    originalFilename: string;
    mimeType: string;
    size: number;
    createdBy?: string;
    metadata?: Record<string, unknown>;
  }) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO documents (id, hubspot_object_type, hubspot_object_id, hubspot_file_id, 
        original_filename, mime_type, size, created_by, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      doc.id,
      doc.hubspotObjectType,
      doc.hubspotObjectId,
      doc.hubspotFileId || null,
      doc.originalFilename,
      doc.mimeType,
      doc.size,
      doc.createdBy || null,
      doc.metadata ? JSON.stringify(doc.metadata) : null
    );
    return this.findById(doc.id);
  },

  findById(id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapRowToDocument(row) : null;
  },

  findByHubSpotObject(objectType: string, objectId: string) {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM documents WHERE hubspot_object_type = ? AND hubspot_object_id = ? ORDER BY created_at DESC'
    ).all(objectType, objectId) as Record<string, unknown>[];
    return rows.map(mapRowToDocument);
  },

  update(id: string, updates: Partial<{
    sharepointFileId: string;
    sharepointDriveItemId: string;
    sharepointWebUrl: string;
    secureLink: string;
    secureLinkExpiry: string;
    currentVersionId: string;
    status: string;
    complianceScore: number;
    metadata: Record<string, unknown>;
  }>) {
    const db = getDatabase();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.sharepointFileId !== undefined) {
      setClauses.push('sharepoint_file_id = ?');
      values.push(updates.sharepointFileId);
    }
    if (updates.sharepointDriveItemId !== undefined) {
      setClauses.push('sharepoint_drive_item_id = ?');
      values.push(updates.sharepointDriveItemId);
    }
    if (updates.sharepointWebUrl !== undefined) {
      setClauses.push('sharepoint_web_url = ?');
      values.push(updates.sharepointWebUrl);
    }
    if (updates.secureLink !== undefined) {
      setClauses.push('secure_link = ?');
      values.push(updates.secureLink);
    }
    if (updates.secureLinkExpiry !== undefined) {
      setClauses.push('secure_link_expiry = ?');
      values.push(updates.secureLinkExpiry);
    }
    if (updates.currentVersionId !== undefined) {
      setClauses.push('current_version_id = ?');
      values.push(updates.currentVersionId);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.complianceScore !== undefined) {
      setClauses.push('compliance_score = ?');
      values.push(updates.complianceScore);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE documents SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return this.findById(id);
  },

  delete(id: string) {
    const db = getDatabase();
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  },

  getStats(objectType: string, objectId: string) {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT 
        COUNT(*) as total_documents,
        COALESCE(SUM(size), 0) as total_size,
        COALESCE(AVG(compliance_score), 100) as avg_compliance_score,
        MAX(updated_at) as last_activity
      FROM documents 
      WHERE hubspot_object_type = ? AND hubspot_object_id = ?
    `).get(objectType, objectId) as Record<string, unknown>;

    const issueCount = db.prepare(`
      SELECT COUNT(*) as count FROM compliance_issues ci
      JOIN documents d ON ci.document_id = d.id
      WHERE d.hubspot_object_type = ? AND d.hubspot_object_id = ? AND ci.status = 'open'
    `).get(objectType, objectId) as { count: number };

    return {
      totalDocuments: row.total_documents as number,
      totalSize: row.total_size as number,
      averageComplianceScore: Math.round(row.avg_compliance_score as number),
      issueCount: issueCount.count,
      lastActivity: row.last_activity as string | null,
    };
  }
};

// Repository functions for Document Versions
export const versionRepository = {
  create(version: {
    id: string;
    documentId: string;
    versionNumber: number;
    sharepointVersionId?: string;
    filename: string;
    size: number;
    checksum: string;
    changedBy?: string;
    changeNotes?: string;
  }) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO document_versions (id, document_id, version_number, sharepoint_version_id, 
        filename, size, checksum, changed_by, change_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      version.id,
      version.documentId,
      version.versionNumber,
      version.sharepointVersionId || null,
      version.filename,
      version.size,
      version.checksum,
      version.changedBy || null,
      version.changeNotes || null
    );
    return this.findById(version.id);
  },

  findById(id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapRowToVersion(row) : null;
  },

  findByDocumentId(documentId: string) {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC'
    ).all(documentId) as Record<string, unknown>[];
    return rows.map(mapRowToVersion);
  },

  getLatestVersion(documentId: string) {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC LIMIT 1'
    ).get(documentId) as Record<string, unknown> | undefined;
    return row ? mapRowToVersion(row) : null;
  },

  getVersionCount(documentId: string): number {
    const db = getDatabase();
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM document_versions WHERE document_id = ?'
    ).get(documentId) as { count: number };
    return result.count;
  }
};

// Repository functions for Compliance Issues
export const complianceIssueRepository = {
  create(issue: {
    id: string;
    documentId: string;
    type: string;
    severity: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO compliance_issues (id, document_id, type, severity, message, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      issue.id,
      issue.documentId,
      issue.type,
      issue.severity,
      issue.message,
      issue.details ? JSON.stringify(issue.details) : null
    );
    return this.findById(issue.id);
  },

  findById(id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM compliance_issues WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapRowToComplianceIssue(row) : null;
  },

  findByDocumentId(documentId: string) {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM compliance_issues WHERE document_id = ? ORDER BY created_at DESC'
    ).all(documentId) as Record<string, unknown>[];
    return rows.map(mapRowToComplianceIssue);
  },

  findOpenByHubSpotObject(objectType: string, objectId: string, limit = 10) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT ci.*, d.original_filename as document_filename FROM compliance_issues ci
      JOIN documents d ON ci.document_id = d.id
      WHERE d.hubspot_object_type = ? AND d.hubspot_object_id = ? AND ci.status = 'open'
      ORDER BY 
        CASE ci.severity 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END,
        ci.created_at DESC
      LIMIT ?
    `).all(objectType, objectId, limit) as Record<string, unknown>[];
    return rows.map(row => ({
      ...mapRowToComplianceIssue(row),
      documentFilename: row.document_filename as string,
    }));
  },

  update(id: string, updates: { status?: string; resolvedAt?: string; resolvedBy?: string }) {
    const db = getDatabase();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.resolvedAt !== undefined) {
      setClauses.push('resolved_at = ?');
      values.push(updates.resolvedAt);
    }
    if (updates.resolvedBy !== undefined) {
      setClauses.push('resolved_by = ?');
      values.push(updates.resolvedBy);
    }

    if (setClauses.length === 0) return this.findById(id);
    values.push(id);

    const stmt = db.prepare(`UPDATE compliance_issues SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return this.findById(id);
  }
};

// Repository functions for Timeline Events
export const timelineEventRepository = {
  create(event: {
    id: string;
    hubspotObjectType: string;
    hubspotObjectId: string;
    documentId?: string;
    eventType: string;
    title: string;
    body: string;
    hubspotTimelineEventId?: string;
  }) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO timeline_events (id, hubspot_object_type, hubspot_object_id, document_id, 
        event_type, title, body, hubspot_timeline_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.hubspotObjectType,
      event.hubspotObjectId,
      event.documentId || null,
      event.eventType,
      event.title,
      event.body,
      event.hubspotTimelineEventId || null
    );
    return this.findById(event.id);
  },

  findById(id: string) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapRowToTimelineEvent(row) : null;
  },

  findByHubSpotObject(objectType: string, objectId: string, limit = 50) {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM timeline_events WHERE hubspot_object_type = ? AND hubspot_object_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(objectType, objectId, limit) as Record<string, unknown>[];
    return rows.map(mapRowToTimelineEvent);
  },

  update(id: string, updates: { hubspotTimelineEventId?: string }) {
    const db = getDatabase();
    if (updates.hubspotTimelineEventId !== undefined) {
      db.prepare('UPDATE timeline_events SET hubspot_timeline_event_id = ? WHERE id = ?')
        .run(updates.hubspotTimelineEventId, id);
    }
    return this.findById(id);
  }
};

// Repository functions for Auth Sessions
export const authSessionRepository = {
  create(session: {
    id: string;
    hubspotAccessToken?: string;
    hubspotRefreshToken?: string;
    hubspotExpiresAt?: string;
    hubspotPortalId?: string;
    microsoftAccessToken?: string;
    microsoftRefreshToken?: string;
    microsoftExpiresAt?: string;
    microsoftTenantId?: string;
    microsoftUserId?: string;
  }) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO auth_sessions (id, hubspot_access_token, hubspot_refresh_token, hubspot_expires_at,
        hubspot_portal_id, microsoft_access_token, microsoft_refresh_token, microsoft_expires_at,
        microsoft_tenant_id, microsoft_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.hubspotAccessToken || null,
      session.hubspotRefreshToken || null,
      session.hubspotExpiresAt || null,
      session.hubspotPortalId || null,
      session.microsoftAccessToken || null,
      session.microsoftRefreshToken || null,
      session.microsoftExpiresAt || null,
      session.microsoftTenantId || null,
      session.microsoftUserId || null
    );
    return this.findById(session.id);
  },

  findById(id: string) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  },

  findByPortalId(portalId: string) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM auth_sessions WHERE hubspot_portal_id = ?').get(portalId) as Record<string, unknown> | undefined;
  },

  update(id: string, updates: Record<string, unknown>) {
    const db = getDatabase();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    const fieldMap: Record<string, string> = {
      hubspotAccessToken: 'hubspot_access_token',
      hubspotRefreshToken: 'hubspot_refresh_token',
      hubspotExpiresAt: 'hubspot_expires_at',
      hubspotPortalId: 'hubspot_portal_id',
      microsoftAccessToken: 'microsoft_access_token',
      microsoftRefreshToken: 'microsoft_refresh_token',
      microsoftExpiresAt: 'microsoft_expires_at',
      microsoftTenantId: 'microsoft_tenant_id',
      microsoftUserId: 'microsoft_user_id',
    };

    for (const [key, value] of Object.entries(updates)) {
      const dbField = fieldMap[key];
      if (dbField) {
        setClauses.push(`${dbField} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE auth_sessions SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return this.findById(id);
  },

  delete(id: string) {
    const db = getDatabase();
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(id);
  }
};

// Helper functions to map database rows to typed objects
function mapRowToDocument(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    hubspotObjectType: row.hubspot_object_type as 'deal' | 'contact',
    hubspotObjectId: row.hubspot_object_id as string,
    hubspotFileId: row.hubspot_file_id as string | undefined,
    originalFilename: row.original_filename as string,
    mimeType: row.mime_type as string,
    size: row.size as number,
    sharepointFileId: row.sharepoint_file_id as string | undefined,
    sharepointDriveItemId: row.sharepoint_drive_item_id as string | undefined,
    sharepointWebUrl: row.sharepoint_web_url as string | undefined,
    secureLink: row.secure_link as string | undefined,
    secureLinkExpiry: row.secure_link_expiry ? new Date(row.secure_link_expiry as string) : undefined,
    currentVersionId: row.current_version_id as string,
    status: row.status as string,
    complianceScore: row.compliance_score as number,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    createdBy: row.created_by as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapRowToVersion(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    versionNumber: row.version_number as number,
    sharepointVersionId: row.sharepoint_version_id as string | undefined,
    filename: row.filename as string,
    size: row.size as number,
    checksum: row.checksum as string,
    changedBy: row.changed_by as string | undefined,
    changeNotes: row.change_notes as string | undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function mapRowToComplianceIssue(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    type: row.type as string,
    severity: row.severity as string,
    message: row.message as string,
    details: row.details ? JSON.parse(row.details as string) : undefined,
    status: row.status as string,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : undefined,
    resolvedBy: row.resolved_by as string | undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function mapRowToTimelineEvent(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    hubspotObjectType: row.hubspot_object_type as 'deal' | 'contact',
    hubspotObjectId: row.hubspot_object_id as string,
    documentId: row.document_id as string | undefined,
    eventType: row.event_type as string,
    title: row.title as string,
    body: row.body as string,
    hubspotTimelineEventId: row.hubspot_timeline_event_id as string | undefined,
    timestamp: new Date(row.timestamp as string),
  };
}
