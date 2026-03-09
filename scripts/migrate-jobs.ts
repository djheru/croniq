/**
 * One-time migration: update weather to Garden MI, remove Gilbert AZ, add RSS feeds.
 * Run: npx tsx scripts/migrate-jobs.ts
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const newFeeds = [
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
      fields: ["title", "link", "pubDate", "content"],
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
];

async function migrate() {
  // 1. Get all existing jobs
  const res = await fetch(`${BASE}/jobs`);
  const { data: jobs } = await res.json() as { data: Array<{ id: string; name: string }> };

  // 2. Update weather job to Garden MI
  const weatherJob = jobs.find(j => j.name.toLowerCase().includes("weather"));
  if (weatherJob) {
    const patchRes = await fetch(`${BASE}/jobs/${weatherJob.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Weather - Garden, MI",
        description: "Current conditions for Garden, MI (49835) from Open-Meteo (free, no key)",
        collectorConfig: {
          type: "api",
          url: "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current_weather=true",
          extract: "current_weather",
        },
      }),
    });
    if (patchRes.ok) console.log(`✓ Updated: ${weatherJob.name} → Weather - Garden, MI`);
    else console.error(`✗ Failed to update weather job:`, await patchRes.json());
  } else {
    console.log("⚠ No weather job found to update");
  }

  // 3. Delete Gilbert AZ Homes job
  const gilbertJob = jobs.find(j => j.name.toLowerCase().includes("gilbert"));
  if (gilbertJob) {
    const delRes = await fetch(`${BASE}/jobs/${gilbertJob.id}`, { method: "DELETE" });
    if (delRes.ok) console.log(`✓ Deleted: ${gilbertJob.name}`);
    else console.error(`✗ Failed to delete Gilbert job:`, await delRes.json());
  } else {
    console.log("⚠ No Gilbert AZ job found to delete");
  }

  // 4. Create new RSS feed jobs
  for (const feed of newFeeds) {
    // Skip if already exists
    const existing = jobs.find(j => j.name === feed.name);
    if (existing) {
      console.log(`⏭ Skipped (already exists): ${feed.name}`);
      continue;
    }

    const createRes = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feed),
    });
    const data = await createRes.json();
    if (createRes.ok) console.log(`✓ Created: ${feed.name}`);
    else console.error(`✗ Failed: ${feed.name}`, data.error);
  }
}

migrate().catch(console.error);
