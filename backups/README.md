# Croniq Job Backups

This directory contains versioned backups of Croniq job configurations.

## Workflow: Local Dev → Pi

### 1. Export Jobs on Local Workstation

```bash
# Export current jobs to a timestamped backup
npm run db:export backups/$(date +%Y-%m-%d)-production.json

# Commit to git
git add backups/
git commit -m "Backup: production jobs $(date +%Y-%m-%d)"
git push
```

### 2. Import Jobs on Pi

```bash
# SSH to Pi
ssh pi@192.168.1.50

# Pull latest code (includes backup file)
cd ~/croniq
git pull

# Import the backup
npm run db:seed backups/2026-03-18-production.json
```

## Quick Reference

### Export Current Jobs
```bash
npm run db:export backups/my-backup.json
```

### Import from Backup
```bash
npm run db:seed backups/my-backup.json
```

### Default Seed (from scripts/seed.ts)
```bash
npm run db:seed
```

## Best Practices

- **Always export before major changes** - create a timestamped backup first
- **Use descriptive names**: `YYYY-MM-DD-description.json`
- **Commit production states** to version control after significant changes
- **Test locally first** before deploying to Pi
