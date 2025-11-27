import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      hubspotPortalId?: string;
      hubspotUserId?: string;
      hubspotAccessToken?: string;
      microsoftAccessToken?: string;
      isHubSpotWebhook?: boolean;
    }
  }
}

export interface HubSpotTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  portalId: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tenantId: string;
  userId?: string;
}

export interface AuthSession {
  id: string;
  hubspotTokens?: HubSpotTokens;
  microsoftTokens?: MicrosoftTokens;
  createdAt: Date;
  updatedAt: Date;
}
