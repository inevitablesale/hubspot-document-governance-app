import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { hubspotOAuthService } from '../services/hubspot-oauth';
import { microsoftOAuthService } from '../services/microsoft-oauth';

/**
 * Verify HubSpot webhook signature
 */
export function verifyHubSpotWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hubspot-signature-v3'] as string;
  const timestamp = req.headers['x-hubspot-request-timestamp'] as string;

  if (!signature || !timestamp) {
    res.status(401).json({ error: 'Missing webhook signature' });
    return;
  }

  // Check timestamp is within 5 minutes
  const requestTimestamp = parseInt(timestamp, 10);
  const currentTimestamp = Date.now();
  if (Math.abs(currentTimestamp - requestTimestamp) > 5 * 60 * 1000) {
    res.status(401).json({ error: 'Webhook timestamp expired' });
    return;
  }

  // Verify signature
  const requestBody = JSON.stringify(req.body);
  const sourceString = `${req.method}${config.hubspot.redirectUri}${requestBody}${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', config.hubspot.clientSecret)
    .update(sourceString)
    .digest('base64');

  if (signature !== expectedSignature) {
    // For development, allow requests through with a warning
    if (config.server.isDevelopment) {
      console.warn('HubSpot webhook signature mismatch (allowed in development)');
      req.isHubSpotWebhook = true;
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  req.isHubSpotWebhook = true;
  next();
}

/**
 * Authentication middleware for API routes
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.headers['x-session-id'] as string;
  const portalId = req.headers['x-hubspot-portal-id'] as string;

  if (!sessionId && !portalId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.hubspotPortalId = portalId;
  next();
}

/**
 * Middleware to ensure HubSpot tokens are available
 */
export async function ensureHubSpotAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.headers['x-session-id'] as string;

  if (!sessionId) {
    res.status(401).json({ error: 'Session ID required' });
    return;
  }

  try {
    const accessToken = await hubspotOAuthService.getValidAccessToken(sessionId);
    if (!accessToken) {
      res.status(401).json({ error: 'HubSpot authentication required', redirectTo: '/oauth/hubspot' });
      return;
    }

    req.hubspotAccessToken = accessToken;
    next();
  } catch {
    res.status(401).json({ error: 'HubSpot authentication failed' });
  }
}

/**
 * Middleware to ensure Microsoft tokens are available
 */
export async function ensureMicrosoftAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.headers['x-session-id'] as string;

  if (!sessionId) {
    res.status(401).json({ error: 'Session ID required' });
    return;
  }

  try {
    const accessToken = await microsoftOAuthService.getValidAccessToken(sessionId);
    if (!accessToken) {
      res.status(401).json({ error: 'Microsoft authentication required', redirectTo: '/oauth/microsoft' });
      return;
    }

    req.microsoftAccessToken = accessToken;
    next();
  } catch {
    res.status(401).json({ error: 'Microsoft authentication failed' });
  }
}

/**
 * Error handling middleware
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err);

  if (config.server.isDevelopment) {
    res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Request logging middleware
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}
