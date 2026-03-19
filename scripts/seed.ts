/**
 * Seed jobs for the agent pipeline.
 *
 * Usage:
 *   npm run db:seed                              # seed with default jobs from this file
 *   npm run db:seed backups/2026-03-18.json      # seed from exported backup
 */

import fs from "fs";
import path from "path";

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const defaultJobs = [
  {
    "name": "News — Multi-Source Aggregation",
    "description": "Aggregated news from The Guardian, Washington Post, and NPR",
    "schedule": "0 * * * *",
    "tags": [
      "news",
      "aggregation"
    ],
    "notifyOnChange": true,
    "retries": 2,
    "timeoutMs": 300000,
    "outputFormat": "json",
    "sources": [
      {
        "name": "The Guardian",
        "config": {
          "type": "rss",
          "url": "https://www.theguardian.com/us-news/rss",
          "maxItems": 10,
          "fields": ["title", "link", "pubDate", "content"]
        }
      },
      {
        "name": "Washington Post",
        "config": {
          "type": "rss",
          "url": "https://feeds.washingtonpost.com/rss/national",
          "maxItems": 10,
          "fields": ["title", "link", "pubDate", "content"]
        }
      },
      {
        "name": "NPR News",
        "config": {
          "type": "rss",
          "url": "https://feeds.npr.org/1001/rss.xml",
          "maxItems": 10,
          "fields": ["title", "link", "pubDate", "content"]
        }
      }
    ],
    "jobPrompt": "Analyze news coverage across three major sources: The Guardian (international perspective), Washington Post (US political focus), and NPR (public radio). For each story:\n- Headline and publication time\n- 1-2 sentence summary\n- Source attribution\n- Topic: Politics, Policy, Economy, Justice, Climate, Health, World, or Other\n\nCross-reference stories:\n- Identify stories covered by multiple sources — note differences in framing or emphasis\n- Flag exclusive stories only appearing in one source\n- Detect emerging stories that appear in one outlet but may spread to others\n\nProvide a synthesized view:\n- What are the dominant news themes across all sources?\n- Are there geographic or topical blind spots (stories covered heavily by one but ignored by others)?\n- Rank the top 5 stories by combined prominence and significance\n\nCompare to previous runs to track story evolution and persistence across the news cycle."
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
    "sources": [{
      "name": "CoinGecko API",
      "config": {
        "type": "api",
        "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"
      }
    }],
    "jobPrompt": "Fetch current prices for Bitcoin, Ethereum, and Solana. For each coin report:\n- Current USD price\n- 24-hour percentage change (flag moves greater than 5% as significant)\n- Market cap\n\nCompare to the previous run if available. Highlight any notable divergences between coins (e.g. BTC up but ETH down). If any coin has moved more than 10% in 24 hours, mark the report as HIGH ALERT."
  },
  {
    "name": "Weather — Multi-Location Monitoring",
    "description": "Current conditions and forecast for Gilbert, AZ and Garden, MI",
    "schedule": "0 */3 * * *",
    "tags": [
      "weather",
      "monitoring"
    ],
    "notifyOnChange": false,
    "retries": 2,
    "timeoutMs": 180000,
    "outputFormat": "json",
    "sources": [
      {
        "name": "Gilbert, AZ (Desert)",
        "config": {
          "type": "api",
          "url": "https://api.open-meteo.com/v1/forecast?latitude=33.35&longitude=-111.79&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,uv_index,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Phoenix&forecast_days=3"
        }
      },
      {
        "name": "Garden, MI (Great Lakes)",
        "config": {
          "type": "api",
          "url": "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Detroit&forecast_days=3"
        }
      }
    ],
    "jobPrompt": "Report weather conditions for two distinct climate zones: Gilbert, AZ (Phoenix metro, desert climate) and Garden, MI (Upper Peninsula, Great Lakes region).\n\nFor each location:\n- Current conditions: temperature, feels-like, humidity, wind\n- Weather description (clear, cloudy, rain, etc.)\n- 3-day forecast: highs, lows, precipitation probability\n- Location-specific alerts:\n  - Gilbert: Flag temps >100°F, UV index >8, wind gusts >30mph, precip >30%\n  - Garden: Flag temps <20°F or >90°F, wind >25mph, precip >70%\n\nProvide comparative analysis:\n- Temperature differential between desert and Great Lakes climates\n- Note any unusual weather patterns (e.g., rain in the desert, heat wave in Michigan)\n- Track multi-day trends for each location\n\nCompare against previous runs to identify developing weather systems or prolonged conditions (e.g., consecutive 100°F+ days in Gilbert, cold snaps in Garden)."
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
    "sources": [{
      "name": "Hacker News RSS",
      "config": {
        "type": "rss",
        "url": "https://hnrss.org/frontpage",
        "maxItems": 10,
        "fields": ["title", "link", "pubDate"]
      }
    }],
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
    "sources": [{
      "name": "AWS Status RSS",
      "config": {
        "type": "rss",
        "url": "https://status.aws.amazon.com/rss/all.rss",
        "maxItems": 20,
        "fields": ["title", "link", "pubDate", "content"]
      }
    }],
    "jobPrompt": "Monitor AWS service health for issues that could affect our infrastructure. We primarily use: Bedrock, Lambda, DynamoDB, EventBridge, SQS, S3, and CloudFront in us-east-1.\n\nFor each incident reported:\n- Identify the affected service and region\n- Classify severity: Critical (service down), Major (degraded), Minor (informational)\n- Note the timestamp and whether it's new, ongoing, or resolved\n\nPrioritize incidents affecting our key services. Compare against previous runs to track incident progression — note any incidents that have escalated or been resolved since the last check."
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
    "sources": [{
      "name": "Anthropic Research Blog",
      "config": {
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
      }
    }],
    "jobPrompt": "Collect the latest posts from Anthropic's research page. For each post extract:\n- Title\n- Publication date\n- URL\n\nIdentify any new posts that weren't present in previous runs. For new posts, note the topic area (safety, capabilities, interpretability, policy, etc.).\n\nSummarize the overall publishing cadence — how frequently is Anthropic posting? Are there clusters around specific topics recently?"
  },
  {
    "name": "GitHub — Platform & Repository Monitoring",
    "description": "Monitor GitHub platform status and Croniq repository activity",
    "schedule": "*/10 * * * *",
    "tags": [
      "monitoring",
      "github",
      "devops"
    ],
    "notifyOnChange": true,
    "retries": 3,
    "timeoutMs": 180000,
    "outputFormat": "json",
    "sources": [
      {
        "name": "GitHub Platform Status",
        "config": {
          "type": "api",
          "url": "https://www.githubstatus.com/api/v2/summary.json"
        }
      },
      {
        "name": "Croniq Repository",
        "config": {
          "type": "graphql",
          "url": "https://api.github.com/graphql",
          "query": "{ repository(owner: \"djheru\", name: \"croniq\") { stargazerCount forkCount issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } defaultBranchRef { target { ... on Commit { history(first: 5) { nodes { message committedDate author { name } } } } } } } }",
          "headers": {
            "Authorization": "Bearer ${GITHUB_TOKEN}"
          },
          "extract": "repository"
        }
      }
    ],
    "jobPrompt": "Monitor GitHub across two dimensions: platform health and Croniq repository activity.\n\n**Platform Status:**\n- Overall status: operational, degraded, or major outage\n- Component health: Git Operations, API Requests, Actions, Packages, Pages, Codespaces, Copilot\n- Active incidents with severity and affected components\n- Flag if Actions or API are degraded (HIGH PRIORITY — affects CI/CD)\n\n**Croniq Repository:**\n- Stars, forks, open issues, and open PRs\n- 5 most recent commits with authors, dates, and messages\n- Commit velocity: daily, weekly, or slowing?\n- Categorize open issues/PRs (bug, feature, docs) based on titles\n\n**Cross-Analysis:**\n- If platform is degraded, note how it might affect Croniq development (e.g., Actions down = CI blocked)\n- Compare repository activity against previous runs — flag new issues, PRs, or commits\n- Track incident progression and repository momentum over time"
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
    "sources": [{
      "name": "Croniq Stats API",
      "config": {
        "type": "api",
        "url": "http://localhost:3001/api/stats?period=24h"
      }
    }],
    "jobPrompt": "This is Croniq's self-monitoring job. The data comes from Croniq's own /api/stats endpoint. Report:\n\n1. **Pipeline Health**: Total runs, success/failure/timeout counts and rates in the last 24 hours\n2. **Token Usage by Model**: For each model, report total tokens consumed, stage count, and error rate\n3. **Cost Estimate**: Total estimated cost in USD (the API provides blended-rate estimates)\n4. **Performance**: Average pipeline duration — flag if it exceeds 60 seconds\n\nCompare to previous runs to track:\n- Are costs trending up or down? What's the daily run rate?\n- Is any particular model producing more errors than others?\n- Has pipeline duration changed significantly?\n\nIf total estimated daily cost exceeds $5.00, flag as HIGH COST. If error rate exceeds 20%, flag as RELIABILITY CONCERN."
  },
  {
    "name": "Pi System Health",
    "description": "Raspberry Pi temperature, CPU load, memory, and disk monitoring",
    "schedule": "*/10 * * * *",
    "tags": [
      "monitoring",
      "system",
      "pi"
    ],
    "notifyOnChange": false,
    "retries": 1,
    "timeoutMs": 60000,
    "outputFormat": "json",
    "sources": [{
      "name": "Pi System Metrics",
      "config": {
        "type": "api",
        "url": "http://localhost:3001/api/system/metrics"
      }
    }],
    "jobPrompt": "Monitor Raspberry Pi system health and flag concerning conditions:\n\n**Temperature:**\n- Current CPU temperature in both Celsius and Fahrenheit\n- Flag as WARNING if >70°C (158°F)\n- Flag as CRITICAL if >80°C (176°F)\n\n**CPU Load:**\n- Report 1-minute, 5-minute, and 15-minute load averages\n- Flag if 5-minute load average exceeds 3.0 (Pi has 4 cores, sustained >75% is concerning)\n\n**Memory:**\n- Total RAM, used RAM, and percentage\n- Flag as WARNING if >80% used\n- Flag as CRITICAL if >90% used\n\n**Disk:**\n- Root filesystem usage percentage\n- Flag as WARNING if >80% full\n- Flag as CRITICAL if >90% full\n\n**Uptime:**\n- Report current uptime\n\n**Trend Analysis:**\nCompare against previous runs to identify:\n- Temperature trends (gradual increase may indicate dust buildup or cooling issues)\n- Memory leaks (steadily increasing RAM usage)\n- Disk space consumption rate\n- Any sudden changes in metrics\n\nProvide a summary status: ALL CLEAR, WARNINGS PRESENT, or CRITICAL CONDITIONS."
  }
];

async function seed() {
  // Load jobs from file or use defaults
  let jobs = defaultJobs;
  const inputFile = process.argv[2];

  if (inputFile) {
    const filePath = path.resolve(inputFile);
    console.log(`Loading jobs from ${filePath}...`);
    try {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      jobs = JSON.parse(fileContent);
      console.log(`  Loaded ${jobs.length} jobs from file.\n`);
    } catch (err) {
      console.error(`✗ Failed to load jobs from file:`, err);
      process.exit(1);
    }
  }

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
      console.log(`  ✓ ${job.name} (${job.sources.length} source${job.sources.length !== 1 ? 's' : ''})`);
    } else {
      console.error(`  ✗ ${job.name}:`, data.error);
    }
  }

  console.log("\nDone.");
}

seed().catch(console.error);

