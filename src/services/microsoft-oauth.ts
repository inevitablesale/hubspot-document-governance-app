import { ConfidentialClientApplication, AuthorizationCodeRequest, AuthorizationUrlRequest } from '@azure/msal-node';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { authSessionRepository } from './database';
import { MicrosoftTokens } from '../types/auth';

const SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite.All',
  'https://graph.microsoft.com/Sites.ReadWrite.All',
  'offline_access',
];

export class MicrosoftOAuthService {
  private _msalClient: ConfidentialClientApplication | null = null;

  private get msalClient(): ConfidentialClientApplication {
    if (!this._msalClient) {
      if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
        throw new Error('Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.');
      }
      this._msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: config.microsoft.clientId,
          clientSecret: config.microsoft.clientSecret,
          authority: `https://login.microsoftonline.com/${config.microsoft.tenantId}`,
        },
      });
    }
    return this._msalClient;
  }

  /**
   * Generate the OAuth authorization URL for Microsoft
   */
  async getAuthorizationUrl(state?: string): Promise<string> {
    const authCodeUrlParameters: AuthorizationUrlRequest = {
      scopes: SCOPES,
      redirectUri: config.microsoft.redirectUri,
      state: state || uuidv4(),
    };

    return this.msalClient.getAuthCodeUrl(authCodeUrlParameters);
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<MicrosoftTokens> {
    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: SCOPES,
      redirectUri: config.microsoft.redirectUri,
    };

    const response = await this.msalClient.acquireTokenByCode(tokenRequest);

    if (!response) {
      throw new Error('Failed to acquire token');
    }

    return {
      accessToken: response.accessToken,
      refreshToken: '', // MSAL handles refresh internally via cache
      expiresAt: response.expiresOn || new Date(Date.now() + 3600 * 1000),
      tenantId: response.tenantId || config.microsoft.tenantId,
      userId: response.account?.homeAccountId,
    };
  }

  /**
   * Get access token silently using cached credentials
   */
  async getAccessTokenSilent(accountId: string): Promise<string | null> {
    try {
      const account = await this.msalClient.getTokenCache().getAccountByHomeId(accountId);
      
      if (!account) {
        return null;
      }

      const response = await this.msalClient.acquireTokenSilent({
        scopes: SCOPES,
        account,
      });

      return response?.accessToken || null;
    } catch {
      return null;
    }
  }

  /**
   * Store tokens in database
   */
  async storeTokens(sessionId: string, tokens: MicrosoftTokens): Promise<void> {
    const existing = authSessionRepository.findById(sessionId);
    
    if (existing) {
      authSessionRepository.update(sessionId, {
        microsoftAccessToken: tokens.accessToken,
        microsoftRefreshToken: tokens.refreshToken,
        microsoftExpiresAt: tokens.expiresAt.toISOString(),
        microsoftTenantId: tokens.tenantId,
        microsoftUserId: tokens.userId,
      });
    } else {
      authSessionRepository.create({
        id: sessionId,
        microsoftAccessToken: tokens.accessToken,
        microsoftRefreshToken: tokens.refreshToken,
        microsoftExpiresAt: tokens.expiresAt.toISOString(),
        microsoftTenantId: tokens.tenantId,
        microsoftUserId: tokens.userId,
      });
    }
  }

  /**
   * Get valid access token for the session
   */
  async getValidAccessToken(sessionId: string): Promise<string | null> {
    const session = authSessionRepository.findById(sessionId);
    
    if (!session || !session.microsoft_access_token) {
      return null;
    }

    const expiresAt = new Date(session.microsoft_expires_at as string);
    
    // If token is still valid, return it
    if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
      return session.microsoft_access_token as string;
    }

    // Try to get a new token silently
    if (session.microsoft_user_id) {
      const newToken = await this.getAccessTokenSilent(session.microsoft_user_id as string);
      if (newToken) {
        authSessionRepository.update(sessionId, {
          microsoftAccessToken: newToken,
          microsoftExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        });
        return newToken;
      }
    }

    return null;
  }
}

export const microsoftOAuthService = new MicrosoftOAuthService();
