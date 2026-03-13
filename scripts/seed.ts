/**
 * Seed jobs for the agent pipeline.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const jobs = [
  // ── API ────────────────────────────────────────────────────────────────────
  {
    name: "BTC/ETH/SOL Prices",
    description: "Crypto price tracker via CoinGecko public API",
    schedule: "*/5 * * * *",
    tags: ["crypto", "prices"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
    },
    jobPrompt: `Fetch current prices for Bitcoin, Ethereum, and Solana. For each coin report:
- Current USD price
- 24-hour percentage change (flag moves greater than 5% as significant)
- Market cap

Compare to the previous run if available. Highlight any notable divergences between coins (e.g. BTC up but ETH down). If any coin has moved more than 10% in 24 hours, mark the report as HIGH ALERT.`,
  },

  {
    name: "Weather — Garden, MI",
    description: "Current conditions and forecast for Garden, MI via Open-Meteo",
    schedule: "0 */3 * * *",
    tags: ["weather", "michigan"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=45.77&longitude=-86.55&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Detroit&forecast_days=3",
    },
    jobPrompt: `Report current weather conditions for Garden, Michigan in plain language. Include:
- Temperature (°F), humidity, wind speed
- A human-readable description of the weather code (e.g. "partly cloudy", "heavy rain")
- 3-day forecast summary with highs, lows, and precipitation probability

Flag any notable conditions: temperatures below 20°F or above 90°F, wind speeds above 25 mph, or precipitation probability above 70%. Compare temperature trends against previous runs if available to note warming or cooling patterns.`,
  },

  // ── RSS ────────────────────────────────────────────────────────────────────
  {
    name: "Hacker News Front Page",
    description: "Top stories from Hacker News via RSS",
    schedule: "0 * * * *",
    tags: ["news", "tech"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://hnrss.org/frontpage",
      maxItems: 15,
      fields: ["title", "link", "pubDate"],
    },
    jobPrompt: `Analyze the current Hacker News front page. Categorize each story into one of: AI/ML, Programming, Startups/Business, Science, Security, Show HN, or Other.

Identify the dominant themes across all stories — are there clusters of related topics? Note any stories that appear to be about the same event or topic.

Highlight stories that are particularly relevant to a TypeScript/Node.js developer working with AI and cloud infrastructure. If any stories relate to AWS, LangChain, or LLM tooling, call them out specifically.`,
  },

  {
    name: "AWS Service Health",
    description: "AWS service status via RSS feed",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "aws", "infrastructure"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://status.aws.amazon.com/rss/all.rss",
      maxItems: 20,
      fields: ["title", "link", "pubDate", "content"],
    },
    jobPrompt: `Monitor AWS service health for issues that could affect our infrastructure. We primarily use: Bedrock, Lambda, DynamoDB, EventBridge, SQS, S3, and CloudFront in us-east-1.

For each incident reported:
- Identify the affected service and region
- Classify severity: Critical (service down), Major (degraded), Minor (informational)
- Note the timestamp and whether it's new, ongoing, or resolved

Prioritize incidents affecting our key services. Compare against previous runs to track incident progression — note any incidents that have escalated or been resolved since the last check.`,
  },

  // ── HTML ───────────────────────────────────────────────────────────────────
  {
    name: "NPM Package Stats — LangChain",
    description: "Track weekly downloads for key LangChain packages",
    schedule: "0 9 * * *",
    tags: ["packages", "langchain", "tracking"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.npmjs.org/downloads/point/last-week/@langchain/core",
    },
    jobPrompt: `Fetch weekly download statistics for the @langchain/core package from npm. Report:
- Total downloads in the past week
- Compare to previous runs to identify growth or decline trends
- Note the percentage change from the last recorded value

If downloads have dropped more than 20% compared to the previous run, flag this as notable. If there's a sustained upward trend across multiple runs, note the growth trajectory.`,
  },

  // ── GraphQL ────────────────────────────────────────────────────────────────
  {
    name: "GitHub — Croniq Repo Stats",
    description: "Track repository stats via GitHub GraphQL API",
    schedule: "0 */6 * * *",
    tags: ["github", "project"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "graphql",
      url: "https://api.github.com/graphql",
      query: "{ repository(owner: \"djheru\", name: \"croniq\") { stargazerCount forkCount issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } defaultBranchRef { target { ... on Commit { history(first: 5) { nodes { message committedDate author { name } } } } } } } }",
      headers: { "Authorization": "Bearer ${GITHUB_TOKEN}" },
      extract: "repository",
    },
    jobPrompt: `Report on the current state of the Croniq GitHub repository. Summarize:
- Stars, forks, open issues, and open PRs
- The 5 most recent commits with author, date, and message summary

Compare stats against previous runs. Flag any new issues or PRs that appeared since the last check. Note commit velocity — are commits happening daily, weekly, or has activity slowed?

If there are open issues or PRs, briefly categorize them (bug, feature, docs, etc.) based on their titles.`,
  },

  // ── Browser ────────────────────────────────────────────────────────────────
  {
    name: "Anthropic Blog — Latest Posts",
    description: "Scrape latest blog posts from Anthropic's research blog",
    schedule: "0 9,17 * * *",
    tags: ["ai", "anthropic", "research"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 60000,
    outputFormat: "json",
    collectorConfig: {
      type: "browser",
      url: "https://www.anthropic.com/research",
      waitFor: "article, [class*='post'], [class*='card'], main",
      scrollToBottom: true,
      selectors: {
        titles: { selector: "h2, h3", multiple: true },
        links: { selector: "a[href*='/research/']", attribute: "href", multiple: true },
        dates: { selector: "time, [class*='date']", multiple: true },
      },
    },
    jobPrompt: `Collect the latest posts from Anthropic's research page. For each post extract:
- Title
- Publication date
- URL

Identify any new posts that weren't present in previous runs. For new posts, note the topic area (safety, capabilities, interpretability, policy, etc.).

Summarize the overall publishing cadence — how frequently is Anthropic posting? Are there clusters around specific topics recently?`,
  },

  // ── Mixed: API with detailed analysis ──────────────────────────────────────
  {
    name: "GitHub Status Monitor",
    description: "Track GitHub platform status and incident history",
    schedule: "*/10 * * * *",
    tags: ["monitoring", "github", "devops"],
    notifyOnChange: true,
    retries: 3,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://www.githubstatus.com/api/v2/summary.json",
    },
    jobPrompt: `Monitor GitHub's platform status. Report:

1. **Overall status**: operational, degraded, major outage
2. **Component breakdown**: For each component (Git Operations, API Requests, Actions, Packages, Pages, Codespaces, Copilot), report current status
3. **Active incidents**: List any ongoing incidents with severity, affected components, and latest update

Compare to previous runs:
- Flag any components that changed status (e.g. operational → degraded)
- Track incident duration for ongoing issues
- Note when previously degraded services have recovered

If GitHub Actions or API Requests are degraded, mark as HIGH PRIORITY since these affect our CI/CD pipeline.`,
  },

  // ── News ───────────────────────────────────────────────────────────────────
  {
    name: "NPR News — Top Stories",
    description: "Top stories from NPR via RSS",
    schedule: "0 * * * *",
    tags: ["news", "npr"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.npr.org/1001/rss.xml",
      maxItems: 15,
      fields: ["title", "link", "pubDate", "content"],
    },
    jobPrompt: `Analyze the top stories from NPR. For each story provide:
- Headline and publication time
- A 1-2 sentence summary of the key facts
- Category: Politics, Economy, Science, Culture, World, Health, or Other

Group stories by category and identify the dominant news themes of the hour. Note any breaking or developing stories that appear across multiple entries.

Compare to previous runs to identify which stories are new, which are continuing coverage of earlier events, and which have dropped off the front page. Track how long major stories persist across runs.`,
  },

  {
    name: "The Guardian — US News",
    description: "Top US news from The Guardian via RSS",
    schedule: "0 * * * *",
    tags: ["news", "guardian", "us"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://www.theguardian.com/us-news/rss",
      maxItems: 15,
      fields: ["title", "link", "pubDate", "content"],
    },
    jobPrompt: `Analyze The Guardian's US news coverage. For each story provide:
- Headline and publication time
- A 1-2 sentence summary
- Topic: Politics, Policy, Justice, Economy, Climate, Social Issues, or Other

The Guardian often provides an international perspective on US events. Note any stories where their framing or emphasis differs from what a US-based outlet might highlight.

Identify the top 3 most significant stories based on prominence and potential impact. Compare to previous runs to track developing stories and note any new angles or updates on ongoing coverage.`,
  },

  {
    name: "Washington Post — Top Stories",
    description: "Top stories from The Washington Post via RSS",
    schedule: "0 * * * *",
    tags: ["news", "wapo", "politics"],
    notifyOnChange: true,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "rss",
      url: "https://feeds.washingtonpost.com/rss/national",
      maxItems: 15,
      fields: ["title", "link", "pubDate", "content"],
    },
    jobPrompt: `Analyze The Washington Post's top national stories. For each story provide:
- Headline and publication time
- A 1-2 sentence summary of the key facts
- Beat: White House, Congress, Courts, National Security, Economy, or Other

The Post is known for its political and investigative reporting. Flag any stories that appear to be investigative pieces, exclusive reports, or breaking news scoops.

Identify the top 3 most consequential stories. Compare to previous runs to track which stories are gaining momentum, which are new, and any developing situations with updated details.`,
  },

  // ── Weather ────────────────────────────────────────────────────────────────
  {
    name: "Weather — Gilbert, AZ",
    description: "Current conditions and forecast for Gilbert, AZ (85233) via Open-Meteo",
    schedule: "0 */3 * * *",
    tags: ["weather", "arizona"],
    notifyOnChange: false,
    retries: 2,
    timeoutMs: 30000,
    outputFormat: "json",
    collectorConfig: {
      type: "api",
      url: "https://api.open-meteo.com/v1/forecast?latitude=33.35&longitude=-111.79&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,uv_index,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Phoenix&forecast_days=3",
    },
    jobPrompt: `Report current weather conditions for Gilbert, Arizona (85233) in plain language. Include:
- Temperature (°F), feels-like temperature, humidity, wind speed and gusts
- UV index with sun safety recommendation (low/moderate/high/very high/extreme)
- A human-readable description of the weather code
- 3-day forecast with highs, lows, precipitation probability, and peak UV index

Gilbert is in the Phoenix metro area with a desert climate. Flag notable conditions:
- Temperatures above 100°F (extreme heat advisory territory)
- UV index above 8 (very high sun exposure risk)
- Wind gusts above 30 mph (dust storm potential)
- Any precipitation probability above 30% (notable for the desert)

Compare temperature trends against previous runs. During summer months, track how many consecutive days have exceeded 100°F.`,
  },
];

async function seed() {
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
