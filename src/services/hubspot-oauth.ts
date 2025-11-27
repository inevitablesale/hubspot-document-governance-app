import { Client } from '@hubspot/api-client';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { authSessionRepository } from './database';
import { HubSpotTokens } from '../types/auth';

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

export class HubSpotOAuthService {
  private client: Client;

  constructor() {
    this.client = new Client();
  }

  /**
   * Generate the OAuth authorization URL for HubSpot
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: config.hubspot.clientId,
      redirect_uri: config.hubspot.redirectUri,
      scope: config.hubspot.scopes.join(' '),
      state: state || uuidv4(),
    });

    return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<HubSpotTokens> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      redirect_uri: config.hubspot.redirectUri,
      code,
    });

    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for tokens: ${error}`);
    }

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    
    // Get the portal ID (hub ID) from access token info
    const tokenInfo = await this.getAccessTokenInfo(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      portalId: tokenInfo.hub_id?.toString() || '',
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<HubSpotTokens> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    const tokenInfo = await this.getAccessTokenInfo(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      portalId: tokenInfo.hub_id?.toString() || '',
    };
  }

  /**
   * Get access token information including hub_id
   */
  private async getAccessTokenInfo(accessToken: string): Promise<{ hub_id?: number; user_id?: number }> {
    const response = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`);
    
    if (!response.ok) {
      return {};
    }

    return response.json() as Promise<{ hub_id?: number; user_id?: number }>;
  }

  /**
   * Get a configured HubSpot client with the given access token
   */
  getClient(accessToken: string): Client {
    this.client.setAccessToken(accessToken);
    return this.client;
  }

  /**
   * Store tokens in database
   */
  async storeTokens(sessionId: string, tokens: HubSpotTokens): Promise<void> {
    const existing = authSessionRepository.findById(sessionId);
    
    if (existing) {
      authSessionRepository.update(sessionId, {
        hubspotAccessToken: tokens.accessToken,
        hubspotRefreshToken: tokens.refreshToken,
        hubspotExpiresAt: tokens.expiresAt.toISOString(),
        hubspotPortalId: tokens.portalId,
      });
    } else {
      authSessionRepository.create({
        id: sessionId,
        hubspotAccessToken: tokens.accessToken,
        hubspotRefreshToken: tokens.refreshToken,
        hubspotExpiresAt: tokens.expiresAt.toISOString(),
        hubspotPortalId: tokens.portalId,
      });
    }
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidAccessToken(sessionId: string): Promise<string | null> {
    const session = authSessionRepository.findById(sessionId);
    
    if (!session || !session.hubspot_access_token) {
      return null;
    }

    const expiresAt = new Date(session.hubspot_expires_at as string);
    
    // If token expires in less than 5 minutes, refresh it
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      try {
        const newTokens = await this.refreshAccessToken(session.hubspot_refresh_token as string);
        await this.storeTokens(sessionId, newTokens);
        return newTokens.accessToken;
      } catch {
        return null;
      }
    }

    return session.hubspot_access_token as string;
  }
}

export const hubspotOAuthService = new HubSpotOAuthService();
