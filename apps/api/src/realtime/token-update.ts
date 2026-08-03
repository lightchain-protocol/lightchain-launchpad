import type { TokenDTO } from "../dto.js";

/** Payload shape published on the `lcai:token:update` channel. */
export interface TokenUpdatePayload {
  address: string;
  priceX18: string;
  priceNative: number;
  marketCap: string;
  realEthRaised: string;
  tokensSold: string;
  progressBps: number;
  graduated: boolean;
  lastTradeAt: string | null;
}

export function tokenUpdateFromDTO(t: TokenDTO): TokenUpdatePayload {
  return {
    address: t.address,
    priceX18: t.currentPriceX18,
    priceNative: t.priceNative,
    marketCap: t.marketCap,
    realEthRaised: t.realEthRaised,
    tokensSold: t.tokensSold,
    progressBps: t.progressBps,
    graduated: t.graduated,
    lastTradeAt: t.lastTradeAt,
  };
}
