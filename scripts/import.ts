#!/usr/bin/env node
/**
 * Import the most recent backup file from backups/
 *
 * Usage:
 *   npm run db:import
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const backupsDir = path.resolve("backups");

// Find all .json files in backups/
const files = fs.readdirSync(backupsDir)
  .filter(f => f.endsWith(".json"))
  .map(f => ({
    name: f,
    path: path.join(backupsDir, f),
    mtime: fs.statSync(path.join(backupsDir, f)).mtime.getTime()
  }))
  .sort((a, b) => b.mtime - a.mtime); // Sort by most recent first

if (files.length === 0) {
  console.error("✗ No backup files found in backups/");
  process.exit(1);
}

const latest = files[0];
console.log(`📥 Importing most recent backup: ${latest.name}\n`);

// Run the seed script with the latest backup
try {
  execSync(`npx tsx scripts/seed.ts ${latest.path}`, { stdio: "inherit" });
} catch (err) {
  console.error("\n✗ Import failed");
  process.exit(1);
}
