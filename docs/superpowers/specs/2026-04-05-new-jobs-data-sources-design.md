# New Jobs & Data Sources — Design Spec

**Date:** 2026-04-05
**Scope:** Add 7 new scheduled jobs and extend 1 existing job with curated data sources
**Approach:** API-based creation script (`scripts/add-jobs.ts`)

---

## Overview

Create a standalone TypeScript script that provisions new data collection jobs via the Croniq REST API. The script authenticates using the existing admin bypass pattern (localhost + `X-Admin-Key` header), validates through the Zod schema layer, and supports `--dry-run` and `--category <name>` flags.

This sub-project focuses exclusively on data sources and job definitions. Code quality, UI/UX, and auth improvements are separate future sub-projects.

## Script Architecture

### File: `scripts/add-jobs.ts`

```
Usage:
  npx tsx scripts/add-jobs.ts                          # create all new jobs
  npx tsx scripts/add-jobs.ts --dry-run                # preview without creating
  npx tsx scripts/add-jobs.ts --category progressive   # create one category only
  npx tsx scripts/add-jobs.ts --update-news            # extend existing news job
```

**Authentication:** Reuses the `SESSION_SECRET` env var + `X-Admin-Key` header pattern from `scripts/seed.ts`.

**Error handling:** Each job creation is independent. Failures are logged but don't block other jobs. Summary table printed at the end.

**Idempotency:** Before creating, the script checks if a job with the same name already exists (via `GET /api/jobs`) and skips duplicates, logging a warning.

### Module structure

Each job category is defined as a named function returning a job payload object. The `CreateJobInput` type (from `src/types/index.ts`) requires all fields, but the API's Zod schema provides defaults for `outputFormat`, `retries`, `timeoutMs`, `tags`, and `notifyOnChange`. The script uses the Zod schema's input type for ergonomics, while explicitly providing all fields for consistency with `seed.ts`.

Every job definition includes: `name`, `description`, `schedule`, `sources`, `tags`, `notifyOnChange`, `retries`, `timeoutMs`, `outputFormat`, and `jobPrompt`.

```typescript
// Shared defaults (matching seed.ts conventions)
const DEFAULTS = { outputFormat: 'json' as const, retries: 2 };

// Job category functions — each returns a complete job payload
const progressiveNews = () => ({ ...DEFAULTS, ... })
const cryptoIntelligence = () => ({ ...DEFAULTS, ... })
const weatherEnhanced = () => ({ ...DEFAULTS, ... })
const awsServerlessEcosystem = () => ({ ...DEFAULTS, ... })
const houseMusic = () => ({ ...DEFAULTS, ... })
const businessMarkets = () => ({ ...DEFAULTS, ... })
const localNews = () => ({ ...DEFAULTS, ... })

// Special: reads existing job, merges sources client-side, returns PATCH payload
const mainstreamNewsExtension = async (existingJob: Job) => ({ ... })
```

---

## Job Definitions

### 1. Progressive News & Analysis

| Field | Value |
|-------|-------|
| **Name** | Progressive News & Analysis |
| **Description** | Progressive and investigative journalism from six left-leaning publications |
| **Schedule** | `0 */2 * * *` (every 2 hours) |
| **Tags** | `["news", "progressive", "politics"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 300000ms |

**Sources (6 RSS feeds):**

| Source | URL | Max Items |
|--------|-----|-----------|
| The Intercept | `https://theintercept.com/feed/?rss` | 10 |
| Mother Jones | `https://www.motherjones.com/feed/` | 10 |
| Jacobin | `https://jacobin.com/feed` | 8 |
| The Nation | `https://www.thenation.com/feed/` | 10 |
| ProPublica | `https://feeds.propublica.org/propublica/main` | 10 |
| Common Dreams | `https://www.commondreams.org/feeds/feed.rss` | 10 |

**Analysis Prompt:**

Analyze progressive and investigative news across six publications spanning investigative journalism (ProPublica, The Intercept), political commentary (Mother Jones, The Nation), democratic socialist perspective (Jacobin), and grassroots progressive coverage (Common Dreams).

For each story:
- Headline, publication time, source attribution
- 1-2 sentence summary
- Topic classification: Policy, Labor, Climate, Justice, Healthcare, Economy, Foreign Policy, Civil Rights, or Other

Cross-source analysis:
- Identify stories covered by multiple outlets — note how framing differs between investigative vs. commentary vs. grassroots sources
- Flag major investigative pieces (ProPublica, The Intercept) that other outlets haven't yet picked up
- Detect emerging policy debates or legislative developments that multiple sources are tracking
- Note which issues are getting disproportionate attention vs. being underreported

Synthesized view:
- What are the dominant progressive concerns right now?
- Are there stories that mainstream media is covering differently or ignoring?
- Track how stories evolve across runs — which narratives are gaining or losing momentum?
- Highlight any direct calls to action or mobilization efforts

Compare against previous runs to identify story persistence, new developments, and shifting editorial focus.

---

### 2. Crypto Market Intelligence

| Field | Value |
|-------|-------|
| **Name** | Crypto Market Intelligence |
| **Description** | Crypto market news, analysis, and sentiment from industry sources |
| **Schedule** | `0 */3 * * *` (every 3 hours) |
| **Tags** | `["crypto", "analysis", "defi"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 180000ms |

**Sources (4 — mixed RSS + API):**

| Source | Type | URL |
|--------|------|-----|
| The Block | RSS | `https://www.theblock.co/rss/all` |
| CoinDesk | RSS | `https://www.coindesk.com/arc/outboundfeeds/rss/` |
| Decrypt | RSS | `https://decrypt.co/feed` |
| Fear & Greed Index | API | `https://api.alternative.me/fng/?limit=1` |

**Future sources (require API keys, included as comments):**
- Messari free tier: `https://data.messari.io/api/v1/news`
- Dune Analytics: `https://api.dune.com/api/v1/` (requires account)

**Analysis Prompt:**

Analyze crypto market intelligence from three news sources and the Fear & Greed Index.

Market Sentiment:
- Current Fear & Greed Index value and classification (Extreme Fear, Fear, Neutral, Greed, Extreme Greed)
- How has sentiment shifted since the previous run?
- Does the news narrative align with or contradict the sentiment index?

News Analysis (The Block, CoinDesk, Decrypt):
- Identify the 5-8 most significant stories across all sources
- Classify each: Regulatory, DeFi, Infrastructure, Market Movement, Security/Hack, Institutional Adoption, or Other
- Flag any stories about regulatory actions, exchange issues, or security breaches as HIGH PRIORITY
- Note which stories appear across multiple outlets (consensus narratives) vs. single-source exclusives

Market Context:
- Correlate news developments with the sentiment indicator
- Identify any emerging trends: new protocol launches, governance proposals, ecosystem shifts
- Flag stories that could have outsized market impact (regulatory rulings, ETF decisions, major hacks)

Compare to previous runs:
- Track developing stories and their progression
- Note sentiment trend direction (improving, worsening, stable)
- Identify stories that have gone from single-source to multi-source coverage (gaining momentum)

---

### 3. Weather — Enhanced Multi-Location (replaces existing)

| Field | Value |
|-------|-------|
| **Name** | Weather — Enhanced Multi-Location |
| **Description** | NWS forecasts and alerts for Gilbert AZ and Garden MI with severe weather detection |
| **Schedule** | `0 */3 * * *` (every 3 hours) |
| **Tags** | `["weather", "monitoring", "alerts"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 180000ms |

**Sources (4 API endpoints):**

| Source | Type | URL |
|--------|------|-----|
| NWS Phoenix Forecast | API | `https://api.weather.gov/gridpoints/PSR/173,58/forecast` |
| NWS Delta County Forecast | API | `https://api.weather.gov/gridpoints/MQT/109,79/forecast` |
| NWS Phoenix Alerts | API | `https://api.weather.gov/alerts/active?point=33.35,-111.79` |
| NWS Delta County Alerts | API | `https://api.weather.gov/alerts/active?point=45.77,-86.55` |

**All NWS sources must include headers:**
```json
{ "User-Agent": "(croniq, contact@example.com)" }
```
Without this header, NWS returns 403. The implementer should replace the email with the user's actual contact.

**Grid point verification:** Before implementation, verify grid coordinates by fetching `https://api.weather.gov/points/33.35,-111.79` and `https://api.weather.gov/points/45.77,-86.55` to confirm the `gridId`, `gridX`, and `gridY` values match the URLs above.

**Pirate Weather** requires a free API key from `https://pirate-weather.apiable.io/` — included as commented-out sources with setup instructions.

**Approach:** This job updates the existing "Weather — Multi-Location Monitoring" job in-place via PATCH (preserving run history). The script will:
1. Find the existing weather job by name via `GET /api/jobs`
2. If found: `PATCH /api/jobs/:id` with the new name, sources, description, and prompt
3. If not found: create as a new job via `POST /api/jobs`

**Analysis Prompt:**

Monitor weather conditions for Gilbert, AZ (Phoenix metro) and Garden, MI (Delta County, Upper Peninsula) using official NWS data.

For each location:
- Current period forecast: temperature, wind, conditions description
- Extended outlook: next 3-4 forecast periods
- Active weather alerts: type, severity, urgency, headline, description
  - Flag any Watch, Warning, or Advisory as HIGH PRIORITY
  - Note alert expiration times

Location-specific thresholds:
- Gilbert, AZ: Flag temps >105°F (extreme heat), dust storm warnings, flash flood watches, haboob advisories
- Garden, MI: Flag temps <10°F (extreme cold), blizzard warnings, lake effect snow, ice storm warnings, wind chill advisories

Comparative analysis:
- Temperature differential between desert and Great Lakes climates
- Contrasting weather patterns (e.g., heat dome in AZ while cold front hits MI)
- Seasonal context: are conditions typical for the time of year?

Compare against previous runs:
- Track multi-day weather pattern evolution
- Note when alerts are issued, escalated, or cleared
- Identify prolonged conditions (heat waves, cold snaps, extended precipitation)

---

### 4. AWS Serverless & TypeScript Ecosystem

| Field | Value |
|-------|-------|
| **Name** | AWS Serverless & TypeScript Ecosystem |
| **Description** | AWS serverless updates, TypeScript ecosystem news, and community thought leadership |
| **Schedule** | `0 8,17 * * *` (8 AM and 5 PM) |
| **Tags** | `["aws", "serverless", "typescript", "ecosystem"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 240000ms |

**Sources (6 RSS/Atom feeds):**

| Source | URL | Max Items |
|--------|-----|-----------|
| AWS Compute Blog | `https://aws.amazon.com/blogs/compute/feed/` | 8 |
| AWS What's New | `https://aws.amazon.com/about-aws/whats-new/recent/feed/` | 15 |
| Yan Cui (theburningmonk) | `https://theburningmonk.com/feed/` | 5 |
| Matt Pocock (Total TypeScript) | `https://www.totaltypescript.com/rss.xml` | 5 |
| TypeScript Blog (Microsoft) | `https://devblogs.microsoft.com/typescript/feed/` | 5 |
| Powertools Lambda TS Releases | `https://github.com/aws-powertools/powertools-lambda-typescript/releases.atom` | 5 |

**Analysis Prompt:**

Analyze the AWS serverless and TypeScript ecosystem from official AWS sources, community thought leaders, and key library releases.

Categorize each item:
- **AWS Service Updates**: New features, region expansions, pricing changes for Lambda, API Gateway, DynamoDB, EventBridge, SQS, Step Functions, Bedrock, CDK
- **Best Practices**: Architecture patterns, performance optimization, cost reduction techniques
- **TypeScript Ecosystem**: Language features, compiler updates, type system improvements
- **Library Releases**: New versions of Powertools, CDK constructs, Middy, or other serverless tooling
- **Community Insights**: Opinions, benchmarks, and real-world experience reports from practitioners

Prioritize for a TypeScript/CDK developer:
- Flag any breaking changes in TypeScript, CDK, or Powertools as HIGH PRIORITY
- Highlight Lambda runtime updates (Node.js version support, ARM64 improvements)
- Note Bedrock-specific updates (new models, pricing, API changes)
- Call out CDK construct library additions or deprecations

Synthesis:
- What are the emerging serverless patterns this week?
- Are there cost optimization opportunities mentioned across sources?
- Any convergence between AWS announcements and community reactions?

Compare to previous runs to track announcement cadence, identify follow-up posts, and note community response to major announcements.

---

### 5. House Music Scene

| Field | Value |
|-------|-------|
| **Name** | House Music Scene |
| **Description** | House music news, releases, and DJ activity from electronic music publications |
| **Schedule** | `0 10 * * *` (daily at 10 AM) |
| **Tags** | `["music", "house", "electronic"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 240000ms |

**Sources (4 RSS feeds):**

| Source | URL | Max Items |
|--------|-----|-----------|
| Resident Advisor News | `https://ra.co/xml/news.xml` | 10 |
| Resident Advisor Podcast | `https://ra.co/xml/podcast.xml` | 5 |
| DJ Mag | `https://djmag.com/feed` | 10 |
| Magnetic Magazine | `https://www.magneticmag.com/feed/` | 8 |

**Analysis Prompt:**

Curate the house music scene from four key electronic music publications.

New Music & Releases:
- Notable new releases, EPs, and albums in the house music spectrum (deep house, tech house, progressive house, afro house, melodic house)
- Label activity: which labels are releasing? Note output from key labels (Defected, Anjunadeep, Drumcode, Dirtybird, Trax Records, etc.)
- Highlight debut releases or breakout tracks getting attention

DJ & Artist Activity:
- Resident Advisor podcast: who's been featured? Genre and style notes
- Tour announcements, residency updates, festival bookings
- Emerging artists getting editorial attention for the first time
- Producer collaborations or notable remixes

Scene & Culture:
- Festival announcements or lineup reveals
- Venue openings/closings, club culture developments
- Industry news: streaming platform changes, vinyl market updates
- Awards, milestones, retrospectives

Compare to previous runs:
- Track which artists are appearing repeatedly (momentum builders)
- Note new names appearing for the first time
- Identify developing stories (festival lineups filling out, album rollout campaigns)

---

### 6. Mainstream News Extension (PATCH existing job)

This is not a new job — it extends the existing "News — Multi-Source Aggregation" job.

**New sources to add (5 RSS feeds):**

| Source | URL | Max Items |
|--------|-----|-----------|
| BBC US/Canada | `http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml` | 10 |
| NYT Homepage | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` | 10 |
| AP News (via RSSHub) | `https://rsshub.app/apnews/topics/apf-topnews` | 10 | *See reliability note below* |
| PBS NewsHour | `https://www.pbs.org/newshour/feeds/rss/headlines` | 10 |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 8 |

**Approach:** The PATCH endpoint replaces the entire `sources` array (it does not merge). The script must:
1. `GET /api/jobs` and find the job named "News — Multi-Source Aggregation"
2. If not found, log an error and skip (do not create a duplicate)
3. Read the existing job's `sources` array (currently 3: Guardian, WaPo, NPR)
4. Concatenate the 5 new sources onto the existing array client-side
5. `PATCH /api/jobs/:id` with the full merged sources array (8 total) and the expanded prompt

**AP News reliability note:** The RSSHub public instance (`rsshub.app`) can be rate-limited or down. If it's unreliable, fallback options include `https://feedx.net/rss/ap.xml` or removing the AP source. Self-hosting RSSHub is out of scope for this sub-project.

**Updated prompt** (replaces existing):

Analyze news coverage across eight major sources spanning wire services (AP), public media (NPR, PBS NewsHour), international perspectives (The Guardian, BBC, Al Jazeera), and US newspapers (Washington Post, New York Times).

For each significant story:
- Headline, publication time, source attribution
- 1-2 sentence summary
- Topic: Politics, Policy, Economy, Justice, Climate, Health, World, Technology, or Other

Cross-source analysis at scale:
- Identify stories covered by 3+ sources — these are the consensus "major" stories of the cycle
- Note stories covered by international sources (Guardian, BBC, Al Jazeera) but absent from US sources, and vice versa
- Compare wire service coverage (AP) against editorial coverage (NYT, WaPo) — how does framing differ?
- Flag exclusive stories appearing in only one source — are they scoops or niche interests?

Synthesized intelligence:
- Rank the top 8 stories by combined prominence across all sources
- What are the dominant news themes across all sources?
- Identify the "story of the day" — the single development getting the most cross-source attention
- Geographic blind spots: what regions or topics are underrepresented?
- Compare US-centric sources vs. international sources on the same events

Compare to previous runs to track story evolution, emergence of new narratives, and the news cycle's attention span.

---

### 7. Business & Markets

| Field | Value |
|-------|-------|
| **Name** | Business & Markets |
| **Description** | Financial news and market analysis from major business media, weekday market hours |
| **Schedule** | `0 7,12,17 * * 1-5` (7 AM, noon, 5 PM weekdays) |
| **Tags** | `["business", "markets", "finance"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 240000ms |

**Sources (4 RSS feeds + API endpoints with key setup):**

| Source | Type | URL | Notes |
|--------|------|-----|-------|
| MarketWatch Top Stories | RSS | `https://feeds.content.dowjones.io/public/rss/mw_topstories` | |
| CNBC Top News | RSS | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114` | |
| WSJ Markets | RSS | `https://feeds.a.dj.com/rss/RSSMarketsMain.xml` | |
| Seeking Alpha | RSS | `https://seekingalpha.com/feed.xml` | |

**Future sources (require free API keys, included as comments):**
- Finnhub market news: `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}` (60 calls/min free)
- Alpha Vantage: `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${ALPHA_VANTAGE_KEY}` (25 calls/day free)
- FRED economic data: `https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${FRED_API_KEY}&file_type=json` (free, unlimited)

**Analysis Prompt:**

Analyze business and market news from four major financial media sources, running on weekday market hours.

Market Overview:
- Identify the top market-moving stories of the session
- Classify each: Earnings, Fed/Monetary Policy, Sector Movement, M&A, IPO/Offering, Economic Data, Geopolitical, or Other
- Flag any stories about Fed rate decisions, major earnings surprises, or market circuit breakers as HIGH PRIORITY

Sector Analysis:
- Which sectors are getting the most coverage? (Tech, Finance, Healthcare, Energy, Consumer, Industrial)
- Note any sector rotation signals — coverage shifting from growth to value or vice versa
- Identify company-specific stories with broader market implications

Economic Context:
- Employment, inflation, GDP, or housing data releases
- Trade policy or tariff developments
- Consumer confidence or spending indicators

Cross-Source Comparison:
- Do MarketWatch and CNBC agree on the day's narrative, or are they emphasizing different stories?
- Note where Seeking Alpha's analyst community diverges from mainstream financial media
- Identify consensus vs. contrarian views

Compare to previous runs:
- Track developing stories (earnings season progression, Fed meeting anticipation)
- Note shifts in market sentiment over the trading day (morning vs. midday vs. close)
- Identify stories that have persisted across multiple sessions vs. one-day events

---

### 8. Local News — Delta County MI & Phoenix AZ

| Field | Value |
|-------|-------|
| **Name** | Local News — Delta County MI & Phoenix AZ |
| **Description** | Local news coverage for Delta County MI and Phoenix AZ metro via RSS and browser scraping |
| **Schedule** | `0 7,17 * * *` (7 AM and 5 PM) |
| **Tags** | `["local", "michigan", "phoenix", "community"]` |
| **Output format** | `json` |
| **Notify on change** | `true` |
| **Retries** | 2 |
| **Timeout** | 300000ms |

**Sources (mixed RSS + browser scraping):**

| Source | Type | URL | Notes |
|--------|------|-----|-------|
| AZCentral | RSS | `https://rssfeeds.azcentral.com/phoenix/home` | Phoenix metro primary |
| KJZZ (NPR Phoenix) | RSS | `https://kjzz.org/rss.xml` | Local NPR affiliate |
| Daily Press (Escanaba) | Browser | `https://www.dailypress.net/` | Delta County primary; needs selectors |
| TV6 Upper Michigan (WLUC) | Browser | `https://www.uppermichiganssource.com/news` | NBC/FOX UP affiliate |

**Browser source selector configs:**

Daily Press (Escanaba):
```json
{
  "type": "browser",
  "url": "https://www.dailypress.net/",
  "selectors": {
    "headlines": { "selector": "h2 a, h3 a", "multiple": true },
    "links": { "selector": "h2 a, h3 a", "attribute": "href", "multiple": true },
    "summaries": { "selector": ".article-summary, .preview-text, p.summary", "multiple": true }
  },
  "waitFor": "article, .story, main",
  "scrollToBottom": true
}
```

TV6 Upper Michigan:
```json
{
  "type": "browser",
  "url": "https://www.uppermichiganssource.com/news",
  "selectors": {
    "headlines": { "selector": "h3 a, .headline a", "multiple": true },
    "links": { "selector": "h3 a, .headline a", "attribute": "href", "multiple": true }
  },
  "waitFor": ".card, article, main"
}
```

**Note:** Browser selectors may need adjustment after initial run — local news sites change their markup periodically. The script includes a comment documenting this.

**Analysis Prompt:**

Analyze local news for two communities: Phoenix, AZ metro area and Delta County, Michigan (Upper Peninsula).

Organize by location:

**Phoenix Metro (AZCentral, KJZZ):**
- Top local stories: city council actions, development projects, transportation
- Public safety: notable incidents, policy changes
- Education: school district news, university developments
- Environment: water issues, heat preparedness, air quality, wildfire updates
- Economy: major employers, real estate trends, tourism
- Flag any extreme heat advisories, water restrictions, or wildfire evacuations as HIGH PRIORITY

**Delta County, MI (Daily Press, TV6):**
- Top local stories: county board actions, community events, school news
- Natural resources: hunting/fishing seasons, DNR updates, Great Lakes conditions
- Economy: tourism, small business, UP development projects
- Weather impacts: road conditions, school closures, lake effect events
- Flag any severe weather impacts, road closures, or emergency declarations as HIGH PRIORITY

Cross-community insights:
- Any stories with national implications originating locally?
- Compare quality of life themes between a major metro and rural community
- Note seasonal patterns unique to each location

Compare to previous runs:
- Track developing local stories (council decisions, ongoing investigations, weather events)
- Note new stories vs. updates on known situations
- Flag stories that have persisted across multiple runs (community concerns gaining traction)

---

## API Keys & Environment Variables

Several sources require free API keys. The script will:

1. Check for required keys in environment variables
2. For missing keys, log a setup instruction with the registration URL
3. Create the job with the keyed sources commented out (or omitted), so the base job still works

| Variable | Source | Registration URL | Cost |
|----------|--------|-----------------|------|
| `PIRATE_WEATHER_KEY` | Pirate Weather | `https://pirate-weather.apiable.io/` | Free |
| `FINNHUB_API_KEY` | Finnhub | `https://finnhub.io/register` | Free (60/min) |
| `ALPHA_VANTAGE_KEY` | Alpha Vantage | `https://www.alphavantage.co/support/#api-key` | Free (25/day) |
| `FRED_API_KEY` | FRED | `https://fred.stlouisfed.org/docs/api/api_key.html` | Free |
| `MESSARI_API_KEY` | Messari | `https://messari.io/api` | Free tier |

**Total cost: $0/month** — all sources use free tiers.

---

## Implementation Notes

- **RSS `fields` parameter:** All RSS sources should include `fields: ['title', 'link', 'pubDate', 'content']` for consistency with existing `seed.ts` jobs. This ensures explicit control over which fields are extracted rather than relying on defaults.
- **Browser selector fragility:** Local news site selectors (Job 8) will likely need adjustment after the first run. The script should include comments documenting this expectation and how to update selectors.
- **NWS grid point verification:** Before finalizing, hit `https://api.weather.gov/points/{lat},{lon}` for both locations to confirm grid coordinates match the forecast URLs.

## Execution Plan

1. Create `scripts/add-jobs.ts` with all 7 new jobs + 1 extension
2. Import types from `src/types/index.ts` for type safety
3. Add `add-jobs` npm script to `package.json`
4. Test with `--dry-run` first
5. Run against live server
6. Verify jobs appear in dashboard and execute on schedule

---

## Out of Scope

- UI changes (separate sub-project)
- Code refactoring (separate sub-project)
- Webhook configuration for new jobs
- RSSHub self-hosting
- Paid API tier upgrades
