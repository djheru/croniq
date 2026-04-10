# Real Estate Intelligence SaaS — Product Design Spec

**Date:** 2026-04-09
**Scope:** High-level product design for a RentCast-powered real estate analytics SaaS
**Status:** Product concept — individual sub-projects will have their own detailed specs

---

## Product Vision

A SaaS platform that transforms raw real estate data from RentCast into actionable investment intelligence. Users set up zip code monitors, and the platform collects property data, listings, market statistics, and comparables — then AI analyzes it all to surface deals, score opportunities, and generate market reports.

**Core differentiator:** AI-driven analysis that automates the work investors do manually — ARV calculations, deal scoring, motivated seller identification, cash flow projections — while providing natural language querying for ad-hoc exploration.

---

## Target Users (Priority Order)

### 1. Wholesalers (Primary)
Find below-market deals and identify motivated sellers. Key signals: out-of-state owners, long days-on-market, tax delinquency indicators, below-comp pricing. Need fast identification of assignment-worthy properties.

### 2. Fix-and-Flip Investors
ARV (after-repair value) calculations, comparable sales analysis, price-per-sqft vs. neighborhood averages, rehab margin estimates. Core question: "Is this flip profitable and by how much?"

### 3. Buy-and-Hold Rental Investors
Rent estimates, cap rate analysis, cash flow projections, tenant demand indicators, appreciation trends. Core question: "Will this property cash flow?"

### 4. Real Estate Agents/Brokers
Market reports for clients, neighborhood analyses, listing intelligence. Need professional-grade reports they can share with buyers and sellers. CMA (Comparative Market Analysis) generation.

---

## Core Feature Set

### Zip Code Monitoring
Users configure monitored zip codes with optional filters (property type, price range, bedrooms). The platform polls RentCast on a scheduled cadence for new listings, price changes, and market statistics.

**Critical architectural decision:** Data is cached per zip code, not per user. When multiple users monitor the same zip code, the system makes ONE set of RentCast API calls and serves all users from the shared cache. RentCast cost scales with unique monitored zip codes, not user count.

### AI Deal Scoring
Every new listing in a monitored zip code receives an AI-generated investment score across three dimensions:
- **Wholesale score:** Below-market potential, motivated seller signals, assignment viability
- **Flip score:** ARV vs. purchase price, rehab margin, comparable flip exits
- **Rental score:** Rent estimate vs. purchase price, cap rate, cash-on-cash return

Scoring uses prompt chains (not agents) — input data is fully known at scoring time.

### Market Intelligence Reports

**Periodic reports (weekly):** Automated digest per monitored zip code covering:
- New listings and price changes since last report
- Market trend shifts (median price, inventory, DOM)
- Top-scored opportunities by investment strategy
- Suggestions for next cycle (developing trends to watch)

**On-demand reports:** User-initiated deep-dive analysis of:
- Single property (comps, AVM, owner info, investment analysis)
- Single zip code (comprehensive market snapshot)
- Comparative analysis: 2-4 zip codes side-by-side with AI-generated strategic recommendation (premium report)

### Natural Language Queries
Users ask questions in plain English:
- "Find properties in 85234 under $250K with flip potential where the owner is out of state"
- "What's the average cap rate for 3-bedroom rentals in 49835?"
- "Compare investment potential between 85234 and 85233"

This is the ONE feature that uses an agentic framework (LangGraph.js). The agent:
1. Parses user intent
2. Decides which RentCast endpoints / cached data to query
3. Fetches and filters data (multiple steps, adaptive)
4. Scores/analyzes results
5. Synthesizes a response

### Alerts (Pro tier)
Email notifications triggered by deal scoring and market changes:
- **New high-score deal:** When a newly listed property scores above a user-configured threshold for wholesale, flip, or rental potential
- **Price drop alert:** When a listing in a monitored zip code reduces its price
- **Market shift alert:** Weekly if median price or inventory changes significantly (configurable threshold)
- Alerts are generated as a side-effect of the scheduled data collection pipeline — no additional RentCast API cost

### Dashboard
Always-on view of monitored zip codes showing:
- Active listing count and recent changes
- Market health indicators (price trends, inventory levels)
- Deal pipeline: highest-scored opportunities
- Recent reports and their key findings

---

## Business Model

### Freemium + Subscription (Stripe)

| Tier | Price | Zip Codes | Reports | NL Queries | Features |
|------|-------|-----------|---------|------------|----------|
| **Free** | $0 | 1 | Weekly digest only | 5/month | Basic deal scores, no deep-dives |
| **Pro** | $29-49/mo | 5 | Weekly + on-demand | Unlimited | Full deal scoring, alerts, export |
| **Enterprise** | Custom | Unlimited | All types | Unlimited | API access, team accounts, white-label |

### Premium Reports (Pay-per-report)
- Single property deep-dive: $5 (comparable services charge $5-15)
- Comparative Market Analysis (2-4 zips): $8-10
- Charged via Stripe metered billing on top of subscription
- Annual billing option: 20% discount on Pro tier ($375/year vs. $468)

### Unit Economics
- RentCast cost per monitored zip: ~$5-8/month (Foundation tier, amortized)
- Bedrock cost per Pro user: ~$0.30-0.50/month (prompt chains are cheap)
- Target margin: 47-53% at 5 Pro subscribers, improving to 70%+ at 15+ subscribers (shared cache amortizes RentCast cost across users on the same zip codes)
- Break-even: ~3 Pro subscribers covers Foundation RentCast tier ($74/mo)

### Free Tier Cost Controls
Free users generate RentCast API cost with zero revenue. Mitigation strategies:
- **Curated zip code pool:** Free tier is limited to a pre-populated set of ~10 high-demand zip codes (popular metros). These are already being polled for Pro users, so incremental cost is near zero.
- **No custom zip codes on free tier:** Users must upgrade to Pro to monitor a zip code outside the curated set. This caps free tier API cost at the cost of the curated set (~$50-60/month), regardless of free user count.
- **Conversion funnel:** Free tier exists to demonstrate value and drive upgrades. Target: 5-10% free-to-Pro conversion rate.

### RentCast Tier Scaling
The API call budget must scale with unique monitored zip codes, not user count. Worst-case modeling:

| Scenario | Unique Zips | Est. Calls/mo | RentCast Tier Needed | Revenue |
|----------|-------------|---------------|----------------------|---------|
| 5 Pro users, high overlap | 8 | ~1,400 | Foundation ($74) | $195-245 |
| 5 Pro users, low overlap | 20 | ~3,480 | Growth ($199) | $195-245 |
| 20 Pro users, moderate overlap | 35 | ~6,090 | Scale ($449) | $780-980 |

At low overlap (worst case), 5 Pro users could push past Foundation. The system must track unique zip counts and alert when approaching tier limits. Pricing should be validated: if low-overlap is common, Pro price should be $49 (not $29) to ensure positive margin even at Growth tier.

---

## Architecture Overview

### Tech Stack
- **Frontend:** AWS Amplify (React), hosted on Amplify
- **BFF:** AWS AppSync (GraphQL) — managed by Amplify
- **Backend:** AWS CDK — Lambda, DynamoDB, EventBridge, SQS
- **AI — Prompt Chains:** AWS Bedrock (Claude Haiku) via AWS SDK — deal scoring, reports
- **AI — NL Queries:** LangGraph.js running in Lambda — agentic tool-use for natural language
- **Auth:** Amplify-managed (Cognito)
- **Billing:** Stripe (subscriptions + metered usage)
- **Data Source:** RentCast API

### Async Data Flow Pattern

All non-trivial operations follow the same async pattern:

```
User Action → AppSync Mutation → DynamoDB (status: pending)
                                      ↓
                                EventBridge Rule
                                      ↓
                              Lambda (async work)
                                      ↓
                          DynamoDB (status: complete, result stored)
                                      ↓
                          AppSync Subscription → UI updates in real-time
```

This pattern is used uniformly for: NL queries, report generation, deal scoring, data collection. The user sees immediate feedback ("processing...") and receives results via GraphQL subscription when the work completes. No HTTP timeout pressure on any operation.

### AI Strategy: Hybrid Approach

| Feature | Approach | Framework | Why |
|---------|----------|-----------|-----|
| Deal scoring | Prompt chain | Bedrock SDK direct | Input/output fully predictable, structured |
| Weekly reports | Prompt chain | Bedrock SDK direct | Data pre-aggregated, templated output |
| On-demand reports | Prompt chain (2-step) | Bedrock SDK direct | Data fetchable upfront, predictable |
| Zip comparison | Prompt chain (2-step) | Bedrock SDK direct | Aggregate then analyze, no adaptive decisions |
| **NL queries** | **Agent with tools** | **LangGraph.js** | Must parse intent, decide what to fetch, adapt |
| Deep-dive (premium) | Prompt chain or agent | Configurable | Base case predictable; agent adds enrichment |

**Cost projection at 100 users:** ~$32/month Bedrock (hybrid) vs. ~$72/month if everything were agentic. The hybrid approach saves ~55% on AI costs.

LangGraph.js runs as a library inside Lambda — no LangGraph Platform or LangSmith Cloud dependency. The `@langchain/langgraph` package is MIT-licensed and model-agnostic (uses `@langchain/aws` for Bedrock).

### RentCast API Budget Model

The system tracks API usage per zip code and enforces call budgets per RentCast tier. Start on Foundation ($74/mo, 1K calls), upgrade tiers as revenue grows.

| Endpoint | Calls per zip/day | 5 zips x 30 days | Notes |
|----------|-------------------|-------------------|-------|
| Listings (sale) | 1 | 150 | Daily poll for new/changed listings |
| Market stats | 0.14 (weekly) | 20 | Weekly market snapshot |
| Property details | ~2 (new listings) | 300 | Fetch details for newly-seen listings |
| AVM / comps | On-demand | ~200 | User-triggered or premium reports |
| NL query calls | On-demand | ~200 | Agent-initiated during NL queries |
| **Total** | | **~870** | Fits Foundation (1K) with buffer |

**Shared cache architecture:** DynamoDB stores RentCast responses with TTL-based freshness. When a user requests data for a zip code that's already cached and fresh, no RentCast call is made. Multiple users on the same zip code share one cache entry.

---

## RentCast API Endpoints Used

### Property Records
`GET /v1/properties` — Structural attributes, tax history, owner info, sale history.
Filter by: zipCode, propertyType, bedrooms, bathrooms, squareFootage, yearBuilt.
Returns: 140M+ property records with dozens of data points.

### Sale Listings
`GET /v1/listings/sale` — Active for-sale listings.
Filter by: zipCode, propertyType, bedrooms, bathrooms, squareFootage, price, status.
Returns: listing price, DOM, property details, listing date.

### Rental Listings
`GET /v1/listings/rental/long-term` — Active rental listings.
Filter by: zipCode, propertyType, bedrooms, bathrooms.
Returns: rent price, property details.

### Value Estimates (AVM)
`GET /v1/avm/value` — Automated Valuation Model.
Input: address or lat/lon + property attributes.
Returns: price estimate, confidence range (low/high), comparable properties with correlation scores.

### Rent Estimates
`GET /v1/avm/rent/long-term` — Rental value estimate.
Input: address or lat/lon + property attributes.
Returns: rent estimate, confidence range, rental comparables.

### Market Statistics
`GET /v1/markets` — Zip-code-level market data.
Filter by: zipCode, dataType (Sale/Rental/All), historyRange (months).
Returns: price trends, rent trends, inventory, market averages.

---

## Data Model (Conceptual)

### Core Entities

**User** — Cognito-managed.
Subscription tier (free/pro/enterprise), investment strategy preference (wholesale/flip/rental), Stripe customer ID.

**ZipMonitor** — User's monitored zip code configuration.
userId, zipCode, filters (propertyType, priceRange, bedrooms), status (active/paused), report cadence preference.

**ZipCache** — Shared per-zip data cache (NOT per-user).
zipCode (partition key), dataType + timestamp (sort key): listings, market, properties. Data payload (JSON), TTL for cache invalidation, lastFetchedAt.

**Property** — Individual property records.
address (partition key), RentCast property data snapshot, owner info, tax history, sale history, last updated timestamp.

**DealScore** — AI-generated investment scores per property.
propertyId, zipCode, wholesale score + reasoning, flip score + ARV estimate + reasoning, rental score + cap rate + reasoning, scored at timestamp.

**Report** — Generated analysis reports.
reportId, userId, type (weekly/on-demand/comparison), input parameters (zip codes, property address, etc.), status (pending/generating/complete/failed), analysis content (markdown), token usage and cost, createdAt.

**NLQuery** — Natural language query history.
queryId, userId, input text, parsed intent, agent trace (tool calls made), result content, token usage and cost.

**ApiUsage** — RentCast API call tracking.
Date + endpoint (partition key), zipCode, callCount, responseSize. Used for budget enforcement and billing.

---

## Sub-Project Decomposition

This product is built in 5 sequential sub-projects. Each produces working, deployable software and has its own detailed spec.

### Sub-Project 1: Data Foundation
CDK backend infrastructure + RentCast data pipeline + shared caching layer.
- CDK stack: DynamoDB tables, Lambda functions, EventBridge scheduler, SQS queues
- RentCast client service with rate limiting, retry, and cost tracking
- Shared zip code cache with TTL-based freshness
- Scheduled data collection: listings, market stats, property details
- Data model: ZipCache, Property, ApiUsage tables
- **Deliverable:** Backend that collects and caches RentCast data on schedule. No UI.

### Sub-Project 2a: AI Analysis Engine (Prompt Chains)
Bedrock-powered deal scoring, market reports, and comparison analysis using prompt chains.
- Deal scoring engine: wholesale, flip, and rental scores per property
- Periodic market report generation (weekly digest per zip code)
- On-demand deep-dive reports (single property, single zip)
- Comparative Market Analysis — 2-4 zip code comparison (premium)
- Cost optimization: prompt templating, token budgets, result caching
- **Deliverable:** Backend generates AI reports and scores from cached data.

### Sub-Project 2b: NL Query Agent (LangGraph.js)
Natural language query system using LangGraph.js agent with tool-use.
- LangGraph.js agent definition with tools: RentCast query, cache lookup, deal scorer
- Intent parsing, adaptive data fetching, multi-step reasoning
- Lambda deployment with appropriate timeout (5 min) and memory allocation
- Guardrails: max tool calls per query, cost budget per query, input validation
- Note: LangGraph.js cold starts in Lambda add ~2-3s. Provisioned concurrency may be needed for Pro tier if query volume justifies it.
- **Deliverable:** Users can ask questions in plain English and get AI-analyzed results.

### Sub-Project 3: GraphQL API + Auth
Amplify AppSync BFF layer + Cognito auth + user management.
- AppSync GraphQL schema: queries, mutations, subscriptions
- Cognito user pools (social sign-in: Google, Apple)
- User tiers: free (1 zip) → pro (5 zips) → enterprise
- Authorization: per-user zip code limits, report access control
- EventBridge integration for async mutations
- Subscription resolvers for real-time UI updates
- **Deliverable:** Authenticated API that serves user-specific data and reports.

### Sub-Project 4: Frontend Dashboard
Amplify React frontend — dashboard, reports, NL query interface.
- Dashboard: monitored zip codes overview, deal pipeline, market indicators
- Report viewer: periodic + on-demand + comparative analysis
- Natural language search bar with streaming results
- Zip code setup wizard + monitoring preferences
- Property detail view: comps, AVM, owner info, AI analysis
- **Deliverable:** Full user-facing application. Functional product.

### Sub-Project 5: Billing + Launch
Stripe integration, premium reports, usage tracking, marketing.
- Stripe Checkout + Customer Portal for subscriptions
- Premium report billing (per-report via Stripe metered usage)
- Usage dashboard: API calls consumed, reports generated, quota remaining
- Landing page + marketing site
- Tier enforcement: free/pro/enterprise feature gating
- **Deliverable:** Revenue-generating SaaS. Launch-ready.

---

## Cost Projections

### Infrastructure (100 users, 5 Pro subscribers)

| Cost Center | Monthly | Notes |
|-------------|---------|-------|
| RentCast API | $74 | Foundation tier (1K calls) |
| AWS Bedrock | $32 | Hybrid AI approach |
| DynamoDB | $5-10 | On-demand capacity |
| Lambda | $2-5 | Included in free tier initially |
| AppSync | $4-8 | Per-request pricing |
| Amplify hosting | $0-5 | Free tier covers small apps |
| **Total infra** | **~$120-135/mo** | |

### Revenue (5 Pro subscribers)

| Revenue | Monthly |
|---------|---------|
| 5 x $39/mo subscriptions | $195 |
| ~20 premium reports x $3 | $60 |
| **Total revenue** | **~$255/mo** |
| **Margin** | **~47-53%** |

Margin improves with scale: RentCast's shared cache means incremental users on existing zip codes cost nearly zero. At 20 Pro subscribers (~$780 revenue), margin exceeds 80%.

---

## Security and Data Handling

### PII Handling
RentCast data includes PII: property owner names, mailing addresses, tax records. The platform must:
- Encrypt all data at rest (DynamoDB encryption enabled by default)
- Encrypt in transit (HTTPS for all API calls, TLS for DynamoDB connections)
- Restrict owner PII access to authenticated Pro/Enterprise users only (free tier sees property data but not owner details)
- Never cache RentCast owner data longer than 30 days (TTL enforcement)
- Log access to PII fields for audit trail

### Data Retention
- **ZipCache (listings, market stats):** 24-hour TTL for active data, 90-day retention for historical snapshots
- **DealScores:** Retained for 90 days, then archived or deleted
- **Reports:** Retained indefinitely (user-generated content, low storage cost)
- **NLQuery history:** Retained for 30 days, then deleted (contains user intent data)
- **ApiUsage logs:** Retained for 12 months (billing and cost analysis)

### Degradation Strategy
- **RentCast down:** Serve stale cache (mark as "last updated X hours ago" in UI). Queue missed poll cycles for retry via SQS DLQ. Notify users if stale > 24 hours.
- **RentCast budget exhausted:** Pause scheduled polls, disable on-demand reports that require new API calls. NL queries work against cached data only. Alert admin via SNS.
- **Bedrock throttled:** Queue analysis requests in SQS with exponential backoff. User sees "report generating..." status until backlog clears.

### Auth During Sub-Projects 1-2
Sub-Projects 1-2 are backend-only with no public-facing endpoints. Lambda functions are invoked by EventBridge (internal) and SQS (internal). DynamoDB tables are not exposed via any API until Sub-Project 3 adds AppSync. IAM policies restrict access to same-account principals only. No auth risk during this phase.

---

## Out of Scope (for initial product)

- Mobile app (responsive web first)
- Real-time MLS integration (RentCast data has inherent latency)
- Property management features (rent collection, tenant screening)
- Multi-market portfolio tracking across dozens of zip codes
- Automated offer generation or contract templates
- Integration with CRMs (Follow Up Boss, Podio, etc.)
- SMS/push notification alerts (email-only initially)

---

## Open Questions for Future Sub-Project Specs

1. **Product name** — needs branding before launch (Sub-Project 5)
2. **Amplify Gen 1 vs Gen 2** — user to specify during Sub-Project 1 technical design
3. **Email delivery for reports** — SES vs. third-party (Sub-Project 3)
4. **Landing page** — same Amplify app or separate static site? (Sub-Project 5)
5. **Detailed Stripe tier pricing** — finalize based on beta user feedback (Sub-Project 5)
