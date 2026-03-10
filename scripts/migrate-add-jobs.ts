/**
 * Add all new Croniq jobs — personal dashboard, data hoarding, professional intel.
 * Also fixes WashPost feeds and enhances weather jobs.
 * Run: npx tsx scripts/migrate-add-jobs.ts
 * Idempotent — skips jobs that already exist by name.
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

interface JobDef {
  name: string;
  description: string;
  schedule: string;
  tags: string[];
  notifyOnChange: boolean;
  retries: number;
  timeoutMs: number;
  outputFormat: string;
  collectorConfig: Record<string, unknown>;
  analysisPrompt?: string;
  analysisSchedule?: string;
}

const newJobs: JobDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // WEATHER — Enhanced with detailed forecasts and alerts
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Weather - Gilbert, AZ (Detailed)",
    description: "Hourly forecast + current conditions for Gilbert AZ via Open-Meteo — temp, humidity, UV, precip, wind, AQI",
    schedule: "0 */2 * * *",
    tags: ["weather", "arizona", "personal"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=33.35&longitude=-111.79&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index&hourly=temperature_2m,precipitation_probability,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FPhoenix&forecast_days=3",
    },
  },
  {
    name: "NWS Alerts - Phoenix Metro",
    description: "Active weather alerts for Phoenix/Gilbert area — excessive heat, dust storms, flash floods",
    schedule: "*/15 * * * *",
    tags: ["weather", "arizona", "alerts"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.weather.gov/alerts/active?point=33.35,-111.79",
      headers: { "User-Agent": "Croniq/1.0 (personal weather monitor)" },
      extract: "features",
    },
  },
  {
    name: "NWS Alerts - Garden, MI",
    description: "Active weather alerts for Garden Peninsula — freeze, winter storm, wind chill warnings",
    schedule: "*/15 * * * *",
    tags: ["weather", "michigan", "alerts"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.weather.gov/alerts/active?point=45.77,-86.55",
      headers: { "User-Agent": "Croniq/1.0 (personal weather monitor)" },
      extract: "features",
    },
  },
  {
    name: "Weather - Garden, MI (Detailed)",
    description: "Detailed forecast for Garden MI — wind chill, snow, precip, sunrise/sunset",
    schedule: "0 */3 * * *",
    tags: ["weather", "michigan"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,snow_depth&hourly=temperature_2m,precipitation_probability,snowfall,weather_code&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,snowfall_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York&forecast_days=3",
    },
  },
  {
    name: "Lake Michigan - Big Bay de Noc Marine Forecast",
    description: "NOAA marine forecast for northern Lake Michigan / Green Bay area",
    schedule: "0 */6 * * *",
    tags: ["weather", "michigan", "lake"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.weather.gov/gridpoints/MQT/73,45/forecast",
      headers: { "User-Agent": "Croniq/1.0 (personal weather monitor)" },
      extract: "properties.periods",
    },
  },
  {
    name: "AZ Air Quality (Maricopa County)",
    description: "Current AQI for Gilbert/Phoenix area via AirNow — PM2.5, ozone",
    schedule: "0 */2 * * *",
    tags: ["weather", "arizona", "health"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=33.35&longitude=-111.79&distance=25&API_KEY=B489EA20-B7D0-4D68-9F1D-C3E15BCB1049",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ARIZONA — Local news, politics, events, food
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "AZ Central News",
    description: "Phoenix metro local news from AZ Central / Arizona Republic",
    schedule: "0 * * * *",
    tags: ["news", "arizona"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://rssfeeds.azcentral.com/phoenix/home",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Phoenix New Times - Food & Drink",
    description: "New restaurants, reviews, and food news in Phoenix metro",
    schedule: "0 */4 * * *",
    tags: ["food", "arizona", "personal"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.phoenixnewtimes.com/phoenix/Rss.xml?section=oid%3A923296",
      maxItems: 15,
      fields: ["title", "link", "pubDate", "content"],
    },
  },
  {
    name: "Eater Phoenix",
    description: "Restaurant openings, reviews, and food news for Phoenix metro",
    schedule: "0 */4 * * *",
    tags: ["food", "arizona", "personal"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://phoenix.eater.com/rss/index.xml",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Phoenix Events - Eventbrite",
    description: "Upcoming events in Phoenix metro area from Eventbrite",
    schedule: "0 8 * * *",
    tags: ["events", "arizona", "personal"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://www.eventbriteapi.com/v3/events/search/?location.address=Phoenix%2C+AZ&location.within=30mi&expand=venue&sort_by=date&token=ZVISUO3HV5SGWQ5XJCAE",
      extract: "events",
    },
  },
  {
    name: "ADOT Traffic Alerts",
    description: "Arizona DOT freeway closures and incidents",
    schedule: "*/30 * * * *",
    tags: ["traffic", "arizona"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.azdot.gov/feeds/traffic-alerts",
      maxItems: 20,
      fields: ["title", "link", "pubDate", "content"],
    },
  },
  {
    name: "AZ Legislature - Recent Bills",
    description: "Arizona state legislature activity — new bills and updates",
    schedule: "0 */6 * * *",
    tags: ["politics", "arizona"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://apps.azleg.gov/BillStatus/RSSFeed",
      maxItems: 20,
      fields: ["title", "link", "pubDate", "content"],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MICHIGAN — UP tourism, local conditions
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "UP Travel Events",
    description: "Upper Peninsula Michigan events — fishing, snowmobile, festivals (Airbnb booking intel)",
    schedule: "0 8 * * 1",
    tags: ["michigan", "airbnb", "events"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "html",
      url: "https://www.uptravel.com/events/",
      selectors: {
        events: { selector: ".event-card h3, .event-title, .views-row .field-content a", multiple: true },
        dates: { selector: ".event-card .date, .event-date, .views-row .date-display-single", multiple: true },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AIRBNB COMPETITOR INTEL
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Airbnb Garden MI Competitors",
    description: "Track Airbnb listing count and prices for Garden Peninsula / Manistique area",
    schedule: "0 8 * * *",
    tags: ["airbnb", "michigan", "business"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 60000,
    outputFormat: "json",
    collectorConfig: {
      type: "browser",
      url: "https://www.airbnb.com/s/Garden--MI/homes?refinement_paths%5B%5D=%2Fhomes&query=Garden%2C%20MI&place_id=ChIJnwqP4fCdOE0RmLJC5UBvRgs",
      waitFor: "[data-testid='card-container']",
      scrollToBottom: true,
      selectors: {
        prices: { selector: "[data-testid='price-availability-row'] span._1y74zjx", multiple: true },
        titles: { selector: "[data-testid='listing-card-title']", multiple: true },
        ratings: { selector: "[aria-label*='rating']", multiple: true },
      },
    },
    analysisPrompt: "Analyze the Airbnb competitive landscape for Garden, MI. How many listings are available? What's the price range? How does this compare to previous snapshots? Note any new listings or significant price changes.",
    analysisSchedule: "0 9 * * 1",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WASHINGTON POST — Fixed feeds (replacing broken single feed)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Washington Post - Politics",
    description: "WashPost political coverage",
    schedule: "0 * * * *",
    tags: ["news", "politics"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.washingtonpost.com/arcio/rss/category/politics/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Washington Post - National",
    description: "WashPost national news",
    schedule: "0 * * * *",
    tags: ["news"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "http://feeds.washingtonpost.com/rss/national",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Washington Post - World",
    description: "WashPost world news",
    schedule: "0 * * * *",
    tags: ["news", "world"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.washingtonpost.com/rss/world",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POLITICS & JUSTICE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "ProPublica",
    description: "Investigative journalism — accountability and public interest",
    schedule: "0 */4 * * *",
    tags: ["news", "politics", "justice"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.propublica.org/feeds/propublica/main",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "The Marshall Project",
    description: "Criminal justice news and analysis",
    schedule: "0 */6 * * *",
    tags: ["news", "justice"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.themarshallproject.org/rss/podcast",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Brennan Center for Justice",
    description: "Voting rights, democracy, and rule of law analysis",
    schedule: "0 */6 * * *",
    tags: ["politics", "justice", "democracy"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.brennancenter.org/rss/feed",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "ACLU Blog",
    description: "Civil liberties and civil rights news",
    schedule: "0 */6 * * *",
    tags: ["politics", "justice", "civil-rights"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.aclu.org/news/feed/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Economic Policy Institute",
    description: "Economic inequality and worker policy research",
    schedule: "0 */6 * * *",
    tags: ["economics", "justice", "labor"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.epi.org/feed/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "FiveThirtyEight / ABC News Polls",
    description: "Political polling and election analysis",
    schedule: "0 */4 * * *",
    tags: ["politics", "polls"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://fivethirtyeight.com/features/feed/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "RealClearPolitics Polling",
    description: "Latest political polling averages and election data",
    schedule: "0 */6 * * *",
    tags: ["politics", "polls"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.realclearpolitics.com/index.xml",
      maxItems: 20,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Gallup Polls",
    description: "Gallup polling on politics, economy, and social issues",
    schedule: "0 8 * * *",
    tags: ["politics", "polls"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://news.gallup.com/rss/all.aspx",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Congress.gov - Recent Bills",
    description: "Recently introduced bills in the US Congress",
    schedule: "0 */6 * * *",
    tags: ["politics", "legislation"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.congress.gov/rss/most-viewed-bills.xml",
      maxItems: 20,
      fields: ["title", "link", "pubDate"],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AI / ML INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Arxiv AI Papers",
    description: "Latest AI and computational linguistics papers — long-term research archive",
    schedule: "0 6 * * *",
    tags: ["ai", "research", "data-hoard"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://rss.arxiv.org/rss/cs.AI+cs.CL",
      maxItems: 30,
      fields: ["title", "link", "pubDate", "author"],
    },
    analysisPrompt: "Summarize the most interesting AI and NLP papers from today's arxiv feed. Focus on: (1) papers related to LLMs, agents, or tool use, (2) papers with practical applications for software engineering, (3) any breakthrough results. Provide clickable links to each paper you mention.",
    analysisSchedule: "0 7 * * *",
  },
  {
    name: "Anthropic Blog",
    description: "Claude and Anthropic model announcements and research",
    schedule: "0 */4 * * *",
    tags: ["ai", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.anthropic.com/rss.xml",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "OpenAI Blog",
    description: "OpenAI announcements and research — competitor awareness",
    schedule: "0 */4 * * *",
    tags: ["ai", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://openai.com/blog/rss.xml",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Hugging Face Papers",
    description: "Daily curated ML papers from Hugging Face",
    schedule: "0 7 * * *",
    tags: ["ai", "research"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://huggingface.co/papers/rss",
      maxItems: 20,
      fields: ["title", "link", "pubDate"],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AWS / NODE.JS ECOSYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "AWS What's New",
    description: "Every new AWS service and feature announcement",
    schedule: "0 * * * *",
    tags: ["aws", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/",
      maxItems: 20,
      fields: ["title", "link", "pubDate", "categories"],
    },
    analysisPrompt: "Summarize the latest AWS announcements. Highlight anything related to: Lambda, CDK, DynamoDB, EventBridge, Bedrock, or serverless. Also flag any pricing changes or new regions. Include links.",
    analysisSchedule: "0 8 * * *",
  },
  {
    name: "AWS Compute Blog",
    description: "AWS blog posts on Lambda, ECS, Fargate, serverless",
    schedule: "0 */4 * * *",
    tags: ["aws", "tech", "serverless"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://aws.amazon.com/blogs/compute/feed/",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "AWS AI/ML Blog",
    description: "AWS blog posts on Bedrock, SageMaker, and AI services",
    schedule: "0 */4 * * *",
    tags: ["aws", "ai", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://aws.amazon.com/blogs/machine-learning/feed/",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Node.js Blog",
    description: "Official Node.js release announcements and security advisories",
    schedule: "0 */6 * * *",
    tags: ["nodejs", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://nodejs.org/en/feed/blog.xml",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "npm Security Advisories",
    description: "GitHub Advisory Database — npm ecosystem security vulnerabilities",
    schedule: "0 */4 * * *",
    tags: ["nodejs", "security", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.github.com/advisories?ecosystem=npm&per_page=15&sort=published&direction=desc",
      headers: { "Accept": "application/vnd.github+json" },
    },
  },
  {
    name: "GitHub Trending - TypeScript",
    description: "Daily trending TypeScript repositories on GitHub",
    schedule: "0 8 * * *",
    tags: ["tech", "typescript", "data-hoard"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "html",
      url: "https://github.com/trending/typescript?since=daily",
      selectors: {
        repos: { selector: "article.Box-row h2 a", attribute: "href", multiple: true },
        descriptions: { selector: "article.Box-row p", multiple: true },
        stars: { selector: "article.Box-row .f6 svg.octicon-star + span", multiple: true, transform: "trim" },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA HOARDING — Financial / Economic
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Gold Price (Metals API)",
    description: "Daily gold spot price in USD — long-term price tracking",
    schedule: "0 18 * * 1-5",
    tags: ["finance", "metals", "data-hoard"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.metals.dev/v1/latest?api_key=demo&currency=USD&unit=toz",
    },
  },
  {
    name: "Gas Prices - Arizona",
    description: "AAA average gas prices for Arizona — long-term tracking",
    schedule: "0 8 * * *",
    tags: ["finance", "arizona", "data-hoard"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "html",
      url: "https://gasprices.aaa.com/?state=AZ",
      selectors: {
        regular: { selector: ".average-price .price-text", multiple: false },
        prices: { selector: "table.table-mob tbody td", multiple: true, transform: "trim" },
      },
    },
  },
  {
    name: "Gas Prices - Michigan",
    description: "AAA average gas prices for Michigan — long-term tracking",
    schedule: "0 8 * * *",
    tags: ["finance", "michigan", "data-hoard"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "html",
      url: "https://gasprices.aaa.com/?state=MI",
      selectors: {
        regular: { selector: ".average-price .price-text", multiple: false },
        prices: { selector: "table.table-mob tbody td", multiple: true, transform: "trim" },
      },
    },
  },
  {
    name: "npm Download Stats - Key Packages",
    description: "Weekly download counts for packages you follow — adoption trend tracking",
    schedule: "0 8 * * 1",
    tags: ["nodejs", "tech", "data-hoard"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.npmjs.org/downloads/point/last-week/typescript,@anthropic-ai/sdk,@aws-sdk/client-bedrock-runtime,aws-cdk-lib,next,@langchain/core,zod,hono,bun-types,effect",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE STATUS / MONITORING
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "Google Cloud Status",
    description: "Google Cloud Platform service status via Statuspage API",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "google"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://status.cloud.google.com/incidents.json",
    },
  },
  {
    name: "Azure DevOps Status",
    description: "Azure DevOps service health via Statuspage API",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "microsoft"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://status.dev.azure.com/_apis/status/health",
    },
  },
  {
    name: "npm Registry Status",
    description: "npm registry operational status",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "nodejs"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 10000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://status.npmjs.org/api/v2/status.json",
      extract: "status",
    },
  },
  {
    name: "Croniq Self-Monitor",
    description: "Croniq monitoring itself — health check canary",
    schedule: "*/5 * * * *",
    tags: ["monitoring", "meta"],
    notifyOnChange: true,
    retries: 1,
    timeoutMs: 5000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "http://localhost:3001/api/health",
    },
  },
];

// Jobs to delete (already removed by user, but clean up if they exist)
const jobsToDelete = [
  "Washington Post",
];

// Jobs to update (enhance existing weather)
const jobsToUpdate: Record<string, Record<string, unknown>> = {
  "Weather - Garden, MI": {
    name: "Weather - Garden, MI (Basic)",
    description: "Basic current conditions for Garden, MI — kept as baseline alongside detailed forecast",
    schedule: "0 */6 * * *",
  },
};

async function migrate() {
  console.log("Fetching existing jobs...");
  const res = await fetch(`${BASE}/jobs`);
  const { data: jobs } = await res.json() as { data: Array<{ id: string; name: string }> };
  const existingNames = new Set(jobs.map((j: { name: string }) => j.name));
  console.log(`Found ${jobs.length} existing jobs\n`);

  // Delete old jobs
  for (const name of jobsToDelete) {
    const job = jobs.find((j: { name: string }) => j.name === name);
    if (job) {
      const delRes = await fetch(`${BASE}/jobs/${job.id}`, { method: "DELETE" });
      if (delRes.ok) console.log(`✗ Deleted: ${name}`);
      else console.error(`  Failed to delete: ${name}`);
    }
  }

  // Update existing jobs
  for (const [name, updates] of Object.entries(jobsToUpdate)) {
    const job = jobs.find((j: { name: string }) => j.name === name);
    if (job) {
      const patchRes = await fetch(`${BASE}/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (patchRes.ok) console.log(`✎ Updated: ${name}`);
      else console.error(`  Failed to update: ${name}`, await patchRes.json());
    }
  }

  // Create new jobs
  let created = 0;
  let skipped = 0;
  for (const job of newJobs) {
    if (existingNames.has(job.name)) {
      skipped++;
      continue;
    }
    const createRes = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await createRes.json();
    if (createRes.ok) {
      console.log(`✓ Created: ${job.name}`);
      created++;
    } else {
      console.error(`✗ Failed: ${job.name}`, data.error);
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped (already exist)`);
}

migrate().catch(console.error);
