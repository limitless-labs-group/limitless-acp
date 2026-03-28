import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { OfferingConfig, OfferingHandlers } from "./acpTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFERINGS_ROOT = path.resolve(__dirname, "offerings");

export interface LoadedOffering {
  config: OfferingConfig;
  handlers: OfferingHandlers;
}

export async function loadOffering(name: string): Promise<LoadedOffering> {
  const offeringDir = path.resolve(OFFERINGS_ROOT, name);

  const configPath = path.join(offeringDir, "offering.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`offering.json not found: ${configPath}`);
  }
  const config: OfferingConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  );

  const handlersPath = path.join(offeringDir, "handlers.ts");
  if (!fs.existsSync(handlersPath)) {
    throw new Error(`handlers.ts not found: ${handlersPath}`);
  }

  const handlers = (await import(handlersPath)) as OfferingHandlers;

  if (typeof handlers.executeJob !== "function") {
    throw new Error(
      `handlers.ts in "${name}" must export an executeJob function`,
    );
  }

  return { config, handlers };
}

export function listOfferings(): string[] {
  if (!fs.existsSync(OFFERINGS_ROOT)) return [];
  return fs
    .readdirSync(OFFERINGS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
