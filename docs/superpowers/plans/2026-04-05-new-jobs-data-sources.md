# New Jobs & Data Sources Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `scripts/add-jobs.ts` that provisions 7 new data collection jobs and extends 1 existing job via the Croniq REST API.

**Architecture:** A standalone TypeScript script using the admin bypass auth pattern from `scripts/seed.ts`. Each job category is a pure function returning a typed payload. The script supports `--dry-run`, `--category`, and `--update-news` flags. It uses the REST API (not direct DB) to validate through the Zod schema layer.

**Tech Stack:** TypeScript, `dotenv`, native `fetch`, existing Croniq types from `src/types/index.ts`

**Spec:** `docs/superpowers/specs/2026-04-05-new-jobs-data-sources-design.md`

---

## Chunk 1: Script Scaffold & Infrastructure

### Task 1: Verify NWS grid points

**Files:** None (verification only)

- [ ] **Step 1: Verify Phoenix grid coordinates**

Run:
```bash
curl -s -H "User-Agent: (croniq, test)" "https://api.weather.gov/points/33.35,-111.79" | grep -E '"gridId"|"gridX"|"gridY"'
```
Expected: `gridId: "PSR"`, `gridX: 173`, `gridY: 58` — matching the spec URLs.

- [ ] **Step 2: Verify Delta County grid coordinates**

Run:
```bash
curl -s -H "User-Agent: (croniq, test)" "https://api.weather.gov/points/45.77,-86.55" | grep -E '"gridId"|"gridX"|"gridY"'
```
Expected: `gridId: "MQT"`, `gridX: 109`, `gridY: 79` — matching the spec URLs.

- [ ] **Step 3: If coordinates don't match, update the URLs in the spec and in this plan**

Note the correct values and adjust Job 3 source URLs accordingly.

---

### Task 2: Create the script scaffold with CLI parsing and API client

**Files:**
- Create: `scripts/add-jobs.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Add the npm script to `package.json`**

In the `"scripts"` section of `package.json`, add after the `"db:seed"` line:

```json
"db:add-jobs": "tsx scripts/add-jobs.ts"
```

- [ ] **Step 2: Create `scripts/add-jobs.ts` with scaffold**

Create the file with CLI argument parsing, admin authentication, API client helpers, and the main orchestration function. No job definitions yet — just the infrastructure.

```typescript
/**
 * Add curated data collection jobs to Croniq via the REST API.
 *
 * Usage:
 *   npm run db:add-jobs                              # create all new jobs
 *   npm run db:add-jobs -- --dry-run                 # preview without creating
 *   npm run db:add-jobs -- --category progressive    # create one category only
 *   npm run db:add-jobs -- --update-news             # extend existing news aggregation job
 *
 * Requires: SESSION_SECRET env var (same as seed.ts)
 * Requires: Croniq server running on CRONIQ_URL (default http://localhost:3001/api)
 */

import 'dotenv/config';
import type { DataSource, Job, OutputFormat } from '../src/types/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE = process.env.CRONIQ_URL ?? 'http://localhost:3001/api';
const ADMIN_KEY = process.env.SESSION_SECRET;

if (!ADMIN_KEY) {
  console.error('[add-jobs] SESSION_SECRET env var is required');
  process.exit(1);
}

const adminHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Admin-Key': ADMIN_KEY,
};

// ─── CLI Flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const UPDATE_NEWS = args.includes('--update-news');
const categoryIdx = args.indexOf('--category');
const CATEGORY = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined;

if (UPDATE_NEWS && CATEGORY) {
  console.error('[add-jobs] --update-news and --category are mutually exclusive');
  process.exit(1);
}

// ─── Shared Defaults ─────────────────────────────────────────────────────────

const DEFAULTS = {
  outputFormat: 'json' as const,
  retries: 2,
};

const RSS_FIELDS: ('title' | 'link' | 'pubDate' | 'content')[] = [
  'title', 'link', 'pubDate', 'content',
];

const NWS_HEADERS = {
  'User-Agent': '(croniq, djheru@gmail.com)',
};

// ─── Job Definitions (added in subsequent tasks) ─────────────────────────────

// Derived from CreateJobInput (src/types/index.ts) — omits optional fields we don't use.
// NOTE: 300000ms is the hard API ceiling for timeoutMs (Zod max validation).
interface JobPayload {
  name: string;
  description: string;
  schedule: string;
  sources: DataSource[];
  tags: string[];
  notifyOnChange: boolean;
  retries: number;
  timeoutMs: number;
  outputFormat: OutputFormat;
  jobPrompt: string;
}

// Category registry — each function returns a JobPayload
const JOB_CATEGORIES: Record<string, () => JobPayload> = {};

// ─── API Helpers ─────────────────────────────────────────────────────────────

const api = {
  get: async <T>(path: string): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, { headers: adminHeaders });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    const json = await res.json() as { data: T };
    return json.data;
  },

  post: async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let errMsg: string;
      try { errMsg = (JSON.parse(text) as { error: string }).error ?? text; } catch { errMsg = text; }
      throw new Error(`POST ${path} failed: ${res.status} — ${errMsg}`);
    }
    return (JSON.parse(text) as { data: T }).data;
  },

  patch: async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let errMsg: string;
      try { errMsg = (JSON.parse(text) as { error: string }).error ?? text; } catch { errMsg = text; }
      throw new Error(`PATCH ${path} failed: ${res.status} — ${errMsg}`);
    }
    return (JSON.parse(text) as { data: T }).data;
  },
};

// ─── Orchestration ───────────────────────────────────────────────────────────

interface Result {
  name: string;
  status: 'created' | 'skipped' | 'updated' | 'failed';
  reason?: string;
}

const run = async (): Promise<void> => {
  console.log(`\n🔧 Croniq Job Provisioner`);
  console.log(`   Server: ${BASE}`);
  console.log(`   Mode:   ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (CATEGORY) console.log(`   Category: ${CATEGORY}`);
  if (UPDATE_NEWS) console.log(`   Action: Update existing news job`);
  console.log('');

  // Fetch existing jobs for idempotency check
  const existingJobs = await api.get<Job[]>('/jobs');
  const existingNames = new Set(existingJobs.map(j => j.name));

  const results: Result[] = [];

  // Handle --update-news separately
  if (UPDATE_NEWS) {
    await updateMainstreamNews(existingJobs, results);
    printResults(results);
    return;
  }

  // Determine which categories to create
  const categories = CATEGORY
    ? { [CATEGORY]: JOB_CATEGORIES[CATEGORY] }
    : JOB_CATEGORIES;

  if (CATEGORY && !JOB_CATEGORIES[CATEGORY]) {
    console.error(`Unknown category: ${CATEGORY}`);
    console.error(`Available: ${Object.keys(JOB_CATEGORIES).join(', ')}`);
    process.exit(1);
  }

  // Weather is special: it updates an existing job in-place (PATCH) to preserve run history,
  // rather than creating a new job. Handle it outside the normal creation loop.
  if (!CATEGORY || CATEGORY === 'weather') {
    await upsertWeatherJob(existingJobs, results);
  }

  // Create new jobs
  for (const [category, buildJob] of Object.entries(categories)) {
    if (category === 'weather') continue; // handled above
    const payload = buildJob();

    if (existingNames.has(payload.name)) {
      results.push({ name: payload.name, status: 'skipped', reason: 'already exists' });
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Would create: ${payload.name} (${payload.sources.length} sources)`);
      results.push({ name: payload.name, status: 'skipped', reason: 'dry run' });
      continue;
    }

    try {
      await api.post('/jobs', payload);
      results.push({ name: payload.name, status: 'created' });
    } catch (err) {
      results.push({
        name: payload.name,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  printResults(results);
};

// ─── Weather Upsert ──────────────────────────────────────────────────────────

const upsertWeatherJob = async (existingJobs: Job[], results: Result[]): Promise<void> => {
  if (!JOB_CATEGORIES['weather']) return;
  const payload = JOB_CATEGORIES['weather']();
  const existing = existingJobs.find(j => j.name === 'Weather — Multi-Location Monitoring');

  if (DRY_RUN) {
    console.log(`  [dry-run] Would ${existing ? 'update' : 'create'}: ${payload.name}`);
    results.push({ name: payload.name, status: 'skipped', reason: 'dry run' });
    return;
  }

  try {
    if (existing) {
      await api.patch(`/jobs/${existing.id}`, payload);
      results.push({ name: payload.name, status: 'updated' });
    } else {
      await api.post('/jobs', payload);
      results.push({ name: payload.name, status: 'created' });
    }
  } catch (err) {
    results.push({
      name: payload.name,
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    });
  }
};

// ─── Mainstream News Extension ───────────────────────────────────────────────

const updateMainstreamNews = async (existingJobs: Job[], results: Result[]): Promise<void> => {
  // Implemented in Task 9
  results.push({ name: 'News — Multi-Source Aggregation', status: 'skipped', reason: 'not yet implemented' });
};

// ─── Output ──────────────────────────────────────────────────────────────────

const printResults = (results: Result[]): void => {
  console.log('\n─── Results ───────────────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'created' ? '✓' :
                 r.status === 'updated' ? '↻' :
                 r.status === 'skipped' ? '○' : '✗';
    const suffix = r.reason ? ` (${r.reason})` : '';
    console.log(`  ${icon} ${r.name} — ${r.status}${suffix}`);
  }
  console.log(`\n  Total: ${results.length} | Created: ${results.filter(r => r.status === 'created').length} | Updated: ${results.filter(r => r.status === 'updated').length} | Skipped: ${results.filter(r => r.status === 'skipped').length} | Failed: ${results.filter(r => r.status === 'failed').length}`);
  console.log('');
};

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the script compiles**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsc --noEmit scripts/add-jobs.ts --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck 2>&1 | head -20
```
Expected: No errors (or only minor ones we'll fix).

- [ ] **Step 4: Test `--dry-run` with empty categories**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run
```
Expected: Shows header, reports 0 jobs (no categories registered yet), clean exit.

- [ ] **Step 5: Commit scaffold**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts package.json && git commit -m "feat: add-jobs script scaffold with CLI parsing and API client"
```

---

## Chunk 2: Job Definitions — Part 1 (RSS-only jobs)

### Task 3: Add Progressive News & Analysis job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `progressive` job category function**

Add after the `JOB_CATEGORIES` declaration in `scripts/add-jobs.ts`:

```typescript
JOB_CATEGORIES['progressive'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'Progressive News & Analysis',
  description: 'Progressive and investigative journalism from six left-leaning publications',
  schedule: '0 */2 * * *',
  tags: ['news', 'progressive', 'politics'],
  notifyOnChange: true,
  timeoutMs: 300000,
  sources: [
    {
      name: 'The Intercept',
      config: { type: 'rss', url: 'https://theintercept.com/feed/?rss', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Mother Jones',
      config: { type: 'rss', url: 'https://www.motherjones.com/feed/', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Jacobin',
      config: { type: 'rss', url: 'https://jacobin.com/feed', maxItems: 8, fields: RSS_FIELDS },
    },
    {
      name: 'The Nation',
      config: { type: 'rss', url: 'https://www.thenation.com/feed/', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'ProPublica',
      config: { type: 'rss', url: 'https://feeds.propublica.org/propublica/main', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Common Dreams',
      config: { type: 'rss', url: 'https://www.commondreams.org/feeds/feed.rss', maxItems: 10, fields: RSS_FIELDS },
    },
  ],
  jobPrompt: `Analyze progressive and investigative news across six publications spanning investigative journalism (ProPublica, The Intercept), political commentary (Mother Jones, The Nation), democratic socialist perspective (Jacobin), and grassroots progressive coverage (Common Dreams).

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

Compare against previous runs to identify story persistence, new developments, and shifting editorial focus.`,
});
```

- [ ] **Step 2: Test dry-run with progressive category**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category progressive
```
Expected: Shows `[dry-run] Would create: Progressive News & Analysis (6 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add progressive news job definition"
```

---

### Task 4: Add Crypto Market Intelligence job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `crypto` job category function**

```typescript
JOB_CATEGORIES['crypto'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'Crypto Market Intelligence',
  description: 'Crypto market news, analysis, and sentiment from industry sources',
  schedule: '0 */3 * * *',
  tags: ['crypto', 'analysis', 'defi'],
  notifyOnChange: true,
  timeoutMs: 180000,
  sources: [
    {
      name: 'The Block',
      config: { type: 'rss', url: 'https://www.theblock.co/rss/all', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'CoinDesk',
      config: { type: 'rss', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Decrypt',
      config: { type: 'rss', url: 'https://decrypt.co/feed', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Fear & Greed Index',
      config: { type: 'api', url: 'https://api.alternative.me/fng/?limit=1' },
    },
    // Future: Uncomment when API keys are configured
    // { name: 'Messari', config: { type: 'api', url: 'https://data.messari.io/api/v1/news', headers: { 'x-messari-api-key': '${MESSARI_API_KEY}' } } },
  ],
  jobPrompt: `Analyze crypto market intelligence from three news sources and the Fear & Greed Index.

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
- Identify stories that have gone from single-source to multi-source coverage (gaining momentum)`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category crypto
```
Expected: Shows `[dry-run] Would create: Crypto Market Intelligence (4 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add crypto market intelligence job definition"
```

---

### Task 5: Add AWS Serverless & TypeScript Ecosystem job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `aws` job category function**

```typescript
JOB_CATEGORIES['aws'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'AWS Serverless & TypeScript Ecosystem',
  description: 'AWS serverless updates, TypeScript ecosystem news, and community thought leadership',
  schedule: '0 8,17 * * *',
  tags: ['aws', 'serverless', 'typescript', 'ecosystem'],
  notifyOnChange: true,
  timeoutMs: 240000,
  sources: [
    {
      name: 'AWS Compute Blog',
      config: { type: 'rss', url: 'https://aws.amazon.com/blogs/compute/feed/', maxItems: 8, fields: RSS_FIELDS },
    },
    {
      name: "AWS What's New",
      config: { type: 'rss', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', maxItems: 15, fields: RSS_FIELDS },
    },
    {
      name: 'Yan Cui (theburningmonk)',
      config: { type: 'rss', url: 'https://theburningmonk.com/feed/', maxItems: 5, fields: RSS_FIELDS },
    },
    {
      name: 'Matt Pocock (Total TypeScript)',
      config: { type: 'rss', url: 'https://www.totaltypescript.com/rss.xml', maxItems: 5, fields: RSS_FIELDS },
    },
    {
      name: 'TypeScript Blog (Microsoft)',
      config: { type: 'rss', url: 'https://devblogs.microsoft.com/typescript/feed/', maxItems: 5, fields: RSS_FIELDS },
    },
    {
      name: 'Powertools Lambda TS Releases',
      config: { type: 'rss', url: 'https://github.com/aws-powertools/powertools-lambda-typescript/releases.atom', maxItems: 5, fields: RSS_FIELDS },
    },
  ],
  jobPrompt: `Analyze the AWS serverless and TypeScript ecosystem from official AWS sources, community thought leaders, and key library releases.

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

Compare to previous runs to track announcement cadence, identify follow-up posts, and note community response to major announcements.`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category aws
```
Expected: Shows `[dry-run] Would create: AWS Serverless & TypeScript Ecosystem (6 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add AWS serverless and TypeScript ecosystem job definition"
```

---

### Task 6: Add House Music Scene job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `music` job category function**

```typescript
JOB_CATEGORIES['music'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'House Music Scene',
  description: 'House music news, releases, and DJ activity from electronic music publications',
  schedule: '0 10 * * *',
  tags: ['music', 'house', 'electronic'],
  notifyOnChange: true,
  timeoutMs: 240000,
  sources: [
    {
      name: 'Resident Advisor News',
      config: { type: 'rss', url: 'https://ra.co/xml/news.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Resident Advisor Podcast',
      config: { type: 'rss', url: 'https://ra.co/xml/podcast.xml', maxItems: 5, fields: RSS_FIELDS },
    },
    {
      name: 'DJ Mag',
      config: { type: 'rss', url: 'https://djmag.com/feed', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Magnetic Magazine',
      config: { type: 'rss', url: 'https://www.magneticmag.com/feed/', maxItems: 8, fields: RSS_FIELDS },
    },
  ],
  jobPrompt: `Curate the house music scene from four key electronic music publications.

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
- Identify developing stories (festival lineups filling out, album rollout campaigns)`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category music
```
Expected: Shows `[dry-run] Would create: House Music Scene (4 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add house music scene job definition"
```

---

### Task 7: Add Business & Markets job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `business` job category function**

```typescript
JOB_CATEGORIES['business'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'Business & Markets',
  description: 'Financial news and market analysis from major business media, weekday market hours',
  schedule: '0 7,12,17 * * 1-5',
  tags: ['business', 'markets', 'finance'],
  notifyOnChange: true,
  timeoutMs: 240000,
  sources: [
    {
      name: 'MarketWatch Top Stories',
      config: { type: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'CNBC Top News',
      config: { type: 'rss', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'WSJ Markets',
      config: { type: 'rss', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Seeking Alpha',
      config: { type: 'rss', url: 'https://seekingalpha.com/feed.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    // Future: Uncomment when API keys are configured
    // { name: 'Finnhub Market News', config: { type: 'api', url: `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}` } },
    // { name: 'FRED Fed Funds Rate', config: { type: 'api', url: `https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=1` } },
  ],
  jobPrompt: `Analyze business and market news from four major financial media sources, running on weekday market hours.

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
- Identify stories that have persisted across multiple sessions vs. one-day events`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category business
```
Expected: Shows `[dry-run] Would create: Business & Markets (4 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add business and markets job definition"
```

---

## Chunk 3: Job Definitions — Part 2 (API + Browser jobs)

### Task 8: Add Weather — Enhanced Multi-Location job

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `weather` job category function**

Note: Uses NWS API with required `User-Agent` header. Grid points verified in Task 1.

```typescript
JOB_CATEGORIES['weather'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'Weather — Enhanced Multi-Location',
  description: 'NWS forecasts and alerts for Gilbert AZ and Garden MI with severe weather detection',
  schedule: '0 */3 * * *',
  tags: ['weather', 'monitoring', 'alerts'],
  notifyOnChange: true,
  timeoutMs: 180000,
  sources: [
    {
      name: 'NWS Phoenix Forecast',
      config: {
        type: 'api',
        url: 'https://api.weather.gov/gridpoints/PSR/173,58/forecast',
        headers: NWS_HEADERS,
      },
    },
    {
      name: 'NWS Delta County Forecast',
      config: {
        type: 'api',
        url: 'https://api.weather.gov/gridpoints/MQT/109,79/forecast',
        headers: NWS_HEADERS,
      },
    },
    {
      name: 'NWS Phoenix Alerts',
      config: {
        type: 'api',
        url: 'https://api.weather.gov/alerts/active?point=33.35,-111.79',
        headers: NWS_HEADERS,
      },
    },
    {
      name: 'NWS Delta County Alerts',
      config: {
        type: 'api',
        url: 'https://api.weather.gov/alerts/active?point=45.77,-86.55',
        headers: NWS_HEADERS,
      },
    },
    // Future: Uncomment when PIRATE_WEATHER_KEY is set
    // { name: 'Pirate Weather Phoenix', config: { type: 'api', url: `https://api.pirateweather.net/forecast/${process.env.PIRATE_WEATHER_KEY}/33.35,-111.79?units=us` } },
    // { name: 'Pirate Weather Garden MI', config: { type: 'api', url: `https://api.pirateweather.net/forecast/${process.env.PIRATE_WEATHER_KEY}/45.77,-86.55?units=us` } },
  ],
  jobPrompt: `Monitor weather conditions for Gilbert, AZ (Phoenix metro) and Garden, MI (Delta County, Upper Peninsula) using official NWS data.

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
- Identify prolonged conditions (heat waves, cold snaps, extended precipitation)`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category weather
```
Expected: Shows `[dry-run] Would update: Weather — Enhanced Multi-Location` (or create, depending on whether the existing job is running).

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add enhanced weather job with NWS alerts"
```

---

### Task 9: Add Local News job (RSS + browser scraping)

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Add the `local` job category function**

Note: This job mixes RSS and browser sources. Browser selectors may need adjustment after the first run — local news sites change their markup periodically.

```typescript
JOB_CATEGORIES['local'] = (): JobPayload => ({
  ...DEFAULTS,
  name: 'Local News — Delta County MI & Phoenix AZ',
  description: 'Local news coverage for Delta County MI and Phoenix AZ metro via RSS and browser scraping',
  schedule: '0 7,17 * * *',
  tags: ['local', 'michigan', 'phoenix', 'community'],
  notifyOnChange: true,
  timeoutMs: 300000,
  sources: [
    {
      name: 'AZCentral (Phoenix)',
      config: { type: 'rss', url: 'https://rssfeeds.azcentral.com/phoenix/home', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'KJZZ NPR Phoenix',
      config: { type: 'rss', url: 'https://kjzz.org/rss.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      // NOTE: Browser selectors are fragile for local news sites.
      // If this source fails, inspect https://www.dailypress.net/ and update selectors.
      name: 'Daily Press (Escanaba, MI)',
      config: {
        type: 'browser',
        url: 'https://www.dailypress.net/',
        selectors: {
          headlines: { selector: 'h2 a, h3 a', multiple: true },
          links: { selector: 'h2 a, h3 a', attribute: 'href', multiple: true },
          summaries: { selector: '.article-summary, .preview-text, p.summary', multiple: true },
        },
        waitFor: 'article, .story, main',
        scrollToBottom: true,
      },
    },
    {
      // NOTE: Browser selectors are fragile for local news sites.
      // If this source fails, inspect https://www.uppermichiganssource.com/news and update selectors.
      name: 'TV6 Upper Michigan (WLUC)',
      config: {
        type: 'browser',
        url: 'https://www.uppermichiganssource.com/news',
        selectors: {
          headlines: { selector: 'h3 a, .headline a', multiple: true },
          links: { selector: 'h3 a, .headline a', attribute: 'href', multiple: true },
        },
        waitFor: '.card, article, main',
      },
    },
  ],
  jobPrompt: `Analyze local news for two communities: Phoenix, AZ metro area and Delta County, Michigan (Upper Peninsula).

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
- Flag stories that have persisted across multiple runs (community concerns gaining traction)`,
});
```

- [ ] **Step 2: Test dry-run**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --category local
```
Expected: Shows `[dry-run] Would create: Local News — Delta County MI & Phoenix AZ (4 sources)`

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add local news job with browser scraping for MI and AZ"
```

---

### Task 10: Implement mainstream news extension (`--update-news`)

**Files:**
- Modify: `scripts/add-jobs.ts`

- [ ] **Step 1: Replace the `updateMainstreamNews` stub with the real implementation**

Replace the placeholder function with:

```typescript
const updateMainstreamNews = async (existingJobs: Job[], results: Result[]): Promise<void> => {
  const JOB_NAME = 'News — Multi-Source Aggregation';
  const existing = existingJobs.find(j => j.name === JOB_NAME);

  if (!existing) {
    results.push({ name: JOB_NAME, status: 'failed', reason: 'job not found — cannot extend' });
    return;
  }

  // New sources to append
  const newSources: DataSource[] = [
    {
      name: 'BBC US/Canada',
      config: { type: 'rss', url: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'NYT Homepage',
      config: { type: 'rss', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'AP News',
      // NOTE: RSSHub public instance can be rate-limited. Fallback: https://feedx.net/rss/ap.xml
      config: { type: 'rss', url: 'https://rsshub.app/apnews/topics/apf-topnews', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'PBS NewsHour',
      config: { type: 'rss', url: 'https://www.pbs.org/newshour/feeds/rss/headlines', maxItems: 10, fields: RSS_FIELDS },
    },
    {
      name: 'Al Jazeera',
      config: { type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', maxItems: 8, fields: RSS_FIELDS },
    },
  ];

  // Client-side merge: existing sources + new sources
  // The PATCH endpoint REPLACES the sources array — it does not merge.
  const existingSourceNames = new Set(existing.sources.map(s => s.name));
  const sourcesToAdd = newSources.filter(s => !existingSourceNames.has(s.name));

  if (sourcesToAdd.length === 0) {
    results.push({ name: JOB_NAME, status: 'skipped', reason: 'all sources already present' });
    return;
  }

  const mergedSources = [...existing.sources, ...sourcesToAdd];

  const updatedPrompt = `Analyze news coverage across eight major sources spanning wire services (AP), public media (NPR, PBS NewsHour), international perspectives (The Guardian, BBC, Al Jazeera), and US newspapers (Washington Post, New York Times).

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

Compare to previous runs to track story evolution, emergence of new narratives, and the news cycle's attention span.`;

  if (DRY_RUN) {
    console.log(`  [dry-run] Would update: ${JOB_NAME} (${existing.sources.length} → ${mergedSources.length} sources)`);
    results.push({ name: JOB_NAME, status: 'skipped', reason: 'dry run' });
    return;
  }

  try {
    await api.patch(`/jobs/${existing.id}`, {
      sources: mergedSources,
      jobPrompt: updatedPrompt,
      description: 'Aggregated news from 8 major sources: wire services, public media, international, and US newspapers',
    });
    results.push({ name: JOB_NAME, status: 'updated' });
  } catch (err) {
    results.push({
      name: JOB_NAME,
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    });
  }
};
```

- [ ] **Step 2: Test dry-run with `--update-news`**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run --update-news
```
Expected: Shows `[dry-run] Would update: News — Multi-Source Aggregation (3 → 8 sources)` (assumes server is running and the job exists).

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/kali/croniq && git add scripts/add-jobs.ts && git commit -m "feat: add mainstream news extension with client-side source merge"
```

---

## Chunk 4: Full Integration Test & Live Execution

### Task 11: Full dry-run of all categories

**Files:** None (verification only)

- [ ] **Step 1: Run full dry-run (requires server running)**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --dry-run
```
Expected output:
```
🔧 Croniq Job Provisioner
   Server: http://localhost:3001/api
   Mode:   DRY RUN

  [dry-run] Would update: Weather — Enhanced Multi-Location
  [dry-run] Would create: Progressive News & Analysis (6 sources)
  [dry-run] Would create: Crypto Market Intelligence (4 sources)
  [dry-run] Would create: AWS Serverless & TypeScript Ecosystem (6 sources)
  [dry-run] Would create: House Music Scene (4 sources)
  [dry-run] Would create: Business & Markets (4 sources)
  [dry-run] Would create: Local News — Delta County MI & Phoenix AZ (4 sources)

─── Results ───────────────────────────────────────
  ...
  Total: 7 | Created: 0 | Updated: 0 | Skipped: 7 | Failed: 0
```

- [ ] **Step 2: If any failures, debug and fix**

Common issues:
- Server not running → start with `npm run dev:server`
- SESSION_SECRET not set → check `.env` file
- TypeScript errors → fix type mismatches

---

### Task 12: Live execution — create all jobs

**Files:** None (execution only)

- [ ] **Step 1: Create all new jobs**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts
```
Expected: All 7 jobs show `created` or `updated` status.

- [ ] **Step 2: Extend the mainstream news job**

Run:
```bash
cd ~/Workspace/kali/croniq && npx tsx scripts/add-jobs.ts --update-news
```
Expected: Shows `News — Multi-Source Aggregation — updated`.

- [ ] **Step 3: Verify jobs in the dashboard**

Open `https://croniq.local/app` in the browser and confirm all new jobs appear in the job list. Verify:
- Each job shows the correct number of sources
- Schedules display correctly (via cronstrue)
- Tags are visible
- The news aggregation job now shows 8 sources

- [ ] **Step 4: Manually trigger one job to verify end-to-end**

In the dashboard, trigger the "AWS Serverless & TypeScript Ecosystem" job (RSS-only, low risk) and wait for it to complete. Verify:
- Status transitions: pending → collecting → analyzing → complete
- Analysis markdown is generated
- No errors in the run detail view

- [ ] **Step 5: Commit the final script state**

```bash
cd ~/Workspace/kali/croniq && git add -A && git commit -m "feat: provision 7 new data collection jobs and extend news aggregation

New jobs:
- Progressive News & Analysis (6 RSS sources)
- Crypto Market Intelligence (3 RSS + Fear & Greed API)
- Weather Enhanced Multi-Location (4 NWS API endpoints)
- AWS Serverless & TypeScript Ecosystem (6 RSS/Atom feeds)
- House Music Scene (4 RSS feeds)
- Business & Markets (4 RSS feeds)
- Local News — Delta County MI & Phoenix AZ (2 RSS + 2 browser)

Extended:
- News Multi-Source Aggregation: 3 → 8 sources (added BBC, NYT, AP, PBS, Al Jazeera)"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Verify NWS grid points | 2 min |
| 2 | Script scaffold + CLI + API client | 5 min |
| 3 | Progressive News job | 3 min |
| 4 | Crypto Market Intelligence job | 3 min |
| 5 | AWS Serverless & TypeScript job | 3 min |
| 6 | House Music Scene job | 3 min |
| 7 | Business & Markets job | 3 min |
| 8 | Weather Enhanced job | 3 min |
| 9 | Local News job (browser scraping) | 3 min |
| 10 | Mainstream News extension | 5 min |
| 11 | Full dry-run verification | 3 min |
| 12 | Live execution + dashboard verification | 5 min |
| **Total** | | **~41 min** |
