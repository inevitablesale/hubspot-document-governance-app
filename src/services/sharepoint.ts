import { Client } from '@microsoft/microsoft-graph-client';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { documentRepository, versionRepository } from './database';
import crypto from 'crypto';

export interface UploadResult {
  sharepointFileId: string;
  sharepointDriveItemId: string;
  webUrl: string;
  versionId?: string;
}

export interface SharePointFile {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  file?: {
    mimeType: string;
    hashes?: {
      sha256Hash?: string;
    };
  };
}

export class SharePointService {
  private getClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  /**
   * Upload a file to SharePoint/OneDrive
   */
  async uploadFile(
    accessToken: string,
    fileContent: Buffer,
    filename: string,
    folderPath: string = 'Document Governance'
  ): Promise<UploadResult> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;
    const siteId = config.microsoft.sharepointSiteId;

    // Sanitize filename
    const sanitizedFilename = this.sanitizeFilename(filename);
    const fullPath = `${folderPath}/${sanitizedFilename}`;

    let uploadUrl: string;
    
    if (siteId && driveId) {
      // SharePoint site
      uploadUrl = `/sites/${siteId}/drives/${driveId}/root:/${fullPath}:/content`;
    } else if (driveId) {
      // Specific drive (OneDrive for Business)
      uploadUrl = `/drives/${driveId}/root:/${fullPath}:/content`;
    } else {
      // Default user's OneDrive
      uploadUrl = `/me/drive/root:/${fullPath}:/content`;
    }

    // For small files (< 4MB), use simple upload
    if (fileContent.length < 4 * 1024 * 1024) {
      const response = await client
        .api(uploadUrl)
        .put(fileContent);

      return {
        sharepointFileId: response.id,
        sharepointDriveItemId: response.id,
        webUrl: response.webUrl,
      };
    }

    // For larger files, use upload session
    return this.uploadLargeFile(client, fileContent, fullPath, driveId, siteId);
  }

  /**
   * Upload large files using upload session
   */
  private async uploadLargeFile(
    client: Client,
    fileContent: Buffer,
    fullPath: string,
    driveId?: string,
    siteId?: string
  ): Promise<UploadResult> {
    let sessionUrl: string;
    
    if (siteId && driveId) {
      sessionUrl = `/sites/${siteId}/drives/${driveId}/root:/${fullPath}:/createUploadSession`;
    } else if (driveId) {
      sessionUrl = `/drives/${driveId}/root:/${fullPath}:/createUploadSession`;
    } else {
      sessionUrl = `/me/drive/root:/${fullPath}:/createUploadSession`;
    }

    const session = await client.api(sessionUrl).post({
      item: {
        '@microsoft.graph.conflictBehavior': 'rename',
      },
    });

    const uploadUrl = session.uploadUrl;
    const fileSize = fileContent.length;
    const chunkSize = 320 * 1024; // 320 KB chunks
    let response;

    for (let i = 0; i < fileSize; i += chunkSize) {
      const chunk = fileContent.slice(i, Math.min(i + chunkSize, fileSize));
      const contentRange = `bytes ${i}-${Math.min(i + chunkSize - 1, fileSize - 1)}/${fileSize}`;

      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': chunk.length.toString(),
          'Content-Range': contentRange,
        },
        body: chunk,
      });

      if (!response.ok && response.status !== 202) {
        throw new Error(`Upload failed at byte ${i}`);
      }
    }

    const finalResponse = await response!.json() as { id: string; webUrl: string };

    return {
      sharepointFileId: finalResponse.id,
      sharepointDriveItemId: finalResponse.id,
      webUrl: finalResponse.webUrl,
    };
  }

  /**
   * Get file metadata from SharePoint
   */
  async getFileMetadata(accessToken: string, driveItemId: string): Promise<SharePointFile | null> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;

    try {
      let endpoint: string;
      if (driveId) {
        endpoint = `/drives/${driveId}/items/${driveItemId}`;
      } else {
        endpoint = `/me/drive/items/${driveItemId}`;
      }

      return await client.api(endpoint).get();
    } catch {
      return null;
    }
  }

  /**
   * Create a sharing link for a file
   */
  async createSharingLink(
    accessToken: string,
    driveItemId: string,
    type: 'view' | 'edit' = 'view',
    expirationDateTime?: Date
  ): Promise<{ link: string; expiry?: Date }> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;

    let endpoint: string;
    if (driveId) {
      endpoint = `/drives/${driveId}/items/${driveItemId}/createLink`;
    } else {
      endpoint = `/me/drive/items/${driveItemId}/createLink`;
    }

    const linkRequest: Record<string, unknown> = {
      type,
      scope: 'organization', // or 'anonymous' for external sharing
    };

    if (expirationDateTime) {
      linkRequest.expirationDateTime = expirationDateTime.toISOString();
    }

    const response = await client.api(endpoint).post(linkRequest);

    return {
      link: response.link.webUrl,
      expiry: response.expirationDateTime ? new Date(response.expirationDateTime) : undefined,
    };
  }

  /**
   * Get file versions from SharePoint
   */
  async getFileVersions(accessToken: string, driveItemId: string): Promise<Array<{
    id: string;
    versionId: string;
    size: number;
    lastModifiedDateTime: string;
  }>> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;

    let endpoint: string;
    if (driveId) {
      endpoint = `/drives/${driveId}/items/${driveItemId}/versions`;
    } else {
      endpoint = `/me/drive/items/${driveItemId}/versions`;
    }

    try {
      const response = await client.api(endpoint).get();
      return response.value || [];
    } catch {
      return [];
    }
  }

  /**
   * Download file content from SharePoint
   */
  async downloadFile(accessToken: string, driveItemId: string): Promise<Buffer> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;

    let endpoint: string;
    if (driveId) {
      endpoint = `/drives/${driveId}/items/${driveItemId}/content`;
    } else {
      endpoint = `/me/drive/items/${driveItemId}/content`;
    }

    const response = await client.api(endpoint).get();
    return Buffer.from(response);
  }

  /**
   * Delete a file from SharePoint
   */
  async deleteFile(accessToken: string, driveItemId: string): Promise<void> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;

    let endpoint: string;
    if (driveId) {
      endpoint = `/drives/${driveId}/items/${driveItemId}`;
    } else {
      endpoint = `/me/drive/items/${driveItemId}`;
    }

    await client.api(endpoint).delete();
  }

  /**
   * Create folder structure in SharePoint
   */
  async ensureFolder(accessToken: string, folderPath: string): Promise<string> {
    const client = this.getClient(accessToken);
    const driveId = config.microsoft.sharepointDriveId;
    const siteId = config.microsoft.sharepointSiteId;

    const folders = folderPath.split('/').filter(f => f);
    let currentPath = '';
    let lastFolderId = '';

    for (const folder of folders) {
      currentPath = currentPath ? `${currentPath}/${folder}` : folder;

      try {
        let endpoint: string;
        if (siteId && driveId) {
          endpoint = `/sites/${siteId}/drives/${driveId}/root:/${currentPath}`;
        } else if (driveId) {
          endpoint = `/drives/${driveId}/root:/${currentPath}`;
        } else {
          endpoint = `/me/drive/root:/${currentPath}`;
        }

        const existing = await client.api(endpoint).get();
        lastFolderId = existing.id;
      } catch {
        // Folder doesn't exist, create it
        let parentEndpoint: string;
        if (siteId && driveId) {
          parentEndpoint = currentPath.includes('/')
            ? `/sites/${siteId}/drives/${driveId}/root:/${currentPath.substring(0, currentPath.lastIndexOf('/'))}:/children`
            : `/sites/${siteId}/drives/${driveId}/root/children`;
        } else if (driveId) {
          parentEndpoint = currentPath.includes('/')
            ? `/drives/${driveId}/root:/${currentPath.substring(0, currentPath.lastIndexOf('/'))}:/children`
            : `/drives/${driveId}/root/children`;
        } else {
          parentEndpoint = currentPath.includes('/')
            ? `/me/drive/root:/${currentPath.substring(0, currentPath.lastIndexOf('/'))}:/children`
            : `/me/drive/root/children`;
        }

        const newFolder = await client.api(parentEndpoint).post({
          name: folder,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        });
        lastFolderId = newFolder.id;
      }
    }

    return lastFolderId;
  }

  /**
   * Sanitize filename for SharePoint
   */
  private sanitizeFilename(filename: string): string {
    // Remove or replace invalid characters
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 250); // SharePoint has a 400 char limit for full path
  }

  /**
   * Calculate file checksum
   */
  calculateChecksum(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Sync document with SharePoint and create version record
   */
  async syncDocument(
    accessToken: string,
    documentId: string,
    fileContent: Buffer,
    filename: string,
    objectType: 'deal' | 'contact',
    objectId: string
  ): Promise<{ document: ReturnType<typeof documentRepository.findById>; version: ReturnType<typeof versionRepository.findById> }> {
    const doc = documentRepository.findById(documentId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Update status to uploading
    documentRepository.update(documentId, { status: 'uploading' });

    // Create folder structure
    const folderPath = `Document Governance/${objectType}s/${objectId}`;
    await this.ensureFolder(accessToken, folderPath);

    // Upload file
    const uploadResult = await this.uploadFile(accessToken, fileContent, filename, folderPath);

    // Calculate checksum
    const checksum = this.calculateChecksum(fileContent);

    // Get current version count
    const versionCount = versionRepository.getVersionCount(documentId);

    // Create version record
    const versionId = uuidv4();
    const version = versionRepository.create({
      id: versionId,
      documentId,
      versionNumber: versionCount + 1,
      sharepointVersionId: uploadResult.versionId,
      filename,
      size: fileContent.length,
      checksum,
    });

    // Create sharing link (expires in 30 days)
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { link } = await this.createSharingLink(accessToken, uploadResult.sharepointDriveItemId, 'view', expiryDate);

    // Update document
    const updatedDoc = documentRepository.update(documentId, {
      sharepointFileId: uploadResult.sharepointFileId,
      sharepointDriveItemId: uploadResult.sharepointDriveItemId,
      sharepointWebUrl: uploadResult.webUrl,
      secureLink: link,
      secureLinkExpiry: expiryDate.toISOString(),
      currentVersionId: versionId,
      status: 'synced',
    });

    return { document: updatedDoc, version };
  }
}

export const sharepointService = new SharePointService();
