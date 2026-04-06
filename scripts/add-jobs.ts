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
if (categoryIdx !== -1 && !args[categoryIdx + 1]) {
  console.error('[add-jobs] --category requires a value');
  process.exit(1);
}
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
    description: 'Progressive and investigative journalism from six left-leaning publications',
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
      'Analyze progressive and investigative news across six publications spanning investigative journalism (ProPublica, The Intercept), political commentary (Mother Jones, The Nation), democratic socialist perspective (Jacobin), and grassroots progressive coverage (Common Dreams).\n\n' +
      'For each story:\n' +
      '- Headline, publication time, source attribution\n' +
      '- 1-2 sentence summary\n' +
      '- Topic classification: Policy, Labor, Climate, Justice, Healthcare, Economy, Foreign Policy, Civil Rights, or Other\n\n' +
      'Cross-source analysis:\n' +
      '- Identify stories covered by multiple outlets — note how framing differs between investigative vs. commentary vs. grassroots sources\n' +
      '- Flag major investigative pieces (ProPublica, The Intercept) that other outlets haven\'t yet picked up\n' +
      '- Detect emerging policy debates or legislative developments that multiple sources are tracking\n' +
      '- Note which issues are getting disproportionate attention vs. being underreported\n\n' +
      'Synthesized view:\n' +
      '- What are the dominant progressive concerns right now?\n' +
      '- Are there stories that mainstream media is covering differently or ignoring?\n' +
      '- Track how stories evolve across runs — which narratives are gaining or losing momentum?\n' +
      '- Highlight any direct calls to action or mobilization efforts\n\n' +
      'Compare against previous runs to identify story persistence, new developments, and shifting editorial focus.',
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
      'Analyze crypto market intelligence from three news sources and the Fear & Greed Index.\n\n' +
      'Market Sentiment:\n' +
      '- Current Fear & Greed Index value and classification (Extreme Fear, Fear, Neutral, Greed, Extreme Greed)\n' +
      '- How has sentiment shifted since the previous run?\n' +
      '- Does the news narrative align with or contradict the sentiment index?\n\n' +
      'News Analysis (The Block, CoinDesk, Decrypt):\n' +
      '- Identify the 5-8 most significant stories across all sources\n' +
      '- Classify each: Regulatory, DeFi, Infrastructure, Market Movement, Security/Hack, Institutional Adoption, or Other\n' +
      '- Flag any stories about regulatory actions, exchange issues, or security breaches as HIGH PRIORITY\n' +
      '- Note which stories appear across multiple outlets (consensus narratives) vs. single-source exclusives\n\n' +
      'Market Context:\n' +
      '- Correlate news developments with the sentiment indicator\n' +
      '- Identify any emerging trends: new protocol launches, governance proposals, ecosystem shifts\n' +
      '- Flag stories that could have outsized market impact (regulatory rulings, ETF decisions, major hacks)\n\n' +
      'Compare to previous runs:\n' +
      '- Track developing stories and their progression\n' +
      '- Note sentiment trend direction (improving, worsening, stable)\n' +
      '- Identify stories that have gone from single-source to multi-source coverage (gaining momentum)',
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
      'Analyze the AWS serverless and TypeScript ecosystem from official AWS sources, community thought leaders, and key library releases.\n\n' +
      'Categorize each item:\n' +
      '- **AWS Service Updates**: New features, region expansions, pricing changes for Lambda, API Gateway, DynamoDB, EventBridge, SQS, Step Functions, Bedrock, CDK\n' +
      '- **Best Practices**: Architecture patterns, performance optimization, cost reduction techniques\n' +
      '- **TypeScript Ecosystem**: Language features, compiler updates, type system improvements\n' +
      '- **Library Releases**: New versions of Powertools, CDK constructs, Middy, or other serverless tooling\n' +
      '- **Community Insights**: Opinions, benchmarks, and real-world experience reports from practitioners\n\n' +
      'Prioritize for a TypeScript/CDK developer:\n' +
      '- Flag any breaking changes in TypeScript, CDK, or Powertools as HIGH PRIORITY\n' +
      '- Highlight Lambda runtime updates (Node.js version support, ARM64 improvements)\n' +
      '- Note Bedrock-specific updates (new models, pricing, API changes)\n' +
      '- Call out CDK construct library additions or deprecations\n\n' +
      'Synthesis:\n' +
      '- What are the emerging serverless patterns this week?\n' +
      '- Are there cost optimization opportunities mentioned across sources?\n' +
      '- Any convergence between AWS announcements and community reactions?\n\n' +
      'Compare to previous runs to track announcement cadence, identify follow-up posts, and note community response to major announcements.',
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
      'Curate the house music scene from four key electronic music publications.\n\n' +
      'New Music & Releases:\n' +
      '- Notable new releases, EPs, and albums in the house music spectrum (deep house, tech house, progressive house, afro house, melodic house)\n' +
      '- Label activity: which labels are releasing? Note output from key labels (Defected, Anjunadeep, Drumcode, Dirtybird, Trax Records, etc.)\n' +
      '- Highlight debut releases or breakout tracks getting attention\n\n' +
      'DJ & Artist Activity:\n' +
      '- Resident Advisor podcast: who\'s been featured? Genre and style notes\n' +
      '- Tour announcements, residency updates, festival bookings\n' +
      '- Emerging artists getting editorial attention for the first time\n' +
      '- Producer collaborations or notable remixes\n\n' +
      'Scene & Culture:\n' +
      '- Festival announcements or lineup reveals\n' +
      '- Venue openings/closings, club culture developments\n' +
      '- Industry news: streaming platform changes, vinyl market updates\n' +
      '- Awards, milestones, retrospectives\n\n' +
      'Compare to previous runs:\n' +
      '- Track which artists are appearing repeatedly (momentum builders)\n' +
      '- Note new names appearing for the first time\n' +
      '- Identify developing stories (festival lineups filling out, album rollout campaigns)',
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
      'Analyze business and market news from four major financial media sources, running on weekday market hours.\n\n' +
      'Market Overview:\n' +
      '- Identify the top market-moving stories of the session\n' +
      '- Classify each: Earnings, Fed/Monetary Policy, Sector Movement, M&A, IPO/Offering, Economic Data, Geopolitical, or Other\n' +
      '- Flag any stories about Fed rate decisions, major earnings surprises, or market circuit breakers as HIGH PRIORITY\n\n' +
      'Sector Analysis:\n' +
      '- Which sectors are getting the most coverage? (Tech, Finance, Healthcare, Energy, Consumer, Industrial)\n' +
      '- Note any sector rotation signals — coverage shifting from growth to value or vice versa\n' +
      '- Identify company-specific stories with broader market implications\n\n' +
      'Economic Context:\n' +
      '- Employment, inflation, GDP, or housing data releases\n' +
      '- Trade policy or tariff developments\n' +
      '- Consumer confidence or spending indicators\n\n' +
      'Cross-Source Comparison:\n' +
      '- Do MarketWatch and CNBC agree on the day\'s narrative, or are they emphasizing different stories?\n' +
      '- Note where Seeking Alpha\'s analyst community diverges from mainstream financial media\n' +
      '- Identify consensus vs. contrarian views\n\n' +
      'Compare to previous runs:\n' +
      '- Track developing stories (earnings season progression, Fed meeting anticipation)\n' +
      '- Note shifts in market sentiment over the trading day (morning vs. midday vs. close)\n' +
      '- Identify stories that have persisted across multiple sessions vs. one-day events',
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
      '- Gilbert, AZ: Flag temps >105°F (extreme heat), dust storm warnings, flash flood watches, haboob advisories\n' +
      '- Garden, MI: Flag temps <10°F (extreme cold), blizzard warnings, lake effect snow, ice storm warnings, wind chill advisories\n\n' +
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
      'Analyze local news for two communities: Phoenix, AZ metro area and Delta County, Michigan (Upper Peninsula).\n\n' +
      'Organize by location:\n\n' +
      '**Phoenix Metro (AZCentral, KJZZ):**\n' +
      '- Top local stories: city council actions, development projects, transportation\n' +
      '- Public safety: notable incidents, policy changes\n' +
      '- Education: school district news, university developments\n' +
      '- Environment: water issues, heat preparedness, air quality, wildfire updates\n' +
      '- Economy: major employers, real estate trends, tourism\n' +
      '- Flag any extreme heat advisories, water restrictions, or wildfire evacuations as HIGH PRIORITY\n\n' +
      '**Delta County, MI (Daily Press, TV6):**\n' +
      '- Top local stories: county board actions, community events, school news\n' +
      '- Natural resources: hunting/fishing seasons, DNR updates, Great Lakes conditions\n' +
      '- Economy: tourism, small business, UP development projects\n' +
      '- Weather impacts: road conditions, school closures, lake effect events\n' +
      '- Flag any severe weather impacts, road closures, or emergency declarations as HIGH PRIORITY\n\n' +
      'Cross-community insights:\n' +
      '- Any stories with national implications originating locally?\n' +
      '- Compare quality of life themes between a major metro and rural community\n' +
      '- Note seasonal patterns unique to each location\n\n' +
      'Compare to previous runs:\n' +
      '- Track developing local stories (council decisions, ongoing investigations, weather events)\n' +
      '- Note new stories vs. updates on known situations\n' +
      '- Flag stories that have persisted across multiple runs (community concerns gaining traction)',
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
    config: { type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', maxItems: 8, fields: RSS_FIELDS },
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
    'Analyze news coverage across eight major sources spanning wire services (AP), public media (NPR, PBS NewsHour), international perspectives (The Guardian, BBC, Al Jazeera), and US newspapers (Washington Post, New York Times).\n\n' +
    'For each significant story:\n' +
    '- Headline, publication time, source attribution\n' +
    '- 1-2 sentence summary\n' +
    '- Topic: Politics, Policy, Economy, Justice, Climate, Health, World, Technology, or Other\n\n' +
    'Cross-source analysis at scale:\n' +
    '- Identify stories covered by 3+ sources — these are the consensus "major" stories of the cycle\n' +
    '- Note stories covered by international sources (Guardian, BBC, Al Jazeera) but absent from US sources, and vice versa\n' +
    '- Compare wire service coverage (AP) against editorial coverage (NYT, WaPo) — how does framing differ?\n' +
    '- Flag exclusive stories appearing in only one source — are they scoops or niche interests?\n\n' +
    'Synthesized intelligence:\n' +
    '- Rank the top 8 stories by combined prominence across all sources\n' +
    '- What are the dominant news themes across all sources?\n' +
    '- Identify the "story of the day" — the single development getting the most cross-source attention\n' +
    '- Geographic blind spots: what regions or topics are underrepresented?\n' +
    '- Compare US-centric sources vs. international sources on the same events\n\n' +
    'Compare to previous runs to track story evolution, emergence of new narratives, and the news cycle\'s attention span.';

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
  let existingJobs: Job[];
  try {
    existingJobs = await api.get<Job[]>('/jobs');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[add-jobs] Could not reach API at ${CRONIQ_URL} — ${msg}`);
    console.error('[add-jobs] Check that the server is running and CRONIQ_URL is correct.');
    process.exit(1);
  }
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

  // Validate category before use — otherwise buildPayload() would throw a TypeError
  if (CATEGORY && !JOB_CATEGORIES[CATEGORY]) {
    console.error(`[add-jobs] Unknown category: "${CATEGORY}". Available: ${Object.keys(JOB_CATEGORIES).join(', ')}`);
    process.exit(1);
  }

  // Determine which categories to process
  const categoriesToProcess = CATEGORY
    ? { [CATEGORY]: JOB_CATEGORIES[CATEGORY] }
    : JOB_CATEGORIES;

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
    try {
      const newsResult = await updateMainstreamNews(existingJobs);
      results.push({
        name: MAINSTREAM_NEWS_NAME,
        status: newsResult.status === 'not-found' ? 'failed' : newsResult.status,
        message: newsResult.message,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'failed', message: msg });
    }
  }

  printResults(results);
};

main().catch((err) => {
  console.error('[add-jobs] Fatal error:', err);
  process.exit(1);
});
