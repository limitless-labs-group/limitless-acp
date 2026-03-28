#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import { ensureMarketApproved } from "../limitless/approve.js";
import { logger } from "../logger.js";

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: npx tsx src/scripts/approve.ts <market-slug>");
  process.exit(1);
}

logger.info({ slug }, "Approving market venue...");

ensureMarketApproved(slug)
  .then(() => {
    logger.info({ slug }, "Market venue approved successfully");
    process.exit(0);
  })
  .catch((err) => {
    logger.fatal({ slug, err }, "Failed to approve market venue");
    process.exit(1);
  });
