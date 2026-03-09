/**
 * Example job configurations to seed via the API.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const examples = [
  {
    name: "BTC Price (Kraken)",
    description: "Track Bitcoin price in USD every 5 minutes via Kraken public API",
    schedule: "*/5 * * * *",
    tags: ["crypto", "prices"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
      extract: "result.XXBTZUSD",
    },
  },
  {
    name: "Hacker News Top Stories",
    description: "Fetch top 10 HN stories every hour",
    schedule: "0 * * * *",
    tags: ["news", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://hnrss.org/frontpage",
      maxItems: 10,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "GitHub Status",
    description: "Monitor GitHub operational status",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "devops"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 10000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://www.githubstatus.com/api/v2/status.json",
      extract: "status",
    },
  },
  {
    name: "AWS Health Dashboard",
    description: "Monitor AWS service health via RSS feed",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "aws"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://status.aws.amazon.com/rss/all.rss",
      maxItems: 20,
      fields: ["title", "link", "pubDate", "description"],
    },
  },
  {
    name: "Microsoft 365 Status",
    description: "Monitor Microsoft Office online apps service health",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "microsoft"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://azure.status.microsoft/en-us/status",
      headers: { "Accept": "application/json" },
    },
  },
  {
    name: "The Guardian US News",
    description: "Latest US news headlines from The Guardian",
    schedule: "0 * * * *",
    tags: ["news", "us"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.theguardian.com/us-news/rss",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Weather - Garden, MI",
    description: "Current conditions for Garden, MI (49835) from Open-Meteo (free, no key)",
    schedule: "0 */3 * * *",
    tags: ["weather", "michigan"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current_weather=true",
      extract: "current_weather",
    },
  },
  {
    name: "NPR News",
    description: "Top stories from NPR",
    schedule: "0 * * * *",
    tags: ["news"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.npr.org/1001/rss.xml",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "CNN Top Stories",
    description: "Top stories from CNN",
    schedule: "0 * * * *",
    tags: ["news"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "http://rss.cnn.com/rss/cnn_topstories.rss",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Washington Post",
    description: "Top stories from Washington Post",
    schedule: "0 * * * *",
    tags: ["news"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "http://www.washingtonpost.com/rss/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Federal Reserve H.15 Rates",
    description: "Selected interest rates from the Federal Reserve",
    schedule: "0 */6 * * *",
    tags: ["finance", "economics"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.federalreserve.gov/releases/h15/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "BLS Latest Releases",
    description: "Latest economic data releases from Bureau of Labor Statistics",
    schedule: "0 */6 * * *",
    tags: ["economics", "labor"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.bls.gov/feed/bls_latest.rss",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Census Economic Indicators",
    description: "Economic indicators from the US Census Bureau",
    schedule: "0 */6 * * *",
    tags: ["economics", "census"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.census.gov/economic-indicators/",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
  {
    name: "Reuters Business News",
    description: "Business news from Reuters",
    schedule: "0 * * * *",
    tags: ["news", "business"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.reuters.com/reuters/businessNews",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
  },
];

async function seed() {
  for (const job of examples) {
    const res = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`✓ Created: ${job.name}`);
    } else {
      console.error(`✗ Failed: ${job.name}`, data.error);
    }
  }
}

seed().catch(console.error);
