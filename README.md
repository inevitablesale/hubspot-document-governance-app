# HubSpot Document Governance App

HubSpot app that automatically uploads Deal and Contact documents to SharePoint/OneDrive, replaces attachments with secure links, tracks versions, enforces document policies, and provides a governance dashboard with expiration alerts, compliance scoring, and document workflows.

## Features

- **Auto-Upload to SharePoint/OneDrive**: Automatically uploads documents attached to Deals and Contacts to SharePoint or OneDrive
- **Secure Link Replacement**: Replaces HubSpot attachments with secure, expiring sharing links
- **Version Tracking**: Tracks all document versions with checksums and change history
- **Compliance Flagging**: Automatically flags documents that violate policies (size limits, file types, missing metadata, expiration)
- **Governance Panel**: CRM card in HubSpot showing document status, compliance scores, and issues
- **Timeline Events**: Logs all document activities to HubSpot timeline
- **Webhook Integration**: Responds to HubSpot events for real-time document processing

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     HubSpot     │────▶│  Document Gov   │────▶│   SharePoint/   │
│   CRM + Files   │◀────│     Server      │◀────│    OneDrive     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │                      │                       │
         ▼                      ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Webhooks     │     │    Database     │     │  Secure Links   │
│   (Real-time)   │     │   (SQLite)      │     │  (Expiring)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- HubSpot Developer Account
- Microsoft Azure AD App Registration
- SharePoint site or OneDrive account

### Installation

```bash
# Clone the repository
git clone https://github.com/inevitablesale/hubspot-document-governance-app.git
cd hubspot-document-governance-app

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Configuration

Create a `.env` file with the following variables:

```env
# Server
PORT=3000
NODE_ENV=development

# HubSpot OAuth
HUBSPOT_CLIENT_ID=your_hubspot_client_id
HUBSPOT_CLIENT_SECRET=your_hubspot_client_secret
HUBSPOT_REDIRECT_URI=http://localhost:3000/oauth/hubspot/callback
HUBSPOT_SCOPES=crm.objects.contacts.read,crm.objects.deals.read,files

# Microsoft OAuth
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=your_tenant_id
MICROSOFT_REDIRECT_URI=http://localhost:3000/oauth/microsoft/callback

# SharePoint (optional - uses OneDrive if not set)
SHAREPOINT_SITE_ID=your_sharepoint_site_id
SHAREPOINT_DRIVE_ID=your_drive_id

# Compliance Settings
MAX_FILE_SIZE_MB=50
ALLOWED_FILE_TYPES=pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv
DOCUMENT_RETENTION_DAYS=365
```

### Running the App

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start

# Run tests
npm test
```

## API Endpoints

### OAuth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/oauth/hubspot` | GET | Initiate HubSpot OAuth flow |
| `/oauth/hubspot/callback` | GET | HubSpot OAuth callback |
| `/oauth/microsoft` | GET | Initiate Microsoft OAuth flow |
| `/oauth/microsoft/callback` | GET | Microsoft OAuth callback |
| `/oauth/status` | GET | Check OAuth connection status |

### Documents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List documents for a HubSpot object |
| `/api/documents/:id` | GET | Get document details |
| `/api/documents` | POST | Upload a new document |
| `/api/documents/:id` | DELETE | Delete a document |
| `/api/documents/:id/refresh-link` | POST | Refresh secure sharing link |
| `/api/documents/:id/versions` | GET | Get document versions |
| `/api/documents/:id/issues` | GET | Get compliance issues |

### CRM Card

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/crm-card` | GET | Get CRM card data for HubSpot |
| `/api/crm-card/timeline` | GET | Get timeline events |

### Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/hubspot` | POST | Handle HubSpot webhook events |
| `/webhooks/file-ingestion` | POST | Manual file upload endpoint |
| `/webhooks/link-sync` | POST | Trigger link synchronization |
| `/webhooks/compliance-check` | POST | Trigger compliance check |

## HubSpot Configuration

### App Setup

1. Create a new app in your HubSpot Developer Account
2. Configure OAuth scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`
   - `files`
   - `timeline`

### CRM Card Setup

1. In your HubSpot app settings, add a CRM Card
2. Set the data fetch URL to: `https://your-domain.com/api/crm-card`
3. Configure card types: DEAL, CONTACT

### Webhook Subscriptions

1. Add webhook subscription for:
   - `deal.creation`
   - `deal.propertyChange`
   - `contact.creation`
   - `contact.propertyChange`
2. Set target URL: `https://your-domain.com/webhooks/hubspot`

## Microsoft Azure Configuration

### App Registration

1. Register a new app in Azure AD
2. Add API permissions:
   - `Files.ReadWrite.All`
   - `Sites.ReadWrite.All`
3. Add redirect URI: `http://localhost:3000/oauth/microsoft/callback`
4. Create a client secret

### SharePoint Setup (Optional)

1. Get your SharePoint site ID from Graph Explorer
2. Get the document library (drive) ID
3. Add to environment variables

## Compliance Rules

The app enforces the following compliance rules by default:

| Rule | Severity | Default |
|------|----------|---------|
| File size limit | High/Critical | 50 MB |
| File type whitelist | Critical | pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv |
| Missing metadata | Low/Medium | Category, Confidentiality |
| Document expiration | Critical/High | Based on retention date |
| Link expiration | Medium/High | 30 days |
| Version limit | Medium | 50 versions |

## Project Structure

```
├── src/
│   ├── config/           # Configuration management
│   ├── controllers/      # Request handlers
│   ├── middleware/       # Express middleware
│   ├── models/           # Data models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   │   ├── database.ts   # SQLite database service
│   │   ├── compliance.ts # Compliance checking
│   │   ├── sharepoint.ts # SharePoint/OneDrive integration
│   │   ├── hubspot-oauth.ts # HubSpot OAuth
│   │   ├── microsoft-oauth.ts # Microsoft OAuth
│   │   ├── timeline.ts   # Timeline events
│   │   └── document-governance.ts # Main orchestration
│   ├── types/            # TypeScript types
│   └── utils/            # Utility functions
├── tests/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── dist/                 # Compiled JavaScript
└── data/                 # SQLite database
```

## Testing

```bash
# Run all tests with coverage
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Watch mode
npm run test:watch
```

## License

MIT
