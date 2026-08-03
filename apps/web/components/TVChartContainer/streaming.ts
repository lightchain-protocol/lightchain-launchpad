/**
 * TradingView "subscribeBars" integration with the new socket.io backend.
 *
 * Each `subscribeOnStream` call joins `token:<address>` on the singleton
 * socket; incoming `trade` events update the latest bar (or open a new one)
 * for every subscriber listening on that token.
 */
import { getSocket } from "@/lib/socket";
import type {
  Bar,
  LibrarySymbolInfo,
  ResolutionString,
  SubscribeBarsCallback,
} from "@/public/trading-view/charting_library/charting_library";
import type { Bar as ApiBar, TradeEventPayload } from "@/types";

type Subscription = {
  subscriberUID: string;
  resolution: ResolutionString;
  lastDailyBar: ApiBar | undefined;
  handlers: { id: string; callback: SubscribeBarsCallback }[];
};

const socket = getSocket();
const channelToSubscription = new Map<string, Subscription>();
const joinedRooms = new Set<string>();

socket.on("trade", (event: TradeEventPayload) => {
  const tradePrice = event.trade.priceNative;
  const tradeTime = new Date(event.trade.timestamp).getTime() / 1000;
  const channelString = `token_${event.token.toLowerCase()}`;
  const subscriptionItem = channelToSubscription.get(channelString);
  if (!subscriptionItem) return;

  const lastDailyBar = subscriptionItem.lastDailyBar;
  const nextDailyBarTime = getNextDailyBarTime(lastDailyBar?.time);

  let bar: Bar | undefined;
  if (!nextDailyBarTime || tradeTime >= nextDailyBarTime) {
    bar = {
      time: (nextDailyBarTime || tradeTime) * 1000,
      open: tradePrice,
      high: tradePrice,
      low: tradePrice,
      close: tradePrice,
    };
  } else if (lastDailyBar) {
    bar = {
      time: lastDailyBar.time * 1000,
      open: lastDailyBar.open,
      high: Math.max(lastDailyBar.high, tradePrice),
      low: Math.min(lastDailyBar.low, tradePrice),
      close: tradePrice,
    };
  }

  if (bar) {
    subscriptionItem.lastDailyBar = {
      time: bar.time / 1000,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: lastDailyBar?.volume ?? 0,
      trades: (lastDailyBar?.trades ?? 0) + 1,
    };
    subscriptionItem.handlers.forEach((handler) => handler.callback(bar!));
  }
});

function getNextDailyBarTime(barTime?: number): number | null {
  if (!barTime) return null;
  const date = new Date(barTime * 1000);
  date.setDate(date.getDate() + 1);
  return date.getTime() / 1000;
}

export function subscribeOnStream(
  symbolInfo: LibrarySymbolInfo,
  resolution: ResolutionString,
  onRealtimeCallback: SubscribeBarsCallback,
  subscriberUID: string,
  lastDailyBar: ApiBar | undefined,
): void {
  const [, address = ""] = symbolInfo.ticker!.split("_");
  const lowered = address.toLowerCase();
  const channelString = `token_${lowered}`;
  const room = `token:${lowered}`;

  const handler = { id: subscriberUID, callback: onRealtimeCallback };
  const existing = channelToSubscription.get(channelString);
  if (existing) {
    existing.handlers.push(handler);
    return;
  }

  channelToSubscription.set(channelString, {
    subscriberUID,
    resolution,
    lastDailyBar,
    handlers: [handler],
  });

  if (!joinedRooms.has(room)) {
    socket.emit("subscribe", room);
    joinedRooms.add(room);
  }
}

export function unsubscribeFromStream(subscriberUID: string): void {
  for (const [channelString, subscriptionItem] of channelToSubscription.entries()) {
    const handlerIndex = subscriptionItem.handlers.findIndex((h) => h.id === subscriberUID);
    if (handlerIndex === -1) continue;

    subscriptionItem.handlers.splice(handlerIndex, 1);
    if (subscriptionItem.handlers.length === 0) {
      const [, address] = channelString.split("_");
      const room = `token:${address}`;
      socket.emit("unsubscribe", room);
      joinedRooms.delete(room);
      channelToSubscription.delete(channelString);
    }
    return;
  }
}
