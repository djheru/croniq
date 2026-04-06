/**
 * Provision additional data collection jobs via the Croniq REST API.
 *
 * Usage:
 *   npm run db:add-jobs                        # create all 7 new jobs + upsert weather
 *   npm run db:add-jobs -- --dry-run            # show what would happen without calling API
 *   npm run db:add-jobs -- --update-news        # only merge sources into the News job
 *   npm run db:add-jobs -- --category crypto    # only create the crypto job
 */

import 'dotenv/config';
import type { CreateJobInput, DataSource, Job, OutputFormat } from '../src/types/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const CRONIQ_URL = process.env.CRONIQ_URL ?? 'http://localhost:3001/api';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('[add-jobs] SESSION_SECRET env var is required');
  process.exit(1);
}

const adminHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Admin-Key': SESSION_SECRET,
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

const SHARED_DEFAULTS = {
  outputFormat: 'json' as OutputFormat,
  retries: 2,
};

const RSS_FIELDS: ('title' | 'link' | 'pubDate' | 'content')[] = ['title', 'link', 'pubDate', 'content'];

const NWS_HEADERS: Record<string, string> = {
  'User-Agent': '(croniq, djheru@gmail.com)',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobPayload extends Omit<CreateJobInput, 'outputFormat' | 'retries'> {
  outputFormat?: OutputFormat;
  retries?: number;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

const api = {
  get: async <T>(path: string): Promise<T> => {
    const res = await fetch(`${CRONIQ_URL}${path}`, { headers: adminHeaders });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return (json as { data?: T }).data ?? json as T;
  },

  post: async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${CRONIQ_URL}${path}`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return (json as { data?: T }).data ?? json as T;
  },

  patch: async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${CRONIQ_URL}${path}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return (json as { data?: T }).data ?? json as T;
  },
};

// ─── Job Categories ──────────────────────────────────────────────────────────

const JOB_CATEGORIES: Record<string, () => JobPayload> = {
  progressive: () => ({
    name: 'Progressive News & Analysis',
    description: 'Investigative and progressive journalism from 6 independent outlets',
    schedule: '0 */2 * * *',
    timeoutMs: 300000,
    tags: ['news', 'progressive', 'politics'],
    notifyOnChange: true,
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
    jobPrompt:
      'Analyze progressive and investigative news coverage across 6 independent outlets: The Intercept, Mother Jones, Jacobin, The Nation, ProPublica, and Common Dreams. For each story:\n' +
      '- Headline and publication time\n' +
      '- 1-2 sentence summary\n' +
      '- Source attribution\n' +
      '- Topic: Politics, Labor, Climate, Justice, Corporate Accountability, Foreign Policy, or Other\n\n' +
      'Cross-source analysis:\n' +
      '- Identify stories covered by multiple outlets — note differences in framing, depth, or angle\n' +
      '- Flag investigative exclusives and long-form pieces\n' +
      '- Detect emerging stories or under-covered issues gaining traction\n\n' +
      'Provide a synthesized view:\n' +
      '- What are the dominant themes across progressive media?\n' +
      '- Are there stories being covered here that are absent from mainstream outlets?\n' +
      '- Rank the top 5 stories by significance and investigative depth\n\n' +
      'Compare to previous runs to track story evolution, developing investigations, and shifts in editorial focus.',
  }),

  crypto: () => ({
    name: 'Crypto Market Intelligence',
    description: 'Crypto news aggregation and market sentiment from 4 sources',
    schedule: '0 */3 * * *',
    timeoutMs: 180000,
    tags: ['crypto', 'analysis', 'defi'],
    notifyOnChange: true,
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
      // {
      //   name: 'Messari',
      //   config: { type: 'api', url: 'https://data.messari.io/api/v1/news', headers: { 'x-messari-api-key': '${MESSARI_API_KEY}' } },
      // },
    ],
    jobPrompt:
      'Analyze crypto market intelligence across news and sentiment sources. For each news story:\n' +
      '- Headline, source, and publication time\n' +
      '- 1-2 sentence summary\n' +
      '- Topic: DeFi, Regulation, Bitcoin, Ethereum, Altcoins, NFTs, Infrastructure, or Other\n\n' +
      'Market sentiment:\n' +
      '- Fear & Greed Index value and classification (Extreme Fear, Fear, Neutral, Greed, Extreme Greed)\n' +
      '- How does current sentiment compare to the news narrative?\n\n' +
      'Market context:\n' +
      '- Identify regulatory developments or policy changes\n' +
      '- Flag major protocol upgrades, hacks, or exploits\n' +
      '- Note institutional adoption signals or major partnership announcements\n\n' +
      'Compare to previous runs to track sentiment shifts, developing regulatory stories, and market narrative evolution.',
  }),

  aws: () => ({
    name: 'AWS Serverless & TypeScript Ecosystem',
    description: 'AWS compute, serverless updates, and TypeScript ecosystem from 6 sources',
    schedule: '0 8,17 * * *',
    timeoutMs: 240000,
    tags: ['aws', 'serverless', 'typescript', 'ecosystem'],
    notifyOnChange: true,
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
        name: 'TypeScript Blog',
        config: { type: 'rss', url: 'https://devblogs.microsoft.com/typescript/feed/', maxItems: 5, fields: RSS_FIELDS },
      },
      {
        name: 'Powertools Lambda TypeScript',
        config: { type: 'rss', url: 'https://github.com/aws-powertools/powertools-lambda-typescript/releases.atom', maxItems: 5, fields: RSS_FIELDS },
      },
    ],
    jobPrompt:
      'Categorize updates from across the AWS serverless and TypeScript ecosystem. For each item:\n' +
      '- Title, source, and publication date\n' +
      '- 1-2 sentence summary\n' +
      '- Category: Lambda, CDK, DynamoDB, EventBridge, Step Functions, TypeScript Language, TypeScript Tooling, Serverless Patterns, or Other\n\n' +
      'Prioritize for a TypeScript/CDK developer:\n' +
      '- Flag breaking changes, new features, or deprecations in AWS services\n' +
      '- Highlight TypeScript language features, type system improvements, or tooling updates\n' +
      '- Note new Powertools releases with changelog highlights\n' +
      '- Identify serverless best practices or architectural patterns\n\n' +
      'Synthesis:\n' +
      '- What themes are emerging across the ecosystem?\n' +
      '- Are there updates that require action (dependency bumps, migration guides)?\n' +
      '- Rank the top 5 most relevant items for a serverless TypeScript developer\n\n' +
      'Compare to previous runs to track release cadences and developing announcements.',
  }),

  music: () => ({
    name: 'House Music Scene',
    description: 'House and electronic music news, releases, and DJ activity from 4 sources',
    schedule: '0 10 * * *',
    timeoutMs: 240000,
    tags: ['music', 'house', 'electronic'],
    notifyOnChange: true,
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
    jobPrompt:
      'Analyze the house and electronic music scene across 4 sources. For each item:\n' +
      '- Title, source, and date\n' +
      '- 1-2 sentence summary\n' +
      '- Category: New Music & Releases, DJ Activity & Mixes, Scene & Culture, Events & Festivals, or Other\n\n' +
      'New music & releases:\n' +
      '- Highlight new tracks, EPs, and albums in house, deep house, tech house, and adjacent genres\n' +
      '- Note label affiliations and notable collaborations\n\n' +
      'DJ activity:\n' +
      '- New mixes, podcasts, and live sets\n' +
      '- Tour announcements and residency news\n' +
      '- RA podcast features and guest mixes\n\n' +
      'Scene & culture:\n' +
      '- Festival lineups and venue news\n' +
      '- Industry trends and cultural commentary\n' +
      '- Emerging artists and breakthrough moments\n\n' +
      'Compare to previous runs to track release cycles, touring patterns, and evolving scene trends.',
  }),

  business: () => ({
    name: 'Business & Markets',
    description: 'Financial markets and business news from 4 major outlets',
    schedule: '0 7,12,17 * * 1-5',
    timeoutMs: 240000,
    tags: ['business', 'markets', 'finance'],
    notifyOnChange: true,
    sources: [
      {
        name: 'MarketWatch',
        config: { type: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', maxItems: 10, fields: RSS_FIELDS },
      },
      {
        name: 'CNBC',
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
      // {
      //   name: 'Finnhub Market News',
      //   config: { type: 'api', url: 'https://finnhub.io/api/v1/news?category=general', headers: { 'X-Finnhub-Token': '${FINNHUB_API_KEY}' } },
      // },
      // {
      //   name: 'FRED Economic Data',
      //   config: { type: 'api', url: 'https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${FRED_API_KEY}&file_type=json&limit=5&sort_order=desc' },
      // },
    ],
    jobPrompt:
      'Analyze business and financial market news across 4 major sources: MarketWatch, CNBC, WSJ Markets, and Seeking Alpha. For each story:\n' +
      '- Headline, source, and publication time\n' +
      '- 1-2 sentence summary\n' +
      '- Topic: Equities, Bonds, Commodities, Crypto, Economy, Earnings, M&A, Policy, or Other\n\n' +
      'Market overview:\n' +
      '- What is the overall market narrative today?\n' +
      '- Identify the key drivers moving markets (Fed policy, earnings, geopolitical events)\n' +
      '- Flag any significant index moves or sector rotations\n\n' +
      'Sector analysis:\n' +
      '- Which sectors are in focus and why?\n' +
      '- Note any major earnings reports or corporate actions\n\n' +
      'Economic context:\n' +
      '- Highlight macroeconomic data releases and their market impact\n' +
      '- Track Fed commentary and interest rate expectations\n\n' +
      'Cross-source comparison:\n' +
      '- Note differences in framing between sources (bullish vs bearish tone)\n' +
      '- Rank top 5 stories by market significance\n\n' +
      'Compare to previous runs to track developing narratives, earnings season progress, and market momentum.',
  }),

  weather: () => ({
    name: 'Weather — Enhanced Multi-Location',
    description: 'NWS forecasts and alerts for Phoenix, AZ and Delta County, MI',
    schedule: '0 */3 * * *',
    timeoutMs: 180000,
    tags: ['weather', 'monitoring', 'alerts'],
    notifyOnChange: true,
    sources: [
      {
        name: 'Phoenix Forecast (NWS)',
        config: { type: 'api', url: 'https://api.weather.gov/gridpoints/PSR/169,52/forecast', headers: NWS_HEADERS },
      },
      {
        name: 'Delta County Forecast (NWS)',
        config: { type: 'api', url: 'https://api.weather.gov/gridpoints/MQT/183,36/forecast', headers: NWS_HEADERS },
      },
      {
        name: 'Phoenix Alerts (NWS)',
        config: { type: 'api', url: 'https://api.weather.gov/alerts/active?point=33.35,-111.79', headers: NWS_HEADERS },
      },
      {
        name: 'Delta County Alerts (NWS)',
        config: { type: 'api', url: 'https://api.weather.gov/alerts/active?point=45.77,-86.55', headers: NWS_HEADERS },
      },
      // {
      //   name: 'Phoenix (Pirate Weather)',
      //   config: { type: 'api', url: 'https://api.pirateweather.net/forecast/${PIRATE_WEATHER_KEY}/33.35,-111.79' },
      // },
      // {
      //   name: 'Delta County (Pirate Weather)',
      //   config: { type: 'api', url: 'https://api.pirateweather.net/forecast/${PIRATE_WEATHER_KEY}/45.77,-86.55' },
      // },
    ],
    jobPrompt:
      'Report weather conditions using NWS data for two locations: Phoenix, AZ and Delta County, MI.\n\n' +
      'For each location:\n' +
      '- Current period forecast: temperature, wind, conditions\n' +
      '- Extended forecast: next 3-4 periods with highs, lows, and conditions\n' +
      '- Active alerts: type, severity, urgency, and description\n\n' +
      'Location-specific thresholds:\n' +
      '- Phoenix: Flag temps >110°F, dust storms, flash flood warnings, excessive heat warnings\n' +
      '- Delta County: Flag temps <0°F or >95°F, winter storm warnings, lake effect snow, wind chill advisories\n\n' +
      'Alert analysis:\n' +
      '- Classify each alert by severity: Extreme, Severe, Moderate, Minor\n' +
      '- Note alert effective/expiration times\n' +
      '- Highlight any watches or warnings requiring immediate attention\n\n' +
      'Comparative analysis:\n' +
      '- Temperature differential between desert and Great Lakes climates\n' +
      '- Contrasting weather patterns and seasonal context\n\n' +
      'Compare against previous runs to identify developing weather systems, prolonged conditions, and alert progression.',
  }),

  local: () => ({
    name: 'Local News — Delta County MI & Phoenix AZ',
    description: 'Local news from Delta County, MI and Phoenix, AZ via RSS and browser scraping',
    schedule: '0 7,17 * * *',
    timeoutMs: 300000,
    tags: ['local', 'michigan', 'phoenix', 'community'],
    notifyOnChange: true,
    sources: [
      {
        name: 'AZCentral',
        config: { type: 'rss', url: 'https://rssfeeds.azcentral.com/phoenix/home', maxItems: 10, fields: RSS_FIELDS },
      },
      {
        name: 'KJZZ NPR (Phoenix)',
        config: { type: 'rss', url: 'https://kjzz.org/rss.xml', maxItems: 10, fields: RSS_FIELDS },
      },
      {
        // Note: browser selectors are fragile and may need updating if site layout changes
        name: 'Daily Press (Escanaba)',
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
        // Note: browser selectors are fragile and may need updating if site layout changes
        name: 'TV6 Upper Michigan',
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
    jobPrompt:
      'Collect and organize local news from two communities: Phoenix, AZ and Delta County, MI.\n\n' +
      'Organize by location:\n\n' +
      '**Phoenix, AZ:**\n' +
      '- Topics: local government, development, water/drought, immigration, education, public safety\n' +
      '- For each story: headline, source (AZCentral or KJZZ), and 1-2 sentence summary\n' +
      '- Flag stories related to water rights, heat emergencies, or major development projects\n\n' +
      '**Delta County, MI:**\n' +
      '- Topics: local government, natural resources, tourism, schools, community events\n' +
      '- For each story: headline, source (Daily Press or TV6), and 1-2 sentence summary\n' +
      '- Flag stories related to forestry, fishing/hunting regulations, or winter weather impacts\n\n' +
      'Cross-community themes:\n' +
      '- Are there shared topics (e.g., education policy, infrastructure, climate impacts)?\n' +
      '- Note contrasts between urban (Phoenix metro) and rural (Upper Peninsula) community concerns\n\n' +
      'Compare to previous runs to track developing local stories, ongoing government proceedings, and seasonal patterns.',
  }),
};

// ─── Update Mainstream News ──────────────────────────────────────────────────

const MAINSTREAM_NEWS_NAME = 'News — Multi-Source Aggregation';

const ADDITIONAL_NEWS_SOURCES: DataSource[] = [
  {
    name: 'BBC US & Canada',
    config: { type: 'rss', url: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', maxItems: 10, fields: RSS_FIELDS },
  },
  {
    name: 'NYT Homepage',
    config: { type: 'rss', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', maxItems: 10, fields: RSS_FIELDS },
  },
  {
    // Note: RSSHub instance — reliability depends on the public instance availability
    name: 'AP News',
    config: { type: 'rss', url: 'https://rsshub.app/apnews/topics/apf-topnews', maxItems: 10, fields: RSS_FIELDS },
  },
  {
    name: 'PBS NewsHour',
    config: { type: 'rss', url: 'https://www.pbs.org/newshour/feeds/rss/headlines', maxItems: 10, fields: RSS_FIELDS },
  },
  {
    name: 'Al Jazeera',
    config: { type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', maxItems: 10, fields: RSS_FIELDS },
  },
];

const updateMainstreamNews = async (existingJobs: Job[]): Promise<{ status: 'updated' | 'skipped' | 'not-found'; message: string }> => {
  const newsJob = existingJobs.find((j) => j.name === MAINSTREAM_NEWS_NAME);
  if (!newsJob) {
    console.error(`  [update-news] Job "${MAINSTREAM_NEWS_NAME}" not found — skipping`);
    return { status: 'not-found', message: 'Job not found' };
  }

  const existingSourceNames = new Set(newsJob.sources.map((s) => s.name));
  const newSources = ADDITIONAL_NEWS_SOURCES.filter((s) => !existingSourceNames.has(s.name));

  if (newSources.length === 0) {
    console.log(`  [update-news] All sources already present — skipping`);
    return { status: 'skipped', message: 'All sources already present' };
  }

  // Client-side merge: PATCH replaces the sources array, so we combine existing + new
  const mergedSources = [...newsJob.sources, ...newSources];

  const updatedPrompt =
    'Analyze news coverage across 8 major sources: The Guardian (international perspective), Washington Post (US political focus), NPR (public radio), ' +
    'BBC (British international lens), NYT (comprehensive US coverage), AP News (wire service), PBS NewsHour (in-depth public broadcasting), and Al Jazeera (global South perspective). For each story:\n' +
    '- Headline and publication time\n' +
    '- 1-2 sentence summary\n' +
    '- Source attribution\n' +
    '- Topic: Politics, Policy, Economy, Justice, Climate, Health, World, or Other\n\n' +
    'Cross-reference stories:\n' +
    '- Identify stories covered by multiple sources — note differences in framing, emphasis, or geographic perspective\n' +
    '- Flag exclusive stories only appearing in one source\n' +
    '- Detect emerging stories that appear in one outlet but may spread to others\n' +
    '- Note how international sources (BBC, Al Jazeera) frame US stories vs domestic outlets\n\n' +
    'Provide a synthesized view:\n' +
    '- What are the dominant news themes across all sources?\n' +
    '- Are there geographic or topical blind spots?\n' +
    '- Rank the top 5 stories by combined prominence and significance\n\n' +
    'Compare to previous runs to track story evolution and persistence across the news cycle.';

  if (DRY_RUN) {
    console.log(`  [update-news] Would merge ${newSources.length} new sources: ${newSources.map((s) => s.name).join(', ')}`);
    return { status: 'updated', message: `Would add ${newSources.length} sources (dry run)` };
  }

  await api.patch<Job>(`/jobs/${newsJob.id}`, {
    sources: mergedSources,
    jobPrompt: updatedPrompt,
    description: `Aggregated news from ${mergedSources.length} major international and domestic outlets`,
  });

  console.log(`  [update-news] Merged ${newSources.length} new sources: ${newSources.map((s) => s.name).join(', ')}`);
  return { status: 'updated', message: `Added ${newSources.length} sources` };
};

// ─── Result Tracking ─────────────────────────────────────────────────────────

interface JobResult {
  name: string;
  status: 'created' | 'skipped' | 'updated' | 'failed';
  message: string;
}

const printResults = (results: JobResult[]): void => {
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Results                                                    │');
  console.log('├─────────────────────────────────────────────────────────────┤');

  for (const r of results) {
    const icon =
      r.status === 'created' ? '+' :
      r.status === 'updated' ? '~' :
      r.status === 'skipped' ? '-' :
      'x';
    const statusLabel = r.status.toUpperCase().padEnd(7);
    console.log(`│  [${icon}] ${statusLabel}  ${r.name.slice(0, 40).padEnd(40)} │`);
    if (r.message) {
      console.log(`│              ${r.message.slice(0, 45).padEnd(45)} │`);
    }
  }

  console.log('└─────────────────────────────────────────────────────────────┘');

  const counts = {
    created: results.filter((r) => r.status === 'created').length,
    updated: results.filter((r) => r.status === 'updated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
  };

  console.log(`\n  Created: ${counts.created}  Updated: ${counts.updated}  Skipped: ${counts.skipped}  Failed: ${counts.failed}`);
};

// ─── Main ────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  console.log(`\n[add-jobs] Target: ${CRONIQ_URL}`);
  if (DRY_RUN) console.log('[add-jobs] DRY RUN — no changes will be made\n');

  // Fetch existing jobs for idempotency checks
  const existingJobs = await api.get<Job[]>('/jobs');
  const existingNames = new Set(existingJobs.map((j) => j.name));
  console.log(`  Found ${existingJobs.length} existing jobs\n`);

  const results: JobResult[] = [];

  // Handle --update-news mode
  if (UPDATE_NEWS) {
    const result = await updateMainstreamNews(existingJobs);
    results.push({ name: MAINSTREAM_NEWS_NAME, status: result.status === 'not-found' ? 'failed' : result.status, message: result.message });
    printResults(results);
    return;
  }

  // Determine which categories to process
  const categoriesToProcess = CATEGORY
    ? { [CATEGORY]: JOB_CATEGORIES[CATEGORY] }
    : JOB_CATEGORIES;

  if (CATEGORY && !JOB_CATEGORIES[CATEGORY]) {
    console.error(`[add-jobs] Unknown category: "${CATEGORY}". Available: ${Object.keys(JOB_CATEGORIES).join(', ')}`);
    process.exit(1);
  }

  // Process each job category
  for (const [key, buildPayload] of Object.entries(categoriesToProcess)) {
    const payload = buildPayload();
    const fullPayload = { ...SHARED_DEFAULTS, ...payload };

    // Weather is special: upsert existing "Weather — Multi-Location Monitoring" to preserve run history
    if (key === 'weather') {
      const existingWeather = existingJobs.find((j) => j.name === 'Weather — Multi-Location Monitoring');

      if (existingWeather) {
        if (DRY_RUN) {
          console.log(`  [~] Would PATCH existing weather job (${existingWeather.id}) with enhanced sources`);
          results.push({ name: fullPayload.name, status: 'updated', message: 'Would upsert (dry run)' });
          continue;
        }

        try {
          await api.patch<Job>(`/jobs/${existingWeather.id}`, {
            name: fullPayload.name,
            description: fullPayload.description,
            sources: fullPayload.sources,
            jobPrompt: fullPayload.jobPrompt,
            tags: fullPayload.tags,
            notifyOnChange: fullPayload.notifyOnChange,
          });
          console.log(`  [~] ${fullPayload.name} — updated existing weather job`);
          results.push({ name: fullPayload.name, status: 'updated', message: `Patched ${existingWeather.id}` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [x] ${fullPayload.name}: ${msg}`);
          results.push({ name: fullPayload.name, status: 'failed', message: msg });
        }
        continue;
      }
      // If no existing weather job, fall through to create
    }

    // Idempotency: skip if job with same name already exists
    if (existingNames.has(fullPayload.name)) {
      console.log(`  [-] ${fullPayload.name} — already exists, skipping`);
      results.push({ name: fullPayload.name, status: 'skipped', message: 'Already exists' });
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [+] Would create: ${fullPayload.name} (${fullPayload.sources.length} sources)`);
      results.push({ name: fullPayload.name, status: 'created', message: `${fullPayload.sources.length} sources (dry run)` });
      continue;
    }

    try {
      const created = await api.post<Job>('/jobs', fullPayload);
      console.log(`  [+] ${fullPayload.name} (${fullPayload.sources.length} sources) — ${created.id}`);
      results.push({ name: fullPayload.name, status: 'created', message: created.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [x] ${fullPayload.name}: ${msg}`);
      results.push({ name: fullPayload.name, status: 'failed', message: msg });
    }
  }

  // Also update mainstream news (unless filtering by category)
  if (!CATEGORY) {
    const newsResult = await updateMainstreamNews(existingJobs);
    results.push({
      name: MAINSTREAM_NEWS_NAME,
      status: newsResult.status === 'not-found' ? 'failed' : newsResult.status,
      message: newsResult.message,
    });
  }

  printResults(results);
};

main().catch((err) => {
  console.error('[add-jobs] Fatal error:', err);
  process.exit(1);
});
