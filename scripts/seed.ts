/**
 * Seed jobs for the agent pipeline.
 * Exported from local DB on 2026-03-14.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const jobs = [
  {
    "name": "The Guardian — US News",
    "description": "Top US news from The Guardian via RSS",
    "schedule": "0 * * * *",
    "tags": [
      "news",
      "guardian",
      "us"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "rss",
      "url": "https://www.theguardian.com/us-news/rss",
      "maxItems": 10,
      "fields": [
        "title",
        "link",
        "pubDate",
        "content"
      ]
    },
    "jobPrompt": "Analyze The Guardian's US news coverage. For each story provide:\n- Headline and publication time\n- A 1-2 sentence summary\n- Topic: Politics, Policy, Justice, Economy, Climate, Social Issues, or Other\n\nThe Guardian often provides an international perspective on US events. Note any stories where their framing or emphasis differs from what a US-based outlet might highlight.\n\nIdentify the top 3 most significant stories based on prominence and potential impact. Compare to previous runs to track developing stories and note any new angles or updates on ongoing coverage."
  },
  {
    "name": "Washington Post — Top Stories",
    "description": "Top stories from The Washington Post via RSS",
    "schedule": "0 * * * *",
    "tags": [
      "news",
      "wapo",
      "politics"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "rss",
      "url": "https://feeds.washingtonpost.com/rss/national",
      "maxItems": 10,
      "fields": [
        "title",
        "link",
        "pubDate",
        "content"
      ]
    },
    "jobPrompt": "Analyze The Washington Post's top national stories. For each story provide:\n- Headline and publication time\n- A 1-2 sentence summary of the key facts\n- Beat: White House, Congress, Courts, National Security, Economy, or Other\n\nThe Post is known for its political and investigative reporting. Flag any stories that appear to be investigative pieces, exclusive reports, or breaking news scoops.\n\nIdentify the top 3 most consequential stories. Compare to previous runs to track which stories are gaining momentum, which are new, and any developing situations with updated details."
  },
  {
    "name": "BTC/ETH/SOL Prices",
    "description": "Crypto price tracker via CoinGecko public API",
    "schedule": "*/5 * * * *",
    "tags": [
      "crypto",
      "prices"
    ],
    "notifyOnChange": false,
    "retries": 2,
    "timeoutMs": 120000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "api",
      "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"
    },
    "jobPrompt": "Fetch current prices for Bitcoin, Ethereum, and Solana. For each coin report:\n- Current USD price\n- 24-hour percentage change (flag moves greater than 5% as significant)\n- Market cap\n\nCompare to the previous run if available. Highlight any notable divergences between coins (e.g. BTC up but ETH down). If any coin has moved more than 10% in 24 hours, mark the report as HIGH ALERT."
  },
  {
    "name": "NPR News — Top Stories",
    "description": "Top stories from NPR via RSS",
    "schedule": "0 * * * *",
    "tags": [
      "news",
      "npr"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "rss",
      "url": "https://feeds.npr.org/1001/rss.xml",
      "maxItems": 10,
      "fields": [
        "title",
        "link",
        "pubDate",
        "content"
      ]
    },
    "jobPrompt": "Analyze the top stories from NPR. For each story provide:\n- Headline and publication time\n- A 1-2 sentence summary of the key facts\n- Category: Politics, Economy, Science, Culture, World, Health, or Other\n\nGroup stories by category and identify the dominant news themes of the hour. Note any breaking or developing stories that appear across multiple entries.\n\nCompare to previous runs to identify which stories are new, which are continuing coverage of earlier events, and which have dropped off the front page. Track how long major stories persist across runs."
  },
  {
    "name": "Weather — Gilbert, AZ",
    "description": "Current conditions and forecast for Gilbert, AZ (85233) via Open-Meteo",
    "schedule": "0 */3 * * *",
    "tags": [
      "weather",
      "arizona"
    ],
    "notifyOnChange": false,
    "retries": 2,
    "timeoutMs": 120000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "api",
      "url": "https://api.open-meteo.com/v1/forecast?latitude=33.35&longitude=-111.79&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,uv_index,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Phoenix&forecast_days=3"
    },
    "jobPrompt": "Report current weather conditions for Gilbert, Arizona (85233) in plain language. Include:\n- Temperature (°F), feels-like temperature, humidity, wind speed and gusts\n- UV index with sun safety recommendation (low/moderate/high/very high/extreme)\n- A human-readable description of the weather code\n- 3-day forecast with highs, lows, precipitation probability, and peak UV index\n\nGilbert is in the Phoenix metro area with a desert climate. Flag notable conditions:\n- Temperatures above 100°F (extreme heat advisory territory)\n- UV index above 8 (very high sun exposure risk)\n- Wind gusts above 30 mph (dust storm potential)\n- Any precipitation probability above 30% (notable for the desert)\n\nCompare temperature trends against previous runs. During summer months, track how many consecutive days have exceeded 100°F."
  },
  {
    "name": "Weather — Garden, MI",
    "description": "Current conditions and forecast for Garden, MI via Open-Meteo",
    "schedule": "0 */3 * * *",
    "tags": [
      "weather",
      "michigan"
    ],
    "notifyOnChange": false,
    "retries": 2,
    "timeoutMs": 120000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "api",
      "url": "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Detroit&forecast_days=3"
    },
    "jobPrompt": "Report current weather conditions for Garden, Michigan in plain language. Include:\n- Temperature (°F), humidity, wind speed\n- A human-readable description of the weather code (e.g. \"partly cloudy\", \"heavy rain\")\n- 3-day forecast summary with highs, lows, and precipitation probability\n\nFlag any notable conditions: temperatures below 20°F or above 90°F, wind speeds above 25 mph, or precipitation probability above 70%. Compare temperature trends against previous runs if available to note warming or cooling patterns."
  },
  {
    "name": "Hacker News Front Page",
    "description": "Top stories from Hacker News via RSS",
    "schedule": "0 * * * *",
    "tags": [
      "news",
      "tech"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "rss",
      "url": "https://hnrss.org/frontpage",
      "maxItems": 10,
      "fields": [
        "title",
        "link",
        "pubDate"
      ]
    },
    "jobPrompt": "Analyze the current Hacker News front page. Categorize each story into one of: AI/ML, Programming, Startups/Business, Science, Security, Show HN, or Other.\n\nIdentify the dominant themes across all stories — are there clusters of related topics? Note any stories that appear to be about the same event or topic.\n\nHighlight stories that are particularly relevant to a TypeScript/Node.js developer working with AI and cloud infrastructure. If any stories relate to AWS, LangChain, or LLM tooling, call them out specifically."
  },
  {
    "name": "AWS Service Health",
    "description": "AWS service status via RSS feed",
    "schedule": "*/10 * * * *",
    "tags": [
      "monitoring",
      "aws",
      "infrastructure"
    ],
    "notifyOnChange": true,
    "retries": 3,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "rss",
      "url": "https://status.aws.amazon.com/rss/all.rss",
      "maxItems": 20,
      "fields": [
        "title",
        "link",
        "pubDate",
        "content"
      ]
    },
    "jobPrompt": "Monitor AWS service health for issues that could affect our infrastructure. We primarily use: Bedrock, Lambda, DynamoDB, EventBridge, SQS, S3, and CloudFront in us-east-1.\n\nFor each incident reported:\n- Identify the affected service and region\n- Classify severity: Critical (service down), Major (degraded), Minor (informational)\n- Note the timestamp and whether it's new, ongoing, or resolved\n\nPrioritize incidents affecting our key services. Compare against previous runs to track incident progression — note any incidents that have escalated or been resolved since the last check."
  },
  {
    "name": "GitHub — Croniq Repo Stats",
    "description": "Track repository stats via GitHub GraphQL API",
    "schedule": "0 */6 * * *",
    "tags": [
      "github",
      "project"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 240000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "graphql",
      "url": "https://api.github.com/graphql",
      "query": "{ repository(owner: \"djheru\", name: \"croniq\") { stargazerCount forkCount issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } defaultBranchRef { target { ... on Commit { history(first: 5) { nodes { message committedDate author { name } } } } } } } }",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      },
      "extract": "repository"
    },
    "jobPrompt": "Report on the current state of the Croniq GitHub repository. Summarize:\n- Stars, forks, open issues, and open PRs\n- The 5 most recent commits with author, date, and message summary\n\nCompare stats against previous runs. Flag any new issues or PRs that appeared since the last check. Note commit velocity — are commits happening daily, weekly, or has activity slowed?\n\nIf there are open issues or PRs, briefly categorize them (bug, feature, docs, etc.) based on their titles."
  },
  {
    "name": "Anthropic Blog — Latest Posts",
    "description": "Scrape latest blog posts from Anthropic's research blog",
    "schedule": "0 9,17 * * *",
    "tags": [
      "ai",
      "anthropic",
      "research"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 300000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "browser",
      "url": "https://www.anthropic.com/research",
      "selectors": {
        "titles": {
          "selector": "h2, h3",
          "multiple": true
        },
        "links": {
          "selector": "a[href*='/research/']",
          "attribute": "href",
          "multiple": true
        },
        "dates": {
          "selector": "time, [class*='date']",
          "multiple": true
        }
      },
      "waitFor": "article, [class*='post'], [class*='card'], main",
      "scrollToBottom": true
    },
    "jobPrompt": "Collect the latest posts from Anthropic's research page. For each post extract:\n- Title\n- Publication date\n- URL\n\nIdentify any new posts that weren't present in previous runs. For new posts, note the topic area (safety, capabilities, interpretability, policy, etc.).\n\nSummarize the overall publishing cadence — how frequently is Anthropic posting? Are there clusters around specific topics recently?"
  },
  {
    "name": "GitHub Status Monitor",
    "description": "Track GitHub platform status and incident history",
    "schedule": "*/10 * * * *",
    "tags": [
      "monitoring",
      "github",
      "devops"
    ],
    "notifyOnChange": true,
    "retries": 3,
    "timeoutMs": 120000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "api",
      "url": "https://www.githubstatus.com/api/v2/summary.json"
    },
    "jobPrompt": "Monitor GitHub's platform status. Report:\n\n1. **Overall status**: operational, degraded, major outage\n2. **Component breakdown**: For each component (Git Operations, API Requests, Actions, Packages, Pages, Codespaces, Copilot), report current status\n3. **Active incidents**: List any ongoing incidents with severity, affected components, and latest update\n\nCompare to previous runs:\n- Flag any components that changed status (e.g. operational → degraded)\n- Track incident duration for ongoing issues\n- Note when previously degraded services have recovered\n\nIf GitHub Actions or API Requests are degraded, mark as HIGH PRIORITY since these affect our CI/CD pipeline."
  },
  {
    "name": "Croniq — Pipeline Stats",
    "description": "Self-monitoring: token usage, costs, and pipeline health",
    "schedule": "0 */6 * * *",
    "tags": [
      "croniq",
      "monitoring",
      "costs"
    ],
    "notifyOnChange": false,
    "retries": 1,
    "timeoutMs": 120000,
    "outputFormat": "json",
    "collectorConfig": {
      "type": "api",
      "url": "http://localhost:3001/api/stats?period=24h"
    },
    "jobPrompt": "This is Croniq's self-monitoring job. The data comes from Croniq's own /api/stats endpoint. Report:\n\n1. **Pipeline Health**: Total runs, success/failure/timeout counts and rates in the last 24 hours\n2. **Token Usage by Model**: For each model, report total tokens consumed, stage count, and error rate\n3. **Cost Estimate**: Total estimated cost in USD (the API provides blended-rate estimates)\n4. **Performance**: Average pipeline duration — flag if it exceeds 60 seconds\n\nCompare to previous runs to track:\n- Are costs trending up or down? What's the daily run rate?\n- Is any particular model producing more errors than others?\n- Has pipeline duration changed significantly?\n\nIf total estimated daily cost exceeds $5.00, flag as HIGH COST. If error rate exceeds 20%, flag as RELIABILITY CONCERN."
  }
];

async function seed() {
  // Clear existing jobs
  console.log(`Clearing existing jobs from ${BASE}...`);
  const existing = await fetch(`${BASE}/jobs`).then((r) => r.json());
  for (const job of existing.data ?? existing) {
    await fetch(`${BASE}/jobs/${job.id}`, { method: "DELETE" });
  }
  console.log(`  Cleared ${(existing.data ?? existing).length} jobs.\n`);

  console.log(`Seeding jobs to ${BASE}...\n`);

  for (const job of jobs) {
    const res = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  ✓ ${job.name} (${job.collectorConfig.type})`);
    } else {
      console.error(`  ✗ ${job.name}:`, data.error);
    }
  }

  console.log("\nDone.");
}

seed().catch(console.error);

