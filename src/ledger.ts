import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEDGER_PATH = path.resolve(__dirname, "..", "ledger.json");

export interface LedgerEntry {
  id: string;
  buyerAddress: string;
  acpJobId: number;
  marketSlug: string;
  side: "YES" | "NO";
  amountUsd: number;
  limitPriceCents: number;
  orderType: "GTC" | "FOK";
  status: "pending" | "filled" | "redeemed" | "failed";
  orderId?: string;
  createdAt: string;
  redeemedAt?: string;
  redeemTxHash?: string;
  payoutUsd?: number;
}

interface Ledger {
  positions: LedgerEntry[];
}

function readLedger(): Ledger {
  if (!fs.existsSync(LEDGER_PATH)) return { positions: [] };
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
  } catch {
    return { positions: [] };
  }
}

function writeLedger(ledger: Ledger): void {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

export function addPosition(
  entry: Omit<LedgerEntry, "id" | "createdAt">,
): LedgerEntry {
  const ledger = readLedger();
  const newEntry: LedgerEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  ledger.positions.push(newEntry);
  writeLedger(ledger);
  return newEntry;
}

export function updatePosition(
  id: string,
  updates: Partial<LedgerEntry>,
): void {
  const ledger = readLedger();
  const idx = ledger.positions.findIndex((p) => p.id === id);
  if (idx === -1) return;
  ledger.positions[idx] = { ...ledger.positions[idx], ...updates };
  writeLedger(ledger);
}

export function getPositionsByBuyer(buyerAddress: string): LedgerEntry[] {
  const ledger = readLedger();
  return ledger.positions.filter(
    (p) => p.buyerAddress.toLowerCase() === buyerAddress.toLowerCase(),
  );
}

export function getRedeemablePositions(
  buyerAddress?: string,
): LedgerEntry[] {
  const ledger = readLedger();
  return ledger.positions.filter((p) => {
    if (p.status !== "filled") return false;
    if (
      buyerAddress &&
      p.buyerAddress.toLowerCase() !== buyerAddress.toLowerCase()
    )
      return false;
    return true;
  });
}

export function getPositionByMarketAndBuyer(
  marketSlug: string,
  buyerAddress: string,
): LedgerEntry | undefined {
  const ledger = readLedger();
  return ledger.positions.find(
    (p) =>
      p.marketSlug === marketSlug &&
      p.buyerAddress.toLowerCase() === buyerAddress.toLowerCase() &&
      p.status === "filled",
  );
}
