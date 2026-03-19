# Croniq Job Backups

This directory contains versioned backups of Croniq job configurations.

## Creating a Backup

```bash
# Export current jobs to a timestamped backup
npx tsx scripts/export.ts backups/$(date +%Y-%m-%d)-production.json

# Or use npm script
npm run db:export backups/my-backup.json
```

## Restoring from a Backup

```bash
# Restore to local
npx tsx scripts/seed.ts backups/2026-03-18-production.json

# Restore to Pi
CRONIQ_URL=http://192.168.1.50:3001 npx tsx scripts/seed.ts backups/2026-03-18-production.json
```

## Best Practices

- **Commit production backups** to version control after significant changes
- Use descriptive names: `YYYY-MM-DD-description.json`
- Keep `backup.json` as the working sync file (gitignored)
- Before major changes, create a timestamped backup first

## Sync Workflows

See `scripts/sync.ts` for convenience commands:

```bash
# Quick sync local → Pi
npm run sync:local-to-pi

# Quick sync Pi → local
npm run sync:pi-to-local
```
