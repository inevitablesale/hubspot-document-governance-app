import { Client } from '@hubspot/api-client';
import { v4 as uuidv4 } from 'uuid';
import { documentRepository } from './database';
import { hubspotOAuthService } from './hubspot-oauth';
import axios from 'axios';

export interface HubSpotFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
}

export class HubSpotFileService {
  /**
   * Get files associated with a CRM object
   */
  async getObjectFiles(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string
  ): Promise<HubSpotFile[]> {
    const client = hubspotOAuthService.getClient(accessToken);
    
    try {
      // Get engagement attachments associated with the object
      const engagements = await client.crm.objects.basicApi.getById(
        objectType === 'deal' ? 'deals' : 'contacts',
        objectId,
        ['hs_object_id'],
        undefined,
        ['engagements']
      );

      const files: HubSpotFile[] = [];

      // Get associated engagement attachments
      if (engagements.associations?.engagements?.results) {
        for (const engagement of engagements.associations.engagements.results) {
          const engagementFiles = await this.getEngagementAttachments(accessToken, engagement.id);
          files.push(...engagementFiles);
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  /**
   * Get attachments from an engagement
   */
  private async getEngagementAttachments(
    accessToken: string,
    engagementId: string
  ): Promise<HubSpotFile[]> {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/${engagementId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const attachments = response.data.attachments || [];
      return attachments.map((att: { id: string; name?: string; size?: number; type?: string }) => ({
        id: att.id,
        name: att.name || 'Unknown',
        size: att.size || 0,
        type: att.type || 'application/octet-stream',
        url: `https://api.hubapi.com/files/v3/files/${att.id}/signed-url`,
        createdAt: response.data.engagement?.createdAt?.toString() || new Date().toISOString(),
        updatedAt: response.data.engagement?.lastUpdated?.toString() || new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Download a file from HubSpot
   */
  async downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    // First, get the signed URL
    const signedUrlResponse = await axios.get(
      `https://api.hubapi.com/files/v3/files/${fileId}/signed-url`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const signedUrl = signedUrlResponse.data.url;
    const filename = signedUrlResponse.data.name || 'document';

    // Download the file
    const fileResponse = await axios.get(signedUrl, {
      responseType: 'arraybuffer',
    });

    return {
      buffer: Buffer.from(fileResponse.data),
      filename,
      mimeType: fileResponse.headers['content-type'] || 'application/octet-stream',
    };
  }

  /**
   * Upload a file to HubSpot
   */
  async uploadFile(
    accessToken: string,
    content: Buffer,
    filename: string,
    folderId?: string
  ): Promise<HubSpotFile> {
    const formData = new FormData();
    const blob = new Blob([content]);
    formData.append('file', blob, filename);
    formData.append('options', JSON.stringify({
      access: 'PRIVATE',
      ttl: 'P3M', // 3 months
      overwrite: false,
      duplicateValidationStrategy: 'NONE',
      duplicateValidationScope: 'ENTIRE_PORTAL',
    }));

    if (folderId) {
      formData.append('folderId', folderId);
    }

    const response = await axios.post(
      'https://api.hubapi.com/files/v3/files',
      formData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return {
      id: response.data.id,
      name: response.data.name,
      size: response.data.size,
      type: response.data.type,
      url: response.data.url,
      createdAt: response.data.createdAt,
      updatedAt: response.data.updatedAt,
    };
  }

  /**
   * Update a note/engagement attachment with a link instead of file
   */
  async replaceAttachmentWithLink(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    originalFilename: string,
    secureLink: string
  ): Promise<void> {
    // Create a note with the secure link
    const noteContent = `📎 Document: ${originalFilename}\n🔗 Secure Link: ${secureLink}\n\n(This document is stored in SharePoint for version control and compliance tracking)`;

    await axios.post(
      'https://api.hubapi.com/crm/v3/objects/notes',
      {
        properties: {
          hs_note_body: noteContent,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [
          {
            to: { id: objectId },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: objectType === 'deal' ? 214 : 202, // Note to Deal: 214, Note to Contact: 202
              },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Create a document record from a HubSpot file
   */
  async createDocumentFromFile(
    accessToken: string,
    file: HubSpotFile,
    objectType: 'deal' | 'contact',
    objectId: string
  ): Promise<{ id: string; document: ReturnType<typeof documentRepository.findById> }> {
    const docId = uuidv4();

    const document = documentRepository.create({
      id: docId,
      hubspotObjectType: objectType,
      hubspotObjectId: objectId,
      hubspotFileId: file.id,
      originalFilename: file.name,
      mimeType: file.type,
      size: file.size,
    });

    return { id: docId, document };
  }
}

export const hubspotFileService = new HubSpotFileService();
