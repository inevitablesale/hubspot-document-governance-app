import { createApp } from './app';
import { config, validateConfig } from './config';
import { getDatabase, closeDatabase } from './services/database';

// Validate configuration
try {
  validateConfig();
} catch (error) {
  console.error('Configuration error:', error);
  if (config.server.isProduction) {
    process.exit(1);
  }
}

// Initialize database
getDatabase();

// Create and start server
const app = createApp();
const server = app.listen(config.server.port, () => {
  console.log(`
🚀 Document Governance Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Server running on port ${config.server.port}
🌍 Environment: ${config.server.nodeEnv}

Endpoints:
  • Health Check:    GET  /health
  • Setup:           GET  /setup
  • HubSpot OAuth:   GET  /oauth/hubspot
  • Microsoft OAuth: GET  /oauth/microsoft
  • OAuth Status:    GET  /oauth/status
  • CRM Card:        GET  /api/crm-card
  • Documents:       GET  /api/documents
  • Webhooks:        POST /webhooks/hubspot
  • File Ingestion:  POST /webhooks/file-ingestion

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    closeDatabase();
    console.log('✅ Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
