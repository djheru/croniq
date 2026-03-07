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

| Feature | AWS Service |
|---|---|
| Archive all results long-term | S3 + scheduled Lambda export |
| AI summarization of scraped text | Bedrock (Claude) |
| Serverless job offload (heavy scrapes) | Lambda + EventBridge |
| Alerting | SNS → email/SMS |
| Historical time-series | Timestream |
| Auth for the dashboard | Cognito |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `DATA_DIR` | `./data` | SQLite database directory |

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
