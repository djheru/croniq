# Croniq

A scheduled data collection and monitoring platform powered by a four-stage LangChain.js agent pipeline. Runs on a Raspberry Pi 4 (or any always-on machine). Define jobs with natural language prompts, and AI agents collect, summarize, research, and produce polished reports on a cron schedule.

---

## Features

- **AI agent pipeline** — four-stage LangChain.js pipeline (Collector → Summarizer → Researcher → Editor) powered by AWS Bedrock
- **5 data source types** — HTML scraping, JS-rendered pages (Playwright), REST APIs, RSS/Atom feeds, GraphQL
- **Natural language prompts** — tell the agent what to collect and how to analyze it; template variables via `{{key}}` syntax
- **Cron scheduling** — any valid cron expression; preset buttons in the UI
- **Change detection** — SHA-256 hashes each result; flags and optionally webhooks when data changes
- **Per-stage tracking** — every pipeline stage is recorded with timing, model ID, output, and error diagnostics
- **Run history** — stores all results and stage details in SQLite
- **Webhook notifications** — fire any HTTP endpoint (Slack, Discord, n8n, etc.) when results change

---

## Agent Pipeline

Each job run executes four sequential AI stages:

| Stage          | Model  | Purpose                                                                                         |
| -------------- | ------ | ----------------------------------------------------------------------------------------------- |
| **Collector**  | Haiku  | Gathers raw data using tools (html_scrape, browser_scrape, api_fetch, rss_fetch, graphql_fetch) |
| **Summarizer** | Sonnet | Produces structured summary with key findings from collected data                               |
| **Researcher** | Sonnet | Queries historical runs and related jobs to identify trends and anomalies                       |
| **Editor**     | Opus   | Writes a polished markdown report combining all stage outputs                                   |

If a stage fails, its error payload wraps the previous stage's output so downstream stages can still attempt partial processing.

### Model Configuration

Each stage reads its model ID from an environment variable with a sensible default:

| Variable              | Default                                       |
| --------------------- | --------------------------------------------- |
| `COLLECTOR_MODEL_ID`  | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `SUMMARIZER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0`         |
| `RESEARCHER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0`         |
| `EDITOR_MODEL_ID`     | `us.anthropic.claude-opus-4-6-v1:0`           |

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
npx tsx scripts/seed.ts
```

Creates 12 jobs across all collector types: crypto prices, weather, news feeds (NPR, Guardian, WaPo), AWS/GitHub status monitors, HN front page, Anthropic blog, and more — each with tailored agent prompts.

---

## Production (Pi deployment)

### Build

```bash
npm run build          # compiles TypeScript + Vite
```

### Run with PM2

```bash
sudo npm install -g pm2
pm2 start dist/server.js --name croniq
pm2 startup && pm2 save
```

The app serves the React build at `/` and the API at `/api`.

### Nginx reverse proxy (optional)

```nginx
server {
    listen 80;
    server_name croniq.local;
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
    }
}
```

---

## Data Source Configuration Reference

Each job has a `collectorConfig` that tells the Collector agent which data source to use. The agent autonomously selects the appropriate tool based on the config type.

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

## Environment Variables

| Variable              | Default                                       | Description               |
| --------------------- | --------------------------------------------- | ------------------------- |
| `PORT`                | `3001`                                        | HTTP server port          |
| `DATA_DIR`            | `./data`                                      | SQLite database directory |
| `AWS_REGION`          | `us-east-1`                                   | AWS region for Bedrock    |
| `COLLECTOR_MODEL_ID`  | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Collector stage model     |
| `SUMMARIZER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0`         | Summarizer stage model    |
| `RESEARCHER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0`         | Researcher stage model    |
| `EDITOR_MODEL_ID`     | `us.anthropic.claude-opus-4-6-v1:0`           | Editor stage model        |

AWS Bedrock credentials are required. Configure via standard AWS credential chain (`~/.aws/credentials`, environment variables, or IAM role). See the IAM Roles Anywhere section below for keyless auth on the Pi.

---

## AWS Bedrock Quotas & Monitoring

The pipeline uses 4 Bedrock invocations per job run (Haiku + Sonnet + Sonnet + Opus). With many active jobs, you can hit throttling limits — especially on Opus.

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
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:*:*:inference-profile/*"
      ]
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

## Project Structure

```
croniq/
├── src/
│   ├── server.ts              # Express entry point
│   ├── types/index.ts         # Shared TypeScript types
│   ├── db/                    # SQLite schema + queries (jobs, runs, run_stages)
│   ├── agents/
│   │   ├── pipeline.ts        # Pipeline orchestrator (4 stages)
│   │   ├── collector.ts       # Stage 1: data collection agent
│   │   ├── summarizer.ts      # Stage 2: structured summary agent
│   │   ├── researcher.ts      # Stage 3: historical analysis agent
│   │   ├── editor.ts          # Stage 4: report writing agent
│   │   ├── prompts.ts         # System prompt factories
│   │   ├── types.ts           # Pipeline types + Zod schemas
│   │   └── tools/             # LangChain tools (scraping, API, RSS, GraphQL, DB queries)
│   ├── jobs/                  # Scheduler (node-cron) + runner
│   └── api/                   # Express routes + Zod validation
├── ui/                        # React + Vite dashboard
├── scripts/
│   └── seed.ts                # 12 example jobs with prompts
├── data/                      # SQLite DB (auto-created)
├── .nvmrc                     # Pins Node 22
└── README.md
```
