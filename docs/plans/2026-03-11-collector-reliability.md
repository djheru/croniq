# Collector Reliability Improvements

**Date:** 2026-03-11
**Status:** Planning

---

## Current State

Of the five collector types, only **API** and **RSS** work reliably. HTML and browser collectors are fragile — sites change structure, block scrapers, or require JavaScript that the collectors can't handle. GraphQL works in principle but has no real jobs using it yet.

### Collector Health Summary

| Type | Status | Issues |
|------|--------|--------|
| **api** | Reliable | No timeout on fetch; otherwise solid |
| **rss** | Reliable | No timeout on parser; otherwise solid |
| **html** | Fragile | No fetch timeout, no retry, sites block/change selectors |
| **browser** | Fragile | Heavy (Playwright/Chromium on Pi), slow, memory-hungry |
| **graphql** | Untested | No real jobs using it; no timeout on fetch |

### Runner Strengths

The job runner (`src/jobs/runner.ts`) already has:
- Retry loop with exponential backoff (2s × attempt number)
- Timeout wrapper via `Promise.race` using job's `timeoutMs`
- Change detection via SHA-256 hashing
- Status recovery (error → active on successful run)

### Runner Gaps

- No per-fetch timeout (only per-job timeout wraps the whole collector)
- Retries don't differentiate error types (404 shouldn't retry, network timeout should)
- No circuit breaker for persistently failing jobs
- Webhook delivery is fire-and-forget with no timeout or retry
- No structured error classification

---

## Improvements

### 1. Add Fetch Timeouts (All Collectors)

Every collector that uses `fetch()` should have a per-request timeout via `AbortController`:

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const res = await fetch(url, { signal: controller.signal, ...options });
clearTimeout(timeout);
```

**Default:** 15 seconds per request. Configurable per job via existing `timeoutMs` field.

**Files:** `html.ts`, `api.ts`, `graphql.ts`, `rss.ts` (wrap parser input fetch)

### 2. Classify Errors for Smarter Retries

Add error classification so the runner can make better retry decisions:

| Error Type | Retry? | Examples |
|------------|--------|----------|
| `network` | Yes | ECONNREFUSED, ETIMEDOUT, DNS failure |
| `timeout` | Yes (with backoff) | AbortController timeout, Playwright timeout |
| `server` | Yes (with backoff) | 500, 502, 503, 429 |
| `client` | No | 400, 401, 403, 404 |
| `parse` | No | Invalid JSON, missing expected selectors |

**Implementation:** Collectors throw typed errors; runner catches and decides retry behavior.

### 3. Circuit Breaker for Failing Jobs

After N consecutive failures (default: 5), automatically pause the job and set status to `error` with a descriptive message. This prevents wasting resources on jobs that are consistently broken.

**Recovery:** Manual resume via UI, or auto-resume after a cooldown period (e.g., 1 hour).

**Files:** `runner.ts`, add `consecutive_failures` counter to jobs table or track in memory.

### 4. Replace Fragile HTML/Browser Jobs with Paid APIs

Several current jobs use HTML scraping that breaks regularly. Replacing them with reliable paid APIs is worth the cost for data that matters.

#### Weather — Open-Meteo (Free)

Already using Open-Meteo for weather. It's free, reliable, and has extensive parameters. No change needed — just ensure the API collector config includes all desired fields (UV, precipitation probability, wind, etc.).

#### Weather Alerts — NWS API (Free)

Free, no API key required. Just needs a descriptive `User-Agent` header. Already configured for alert jobs. Reliable.

#### Real Estate — Options

| Service | Price | Data | Notes |
|---------|-------|------|-------|
| Redfin Data Center | Free | Downloadable CSVs | Weekly market data, no API, download + parse |
| Zillow Bridge API | $0-paid tiers | Property data, Zestimates | Requires application approval |
| Realtor.com API (RapidAPI) | Free tier: 100 req/mo | Listings, property details | Good for specific property monitoring |
| ATTOM Data | $$$$ | Comprehensive property data | Overkill for personal use |

**Recommendation:** Redfin Data Center (free CSVs) for market trends. RapidAPI Realtor.com free tier for specific property/listing monitoring if needed.

#### Financial Data

| Service | Price | Data | Notes |
|---------|-------|------|-------|
| Alpha Vantage | Free (25 req/day) | Stocks, forex, crypto, economic indicators | Generous free tier |
| Finnhub | Free tier | Real-time quotes, company news | Good for market monitoring |
| FRED API | Free | Federal Reserve economic data | Authoritative source, API key required |

**Recommendation:** Alpha Vantage free tier for gold/market prices. FRED for economic indicators (replaces fragile Fed Reserve HTML scraping).

#### Political Polling

| Service | Price | Data | Notes |
|---------|-------|------|-------|
| FiveThirtyEight | Free (RSS/scrape) | Polling averages | Already have RSS feed configured |
| RealClearPolitics | Free (RSS) | Polling aggregation | Already configured |
| Google Civic Info API | Free | Election info, officials | Requires API key |

**Recommendation:** Keep RSS feeds for polling. Add Google Civic API for structured election data if desired.

### 5. Improve Browser Collector Efficiency

For jobs that genuinely need JavaScript rendering (can't be replaced with APIs):

- **Resource blocking:** Block images, fonts, and CSS to speed up page loads
- **Shared browser context:** Reuse a single Playwright browser instance across jobs instead of launching per-run
- **Memory limits:** Set `--max-old-space-size` for Chromium on the Pi (4GB RAM shared with everything else)
- **Graceful degradation:** If Playwright isn't available, fall back to HTML collector with a warning

```typescript
// Block unnecessary resources
await page.route('**/*.{png,jpg,gif,svg,woff,woff2,css}', route => route.abort());
```

### 6. Validate Response Shape

API and GraphQL collectors should validate that the response contains expected fields before returning:

- **API:** Check that configured `fields` paths exist in response JSON
- **GraphQL:** Check that query response has `data` (not just `errors`)
- **RSS:** Validate that feed has at least one entry

This prevents silent "success" with empty or malformed data that looks like nothing changed.

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Fetch timeouts (all collectors) | 1 hour | Prevents hanging jobs |
| 2 | Error classification + smart retries | 2 hours | Stops wasting retries on permanent failures |
| 3 | Response validation | 1 hour | Catches silent failures |
| 4 | Circuit breaker | 1 hour | Protects Pi resources |
| 5 | Browser resource blocking | 30 min | Speeds up browser jobs |
| 6 | Replace HTML jobs with APIs | 2-3 hours | Eliminates fragile scraping |

---

## Jobs to Convert

These current jobs use HTML/browser scraping and should be converted to API-based collection:

| Job | Current Type | Proposed Source | Notes |
|-----|-------------|----------------|-------|
| Gold Price | html (scrape) | Alpha Vantage API | Free, 25 req/day |
| Gas Prices (AZ/MI) | html (scrape) | GasBuddy or AAA API | May need to stay as scrape |
| Phoenix New Times Food | html (scrape) | RSS if available | Check for RSS feed first |
| GitHub Trending TS | html (scrape) | GitHub API (GraphQL) | `/search/repositories` endpoint |

---

## Open Questions

1. **Shared Playwright instance:** Worth the complexity? Pi runs ~5 browser jobs. Startup cost is ~3s each.
2. **Alerting:** Should circuit breaker failures trigger a webhook/notification beyond just setting error status?
3. **Rate limiting:** Should we add a global rate limiter to avoid hammering the same domain with multiple jobs?
4. **Historical cleanup:** Should we auto-purge old runs (e.g., keep last 30 days) to prevent unbounded growth?
