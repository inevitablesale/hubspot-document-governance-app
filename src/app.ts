import express, { Request, Response, Application } from 'express';
import routes from './routes';
import { errorHandler, requestLogger } from './middleware';
import { config } from './config';

export function createApp(): Application {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // HubSpot app descriptor endpoint
  app.get('/.well-known/hubspot-app.json', (req: Request, res: Response) => {
    res.json({
      name: 'Document Governance',
      description: 'Automatically uploads Deal and Contact documents to SharePoint/OneDrive, replaces attachments with secure links, tracks versions, and enforces document policies.',
      scopes: config.hubspot.scopes,
      webhooks: {
        targetUrl: `${req.protocol}://${req.get('host')}/webhooks/hubspot`,
        subscriptions: [
          { subscriptionType: 'deal.creation' },
          { subscriptionType: 'deal.propertyChange' },
          { subscriptionType: 'contact.creation' },
          { subscriptionType: 'contact.propertyChange' },
        ],
      },
      cards: {
        crmCardTypes: ['COMPANY', 'CONTACT', 'DEAL'],
        dataFetch: {
          uri: `${req.protocol}://${req.get('host')}/api/crm-card`,
          httpMethod: 'GET',
        },
      },
    });
  });

  // Static pages for OAuth flows and UI
  app.get('/setup', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Document Governance Setup</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { color: #33475b; }
          .step { background: #f5f8fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .step h3 { margin-top: 0; color: #00a4bd; }
          .btn { display: inline-block; padding: 12px 24px; background: #00a4bd; color: white; text-decoration: none; border-radius: 4px; margin: 10px 5px 10px 0; }
          .btn:hover { background: #0091ae; }
          .btn-microsoft { background: #0078d4; }
          .btn-microsoft:hover { background: #006cbe; }
          code { background: #f5f8fa; padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>🔐 Document Governance Setup</h1>
        <p>Connect your HubSpot and Microsoft accounts to enable document governance.</p>
        
        <div class="step">
          <h3>Step 1: Connect HubSpot</h3>
          <p>Authorize the app to access your HubSpot CRM data.</p>
          <a href="/oauth/hubspot" class="btn">Connect HubSpot</a>
        </div>
        
        <div class="step">
          <h3>Step 2: Connect Microsoft/SharePoint</h3>
          <p>Authorize the app to upload documents to your SharePoint or OneDrive.</p>
          <a href="/oauth/microsoft" class="btn btn-microsoft">Connect Microsoft</a>
        </div>
        
        <div class="step">
          <h3>Step 3: Configure (Optional)</h3>
          <p>Set environment variables to customize:</p>
          <ul>
            <li><code>SHAREPOINT_SITE_ID</code> - Target SharePoint site</li>
            <li><code>SHAREPOINT_DRIVE_ID</code> - Target document library</li>
            <li><code>MAX_FILE_SIZE_MB</code> - Maximum file size (default: 50)</li>
            <li><code>ALLOWED_FILE_TYPES</code> - Allowed extensions</li>
          </ul>
        </div>
      </body>
      </html>
    `);
  });

  // Governance panel (embedded in HubSpot)
  app.get('/governance-panel', (req: Request, res: Response) => {
    const { objectType, objectId } = req.query;
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Document Governance Panel</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f5f8fa; }
          .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .header h1 { font-size: 24px; color: #33475b; }
          .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
          .stat { background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .stat-value { font-size: 28px; font-weight: bold; color: #00a4bd; }
          .stat-label { font-size: 12px; color: #516f90; margin-top: 5px; }
          .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .section h2 { font-size: 16px; color: #33475b; margin-bottom: 15px; border-bottom: 1px solid #eaf0f6; padding-bottom: 10px; }
          .document { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #eaf0f6; }
          .document:last-child { border-bottom: none; }
          .doc-icon { width: 40px; height: 40px; background: #e5f5f8; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-size: 20px; }
          .doc-info { flex: 1; }
          .doc-name { font-weight: 500; color: #33475b; }
          .doc-meta { font-size: 12px; color: #516f90; margin-top: 4px; }
          .doc-score { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
          .score-good { background: #e3fcef; color: #006644; }
          .score-warning { background: #fff8e1; color: #8a6d3b; }
          .score-danger { background: #ffebee; color: #c62828; }
          .issue { padding: 12px; background: #fff8e1; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #f0ad4e; }
          .issue.critical { background: #ffebee; border-left-color: #c62828; }
          .issue-type { font-weight: 500; color: #8a6d3b; }
          .issue.critical .issue-type { color: #c62828; }
          .issue-message { font-size: 13px; color: #516f90; margin-top: 4px; }
          .empty { text-align: center; padding: 40px; color: #516f90; }
          .btn { padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; }
          .btn-primary { background: #00a4bd; color: white; }
          .btn-primary:hover { background: #0091ae; }
          #loading { text-align: center; padding: 40px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📋 Document Governance</h1>
          <p style="color: #516f90; margin-top: 5px;">${objectType} ID: ${objectId}</p>
        </div>
        
        <div id="loading">Loading...</div>
        <div id="content" style="display: none;">
          <div class="stats">
            <div class="stat">
              <div class="stat-value" id="totalDocs">-</div>
              <div class="stat-label">Documents</div>
            </div>
            <div class="stat">
              <div class="stat-value" id="complianceScore">-</div>
              <div class="stat-label">Compliance Score</div>
            </div>
            <div class="stat">
              <div class="stat-value" id="openIssues">-</div>
              <div class="stat-label">Open Issues</div>
            </div>
            <div class="stat">
              <div class="stat-value" id="totalSize">-</div>
              <div class="stat-label">Total Size</div>
            </div>
          </div>
          
          <div class="section">
            <h2>📁 Documents</h2>
            <div id="documents"></div>
          </div>
          
          <div class="section">
            <h2>⚠️ Compliance Issues</h2>
            <div id="issues"></div>
          </div>
        </div>
        
        <script>
          const objectType = '${objectType}';
          const objectId = '${objectId}';
          
          async function loadData() {
            try {
              const response = await fetch('/api/crm-card?objectType=' + objectType + '&objectId=' + objectId);
              const data = await response.json();
              renderData(data);
            } catch (error) {
              document.getElementById('loading').innerHTML = 'Error loading data: ' + error.message;
            }
          }
          
          function renderData(data) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            
            // Find stats from results
            const summary = data.results.find(r => r.title === 'Document Governance Summary');
            if (summary) {
              const props = summary.properties;
              document.getElementById('totalDocs').textContent = props.find(p => p.label === 'Total Documents')?.value || 0;
              document.getElementById('complianceScore').textContent = (props.find(p => p.label === 'Compliance Score')?.value || 100) + '%';
              document.getElementById('openIssues').textContent = props.find(p => p.label === 'Open Issues')?.value || 0;
              document.getElementById('totalSize').textContent = props.find(p => p.label === 'Total Size')?.value || '0 B';
            }
            
            // Render documents
            const documents = data.results.filter(r => r.objectId !== 1 && r.objectId !== 'issues');
            const docsContainer = document.getElementById('documents');
            
            if (documents.length === 0) {
              docsContainer.innerHTML = '<div class="empty">No documents yet</div>';
            } else {
              docsContainer.innerHTML = documents.map(doc => {
                const compliance = doc.properties.find(p => p.label === 'Compliance')?.value || 100;
                const scoreClass = compliance >= 80 ? 'score-good' : compliance >= 50 ? 'score-warning' : 'score-danger';
                return '<div class="document">' +
                  '<div class="doc-icon">📄</div>' +
                  '<div class="doc-info">' +
                    '<div class="doc-name">' + doc.title + '</div>' +
                    '<div class="doc-meta">' + (doc.properties.find(p => p.label === 'Versions')?.value || 1) + ' version(s)</div>' +
                  '</div>' +
                  '<span class="doc-score ' + scoreClass + '">' + compliance + '%</span>' +
                '</div>';
              }).join('');
            }
            
            // Render issues
            const issuesSection = data.results.find(r => r.objectId === 'issues');
            const issuesContainer = document.getElementById('issues');
            
            if (!issuesSection || issuesSection.properties.length === 0) {
              issuesContainer.innerHTML = '<div class="empty">No compliance issues 🎉</div>';
            } else {
              issuesContainer.innerHTML = issuesSection.properties.map(issue => {
                const isCritical = issue.value.includes('[CRITICAL]');
                return '<div class="issue ' + (isCritical ? 'critical' : '') + '">' +
                  '<div class="issue-type">' + issue.label + '</div>' +
                  '<div class="issue-message">' + issue.value + '</div>' +
                '</div>';
              }).join('');
            }
          }
          
          loadData();
        </script>
      </body>
      </html>
    `);
  });

  // Mount routes
  app.use('/', routes);

  // Error handling
  app.use(errorHandler);

  return app;
}

export default createApp;
