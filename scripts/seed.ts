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
    name: "Gilbert AZ Homes (Pool)",
    description: "Realtor.com search: Gilbert AZ, 2bd/2ba, $300-650k, pool, single-family/condo/townhome",
    schedule: "0 8,20 * * *",
    tags: ["real-estate", "gilbert-az"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 45000,
    outputFormat: "json",
    collectorConfig: {
      type: "browser",
      url: "https://www.realtor.com/realestateandhomes-search/Gilbert_AZ/type-single-family-home,condo,townhome/beds-2/baths-2/pnd-ctg-hide/price-300000-650000/keyword-Pool",
      waitFor: "[data-testid='card-content']",
      scrollToBottom: true,
      selectors: {
        prices: { selector: "[data-testid='card-price']", multiple: true },
        addresses: { selector: "[data-testid='card-address']", multiple: true },
        beds: { selector: "[data-testid='property-meta-beds'] span", multiple: true },
        baths: { selector: "[data-testid='property-meta-baths'] span", multiple: true },
        sqft: { selector: "[data-testid='property-meta-sqft'] span", multiple: true },
        links: { selector: "a[data-testid='card-link']", attribute: "href", multiple: true },
      },
    },
  },
  {
    name: "Weather - Detroit, MI",
    description: "Current conditions from Open-Meteo (free, no key)",
    schedule: "0 */3 * * *",
    tags: ["weather", "michigan"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=42.33&longitude=-83.05&current_weather=true",
      extract: "current_weather",
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
