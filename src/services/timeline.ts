import { v4 as uuidv4 } from 'uuid';
import { timelineEventRepository } from './database';
import { TimelineEventType } from '../types';
import axios from 'axios';

export interface CreateTimelineEventOptions {
  accessToken: string;
  objectType: 'deal' | 'contact';
  objectId: string;
  documentId?: string;
  eventType: TimelineEventType;
  title: string;
  body: string;
}

export class TimelineService {
  /**
   * Create a timeline event for a CRM object
   */
  async createEvent(options: CreateTimelineEventOptions): Promise<string> {
    const eventId = uuidv4();

    // Store in local database
    timelineEventRepository.create({
      id: eventId,
      hubspotObjectType: options.objectType,
      hubspotObjectId: options.objectId,
      documentId: options.documentId,
      eventType: options.eventType,
      title: options.title,
      body: options.body,
    });

    // Create a note in HubSpot to represent the timeline event
    try {
      const noteBody = `📋 ${options.title}\n\n${options.body}\n\n---\nDocument Governance Event`;

      const response = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/notes',
        {
          properties: {
            hs_note_body: noteBody,
            hs_timestamp: new Date().toISOString(),
          },
          associations: [
            {
              to: { id: options.objectId },
              types: [
                {
                  associationCategory: 'HUBSPOT_DEFINED',
                  associationTypeId: options.objectType === 'deal' ? 214 : 202,
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Update with HubSpot ID
      timelineEventRepository.create({
        id: eventId,
        hubspotObjectType: options.objectType,
        hubspotObjectId: options.objectId,
        documentId: options.documentId,
        eventType: options.eventType,
        title: options.title,
        body: options.body,
        hubspotTimelineEventId: response.data.id,
      });
    } catch {
      // If HubSpot API fails, we still have the local record
      console.error('Failed to create HubSpot timeline event, but local record created');
    }

    return eventId;
  }

  /**
   * Log document upload event
   */
  async logDocumentUploaded(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string
  ): Promise<string> {
    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'document_uploaded',
      title: 'Document Uploaded',
      body: `Document "${filename}" has been uploaded and is being processed for SharePoint sync.`,
    });
  }

  /**
   * Log document synced event
   */
  async logDocumentSynced(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string,
    sharepointUrl: string
  ): Promise<string> {
    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'document_synced',
      title: 'Document Synced to SharePoint',
      body: `Document "${filename}" has been synced to SharePoint.\n\n🔗 View in SharePoint: ${sharepointUrl}`,
    });
  }

  /**
   * Log new version event
   */
  async logVersionCreated(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string,
    versionNumber: number
  ): Promise<string> {
    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'document_version_created',
      title: 'New Document Version',
      body: `Version ${versionNumber} of "${filename}" has been created.`,
    });
  }

  /**
   * Log compliance issue detected
   */
  async logComplianceIssue(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string,
    issueType: string,
    severity: string,
    message: string
  ): Promise<string> {
    const severityEmoji = {
      low: 'ℹ️',
      medium: '⚠️',
      high: '🔶',
      critical: '🔴',
    }[severity] || '⚠️';

    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'compliance_issue_detected',
      title: `${severityEmoji} Compliance Issue Detected`,
      body: `A ${severity} compliance issue was detected for "${filename}".\n\nIssue: ${issueType}\n${message}`,
    });
  }

  /**
   * Log compliance issue resolved
   */
  async logComplianceResolved(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string,
    issueType: string
  ): Promise<string> {
    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'compliance_issue_resolved',
      title: '✅ Compliance Issue Resolved',
      body: `The compliance issue (${issueType}) for "${filename}" has been resolved.`,
    });
  }

  /**
   * Log link refreshed event
   */
  async logLinkRefreshed(
    accessToken: string,
    objectType: 'deal' | 'contact',
    objectId: string,
    documentId: string,
    filename: string,
    newExpiry: Date
  ): Promise<string> {
    return this.createEvent({
      accessToken,
      objectType,
      objectId,
      documentId,
      eventType: 'link_refreshed',
      title: 'Secure Link Refreshed',
      body: `The secure sharing link for "${filename}" has been refreshed.\n\nNew expiry: ${newExpiry.toLocaleDateString()}`,
    });
  }

  /**
   * Get timeline events for an object
   */
  getObjectEvents(objectType: 'deal' | 'contact', objectId: string, limit = 50) {
    return timelineEventRepository.findByHubSpotObject(objectType, objectId, limit);
  }
}

export const timelineService = new TimelineService();
