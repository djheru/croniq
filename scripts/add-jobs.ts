/**
 * Provision additional data collection jobs via the Croniq REST API.
 *
 * Modes (mutually exclusive):
 *   npm run db:add-jobs                          # create all 7 new jobs + upsert weather
 *   npm run db:add-jobs -- --update-news         # merge new sources into the News job
 *   npm run db:add-jobs -- --update-prompts      # PATCH prompts on existing jobs (safe; preserves sources)
 *   npm run db:add-jobs -- --update-all          # PATCH prompts AND sources/schedule/timeout (overwrites UI customizations)
 *
 * Modifiers:
 *   --dry-run                                    # show what would happen without calling API
 *   --category <name>                            # filter to a single job category
 *
 * Common combinations:
 *   --update-prompts --dry-run                   # preview prompt updates
 *   --update-all --category crypto               # fully sync only the crypto job
 *   --update-prompts --category business         # update only business job's prompt
 *
 * API Keys (optional, set in .env):
 *   RENTCAST_API_KEY  — Free: 50 calls/month at https://www.rentcast.io/api
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
const UPDATE_ALL = args.includes('--update-all');
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
const updateModes = [UPDATE_NEWS, UPDATE_PROMPTS, UPDATE_ALL].filter(Boolean).length;
if (updateModes > 1) {
  console.error('[add-jobs] --update-news, --update-prompts, and --update-all are mutually exclusive');
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

// ─── Shared Prompt Fragments ─────────────────────────────────────────────────
//
// These fragments are concatenated into each news/RSS job prompt to keep
// formatting and instructions consistent. They are intentionally terse to
// minimize input token cost — every byte added here multiplies across all runs.

const PROMPT_HEADER_PREVIOUS_CONTEXT =
  '**Previous suggestions:** If a previous-run suggestions section is provided in context, prioritize the items it flagged.';

const PROMPT_DEDUP_RULE =
  '**Dedup rule:** If 2+ sources cover the same story, list it ONCE with sources inline (e.g., "[Headline](primary-link) — *Source A, Source B, Source C*"). Never list duplicates separately.';

const PROMPT_FORMAT_RULE =
  'Format each item on a single line: **[Headline](link)** — *Source(s)* · Tag · Brief 8-12 word note. No multi-line summaries.';

const PROMPT_SUGGESTIONS_FOOTER =
  '**Suggestions for Next Run:** End your response with a section titled exactly "**Suggestions for Next Run**" containing 3 short bullets (max 15 words each) flagging stories or threads to track in the next cycle.';

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
        config: { type: 'rss', url: 'https://theintercept.com/feed/?rss', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Mother Jones',
        config: { type: 'rss', url: 'https://www.motherjones.com/feed/', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Jacobin',
        config: { type: 'rss', url: 'https://jacobin.com/feed', maxItems: 5, fields: RSS_FIELDS },
      },
      {
        name: 'The Nation',
        config: { type: 'rss', url: 'https://www.thenation.com/feed/', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'ProPublica',
        config: { type: 'rss', url: 'https://feeds.propublica.org/propublica/main', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Common Dreams',
        config: { type: 'rss', url: 'https://www.commondreams.org/feeds/feed.rss', maxItems: 6, fields: RSS_FIELDS },
      },
    ],
    jobPrompt:
      `Curate the **top 5** progressive/investigative stories from ProPublica, The Intercept, Mother Jones, The Nation, Jacobin, Common Dreams.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Top 5 Stories:**\n${PROMPT_FORMAT_RULE}\n` +
      `Topic tags: Policy, Labor, Climate, Justice, Healthcare, Economy, Foreign Policy, Civil Rights.\n` +
      `Prioritize: investigative exclusives (ProPublica, The Intercept) > multi-outlet consensus > policy developments.\n\n` +
      `**Brief Note (1-2 sentences):** Dominant theme this cycle, or notable framing divergence between investigative vs. commentary outlets.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
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
        config: { type: 'rss', url: 'https://www.theblock.co/rss/all', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'CoinDesk',
        config: { type: 'rss', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Decrypt',
        config: { type: 'rss', url: 'https://decrypt.co/feed', maxItems: 6, fields: RSS_FIELDS },
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
      `Curate the **top 5** crypto stories from The Block, CoinDesk, Decrypt, plus the Fear & Greed Index.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Sentiment:** One line: Fear & Greed value + classification + direction.\n\n` +
      `**Top 5 Stories:**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: Regulatory, DeFi, Infrastructure, Market Movement, Security/Hack, Institutional Adoption.\n` +
      `Prefix 🔴 for regulatory actions, exchange issues, or security breaches.\n\n` +
      `**Brief Note (1 sentence):** Whether news aligns with or contradicts sentiment.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
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
        config: { type: 'rss', url: 'https://aws.amazon.com/blogs/compute/feed/', maxItems: 5, fields: RSS_FIELDS },
      },
      {
        name: "AWS What's New",
        config: { type: 'rss', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', maxItems: 8, fields: RSS_FIELDS },
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
      `Curate the **top 5** AWS serverless / TypeScript ecosystem items from AWS Compute Blog, AWS What's New, theburningmonk, Total TypeScript, TypeScript Blog, Powertools releases.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Top 5 Items:**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: AWS Service Update, TypeScript Ecosystem, Library Release, Best Practice, Community Insight.\n` +
      `Prefix 🔴 for breaking changes in TypeScript, CDK, or Powertools.\n` +
      `Prioritize: breaking changes > Bedrock/Lambda runtime updates > CDK constructs > community posts.\n\n` +
      `**Brief Note (1 sentence):** Most actionable item for a TypeScript/CDK developer this cycle.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
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
        config: { type: 'rss', url: 'https://ra.co/xml/news.xml', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Resident Advisor Podcast',
        config: { type: 'rss', url: 'https://ra.co/xml/podcast.xml', maxItems: 4, fields: RSS_FIELDS },
      },
      {
        name: 'DJ Mag',
        config: { type: 'rss', url: 'https://djmag.com/feed', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Magnetic Magazine',
        config: { type: 'rss', url: 'https://www.magneticmag.com/feed/', maxItems: 5, fields: RSS_FIELDS },
      },
    ],
    jobPrompt:
      `Curate the **top 5** house music items from Resident Advisor (news + podcast), DJ Mag, Magnetic Magazine.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Top 5 Items:**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: New Release, DJ Mix, Festival/Event, Artist Feature, Scene & Culture.\n` +
      `For releases, note label inline (Defected, Anjunadeep, Drumcode, Dirtybird, etc.). Sub-genres: deep, tech, progressive, afro, melodic house.\n` +
      `Prioritize: new releases > RA podcast features > festival news.\n\n` +
      `**Brief Note (1 sentence):** Artist or label gaining momentum this cycle.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
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
        config: { type: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'CNBC',
        config: { type: 'rss', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'WSJ Markets',
        config: { type: 'rss', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'Seeking Alpha',
        config: { type: 'rss', url: 'https://seekingalpha.com/feed.xml', maxItems: 6, fields: RSS_FIELDS },
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
      `Curate the **top 5** market-moving stories from MarketWatch, CNBC, WSJ Markets, Seeking Alpha.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Top 5 Stories:**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: Earnings, Fed/Monetary Policy, Sector Movement, M&A, Economic Data, Geopolitical.\n` +
      `Prefix 🔴 for Fed rate decisions, major earnings surprises, or circuit breakers.\n\n` +
      `**Brief Note (1 sentence):** Dominant market narrative this session.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
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
        config: { type: 'rss', url: 'https://rssfeeds.azcentral.com/phoenix/home', maxItems: 6, fields: RSS_FIELDS },
      },
      {
        name: 'KJZZ NPR (Phoenix)',
        config: { type: 'rss', url: 'https://kjzz.org/rss.xml', maxItems: 6, fields: RSS_FIELDS },
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
      `Curate local news: **top 3 Phoenix** stories (AZCentral, KJZZ) and **top 3 Delta County MI** stories (Daily Press, TV6).\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
      `**Phoenix Metro (top 3):**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: Government, Development, Water, Public Safety, Education, Economy, Environment.\n` +
      `Prefix 🔴 for extreme heat, water restrictions, wildfire evacuations.\n\n` +
      `**Delta County, MI (top 3):**\n${PROMPT_FORMAT_RULE}\n` +
      `Tags: Government, Natural Resources, Economy, Schools, Community, Weather.\n` +
      `Prefix 🔴 for severe weather, road closures, emergency declarations.\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
  }),

  'realestate-az': () => ({
    name: 'Real Estate — Gilbert AZ (85234)',
    description: 'Daily for-sale home listings in Gilbert AZ via RentCast API',
    schedule: '0 8 * * *',
    timeoutMs: 60000,
    tags: ['realestate', 'phoenix', 'housing'],
    notifyOnChange: true,
    sources: [
      {
        name: 'RentCast — 85234 For Sale',
        config: {
          type: 'api',
          url: 'https://api.rentcast.io/v1/listings/sale?zipCode=85234&status=Active&limit=50',
          headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY ?? '' },
        },
      },
    ],
    jobPrompt:
      `Curate for-sale home listings in Gilbert, AZ (85234) from RentCast data.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n\n` +
      `**Filter criteria:** Only include listings with **3+ bedrooms** and **1,500+ sqft**. Ignore listings that don't meet both criteria.\n\n` +
      `**Top 5 Listings:**\n` +
      `For each qualifying listing, output on one line:\n` +
      `- **$Price** — Beds/Baths/Sqft · Address · Property type · Days on market (if available)\n\n` +
      `Prioritize: new listings (not in previous run) > price reductions > lowest price per sqft.\n\n` +
      `**Market Snapshot (2-3 sentences):**\n` +
      `- How many total active listings meet the 3bed/1500sqft criteria?\n` +
      `- Price range (low–high) and median for qualifying listings\n` +
      `- Any notable trends vs. previous run (new listings, delistings, price changes)?\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
  }),

  'realestate-mi': () => ({
    name: 'Real Estate — Garden MI (49835)',
    description: 'Weekly for-sale homes and land listings in Garden MI via RentCast API',
    schedule: '0 9 * * 1',
    timeoutMs: 60000,
    tags: ['realestate', 'michigan', 'housing'],
    notifyOnChange: true,
    sources: [
      {
        name: 'RentCast — 49835 For Sale (all types)',
        config: {
          type: 'api',
          url: 'https://api.rentcast.io/v1/listings/sale?zipCode=49835&status=Active&limit=50',
          headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY ?? '' },
        },
      },
    ],
    jobPrompt:
      `Curate for-sale listings (homes AND land/lots) in Garden, MI (49835) from RentCast data.\n\n` +
      `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n\n` +
      `**All Qualifying Listings (up to 10):**\n` +
      `Separate into two sections:\n\n` +
      `**Homes:**\n` +
      `- **$Price** — Beds/Baths/Sqft · Address · Property type · Days on market\n\n` +
      `**Land & Lots:**\n` +
      `- **$Price** — Acreage · Address · Zoning/use notes (if available)\n\n` +
      `Prioritize: new listings > price reductions > unique properties (waterfront, wooded acreage).\n\n` +
      `**Market Snapshot (2-3 sentences):**\n` +
      `- Total active listings in 49835 (homes vs. land breakdown)\n` +
      `- Price range and any notable changes since previous run\n` +
      `- Rural market context: how does inventory compare to prior weeks?\n\n` +
      `${PROMPT_SUGGESTIONS_FOOTER}`,
  }),
};

// ─── Update Mainstream News ──────────────────────────────────────────────────

const MAINSTREAM_NEWS_NAME = 'News — Multi-Source Aggregation';

const ADDITIONAL_NEWS_SOURCES: DataSource[] = [
  {
    name: 'BBC US & Canada',
    config: { type: 'rss', url: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', maxItems: 6, fields: RSS_FIELDS },
  },
  {
    name: 'NYT Homepage',
    config: { type: 'rss', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', maxItems: 6, fields: RSS_FIELDS },
  },
  {
    // Note: RSSHub instance — reliability depends on the public instance availability
    name: 'AP News',
    config: { type: 'rss', url: 'https://rsshub.app/apnews/topics/apf-topnews', maxItems: 6, fields: RSS_FIELDS },
  },
  {
    name: 'PBS NewsHour',
    config: { type: 'rss', url: 'https://www.pbs.org/newshour/feeds/rss/headlines', maxItems: 6, fields: RSS_FIELDS },
  },
  {
    name: 'Al Jazeera',
    config: { type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', maxItems: 6, fields: RSS_FIELDS },
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
 * Update mode for in-place job updates.
 * - 'prompts': PATCH only jobPrompt/description/tags. Safe — never touches sources.
 * - 'all':     PATCH all fields including sources. Will overwrite UI customizations.
 */
type UpdateMode = 'prompts' | 'all';

/**
 * PATCH fields on existing jobs in-place. Used by --update-prompts (mode=prompts)
 * and --update-all (mode=all) to apply script changes to jobs already in the DB.
 *
 * Also updates the Mainstream News Aggregation job (which lives outside JOB_CATEGORIES).
 */
const updateExistingJobs = async (
  existingJobs: Job[],
  results: JobResult[],
  mode: UpdateMode,
): Promise<void> => {
  // Respect --category filter if present
  const categoriesToProcess = CATEGORY
    ? { [CATEGORY]: JOB_CATEGORIES[CATEGORY] }
    : JOB_CATEGORIES;

  for (const [key, buildPayload] of Object.entries(categoriesToProcess)) {
    const payload = buildPayload();
    const fullPayload = { ...SHARED_DEFAULTS, ...payload };
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

    // Build the patch body — always include prompt fields; include sources only in 'all' mode
    const patchBody: Record<string, unknown> = {
      jobPrompt: payload.jobPrompt,
      description: payload.description,
      tags: payload.tags,
    };
    if (mode === 'all') {
      patchBody.sources = fullPayload.sources;
      patchBody.schedule = fullPayload.schedule;
      patchBody.timeoutMs = fullPayload.timeoutMs;
      patchBody.notifyOnChange = fullPayload.notifyOnChange;
    }

    const fieldsLabel = mode === 'all' ? 'all fields' : 'prompt';

    if (DRY_RUN) {
      console.log(`  [~] Would PATCH ${fieldsLabel} on: ${existing.name} (${existing.id})`);
      results.push({ name: existing.name, status: 'updated', message: `Would update ${fieldsLabel} (dry run)` });
      continue;
    }

    try {
      await api.patch<Job>(`/jobs/${existing.id}`, patchBody);
      console.log(`  [~] ${existing.name} — ${fieldsLabel} updated`);
      results.push({ name: existing.name, status: 'updated', message: `${fieldsLabel} patched (${existing.id})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [x] ${existing.name}: ${msg}`);
      results.push({ name: existing.name, status: 'failed', message: msg });
    }
  }

  // Also update the Mainstream News Aggregation job (only when no category filter)
  if (!CATEGORY) {
    const newsJob = existingJobs.find((j) => j.name === MAINSTREAM_NEWS_NAME);
    if (!newsJob) {
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'skipped', message: 'Job not found' });
      return;
    }

    // The mainstream news prompt describes the source count; use whatever the job has now.
    const updatedNewsPrompt = buildMainstreamNewsPrompt(newsJob.sources.length);
    const fieldsLabel = mode === 'all' ? 'all fields' : 'prompt';

    if (DRY_RUN) {
      console.log(`  [~] Would PATCH ${fieldsLabel} on: ${MAINSTREAM_NEWS_NAME} (${newsJob.id})`);
      results.push({ name: MAINSTREAM_NEWS_NAME, status: 'updated', message: `Would update ${fieldsLabel} (dry run)` });
      return;
    }

    try {
      // For news, we always update only the prompt — sources are managed by --update-news.
      // Even in 'all' mode, we don't want to clobber the user's source list here because
      // --update-news has its own merge semantics that preserve manual additions.
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
 * Build the mainstream news prompt. Extracted so --update-prompts and
 * --update-news can share the same source of truth.
 */
const buildMainstreamNewsPrompt = (sourceCount: number): string =>
  `Curate the **top 5** stories from ${sourceCount} mainstream sources: wire services, public media, international, US newspapers.\n\n` +
  `${PROMPT_HEADER_PREVIOUS_CONTEXT}\n${PROMPT_DEDUP_RULE}\n\n` +
  `**Top 5 Stories:**\n${PROMPT_FORMAT_RULE}\n` +
  `Tags: Politics, Policy, Economy, Justice, Climate, Health, World, Technology.\n` +
  `Prioritize stories covered by 3+ sources (consensus). Note source count inline (e.g., "*Guardian, BBC, NYT*").\n\n` +
  `**Brief Note (1 sentence):** "Story of the day" — the single development with most cross-source attention.\n\n` +
  `${PROMPT_SUGGESTIONS_FOOTER}`;

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

  // Handle --update-prompts mode: PATCH only prompt/description/tags on existing jobs.
  // Safe — never touches sources or schedule. Use this if you have UI customizations.
  if (UPDATE_PROMPTS) {
    await updateExistingJobs(existingJobs, results, 'prompts');
    printResults(results);
    return;
  }

  // Handle --update-all mode: PATCH prompt + sources + schedule + timeout on existing jobs.
  // More aggressive — overwrites any UI customizations to match the script definitions.
  // Use this when you want existing jobs to fully match the latest script.
  if (UPDATE_ALL) {
    await updateExistingJobs(existingJobs, results, 'all');
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
