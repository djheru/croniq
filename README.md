# Croniq

A scheduled data collection and monitoring platform powered by a two-stage LangChain.js agent pipeline. Runs on a Raspberry Pi 4 (or any always-on machine). Define jobs with natural language prompts, and AI agents collect data and produce polished reports on a cron schedule.

---

## Features

- **AI agent pipeline** — two-stage LangChain.js pipeline (Collector → Editor) powered by AWS Bedrock
- **5 data source types** — HTML scraping, JS-rendered pages (Playwright), REST APIs, RSS/Atom feeds, GraphQL
- **Multi-source jobs** — combine multiple data sources in a single job; Collector processes all sources in parallel
- **Natural language prompts** — tell the agent what to collect and how to analyze it; template variables via `{{key}}` syntax
- **Cron scheduling** — any valid cron expression; preset buttons in the UI
- **Change detection** — SHA-256 hashes each result; flags and optionally webhooks when data changes
- **Per-stage tracking** — every pipeline stage is recorded with timing, model ID, output, and error diagnostics
- **Run history** — stores all results and stage details in SQLite
- **Webhook notifications** — fire any HTTP endpoint (Slack, Discord, n8n, etc.) when results change
- **Pi system monitoring** — built-in endpoint for temperature, CPU, memory, and disk metrics with AI-powered health analysis

---

## Agent Pipeline

Each job run executes two sequential AI stages:

| Stage         | Model | Purpose                                                                                         |
| ------------- | ----- | ----------------------------------------------------------------------------------------------- |
| **Collector** | Haiku | Gathers raw data using tools (html_scrape, browser_scrape, api_fetch, rss_fetch, graphql_fetch) |
| **Editor**    | Haiku | Writes a polished markdown report with analysis, patterns, and insights from the collected data |

If a stage fails, its error payload wraps the previous stage's output so downstream stages can still attempt partial processing.

### Model Configuration

Each stage reads its model ID from an environment variable with a sensible default:

| Variable             | Default                                       |
| -------------------- | --------------------------------------------- |
| `COLLECTOR_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `EDITOR_MODEL_ID`    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

---

## Authentication

Croniq uses **passwordless WebAuthn authentication** (passkeys) for secure, phishing-resistant access.

### Features

- **Passkey-based login** — Touch ID, Face ID, Windows Hello, or hardware security keys
- **Multi-device passkeys** — iCloud Keychain, Google Password Manager sync across devices
- **Recovery codes** — One-time use backup codes for account recovery
- **Passkey management** — Rename, delete, and add multiple passkeys per account
- **No passwords** — No password storage, no password resets, no credential stuffing attacks

### First-Time Setup

On first launch, Croniq will prompt you to create an account:

1. Enter your email address
2. Follow your browser's passkey creation flow (Touch ID, Face ID, etc.)
3. **Save your recovery code** — This is your only backup if you lose access to your passkey

### Adding a New Device

To register a passkey on a new device (work laptop, phone, etc.) that doesn't share your passkey ecosystem:

**On your existing device:**

1. Log in to Croniq
2. Open "Manage Passkeys" from the navigation menu
3. Click "📱 Generate code for new device"
4. A 6-digit code will be displayed (valid for 5 minutes)

**On your new device:**

1. Navigate to Croniq registration page
2. Enter your email address
3. Enter the 6-digit device code
4. Complete the passkey registration flow

This ensures only someone with access to an existing authenticated device can add new passkeys to your account.

### Production Configuration

For production deployment, configure WebAuthn settings in `.env`:

```bash
RP_ID=croniq.local               # Your domain (must match the URL hostname)
ORIGIN=https://croniq.local      # Full origin URL — must use https:// in production
CORS_ORIGIN=https://croniq.local # Match your production URL scheme
```

**Important:** The `RP_ID` must match the hostname users access the app from. If using nginx with a custom domain, set `RP_ID` to that domain. `ORIGIN` must match the scheme the browser uses — `https://` when behind TLS.

> **Note:** `NODE_ENV=production` is set automatically by `pm2.config.cjs` — you do not need it in `.env`.

### Recovery Code Usage

If you lose access to all your passkeys:

1. Click "Use recovery code" on the login page
2. Enter your email and recovery code
3. You'll be logged in and issued a **new recovery code** (save it!)
4. Add new passkeys in the passkey manager

### Security Notes

- Sessions are stored in SQLite (`data/sessions.db`) and survive server restarts
- Sessions expire after 30 days of inactivity
- CSRF protection on all state-changing requests
- Rate limiting on authentication endpoints (10 requests/minute)
- Audit log for all authentication events (stored in SQLite)

---

## Quick Start

### 1. Install dependencies

```bash
# Use correct Node version (requires nvm)
nvm use

# Server
npm install

# UI
cd ui && npm install && cd ..

# Install Playwright browser (for browser scraping tool)
npx playwright install chromium --with-deps
```

### 2. Run in development

```bash
npm run dev
```

- API server: `http://localhost:3001`
- UI dev server: `http://localhost:5173` (proxies API calls)

### 3. Seed example jobs (optional)

With the server running:

```bash
npm run db:seed
```

The script authenticates using `SESSION_SECRET` from your `.env` file — make sure it's set before running.

Creates 9 example jobs: multi-source news aggregation (Guardian, WaPo, NPR), crypto prices, weather monitoring (Gilbert AZ + Garden MI), Hacker News, AWS/GitHub status, Anthropic blog scraping, Croniq pipeline stats, and Pi system health — each with tailored agent prompts and multi-source collection where appropriate.

---

## Production (Pi deployment)

### Build

```bash
npm run build          # compiles TypeScript + Vite
```

### Run with PM2

```bash
sudo npm install -g pm2
pm2 start pm2.config.cjs
pm2 startup && pm2 save
```

`pm2.config.cjs` reads your `.env` file, sets `NODE_ENV=production`, and starts the server. The app serves the React build at `/` and the API at `/api`.

### Nginx reverse proxy

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name croniq.local 192.168.0.45;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name croniq.local 192.168.0.45;

    ssl_certificate     /etc/ssl/croniq/cert.pem;
    ssl_certificate_key /etc/ssl/croniq/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # required — tells Express the connection is HTTPS
    }
}
```

> **`X-Forwarded-Proto` is required.** Express uses it (via `trust proxy`) to set `req.secure = true`. Without it, `express-session` will not send the `Set-Cookie` header for secure cookies, causing all logins to fail with 401 immediately after the passkey ceremony completes.

After editing nginx config:

```bash
sudo nginx -t && sudo nginx -s reload
```

---

## Data Source Configuration Reference

Each job has a `sources` array containing one or more data sources. The Collector agent processes all sources in parallel using Promise.allSettled() for fault-tolerant collection. Each source can optionally have a name for identification in the output.

```json
{
  "sources": [
    {
      "name": "The Guardian",
      "config": { "type": "rss", "url": "https://..." }
    },
    {
      "name": "NPR News",
      "config": { "type": "rss", "url": "https://..." }
    }
  ]
}
```

### `html` — Static HTML scraping (cheerio)

```json
{
  "type": "html",
  "url": "https://example.com/product",
  "selectors": {
    "title": "h1.product-title",
    "price": { "selector": ".price", "transform": "number" },
    "imageUrl": { "selector": "img.main", "attribute": "src" },
    "features": { "selector": "ul.features li", "multiple": true }
  },
  "headers": { "Accept-Language": "en-US" }
}
```

**Selector spec:**

| Field       | Type     | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `selector`  | string   | CSS selector                                           |
| `attribute` | string?  | Extract attribute instead of text (e.g. `href`, `src`) |
| `multiple`  | boolean? | Return array of all matches                            |
| `transform` | enum?    | `trim` \| `number` \| `lowercase` \| `uppercase`       |

### `browser` — JS-rendered pages (Playwright)

Use when the page requires JavaScript to render content.

```json
{
  "type": "browser",
  "url": "https://app.example.com/dashboard",
  "waitFor": ".data-loaded",
  "clickBefore": ["#accept-cookies"],
  "scrollToBottom": true,
  "selectors": {
    "metric": ".kpi-value",
    "timestamp": { "selector": ".last-updated", "transform": "trim" }
  }
}
```

### `api` — JSON REST APIs

```json
{
  "type": "api",
  "url": "https://api.example.com/v1/items",
  "method": "GET",
  "headers": { "Authorization": "Bearer YOUR_TOKEN" },
  "extract": "data.results"
}
```

`extract` is a dot-path to drill into the response (e.g. `data.items`).

### `rss` — RSS/Atom feeds

```json
{
  "type": "rss",
  "url": "https://feeds.example.com/rss.xml",
  "maxItems": 20,
  "fields": ["title", "link", "pubDate", "content", "author"]
}
```

### `graphql` — GraphQL APIs

```json
{
  "type": "graphql",
  "url": "https://api.example.com/graphql",
  "query": "{ products(first: 10) { name price stock } }",
  "extract": "products",
  "headers": { "Authorization": "Bearer TOKEN" }
}
```

---

## Webhook Payload

When `notifyOnChange: true` and a `webhookUrl` is set, a POST is fired on change:

```json
{
  "jobId": "uuid",
  "jobName": "My Job",
  "result": "...",
  "timestamp": "2024-03-01T12:00:00.000Z"
}
```

Compatible with Slack incoming webhooks, Discord webhooks, n8n, Make, etc.

---

## Backup & Sync Workflow

Export and import jobs between environments (local dev ↔ Pi) via git-based backups.

### Export Jobs

```bash
npm run db:export                    # Creates backups/{timestamp}.json
npm run db:export backups/custom.json # Custom filename
```

### Import Jobs

```bash
npm run db:import                     # Imports most recent backup
npm run db:seed backups/1742515200.json # Import specific backup
npm run db:seed                       # Load default seed jobs
```

### Workflow: Local → Pi

```bash
# On local machine
npm run db:export
git add backups/ && git commit -m "Backup: production jobs" && git push

# On Pi
git pull
npm run db:import
```

See `backups/README.md` for detailed workflow documentation.

---

## Pi System Health Monitoring

Croniq includes built-in Pi system metrics monitoring via the `/api/system/metrics` endpoint.

### Endpoint Response

```json
{
  "temperature": {
    "celsius": 52.3,
    "fahrenheit": 126.14
  },
  "memory": {
    "totalMB": 3906,
    "usedMB": 1234,
    "percentUsed": 31.59
  },
  "disk": {
    "percentUsed": 45,
    "raw": "45%"
  },
  "cpu": {
    "load1min": 0.52,
    "load5min": 0.68,
    "load15min": 0.71
  },
  "uptime": "up 3 days, 14 hours, 22 minutes",
  "timestamp": "2026-03-18T12:00:00.000Z"
}
```

### Automated Monitoring Job

The default seed includes a "Pi System Health" job that monitors the Pi every 10 minutes and flags:

- **Temperature:** WARNING >70°C (158°F), CRITICAL >80°C (176°F)
- **CPU Load:** WARNING if 5-min load >3.0 (>75% on 4-core Pi)
- **Memory:** WARNING >80%, CRITICAL >90%
- **Disk:** WARNING >80%, CRITICAL >90%

The AI agent compares against previous runs to detect trends like memory leaks, temperature increases, or disk space consumption.

**Note:** This endpoint only works on Linux systems with `/sys/class/thermal/thermal_zone0/temp` (Raspberry Pi). It will fail gracefully on other platforms.

---

## Environment Variables

Create a `.env` file in the project root (see `.env.example` for template):

| Variable             | Default                                       | Description                   |
| -------------------- | --------------------------------------------- | ----------------------------- |
| `PORT`               | `3001`                                        | HTTP server port              |
| `DATA_DIR`           | `./data`                                      | SQLite database directory     |
| `SESSION_SECRET`     | _(required)_                                  | Secret for session encryption |
| `CORS_ORIGIN`        | `http://localhost:5173` (dev)                 | CORS allowed origin           |
| `NODE_ENV`           | `development`                                 | Environment mode              |
| `RP_ID`              | `localhost`                                   | WebAuthn Relying Party ID     |
| `ORIGIN`             | `http://localhost:5173`                       | WebAuthn origin URL           |
| `AWS_REGION`         | `us-east-1`                                   | AWS region for Bedrock        |
| `COLLECTOR_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Collector stage model         |
| `EDITOR_MODEL_ID`    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Editor stage model            |

### Required Environment Variables

**`SESSION_SECRET`** — Required for Express session encryption. Generate a secure random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### AWS Credentials

AWS Bedrock credentials are required for the AI pipeline. Configure via:

- Standard AWS credential chain (`~/.aws/credentials`, environment variables)
- IAM role (EC2/ECS)
- IAM Roles Anywhere (recommended for Pi — see below for keyless auth setup)

---

## AWS Bedrock Quotas & Monitoring

The pipeline uses 2 Bedrock invocations per job run (both stages use Haiku for cost efficiency). With many active jobs, you can hit throttling limits.

```bash
# Check which Claude models you have access to
aws bedrock list-foundation-models \
  --by-output-modality TEXT \
  --query "modelSummaries[?contains(modelId, 'anthropic')].[modelId,modelLifecycle.status]" \
  --output

|  anthropic.claude-sonnet-4-20250514-v1:0       |  ACTIVE |
|  anthropic.claude-haiku-4-5-20251001-v1:0      |  ACTIVE |
|  anthropic.claude-sonnet-4-6                   |  ACTIVE |
|  anthropic.claude-opus-4-6-v1                  |  ACTIVE |
|  anthropic.claude-sonnet-4-5-20250929-v1:0     |  ACTIVE |
|  anthropic.claude-opus-4-5-20251101-v1:0       |  ACTIVE |

# Check current Bedrock quotas (tokens per minute)
aws service-quotas list-service-quotas \
  --service-code bedrock \
  --query "Quotas[?contains(QuotaName, 'Claude')].[QuotaName,Value]" \
  --output table



# Check for recent throttling (last hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Bedrock \
  --metric-name InvocationThrottles \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

Monitor usage in the AWS Console under **CloudWatch > Metrics > Bedrock** or **Amazon Bedrock > Model access**.

If hitting throttling, request a quota increase via **Service Quotas > Amazon Bedrock** in the console. Haiku has generous defaults; Sonnet and Opus quotas are tighter.

---

## AWS Credentials via IAM Roles Anywhere (X.509)

This avoids storing any AWS access keys on the Pi. Instead, the Pi presents an X.509 certificate to assume an IAM role and receive short-lived credentials.

### Step 1: Create a Private CA (on your Mac)

```bash
mkdir -p ~/.croniq-ca && cd ~/.croniq-ca

# Generate CA private key
openssl genrsa -out ca.key 4096

# Create OpenSSL config with CA basic constraints
cat > ca.cnf << 'EOF'
[req]
distinguished_name = req_dn
x509_extensions = v3_ca
prompt = no

[req_dn]
CN = Croniq Pi CA
O = Home Lab

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF

# Generate CA certificate (valid 10 years)
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt -config ca.cnf

# Verify CA basic constraints
openssl x509 -in ca.crt -noout -text | grep -A1 "Basic Constraints"
# Should show: CA:TRUE
```

### Step 2: Issue a Client Certificate for the Pi

```bash
cd ~/.croniq-ca

openssl genrsa -out pi.key 2048
openssl req -new -key pi.key -out pi.csr -subj "/CN=kali-pi4/O=Home Lab"

cat > pi.cnf << 'EOF'
[v3_end]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl x509 -req -days 365 -in pi.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out pi.crt -extfile pi.cnf -extensions v3_end

openssl verify -CAfile ca.crt pi.crt
```

### Step 3: Create IAM Role for the Pi

```bash
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "rolesanywhere.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"]
    }
  ]
}
EOF

aws iam create-role \
  --role-name CroniqPiRole \
  --assume-role-policy-document file://trust-policy.json

cat > bedrock-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name CroniqPiRole \
  --policy-name BedrockInvoke \
  --policy-document file://bedrock-policy.json
```

### Step 4: Set Up IAM Roles Anywhere

```bash
# Create trust anchor (registers your CA with AWS)
aws rolesanywhere create-trust-anchor \
  --name croniq-pi-ca \
  --source "sourceType=CERTIFICATE_BUNDLE,sourceData={x509CertificateData=$(cat ~/.croniq-ca/ca.crt)}" \
  --region us-east-1

# Note the trustAnchorId from the output
TRUST_ANCHOR_ID=<your-trust-anchor-id>

aws rolesanywhere enable-trust-anchor \
  --trust-anchor-id "$TRUST_ANCHOR_ID" \
  --region us-east-1

ROLE_ARN=$(aws iam get-role --role-name CroniqPiRole --query 'Role.Arn' --output text)

aws rolesanywhere create-profile \
  --name croniq-pi-profile \
  --role-arns "$ROLE_ARN" \
  --region us-east-1

# Note the profileId from the output
PROFILE_ID=<your-profile-id>

aws rolesanywhere enable-profile \
  --profile-id "$PROFILE_ID" \
  --region us-east-1
```

### Step 5: Install the Credential Helper on the Pi

```bash
scp ~/.croniq-ca/pi.crt ~/.croniq-ca/pi.key kali:/home/kali/.aws/
scp ~/.croniq-ca/ca.crt kali:/home/kali/.aws/ca.crt

ssh kali
chmod 600 ~/.aws/pi.key

# Download the AWS signing helper (ARM64 for Pi)
curl -Lo /tmp/aws_signing_helper \
  "https://rolesanywhere.amazonaws.com/releases/1.4.0/Aarch64/Linux/aws_signing_helper"

chmod +x /tmp/aws_signing_helper
sudo mv /tmp/aws_signing_helper /usr/local/bin/
aws_signing_helper version
```

### Step 6: Configure AWS Credential Process

On the Pi, create/edit `~/.aws/config`:

```ini
[default]
region = us-east-1
credential_process = aws_signing_helper credential-process \
  --certificate /home/kali/.aws/pi.crt \
  --private-key /home/kali/.aws/pi.key \
  --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:ACCOUNT_ID:trust-anchor/TRUST_ANCHOR_ID \
  --profile-arn arn:aws:rolesanywhere:us-east-1:ACCOUNT_ID:profile/PROFILE_ID \
  --role-arn arn:aws:iam::ACCOUNT_ID:role/CroniqPiRole
```

Replace `ACCOUNT_ID`, `TRUST_ANCHOR_ID`, and `PROFILE_ID` with your values.

### Step 7: Verify

```bash
aws sts get-caller-identity
# Should return your assumed role identity

pm2 restart croniq
```

### Certificate Renewal

The Pi certificate expires after 1 year. To renew:

```bash
cd ~/.croniq-ca
openssl genrsa -out pi.key 2048
openssl req -new -key pi.key -out pi.csr -subj "/CN=kali-pi4/O=Home Lab"
openssl x509 -req -days 365 -in pi.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out pi.crt -extfile pi.cnf -extensions v3_end
scp pi.crt pi.key kali:/home/kali/.aws/
ssh kali "chmod 600 ~/.aws/pi.key && pm2 restart croniq"
```

---

## Tech Stack

### Backend

| Layer               | Technology                                      |
| ------------------- | ----------------------------------------------- |
| **Runtime**         | Node.js 22, TypeScript 5                        |
| **Framework**       | Express 4                                       |
| **Authentication**  | WebAuthn (SimpleWebAuthn), Express Session      |
| **Security**        | CSRF protection (csrf-csrf), rate limiting      |
| **AI Pipeline**     | LangChain.js, AWS Bedrock (Claude Haiku 4.5)    |
| **Scheduling**      | node-cron                                       |
| **Database**        | SQLite (better-sqlite3, WAL mode)               |
| **Scraping**        | cheerio (static HTML), Playwright (JS-rendered) |
| **HTTP Client**     | native fetch                                    |
| **Feed Parsing**    | rss-parser                                      |
| **Validation**      | Zod                                             |
| **Process Manager** | PM2 (production)                                |

### Frontend

| Layer          | Technology                                 |
| -------------- | ------------------------------------------ |
| **Framework**  | React 18                                   |
| **Build Tool** | Vite 5                                     |
| **Styling**    | Tailwind CSS v3 (utility-first)            |
| **Icons**      | lucide-react                               |
| **Date/Time**  | date-fns                                   |
| **WebAuthn**   | @simplewebauthn/browser                    |
| **Fonts**      | Google Fonts (Geist Mono + custom pairing) |

### Architecture Patterns

- **Hexagonal Architecture** — Business logic independent of infrastructure
- **Domain-Driven Design** — Clear bounded contexts (auth, jobs, agents)
- **Type Safety** — Full TypeScript coverage, Zod runtime validation
- **Function-Based** — Pure functions over classes where possible
- **Event-Driven** — Agent pipeline with sequential stage execution
- **Multi-source** — Parallel data collection with fault tolerance (Promise.allSettled)

---

## Project Structure

```text
croniq/
├── src/
│   ├── server.ts              # Express entry point, CSRF, session, rate limiting
│   ├── types/index.ts         # Shared TypeScript types
│   ├── db.ts                  # SQLite connection, migrations, query functions
│   ├── auth/
│   │   └── routes.ts          # WebAuthn registration, login, recovery, passkey mgmt
│   ├── agents/
│   │   ├── pipeline.ts        # Pipeline orchestrator (2 stages sequentially)
│   │   ├── collector.ts       # Stage 1: data collection agent factory
│   │   ├── editor.ts          # Stage 2: report writing agent factory
│   │   ├── prompts.ts         # System prompt factories for all agents
│   │   ├── types.ts           # Pipeline types + Zod schemas
│   │   └── tools/             # LangChain tools (html, browser, api, rss, graphql)
│   ├── scheduler/
│   │   └── index.ts           # node-cron job management
│   ├── runner/
│   │   └── index.ts           # Pipeline executor, run recording
│   └── api/
│       └── routes.ts          # Express routes + Zod validation (jobs, runs, stats)
├── ui/
│   ├── src/
│   │   ├── main.tsx           # React entry point
│   │   ├── App.tsx            # Main app, routing, job list
│   │   ├── api.ts             # API client + shared types
│   │   ├── auth/              # Login, register, recover pages
│   │   └── components/        # JobForm, JobDetail, PasskeyManager, Nav, UI kit
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── scripts/
│   ├── seed.ts                # Default example jobs with prompts
│   ├── export.ts              # Export jobs to timestamped backup
│   └── import.ts              # Import most recent backup
├── backups/                   # Versioned job configuration backups (git-tracked)
├── data/                      # SQLite DB (auto-created, .gitignored)
├── .env.example               # Environment variable template
├── .nvmrc                     # Pins Node 22
└── README.md
```
