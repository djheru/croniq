# Real Estate Intelligence SaaS — Product Design Spec

**Date:** 2026-04-09
**Type:** High-level product concept + sub-project decomposition
**Status:** Brainstorming output — to be refined into sub-project specs

---

## 1. Product Vision

An AI-powered real estate intelligence platform that transforms raw property and market data (via RentCast API) into actionable investment analysis for real estate professionals. Users monitor zip codes, receive AI-scored deal alerts, generate market reports, and query their data in natural language.

**One-line pitch:** *"Your AI real estate analyst — monitoring markets, scoring deals, and answering questions 24/7."*

---

## 2. Target Users (Priority Order)

### 2.1 Wholesalers (Primary)
- Find below-market deals and motivated sellers
- Need: owner contact info, out-of-state owner detection, tax delinquency signals, long days-on-market, price vs. comps gap analysis
- Key metric: wholesale deal score (assignment fee potential)

### 2.2 Fix-and-Flip Investors
- Evaluate rehab profitability
- Need: ARV calculations, comparable sales analysis, price-per-sqft vs. neighborhood average, days on market trends
- Key metric: flip margin estimate

### 2.3 Buy-and-Hold Investors
- Evaluate long-term rental income potential
- Need: rent estimates, cap rate analysis, cash flow projections, appreciation trends, tenant demand indicators
- Key metric: cash-on-cash return, cap rate

### 2.4 Real Estate Agents
- Generate professional market reports for clients
- Need: neighborhood market trends, comparative market analyses, listing intelligence
- Key metric: report quality and presentation

---

## 3. Core Feature Set

### 3.1 Zip Code Monitoring
- Users add zip codes to their monitoring list (limited by subscription tier)
- System polls RentCast on schedule for: new listings, price changes, market statistics
- **Shared cache architecture**: multiple users monitoring the same zip code share a single set of API calls. RentCast cost scales with unique monitored zip codes, not user count.
- Configurable alert preferences per zip code (property type, price range, bedroom count)

### 3.2 AI Deal Scoring
- Every new listing is automatically scored by AI across three dimensions:
  - **Wholesale score**: price vs. comps gap, owner signals (out-of-state, long DOM), assignment fee potential
  - **Flip score**: ARV estimate, rehab margin, price-per-sqft discount vs. neighborhood
  - **Rental yield score**: rent estimate, cap rate, cash flow projection
- Scores are pre-computed via prompt chains (not agentic) from cached RentCast data
- Users can filter/sort their deal pipeline by score type and threshold

### 3.3 Market Intelligence Reports

**Periodic (scheduled, included in subscription):**
- Weekly market digest per monitored zip code
- Trends: median price movement, inventory changes, days-on-market shifts, new listing volume
- AI narrative: what's driving the market this week, opportunities flagged, risks noted

**On-demand (user-initiated, some premium):**
- Single property deep-dive: full RentCast data + AI analysis (comps, AVM, owner info, deal scoring)
- Single zip code market report: comprehensive market snapshot with AI commentary
- **Comparative Market Analysis (premium)**: 2-4 zip code side-by-side comparison with metrics table + AI strategic recommendation (e.g., "which market best fits a buy-and-hold strategy with $200K capital")

### 3.4 Natural Language Queries (Agentic)
- Users ask questions in plain English via a search/chat interface
- Examples:
  - "Show me properties in 85234 under $250K with flip potential"
  - "Find out-of-state owners in 49835 with properties listed over 90 days"
  - "Compare rental yields between 85234 and 85233"
  - "What's happening in the Phoenix rental market this month?"
- **Powered by LangGraph.js** running in Lambda — the agent decides which RentCast endpoints to query, how to filter, and how to synthesize results
- Async execution: mutation → EventBridge → Lambda → subscription update

### 3.5 Dashboard
- At-a-glance view of all monitored zip codes
- Active listing count, price movement indicators, deal pipeline (scored properties)
- Recent reports, recent NL query results
- Market health indicators per zip code (inventory trend, DOM trend, price momentum)

### 3.6 Comparative Market Analysis (Premium Feature)
*(Consolidation of premium comparison report — referenced in 3.3 and here)*
- Select 2-4 zip codes for side-by-side comparison
- Data: median price, inventory, DOM, rent yields, appreciation rate, price/sqft, listing volume
- AI produces strategic recommendation tailored to user's investment strategy
- Generates a shareable/downloadable report
- Charged as a premium report ($3-5 per comparison)
- Uses cached market stats where available; only fetches uncached zips from RentCast

---

## 4. Architecture

### 4.1 High-Level Stack

```
┌─────────────────────────────────────────────────────────┐
│                    Amplify Frontend                      │
│              React + Amplify UI Components               │
│         Dashboard · Reports · NL Query · Settings        │
└──────────────────────┬──────────────────────────────────┘
                       │ GraphQL (queries, mutations, subscriptions)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                 AppSync (GraphQL BFF)                    │
│          Resolvers → Lambda / DynamoDB direct            │
│          Subscriptions → real-time UI updates            │
│          Auth → Cognito                                  │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌─────────┐  ┌──────────┐  ┌──────────────┐
   │ DynamoDB │  │ Lambda   │  │ EventBridge  │
   │ (data)   │  │ (sync)   │  │ (async)      │
   └─────────┘  └──────────┘  └──────┬───────┘
                                     │
                              ┌──────┴───────┐
                              │   Lambda     │
                              │  (async)     │
                              │              │
                              │ • Data collect│
                              │ • Deal score  │
                              │ • Reports    │
                              │ • NL queries │
                              └──────┬───────┘
                                     │
                         ┌───────────┼───────────┐
                         ▼           ▼           ▼
                   ┌──────────┐ ┌─────────┐ ┌─────────┐
                   │ RentCast │ │ Bedrock │ │DynamoDB │
                   │   API    │ │ (Claude)│ │ (write) │
                   └──────────┘ └─────────┘ └─────────┘
```

### 4.2 Async Pattern (Uniform)

All non-trivial operations follow the same async pattern:

```
1. User action     → AppSync Mutation → DynamoDB (status: pending)
2. Event trigger   → EventBridge Rule → Lambda (async processor)
3. Processing      → Lambda calls RentCast / Bedrock / etc.
4. Completion      → DynamoDB (status: complete, result stored)
5. UI notification → AppSync Subscription → Frontend updates
```

This applies to: NL queries, report generation, deal scoring batches, data collection runs, comparative analyses.

### 4.3 AI Approach (Hybrid)

| Feature | AI Approach | Framework | Cost/invocation |
|---------|------------|-----------|-----------------|
| Deal scoring | Prompt chain | Bedrock SDK direct | ~$0.002 |
| Weekly market report | Prompt chain | Bedrock SDK direct | ~$0.006 |
| On-demand property report | Prompt chain | Bedrock SDK direct | ~$0.01 |
| Comparative analysis | Two-step prompt chain | Bedrock SDK direct | ~$0.009 |
| **NL queries** | **Agent with tools** | **LangGraph.js in Lambda** | **~$0.02-0.08** |

LangGraph.js is used ONLY for NL queries — the one feature that genuinely requires multi-step runtime decision-making. Everything else uses direct Bedrock SDK prompt chains for cost efficiency.

**LangGraph.js operates as a library inside Lambda** — no LangGraph Platform/LangSmith dependency. The npm package (`@langchain/langgraph`) is imported, the graph is defined in code, and it executes within the Lambda invocation.

### 4.4 Shared Zip Code Cache

The single most important architectural decision for profitability:

- RentCast data is cached in DynamoDB per zip code, NOT per user
- Multiple users monitoring the same zip code share one set of API calls
- Dependency-aware freshness: deal scores expire when their source listing data changes (via DynamoDB Streams), not on independent timers
- RentCast cost scales with `unique_monitored_zip_codes`, not `user_count`

### 4.4.1 RentCast API Call Budget (Per Unique Zip Code)

| Endpoint | Frequency | Calls/zip/month | Purpose |
|----------|-----------|-----------------|---------|
| `/v1/listings/sale` | Daily | 30 | Active listings refresh |
| `/v1/markets` | Weekly | 4 | Market stats + trends |
| `/v1/properties` (batch) | Daily (new listings only) | ~15 | Property details for newly appeared listings (~0.5 new/day avg) |
| `/v1/avm/value` | On new listing | ~15 | AVM + comps for deal scoring |
| **Subtotal per zip (scheduled)** | | **~64** | |
| On-demand reports | User-initiated | ~10-20 | Deep dives, CMA (shared cache reduces redundant calls) |
| **Total per zip** | | **~75-85** | |

**Tier capacity:**
- **Foundation (1K calls/mo)**: ~12 unique zip codes (realistic, not 5-10 as initially estimated)
- **Growth (5K calls/mo)**: ~60 unique zip codes
- **Scale (25K calls/mo)**: ~300 unique zip codes
- Upgrade tier when `unique_zips × 85 > tier_limit × 0.8` (80% threshold)

### 4.4.2 NL Query Agent Cost Constraints

The NL query agent (LangGraph.js) can trigger live RentCast API calls, creating unbounded cost risk if unconstrained. Mitigations:

1. **Cache-first policy**: Agent tools query DynamoDB cache before hitting RentCast. Live API calls only when cached data is stale or absent.
2. **Per-query call budget**: Each NL query execution is limited to **max 3 RentCast API calls**. If the agent needs more, it returns partial results with a "refine your query" prompt.
3. **Per-user monthly NL budget**: Free tier: 5 queries/month. Pro tier: 50 queries/month (not unlimited — revised from initial design). Premium queries beyond budget cost $0.25 each via Stripe metered billing.
4. **Agent tool guardrails**: RentCast tools in the LangGraph.js graph are wrapped with a call counter that raises a `BudgetExceeded` error if the per-query limit is hit.

Estimated NL query cost with constraints: ~$0.02-0.05/query (3 API calls max + 3-4 LLM calls).

### 4.5 Data Model (Key Tables)

**TTL strategy:** Deal scores do NOT have an independent TTL. They are invalidated via DynamoDB Streams when their source listing record changes. This prevents serving stale scores for updated listings.

| Table | Purpose | Key | TTL/Expiry |
|-------|---------|-----|------------|
| Users | Profiles, Stripe customerId, Cognito sub | userId (PK) | — |
| Subscriptions | Stripe subscription state, tier, limits | userId (PK) | — |
| ZipMonitors | Which zips each user monitors + alert prefs | userId (PK), zipCode (SK) | — |
| ZipCache | Shared RentCast data per zip code | zipCode (PK), dataType (SK) | 24h (listings) / 7d (market) |
| Properties | Cached property records + owner info | propertyId (PK), zipCode (GSI) | 7d |
| Listings | Active sale/rental listings | listingId (PK), zipCode (GSI) | 24h |
| DealScores | AI-computed scores per listing | listingId (PK), scoreType (SK) | Invalidated on listing change (DDB Streams) |
| Reports | Generated reports (periodic + on-demand) | reportId (PK), userId+type (GSI) | 90d |
| Alerts | Generated deal alerts + delivery state | alertId (PK), userId+zipCode (GSI) | 30d |
| NLQueries | NL query history + results | queryId (PK), userId (GSI) | 30d |
| ApiUsage | RentCast call tracking for cost control | date (PK), endpoint (SK) | 90d |
| MarketSnapshots | Historical market stats for trend analysis | zipCode (PK), date (SK) | 365d |

### 4.6 Infrastructure (CDK)

All backend infrastructure managed by AWS CDK:
- **Lambda functions**: data collectors, deal scorers, report generators, NL query agent
- **DynamoDB tables**: as described above, with GSIs for access patterns
- **EventBridge**: scheduled rules (data collection, report generation) + event-driven rules (new listing → score, query submitted → agent)
- **SQS**: dead letter queues for failed async operations
- **AppSync**: GraphQL API with Cognito auth, Lambda resolvers, DynamoDB direct resolvers, subscriptions
- **Cognito**: user pools with email/password + social sign-in (Google, Apple)
- **Bedrock**: Claude model access for prompt chains and LangGraph agent
- **Secrets Manager**: RentCast API key, Stripe keys

---

## 5. Monetization

### 5.1 Subscription Tiers (Stripe)

| Tier | Price | Zip Codes | Reports | NL Queries | Deal Scoring |
|------|-------|-----------|---------|------------|--------------|
| **Free** | $0/mo | 1 | Weekly digest only | 5/month | Basic (top 3) |
| **Pro** | $29-49/mo | 5 | Weekly + on-demand | 50/month | Full scoring |

*Enterprise tier (unlimited zips, white-label, API access) is deferred to post-launch — see Section 8.*

NL queries beyond tier limits are available at $0.25 each via Stripe metered billing.

### 5.2 Premium Reports (Pay-per-use)

- Comparative Market Analysis (2-4 zips): $3-5 per report
- Deep-dive property analysis: $1-2 per report
- Charged via Stripe metered usage billing

### 5.3 Unit Economics (Target)

*Assumptions: Pro user monitors 5 zip codes. ~20 active listings per zip. Deal scoring batches all 3 scores (wholesale, flip, rental) into one Bedrock call per listing (~2.5K input tokens, ~500 output). Scoring runs only for NEW listings (not every listing daily).*

| Cost Component | Per User/Month (Pro tier) | Calculation |
|---------------|--------------------------|-------------|
| RentCast API | ~$1.50-3.00 | 5 zips × ~75 calls shared across users; per-user attribution depends on zip overlap |
| Bedrock (deal scoring) | ~$2.00-4.00 | ~5 new listings/zip/week × 5 zips × 4 weeks = 100 scores @ ~$0.003 each |
| Bedrock (reports) | ~$0.50-1.00 | 5 weekly digests + ~2 on-demand @ $0.006-0.01 each |
| Bedrock (NL queries) | ~$1.00-2.50 | ~20 queries/month × $0.05 avg (agent) |
| Infrastructure (Lambda, DDB) | ~$0.10-0.30 | Low at moderate scale |
| **Total cost/user** | **~$5.10-10.80** | |
| **Subscription revenue** | **$29-49** | |
| **Gross margin** | **~70-83%** | Healthy SaaS margins at scale |

*Note: Gross margin improves with user density per zip code. At 10+ users per zip, RentCast cost per user drops to ~$0.15-0.30 (shared cache effect). Early-stage margins will be lower due to low zip code overlap.*

---

## 6. Sub-Project Decomposition

Build in sequence — each sub-project produces working, deployable software.

### Sub-Project 1: Data Foundation
- CDK stack: DynamoDB tables, Lambda functions, EventBridge scheduler, SQS
- RentCast client service with rate limiting, retry, cost tracking per endpoint
- Shared cache layer: zip code data cached with TTL-based freshness
- Scheduled data collection: listings, market stats, property details per monitored zip
- API usage tracking table for cost control
- **Deliverable**: Backend that collects and caches RentCast data on schedule. No UI.

### Sub-Project 2: AI Analysis Engine
- Deal scoring engine: wholesale, flip, rental yield scores per property
- Periodic market report generation (weekly digest per zip code)
- On-demand reports: single property deep-dive, single zip market report
- Comparative Market Analysis: 2-4 zip code comparison (premium report)
- Prompt templates with token budgets and result caching
- **Deliverable**: Backend generates AI reports from cached data. Reports in DynamoDB.

### Sub-Project 3: GraphQL API + Auth
- AppSync schema: queries, mutations, subscriptions for all data types
- Cognito user pools with social sign-in
- User tiers: free (1 zip, basic) → pro (5 zips, full) → enterprise
- Authorization: per-user zip code limits, report access, feature gating
- NL query endpoint: mutation → EventBridge → LangGraph.js Lambda → subscription
- **Deliverable**: Authenticated GraphQL API serving user-specific data and reports.

### Sub-Project 4: Frontend Dashboard
- Amplify React frontend with Amplify UI components
- Dashboard: monitored zip overview, deal pipeline, market indicators
- Report viewer: periodic + on-demand + comparative analysis
- NL query interface (search bar + conversational results)
- Zip code setup wizard, monitoring preferences
- Property detail view: comps, AVM, owner info, AI analysis
- **Deliverable**: Full user-facing application.

### Sub-Project 5: Billing + Launch
- Stripe Checkout + Customer Portal for subscription management
- Premium report billing (Stripe metered usage for NL query overages + premium reports)
- Stripe webhook processing: subscription lifecycle (created, updated, cancelled, payment_failed)
- Downgrade handling: when user drops from Pro to Free, auto-pause excess zip monitors (keep most recent, pause others)
- Grace period logic for failed payments (7-day grace before feature restriction)
- Usage dashboard: API calls consumed, reports generated, NL queries used, quota remaining
- Tier enforcement: zip code limits, NL query limits, feature gating tied to Stripe subscription status
- Landing page + marketing site
- **Deliverable**: Revenue-generating, launch-ready SaaS.

---

## 7. Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Amplify (React) | Managed hosting, GraphQL integration, Cognito auth built-in |
| BFF layer | AppSync (GraphQL) | Subscriptions for real-time updates, fine-grained auth, direct DynamoDB resolvers |
| Backend IaC | AWS CDK | Full infrastructure control, TypeScript-native, your standard stack |
| Database | DynamoDB | Serverless scaling, TTL for cache expiry, event streams for change detection |
| Async pattern | EventBridge → Lambda | Uniform for all async ops: queries, reports, scoring, data collection |
| AI (structured tasks) | Bedrock SDK direct | Prompt chains for predictable inputs/outputs. Cheaper, simpler. |
| AI (NL queries) | LangGraph.js in Lambda | Agent framework only where multi-step runtime decisions are needed |
| AI model | Claude Haiku (Bedrock) | Best cost/quality for high-volume analysis. Upgrade to Sonnet for premium reports. |
| Data source | RentCast API | 140M+ properties, sales/rental/AVM/comps/market data. Foundation tier to start. |
| Zip code caching | Shared per zip, not per user | Critical for profitability — RentCast cost scales with unique zips, not users |
| Auth | Cognito | Social sign-in, managed user pools, native AppSync integration |
| Payments | Stripe | Subscriptions + metered usage for premium reports |

---

## 8. Out of Scope (Future Considerations)

- Enterprise tier (unlimited zips, white-label reports, public API access, custom pricing) — requires tenant isolation, API key management, and branding customization
- Mobile app (React Native) — potential future sub-project
- MLS direct integration (requires agent/broker partnership)
- Property photo analysis (visual AI for condition assessment)
- Automated offer generation / contract drafting
- Multi-user team accounts with shared monitors
- White-label API for third-party integration
- Durable Lambda workflows for long-running async operations (evaluate if EventBridge+Lambda proves insufficient)
