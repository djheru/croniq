/**
 * Provision additional data collection jobs via the Croniq REST API.
 *
 * Usage:
 *   npm run db:add-jobs                           # create all 7 new jobs + upsert weather
 *   npm run db:add-jobs -- --dry-run              # show what would happen without calling API
 *   npm run db:add-jobs -- --update-news          # only merge sources into the News job
 *   npm run db:add-jobs -- --update-prompts       # PATCH prompts on existing jobs (no source changes)
 *   npm run db:add-jobs -- --category crypto      # only create/update the crypto job
 *
 * Flags can be combined:
 *   --update-prompts --category crypto            # update only the crypto job's prompt
 *   --update-prompts --dry-run                    # preview prompt updates
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
const UPDATE_PROMPTS = args.includes('--update-prompts');
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
if (UPDATE_NEWS && UPDATE_PROMPTS) {
  console.error('[add-jobs] --update-news and --update-prompts are mutually exclusive');
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
      'Curate progressive and investigative news across six publications: ProPublica, The Intercept (investigative), Mother Jones, The Nation (commentary), Jacobin (democratic socialist), and Common Dreams (grassroots).\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to guide which stories and threads to prioritize in this analysis.\n\n' +
      '**Article Listing (primary output):**\n' +
      'For each noteworthy article, output:\n' +
      '- **[Headline](link)** — *Source* · Topic tag (Policy, Labor, Climate, Justice, Healthcare, Economy, Foreign Policy, Civil Rights)\n' +
      '- One sentence describing why this article matters\n\n' +
      'Group articles by topic. Prioritize investigative exclusives (ProPublica, The Intercept) and stories covered by 3+ outlets. Include the direct link for every article.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- Which stories appear across multiple outlets? (1-2 sentences on framing differences)\n' +
      '- Any major investigative pieces not yet picked up by other sources?\n' +
      '- Stories that mainstream media is covering differently or ignoring?\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 developing stories or threads to watch for in the next cycle\n' +
      '- Flag any emerging policy debates or legislative timelines to track\n' +
      '- Note investigative series that may have follow-up pieces coming',
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
      'Curate crypto market intelligence from three news sources (The Block, CoinDesk, Decrypt) and the Fear & Greed Index.\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to prioritize which stories and trends to highlight.\n\n' +
      '**Sentiment Snapshot:**\n' +
      '- Fear & Greed Index: value, classification (Extreme Fear → Extreme Greed), direction since last run\n\n' +
      '**Article Listing (primary output):**\n' +
      'For each significant article, output:\n' +
      '- **[Headline](link)** — *Source* · Tag (Regulatory, DeFi, Infrastructure, Market Movement, Security/Hack, Institutional Adoption)\n' +
      '- One sentence on why it matters\n' +
      '- Mark regulatory actions, exchange issues, or security breaches as 🔴 HIGH PRIORITY\n\n' +
      'Group by tag. Prioritize stories appearing in multiple outlets. Include the direct link for every article.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- Does the news narrative align with or contradict the sentiment index? (1-2 sentences)\n' +
      '- Any stories with outsized market impact potential? (regulatory rulings, ETF decisions, major hacks)\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 developing stories to track (regulatory timelines, protocol upgrades, institutional moves)\n' +
      '- Note sentiment trend direction to watch\n' +
      '- Flag any stories gaining multi-source momentum',
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
      'Curate the AWS serverless and TypeScript ecosystem from official AWS sources, community thought leaders, and key library releases.\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to prioritize which announcements, releases, or discussions to highlight.\n\n' +
      '**Article & Release Listing (primary output):**\n' +
      'For each noteworthy item, output:\n' +
      '- **[Title](link)** — *Source* · Tag (AWS Service Update, Best Practice, TypeScript Ecosystem, Library Release, Community Insight)\n' +
      '- One sentence on what changed or why it matters to a TypeScript/CDK developer\n' +
      '- Mark breaking changes in TypeScript, CDK, or Powertools as 🔴 HIGH PRIORITY\n\n' +
      'Group by tag. Prioritize: breaking changes > Bedrock updates > Lambda runtime changes > CDK constructs > community posts. Include the direct link for every item.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- Any breaking changes or required dependency bumps? (1-2 sentences)\n' +
      '- Notable convergence between AWS announcements and community reactions?\n' +
      '- Cost optimization opportunities mentioned across sources?\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 releases, RFCs, or announcements to track for follow-up\n' +
      '- Flag any migration guides or deprecation timelines to watch\n' +
      '- Note library pre-releases that may hit stable soon',
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
      'Curate the house music scene from four key electronic music publications: Resident Advisor, DJ Mag, and Magnetic Magazine.\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to track artists, releases, and events flagged previously.\n\n' +
      '**Article & Release Listing (primary output):**\n' +
      'For each noteworthy item, output:\n' +
      '- **[Title](link)** — *Source* · Tag (New Release, DJ Mix/Podcast, Festival/Event, Scene & Culture, Artist Feature)\n' +
      '- One sentence on what it is and why it\'s notable\n' +
      '- Note label affiliations for releases (Defected, Anjunadeep, Drumcode, Dirtybird, Trax Records, etc.)\n\n' +
      'Group by tag. Prioritize: new releases and mixes > festival announcements > scene news. Sub-genres to note: deep house, tech house, progressive house, afro house, melodic house. Include the direct link for every item.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- Which artists are building momentum across multiple articles? (1-2 sentences)\n' +
      '- Any debut releases or emerging artists getting first-time editorial coverage?\n' +
      '- RA podcast feature: who was featured, genre/style notes\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 artists, labels, or events to watch for follow-up coverage\n' +
      '- Flag upcoming release dates or festival lineup announcements\n' +
      '- Note any developing album rollout campaigns or residency announcements',
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
      'Curate business and market news from four major financial media sources (MarketWatch, CNBC, WSJ, Seeking Alpha), running on weekday market hours.\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to track earnings, Fed commentary, and developing market narratives.\n\n' +
      '**Article Listing (primary output):**\n' +
      'For each market-moving story, output:\n' +
      '- **[Headline](link)** — *Source* · Tag (Earnings, Fed/Monetary Policy, Sector Movement, M&A, Economic Data, Geopolitical)\n' +
      '- One sentence on market impact or significance\n' +
      '- Mark Fed rate decisions, major earnings surprises, or circuit breakers as 🔴 HIGH PRIORITY\n\n' +
      'Group by tag. Prioritize: HIGH PRIORITY items > multi-source consensus stories > sector movers. Include the direct link for every article.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- What is the dominant market narrative this session? (1-2 sentences)\n' +
      '- Do sources agree or diverge? Note where Seeking Alpha analysts differ from mainstream coverage\n' +
      '- Any sector rotation signals? (1 sentence)\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 stories to track (earnings dates, Fed meeting timelines, pending economic data releases)\n' +
      '- Flag developing narratives that may escalate (trade disputes, regulatory actions)\n' +
      '- Note market sentiment direction to watch for confirmation or reversal',
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
      'Curate local news for two communities: Phoenix, AZ metro area and Delta County, Michigan (Upper Peninsula).\n\n' +
      '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to track ongoing council proceedings, investigations, and seasonal events.\n\n' +
      '**Article Listing (primary output):**\n' +
      'Organize by location. For each story, output:\n' +
      '- **[Headline](link)** — *Source* · Topic tag\n' +
      '- One sentence on local significance\n\n' +
      '**Phoenix Metro (AZCentral, KJZZ):**\n' +
      'Tags: Government, Development, Water/Drought, Public Safety, Education, Economy, Environment\n' +
      '- Mark extreme heat advisories, water restrictions, or wildfire evacuations as 🔴 HIGH PRIORITY\n\n' +
      '**Delta County, MI (Daily Press, TV6):**\n' +
      'Tags: Government, Natural Resources, Economy, Schools, Community, Weather Impact\n' +
      '- Mark severe weather impacts, road closures, or emergency declarations as 🔴 HIGH PRIORITY\n\n' +
      'Include the direct link for every article.\n\n' +
      '**Curation Notes (brief):**\n' +
      '- Any stories with national implications originating locally? (1-2 sentences)\n' +
      '- Contrasts between urban Phoenix and rural UP community concerns?\n\n' +
      '**Suggestions for Next Run:**\n' +
      '- Name 3-5 developing local stories to track (council votes, ongoing investigations, seasonal events)\n' +
      '- Flag any scheduled government meetings, public hearings, or community events coming up\n' +
      '- Note weather patterns or environmental conditions to watch',
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

  const updatedPrompt = buildMainstreamNewsPrompt(mergedSources.length);

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

// ─── Update Prompts on Existing Jobs ─────────────────────────────────────────

/**
 * Map a category key to the job names it might match in the database.
 * Weather has two possible names depending on whether a prior upsert has happened.
 */
const categoryJobNames = (key: string, payloadName: string): string[] => {
  if (key === 'weather') {
    return ['Weather — Enhanced Multi-Location', 'Weather — Multi-Location Monitoring'];
  }
  return [payloadName];
};

/**
 * PATCH prompt-related fields on existing jobs without touching sources or
 * creating new jobs. Used by --update-prompts to roll updated prompt text out
 * to jobs already provisioned in the database.
 *
 * Also updates the Mainstream News Aggregation job's prompt and description
 * (without touching its sources) so the link-first style is applied there too.
 */
const updatePromptsForExistingJobs = async (
  existingJobs: Job[],
  results: JobResult[],
): Promise<void> => {
  // Respect --category filter if present
  const categoriesToProcess = CATEGORY
    ? { [CATEGORY]: JOB_CATEGORIES[CATEGORY] }
    : JOB_CATEGORIES;

  for (const [key, buildPayload] of Object.entries(categoriesToProcess)) {
    const payload = buildPayload();
    const candidateNames = categoryJobNames(key, payload.name);
    const existing = existingJobs.find((j) => candidateNames.includes(j.name));

    if (!existing) {
      results.push({
        name: payload.name,
        status: 'skipped',
        message: `No existing job found (tried: ${candidateNames.join(', ')})`,
      });
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [~] Would PATCH prompt on: ${existing.name} (${existing.id})`);
      results.push({ name: existing.name, status: 'updated', message: 'Would update prompt (dry run)' });
      continue;
    }

    try {
      await api.patch<Job>(`/jobs/${existing.id}`, {
        jobPrompt: payload.jobPrompt,
        description: payload.description,
        tags: payload.tags,
      });
      console.log(`  [~] ${existing.name} — prompt updated`);
      results.push({ name: existing.name, status: 'updated', message: `Prompt patched (${existing.id})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [x] ${existing.name}: ${msg}`);
      results.push({ name: existing.name, status: 'failed', message: msg });
    }
  }

  // Also update the Mainstream News Aggregation job's prompt (only when no category filter)
  if (!CATEGORY) {
    const newsJob = existingJobs.find((j) => j.name === MAINSTREAM_NEWS_NAME);
    if (!newsJob) {
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'skipped', message: 'Job not found' });
      return;
    }

    // Compute the updated prompt using the same source count the job currently has.
    // The prompt is the same whether we have 3 or 8 sources — it just describes what's there.
    const promptSourceCount = newsJob.sources.length;
    const updatedNewsPrompt = buildMainstreamNewsPrompt(promptSourceCount);

    if (DRY_RUN) {
      console.log(`  [~] Would PATCH prompt on: ${MAINSTREAM_NEWS_NAME} (${newsJob.id})`);
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'updated', message: 'Would update prompt (dry run)' });
      return;
    }

    try {
      await api.patch<Job>(`/jobs/${newsJob.id}`, { jobPrompt: updatedNewsPrompt });
      console.log(`  [~] ${MAINSTREAM_NEWS_NAME} — prompt updated`);
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'updated', message: `Prompt patched (${newsJob.id})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [x] ${MAINSTREAM_NEWS_NAME}: ${msg}`);
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'failed', message: msg });
    }
  }
};

/**
 * Build the mainstream news analytical prompt. Extracted so --update-prompts
 * and --update-news can share the same source of truth.
 */
const buildMainstreamNewsPrompt = (sourceCount: number): string =>
  `Curate news coverage across ${sourceCount} major sources: wire services, public media, international, and US newspapers.\n\n` +
  '**Previous Run Context:** If a previous run exists, review its "Suggestions for Next Run" section first. Use those suggestions to track developing stories and watch items.\n\n' +
  '**Article Listing (primary output):**\n' +
  'For each significant story, output:\n' +
  '- **[Headline](link)** — *Source* · Tag (Politics, Policy, Economy, Justice, Climate, Health, World, Technology)\n' +
  '- One sentence on significance\n' +
  '- Note if covered by 3+ sources (consensus story) or single-source exclusive\n\n' +
  'Group by topic. Prioritize: consensus stories (3+ sources) > single-source scoops > breaking developments. Include the direct link for every article.\n\n' +
  '**Curation Notes (brief):**\n' +
  '- Story of the day: the single development with most cross-source attention (1 sentence)\n' +
  '- International vs. domestic framing: any stories where international sources cover differently than US sources? (1-2 sentences)\n' +
  '- Geographic blind spots: what regions or topics are underrepresented? (1 sentence)\n\n' +
  '**Suggestions for Next Run:**\n' +
  '- Name 3-5 developing stories to track in the next news cycle\n' +
  '- Flag stories that appeared in one source but may spread to others\n' +
  '- Note any stories losing momentum vs. gaining traction';

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

  // Handle --update-prompts mode: PATCH prompt/description/tags on existing jobs
  // without touching sources, schedule, or creating new jobs. This is how users
  // apply updated prompt text to jobs already in their database.
  if (UPDATE_PROMPTS) {
    await updatePromptsForExistingJobs(existingJobs, results);
    printResults(results);
    return;
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
