# DynamoDB Migration Initiative

**Date:** 2026-03-11
**Status:** Planning

---

## Why Migrate?

Croniq currently stores everything in SQLite on the Pi's SD card. This works but has limitations:

- **Durability:** SD cards fail; a single hardware event loses all historical data
- **Capacity:** As jobs scale and runs accumulate, SQLite on a Pi 4 will eventually bottleneck
- **Access:** Data is only queryable from the Pi itself
- **Backup:** Manual, no built-in replication

The Pi already authenticates to AWS via IAM Roles Anywhere (X.509 certificates) for Bedrock. DynamoDB would give us durable, replicated storage with no additional auth infrastructure.

---

## Current Database Shape

### Tables

| Table | Records | Growth Rate | Key Access Patterns |
|-------|---------|-------------|-------------------|
| **jobs** | ~60 | Slow (manual creation) | List all (sorted), CRUD by ID, reorder |
| **runs** | Thousands+ | ~60 runs/hour at full load | List by job (newest first), stats aggregation, latest run |
| **analyses** | Hundreds | Periodic per-job | List by job (newest first), latest |

### Schema Summary

- `jobs`: 18 columns including JSON blobs (`collector_config`, `tags`), custom `sort_order`
- `runs`: 11 columns, FK to jobs with CASCADE delete, `result` JSON blob (can be large)
- `analyses`: 7 columns, FK to jobs with CASCADE delete, `run_ids` JSON array

---

## DynamoDB Table Design

### Proposed Single-Table Design

**Table: `croniq`**

| Entity | PK | SK | Notes |
|--------|----|----|-------|
| Job | `JOB#<id>` | `META` | All job attributes |
| Run | `JOB#<jobId>` | `RUN#<startedAt>#<id>` | Enables time-sorted queries per job |
| Analysis | `JOB#<jobId>` | `ANALYSIS#<createdAt>#<id>` | Enables time-sorted queries per job |
| JobOrder | `SYSTEM` | `JOB_ORDER` | Single item storing ordered job ID array |
| RunStats | `JOB#<jobId>` | `STATS` | Denormalized counters (total, success, failure, avg_duration) |

### GSI: `GSI1` (for listing all jobs)

| GSI1-PK | GSI1-SK | Use |
|---------|---------|-----|
| `ENTITY#JOB` | `<sort_order>#<created_at>` | List all jobs in display order |

---

## Migration Challenges & Solutions

### 1. Job Ordering (High Complexity)

**Problem:** `listJobs()` sorts by `sort_order ASC, created_at DESC`. DynamoDB can only sort by one key.

**Solution:** Store a `JOB_ORDER` item containing an ordered array of job IDs. Client fetches this first, then batch-gets job items. For ~60 jobs this is two DynamoDB calls — acceptable.

**Alternative:** Use GSI1 with a composite sort key like `<padded_sort_order>#<inverted_timestamp>`. More complex but avoids the two-call pattern.

### 2. Run Stats Aggregation (High Complexity)

**Problem:** `getRunStats()` computes COUNT, SUM, AVG in a single SQL query across all runs for a job.

**Solution:** Maintain a denormalized `STATS` item per job. Increment/update atomically when each run completes using `UpdateExpression` with `ADD` and `SET` operations. This is actually *faster* than the current SQL approach.

### 3. Reorder Transaction (Medium Complexity)

**Problem:** `reorderJobs()` updates `sort_order` on every job atomically. DynamoDB transactions max at 25 items.

**Solution:** With the `JOB_ORDER` array approach, reordering is a single `PutItem` on the order document. No transaction needed.

### 4. Cascading Deletes (Medium Complexity)

**Problem:** SQLite `ON DELETE CASCADE` automatically removes runs and analyses when a job is deleted.

**Solution:** Query all items with `PK = JOB#<id>`, then `BatchWriteItem` to delete them. Batch writes handle 25 items per call; paginate for jobs with many runs. Wrap in a function that the delete-job API calls.

### 5. Large Result Blobs (Medium Complexity)

**Problem:** DynamoDB has a 400KB item size limit. Some collector results (especially browser/HTML collectors returning full page content) could exceed this.

**Solution Options:**
- **A) S3 offload:** Store results in S3, keep only the S3 key in DynamoDB. Adds latency but handles any size.
- **B) Compress:** gzip the result JSON before storing. Most HTML/JSON compresses 5-10x.
- **C) Truncate:** Cap stored results at a reasonable size (e.g., 100KB). Collector results beyond that are likely more data than needed.

**Recommendation:** Start with B (compression), add A (S3 offload) if any results still exceed 400KB after compression.

### 6. Change Detection (Low Complexity)

**Problem:** Need to compare current run's hash with previous run's hash.

**Solution:** No change needed in logic. Query latest run for the job (SK begins_with `RUN#`, ScanIndexForward=false, Limit=1), compare hashes in application code. Same as current pattern but explicit query instead of implicit.

---

## Migration Strategy

### Phase 1: Dual-Write (1-2 days)

- Add DynamoDB client alongside SQLite
- Write to both stores on every mutation
- Read from SQLite (source of truth)
- Verify DynamoDB data matches via a comparison script

### Phase 2: Switch Reads (1 day)

- Read from DynamoDB, write to both
- Monitor for discrepancies
- SQLite becomes the fallback

### Phase 3: Remove SQLite (1 day)

- Stop writing to SQLite
- Remove better-sqlite3 dependency
- Keep the last SQLite backup file

### Data Migration Script

One-time script to backfill all existing jobs, runs, and analyses into DynamoDB. Should be idempotent (use `PutItem` with all attributes, not conditional writes).

---

## Cost Estimate

With ~60 jobs running on various schedules:

- **Writes:** ~100-200 runs/day + stats updates ≈ 200-400 WCU/day → well within free tier (25 WCU sustained)
- **Reads:** Dashboard polls every 30s, detail pages on demand ≈ minimal
- **Storage:** Runs accumulate; at ~2KB average per run, 1 year ≈ 50MB → $0.01/month
- **Total:** Effectively free under DynamoDB free tier for this workload

---

## Dependencies

- `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (document client)
- IAM Roles Anywhere already configured on Pi
- DynamoDB table created via CDK or CLI (single table, one GSI)

---

## Open Questions

1. **Retention policy:** Should runs be TTL'd after N days? DynamoDB supports native TTL.
2. **Backup strategy:** Enable DynamoDB point-in-time recovery (PITR)? It's $0.20/GB/month but gives 35-day restore window.
3. **Local development:** Use DynamoDB Local for dev, or just connect to the real table?
4. **Result storage:** Compression vs S3 offload — need to measure actual result sizes first.
