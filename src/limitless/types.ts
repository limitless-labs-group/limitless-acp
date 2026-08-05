export interface Token {
  address: string;
  decimals: number;
  symbol: string;
}

export interface MarketVenue {
  exchange: string;
  adapter: string;
}

export interface Market {
  id: number;
  address: string;
  title: string;
  prices: number[];
  tradeType: "amm" | "clob" | "group";
  marketType: "single" | "group";
  slug: string;
  venue: MarketVenue;
  positionIds: string[];
  collateralToken: Token;
  volume: string;
  volumeFormatted: string;
  liquidity: string;
  liquidityFormatted: string;
  expirationTimestamp: number;
  status: "FUNDED" | "CLOSED" | "RESOLVED";
}

export interface MarketDetail extends Market {
  description?: string;
  resolutionSource?: string;
}

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  midpoint?: number;
}

export interface Order {
  id: string;
  marketSlug: string;
  side: "YES" | "NO";
  price: number;
  size: number;
  filledSize: number;
  status: "OPEN" | "FILLED" | "CANCELLED" | "EXPIRED";
  timestamp: number;
}
