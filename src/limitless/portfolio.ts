import type { PortfolioPositionsResponse } from "@limitless-exchange/sdk";
import { getSdkClient } from "./sdk.js";
import { logger } from "../logger.js";

export class PortfolioClient {
  private get sdk() {
    return getSdkClient();
  }

  async getPositions(): Promise<PortfolioPositionsResponse> {
    logger.debug("Fetching user positions");
    return this.sdk.portfolio.getPositions();
  }

  async verifyFill(
    marketSlug: string,
    side: "YES" | "NO",
  ): Promise<{ filled: boolean; balance: bigint }> {
    const raw = await this.getPositions();
    const positions = [
      ...(raw.clob ?? []),
      ...(raw.amm ?? []),
      ...(raw.group ?? []),
    ] as unknown as Record<string, unknown>[];

    const match = positions.find(
      (p) =>
        (p.market as Record<string, unknown>)?.slug === marketSlug ||
        p.marketSlug === marketSlug,
    );

    if (!match) {
      return { filled: false, balance: 0n };
    }

    const posData = match.positions as Record<string, Record<string, unknown>>;
    const sideData =
      side === "YES"
        ? (posData?.yes ??
          (match as Record<string, unknown>).yes ??
          (match as Record<string, unknown>).yesPosition)
        : (posData?.no ??
          (match as Record<string, unknown>).no ??
          (match as Record<string, unknown>).noPosition);

    if (!sideData) {
      return { filled: false, balance: 0n };
    }

    const rawBalance =
      (sideData as Record<string, unknown>).tokensBalance ??
      (sideData as Record<string, unknown>).balance ??
      (sideData as Record<string, unknown>).size ??
      "0";

    const balance = BigInt(Math.round(Number(rawBalance)));
    return { filled: balance > 0n, balance };
  }
}
