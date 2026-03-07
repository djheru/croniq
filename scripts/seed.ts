/**
 * Example job configurations to seed via the API.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = 'http://localhost:3001/api';

const examples = [
  {
    name: 'BTC Price (CoinGecko)',
    description: 'Track Bitcoin price in USD every 5 minutes',
    schedule: '*/5 * * * *',
    tags: ['crypto', 'prices'],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: 'json',
    collectorConfig: {
      type: 'api',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur',
    },
  },
  {
    name: 'Hacker News Top Stories',
    description: 'Fetch top 10 HN stories every hour',
    schedule: '0 * * * *',
    tags: ['news', 'tech'],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 20000,
    outputFormat: 'json',
    collectorConfig: {
      type: 'rss',
      url: 'https://hnrss.org/frontpage',
      maxItems: 10,
      fields: ['title', 'link', 'pubDate'],
    },
  },
  {
    name: 'GitHub Status',
    description: 'Monitor GitHub operational status',
    schedule: '*/10 * * * *',
    tags: ['monitoring', 'devops'],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 10000,
    outputFormat: 'json',
    collectorConfig: {
      type: 'api',
      url: 'https://www.githubstatus.com/api/v2/status.json',
      extract: 'status',
    },
  },
  {
    name: 'Weather - Detroit, MI',
    description: 'Current conditions from Open-Meteo (free, no key)',
    schedule: '0 */3 * * *',
    tags: ['weather', 'michigan'],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 15000,
    outputFormat: 'json',
    collectorConfig: {
      type: 'api',
      url: 'https://api.open-meteo.com/v1/forecast?latitude=42.33&longitude=-83.05&current_weather=true',
      extract: 'current_weather',
    },
  },
];

async function seed() {
  for (const job of examples) {
    const res = await fetch(`${BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
