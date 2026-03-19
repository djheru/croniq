#!/usr/bin/env node
/**
 * Sync jobs between local dev and Pi
 *
 * Usage:
 *   npx tsx scripts/sync.ts pull        # Export from Pi, save to scripts/backup.json
 *   npx tsx scripts/sync.ts push        # Import scripts/backup.json to Pi
 *   npx tsx scripts/sync.ts local-to-pi # Export from local, import to Pi (one step)
 *   npx tsx scripts/sync.ts pi-to-local # Export from Pi, import to local (one step)
 *
 * Environment variables:
 *   CRONIQ_URL        - Override default URL (default: http://localhost:3001/api)
 *   CRONIQ_PI_URL     - Pi URL (default: http://192.168.1.50:3001/api)
 *   BACKUP_FILE       - Backup file path (default: scripts/backup.json)
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const LOCAL_URL = process.env.CRONIQ_URL ?? "http://localhost:3001/api";
const PI_URL = process.env.CRONIQ_PI_URL ?? "http://192.168.1.50:3001/api";
const BACKUP_FILE = process.env.BACKUP_FILE ?? "scripts/backup.json";

const command = process.argv[2];

function run(cmd: string, env: Record<string, string> = {}) {
  console.log(`$ ${cmd}\n`);
  execSync(cmd, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

async function main() {
  switch (command) {
    case "pull":
      console.log("📥 Exporting jobs from Pi...\n");
      run(`npx tsx scripts/export.ts ${BACKUP_FILE}`, { CRONIQ_URL: PI_URL });
      console.log(`\n✓ Jobs exported to ${BACKUP_FILE}`);
      console.log(`\nTo import to local: npx tsx scripts/sync.ts push-local`);
      break;

    case "push":
      console.log("📤 Importing backup to Pi...\n");
      if (!fs.existsSync(BACKUP_FILE)) {
        console.error(`✗ Backup file not found: ${BACKUP_FILE}`);
        console.log(`Run 'npx tsx scripts/sync.ts pull' first`);
        process.exit(1);
      }
      run(`npx tsx scripts/seed.ts ${BACKUP_FILE}`, { CRONIQ_URL: PI_URL });
      console.log(`\n✓ Jobs imported to Pi`);
      break;

    case "push-local":
      console.log("📤 Importing backup to local...\n");
      if (!fs.existsSync(BACKUP_FILE)) {
        console.error(`✗ Backup file not found: ${BACKUP_FILE}`);
        process.exit(1);
      }
      run(`npx tsx scripts/seed.ts ${BACKUP_FILE}`, { CRONIQ_URL: LOCAL_URL });
      console.log(`\n✓ Jobs imported to local`);
      break;

    case "local-to-pi":
      console.log("🔄 Syncing local → Pi...\n");
      console.log("Step 1: Export from local\n");
      run(`npx tsx scripts/export.ts ${BACKUP_FILE}`, {
        CRONIQ_URL: LOCAL_URL,
      });
      console.log("\nStep 2: Import to Pi\n");
      run(`npx tsx scripts/seed.ts ${BACKUP_FILE}`, { CRONIQ_URL: PI_URL });
      console.log(`\n✓ Sync complete: local → Pi`);
      break;

    case "pi-to-local":
      console.log("🔄 Syncing Pi → local...\n");
      console.log("Step 1: Export from Pi\n");
      run(`npx tsx scripts/export.ts ${BACKUP_FILE}`, { CRONIQ_URL: PI_URL });
      console.log("\nStep 2: Import to local\n");
      run(`npx tsx scripts/seed.ts ${BACKUP_FILE}`, {
        CRONIQ_URL: LOCAL_URL,
      });
      console.log(`\n✓ Sync complete: Pi → local`);
      break;

    default:
      console.log(`Croniq Job Sync Tool

Usage:
  npx tsx scripts/sync.ts pull          Export from Pi → ${BACKUP_FILE}
  npx tsx scripts/sync.ts push          Import ${BACKUP_FILE} → Pi
  npx tsx scripts/sync.ts push-local    Import ${BACKUP_FILE} → local
  npx tsx scripts/sync.ts local-to-pi   Export from local, import to Pi (one step)
  npx tsx scripts/sync.ts pi-to-local   Export from Pi, import to local (one step)

Environment:
  CRONIQ_URL=${LOCAL_URL}
  CRONIQ_PI_URL=${PI_URL}
  BACKUP_FILE=${BACKUP_FILE}
`);
      if (command) {
        console.error(`\n✗ Unknown command: ${command}`);
        process.exit(1);
      }
      break;
  }
}

main().catch((err) => {
  console.error("\n✗ Sync failed:", err);
  process.exit(1);
});
