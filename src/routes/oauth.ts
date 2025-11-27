import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { hubspotOAuthService } from '../services/hubspot-oauth';
import { microsoftOAuthService } from '../services/microsoft-oauth';
import { authSessionRepository } from '../services/database';

const router = Router();

/**
 * GET /oauth/hubspot
 * Initiate HubSpot OAuth flow
 */
router.get('/hubspot', (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || uuidv4();
  const state = JSON.stringify({ sessionId });
  const authUrl = hubspotOAuthService.getAuthorizationUrl(state);
  res.redirect(authUrl);
});

/**
 * GET /oauth/hubspot/callback
 * Handle HubSpot OAuth callback
 */
router.get('/hubspot/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code) {
    res.status(400).json({ error: 'No authorization code provided' });
    return;
  }

  try {
    const stateData = state ? JSON.parse(state as string) : {};
    const sessionId = stateData.sessionId || uuidv4();

    const tokens = await hubspotOAuthService.exchangeCodeForTokens(code as string);
    await hubspotOAuthService.storeTokens(sessionId, tokens);

    // Return success page with session info
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>HubSpot Connected</title>
        <style>
          body { font-family: sans-serif; padding: 40px; text-align: center; }
          .success { color: #00a4bd; font-size: 24px; }
          .info { margin: 20px 0; color: #516f90; }
          code { background: #f5f8fa; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1 class="success">✓ HubSpot Connected Successfully</h1>
        <p class="info">Your HubSpot account has been connected.</p>
        <p>Portal ID: <code>${tokens.portalId}</code></p>
        <p>Session ID: <code>${sessionId}</code></p>
        <p class="info">You can close this window and continue setting up Microsoft/SharePoint integration.</p>
        <p><a href="/oauth/microsoft?sessionId=${sessionId}">Connect Microsoft/SharePoint →</a></p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('HubSpot OAuth error:', error);
    res.status(500).json({ error: 'Failed to complete HubSpot authentication' });
  }
});

/**
 * GET /oauth/microsoft
 * Initiate Microsoft OAuth flow
 */
router.get('/microsoft', async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || uuidv4();
  const state = JSON.stringify({ sessionId });
  
  try {
    const authUrl = await microsoftOAuthService.getAuthorizationUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Microsoft OAuth initialization error:', error);
    res.status(500).json({ error: 'Failed to initialize Microsoft authentication' });
  }
});

/**
 * GET /oauth/microsoft/callback
 * Handle Microsoft OAuth callback
 */
router.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code) {
    res.status(400).json({ error: 'No authorization code provided' });
    return;
  }

  try {
    const stateData = state ? JSON.parse(state as string) : {};
    const sessionId = stateData.sessionId || uuidv4();

    const tokens = await microsoftOAuthService.exchangeCodeForTokens(code as string);
    await microsoftOAuthService.storeTokens(sessionId, tokens);

    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Microsoft Connected</title>
        <style>
          body { font-family: sans-serif; padding: 40px; text-align: center; }
          .success { color: #0078d4; font-size: 24px; }
          .info { margin: 20px 0; color: #323130; }
          code { background: #f3f2f1; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1 class="success">✓ Microsoft Connected Successfully</h1>
        <p class="info">Your Microsoft/SharePoint account has been connected.</p>
        <p>Session ID: <code>${sessionId}</code></p>
        <p class="info">You can close this window. Document Governance is now fully configured.</p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Microsoft OAuth error:', error);
    res.status(500).json({ error: 'Failed to complete Microsoft authentication' });
  }
});

/**
 * GET /oauth/status
 * Check OAuth connection status
 */
router.get('/status', (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: 'Session ID required' });
    return;
  }

  const session = authSessionRepository.findById(sessionId);

  if (!session) {
    res.json({
      hubspot: { connected: false },
      microsoft: { connected: false },
    });
    return;
  }

  const hubspotExpiry = session.hubspot_expires_at ? new Date(session.hubspot_expires_at as string) : null;
  const microsoftExpiry = session.microsoft_expires_at ? new Date(session.microsoft_expires_at as string) : null;

  res.json({
    hubspot: {
      connected: !!session.hubspot_access_token,
      portalId: session.hubspot_portal_id,
      expiresAt: hubspotExpiry,
      isExpired: hubspotExpiry ? hubspotExpiry < new Date() : false,
    },
    microsoft: {
      connected: !!session.microsoft_access_token,
      tenantId: session.microsoft_tenant_id,
      expiresAt: microsoftExpiry,
      isExpired: microsoftExpiry ? microsoftExpiry < new Date() : false,
    },
  });
});

/**
 * POST /oauth/disconnect
 * Disconnect an OAuth integration
 */
router.post('/disconnect', (req: Request, res: Response) => {
  const { sessionId, provider } = req.body;

  if (!sessionId) {
    res.status(400).json({ error: 'Session ID required' });
    return;
  }

  if (provider === 'hubspot') {
    authSessionRepository.update(sessionId, {
      hubspotAccessToken: null,
      hubspotRefreshToken: null,
      hubspotExpiresAt: null,
      hubspotPortalId: null,
    });
  } else if (provider === 'microsoft') {
    authSessionRepository.update(sessionId, {
      microsoftAccessToken: null,
      microsoftRefreshToken: null,
      microsoftExpiresAt: null,
      microsoftTenantId: null,
      microsoftUserId: null,
    });
  } else {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  res.json({ success: true, message: `${provider} disconnected` });
});

export default router;
