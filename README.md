# Croniq

A general-purpose scheduled data collection and monitoring platform for your Raspberry Pi (or any always-on machine). Define jobs using pluggable "collectors", view results in a clean dashboard, and get notified when data changes.

---

## Features

- **5 collector types** — HTML scraping, JS-rendered pages (Playwright), REST APIs, RSS/Atom feeds, GraphQL
- **Cron scheduling** — any valid cron expression; preset buttons in the UI
- **Change detection** — SHA-256 hashes each result; flags and optionally webhooks when data changes
- **Run history** — stores all results in SQLite with duration, outcome, and diff tracking
- **Retry logic** — configurable retries with exponential backoff
- **Webhook notifications** — fire any HTTP endpoint (Slack, Discord, n8n, etc.) when results change
- **Clean dashboard** — filter by status/type, view run history, trigger jobs manually

---

## Quick Start

### 1. Install dependencies

```bash
# Server
npm install

# Install Playwright browser (for browser collector type)
npx playwright install chromium --with-deps

# UI
cd ui && npm install && cd ..
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

This creates: BTC price tracker, HN top stories, GitHub status monitor, Michigan weather.

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

## Collector Configuration Reference

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
| Field | Type | Description |
|---|---|---|
| `selector` | string | CSS selector |
| `attribute` | string? | Extract attribute instead of text (e.g. `href`, `src`) |
| `multiple` | boolean? | Return array of all matches |
| `transform` | enum? | `trim` \| `number` \| `lowercase` \| `uppercase` |

---

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

---

### `api` — JSON REST APIs

```json
{
  "type": "api",
  "url": "https://api.example.com/v1/items",
  "method": "GET",
  "headers": { "Authorization": "Bearer YOUR_TOKEN" },
  "extract": "data.results",
  "transform": [
    { "from": "item.name", "to": "name" },
    { "from": "item.price_usd", "to": "price", "transform": "number" }
  ]
}
```

`extract` is a dot-path to drill into the response (e.g. `data.items`, `result.0.value`).

---

### `rss` — RSS/Atom feeds

```json
{
  "type": "rss",
  "url": "https://feeds.example.com/rss.xml",
  "maxItems": 20,
  "fields": ["title", "link", "pubDate", "content", "author"]
}
```

---

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
  "result": { ... },
  "timestamp": "2024-03-01T12:00:00.000Z"
}
```

Compatible with Slack incoming webhooks, Discord webhooks, n8n, Make, etc.

---

## AWS Enhancement Ideas

Given the serverless/AWS background, easy extensions:

| Feature                                | AWS Service                  |
| -------------------------------------- | ---------------------------- |
| Archive all results long-term          | S3 + scheduled Lambda export |
| AI summarization of scraped text       | Bedrock (Claude)             |
| Serverless job offload (heavy scrapes) | Lambda + EventBridge         |
| Alerting                               | SNS → email/SMS              |
| Historical time-series                 | Timestream                   |
| Auth for the dashboard                 | Cognito                      |

---

## LLM Analysis (Optional)

Jobs can optionally include an `analysisPrompt` and `analysisSchedule`. When configured, Croniq queries Claude on AWS Bedrock with the last 5 run results and your prompt on a separate schedule (default: hourly).

### AWS Credentials via IAM Roles Anywhere (X.509)

This avoids storing any AWS access keys on the Pi. Instead, the Pi presents an X.509 certificate to assume an IAM role and receive short-lived credentials.

#### Step 1: Create a Private CA (on your Mac)

```bash
# Create a directory for CA materials
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

#### Step 2: Issue a Client Certificate for the Pi

```bash
cd ~/.croniq-ca

# Generate Pi private key
openssl genrsa -out pi.key 2048

# Generate certificate signing request
openssl req -new -key pi.key -out pi.csr \
  -subj "/CN=kali-pi4/O=Home Lab"

# Create end-entity extensions config
cat > pi.cnf << 'EOF'
[v3_end]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

# Sign with the CA (valid 1 year), including required extensions
openssl x509 -req -days 365 -in pi.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out pi.crt -extfile pi.cnf -extensions v3_end

# Verify chain and extensions
openssl verify -CAfile ca.crt pi.crt
openssl x509 -in pi.crt -noout -text | grep -A5 "X509v3"
```

#### Step 3: Create IAM Role for the Pi

```bash
# Create the trust policy — Roles Anywhere will fill in the principal later
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "rolesanywhere.amazonaws.com"
      },
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession",
        "sts:SetSourceIdentity"
      ]
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name CroniqPiRole \
  --assume-role-policy-document file://trust-policy.json

# Attach Bedrock invoke permission
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

#### Step 4: Set Up IAM Roles Anywhere

```bash
# Create trust anchor (registers your CA with AWS)
aws rolesanywhere create-trust-anchor \
  --name croniq-pi-ca \
  --source "sourceType=CERTIFICATE_BUNDLE,sourceData={x509CertificateData=$(cat ~/.croniq-ca/ca.crt)}" \
  --region us-east-1

# Note the trustAnchorId from the output, then:
TRUST_ANCHOR_ID=149bd37d-bae5-45de-93ff-647e0a07f05f

# Enable the trust anchor (created disabled by default)
aws rolesanywhere enable-trust-anchor \
  --trust-anchor-id "$TRUST_ANCHOR_ID" \
  --region us-east-1

# Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name CroniqPiRole --query 'Role.Arn' --output text)

# Create a profile (maps certificates to the IAM role)
aws rolesanywhere create-profile \
  --name croniq-pi-profile \
  --role-arns "$ROLE_ARN" \
  --region us-east-1

# Note the profileId from the output:
PROFILE_ID="8edb6bef-9b5e-4b5e-aa44-bf8569f15731"

# Enable the profile (created disabled by default)
aws rolesanywhere enable-profile \
  --profile-id "$PROFILE_ID" \
  --region us-east-1
```

#### Step 5: Install the Credential Helper on the Pi

```bash
# Copy certs to Pi
scp ~/.croniq-ca/pi.crt ~/.croniq-ca/pi.key kali:/home/kali/.aws/
scp ~/.croniq-ca/ca.crt kali:/home/kali/.aws/ca.crt

# SSH to Pi
ssh kali

# Secure the key
chmod 600 ~/.aws/pi.key

# Download the AWS signing helper (ARM64)
curl -Lo /tmp/aws_signing_helper \
  "https://rolesanywhere.amazonaws.com/releases/1.4.0/X86_64/Linux/aws_signing_helper"

# For ARM64 Pi, use:
curl -Lo /tmp/aws_signing_helper \
  "https://rolesanywhere.amazonaws.com/releases/1.4.0/Aarch64/Linux/aws_signing_helper"

chmod +x /tmp/aws_signing_helper
sudo mv /tmp/aws_signing_helper /usr/local/bin/

# Verify
aws_signing_helper version
```

#### Step 6: Configure AWS Credential Process

On the Pi, create/edit `~/.aws/config`:

```ini
[default]
region = us-east-1
credential_process = aws_signing_helper credential-process \
  --certificate /home/kali/.aws/pi.crt \
  --private-key /home/kali/.aws/pi.key \
  --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:190423078218:trust-anchor/149bd37d-bae5-45de-93ff-647e0a07f05f \
  --profile-arn arn:aws:rolesanywhere:us-east-1:190423078218:profile/8edb6bef-9b5e-4b5e-aa44-bf8569f15731 \
  --role-arn arn:aws:iam::190423078218:role/CroniqPiRole
```

Replace `190423078218`, `149bd37d-bae5-45de-93ff-647e0a07f05f`, and `8edb6bef-9b5e-4b5e-aa44-bf8569f15731` with your values.

#### Step 7: Verify

```bash
# On the Pi — should return your assumed role identity
aws_signing_helper credential-process \
  --certificate /home/kali/.aws/pi.crt \
  --private-key /home/kali/.aws/pi.key \
  --intermediates /home/kali/.aws/ca.crt \
  --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:190423078218:trust-anchor/149bd37d-bae5-45de-93ff-647e0a07f05f \
  --profile-arn arn:aws:rolesanywhere:us-east-1:190423078218:profile/8edb6bef-9b5e-4b5e-aa44-bf8569f15731 \
  --role-arn arn:aws:iam::190423078218:role/CroniqPiRole

# Restart Croniq so it picks up the credential process
pm2 restart croniq
```

The AWS SDK in Croniq will automatically use the credential process from `~/.aws/config` — no code changes needed.

#### Certificate Renewal

The Pi certificate expires after 1 year. To renew:

```bash
# On your Mac
cd ~/.croniq-ca
openssl genrsa -out pi.key 2048
openssl req -new -key pi.key -out pi.csr -subj "/CN=kali-pi4/O=Home Lab"
openssl x509 -req -days 365 -in pi.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out pi.crt
scp pi.crt pi.key kali:/home/kali/.aws/
ssh kali "chmod 600 ~/.aws/pi.key && pm2 restart croniq"
```

---

## Environment Variables

| Variable           | Default                                      | Description                       |
| ------------------ | -------------------------------------------- | --------------------------------- |
| `PORT`             | `3001`                                       | HTTP server port                  |
| `DATA_DIR`         | `./data`                                     | SQLite database directory         |
| `AWS_REGION`       | `us-east-1`                                  | AWS region for Bedrock            |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-opus-4-6-v1` | Bedrock model to use for analysis |

---

## Project Structure

```
croniq/
├── src/
│   ├── collectors/     # html, browser, api, rss, graphql
│   ├── db/             # SQLite schema + queries
│   ├── jobs/           # scheduler (node-cron) + runner
│   ├── api/            # Express routes + Zod validation
│   └── server.ts       # Entry point
├── ui/                 # React + Vite dashboard
├── scripts/
│   └── seed.ts         # Example jobs
├── data/               # SQLite DB (auto-created)
└── README.md
```
