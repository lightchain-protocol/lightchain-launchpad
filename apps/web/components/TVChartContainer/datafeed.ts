import type {
  Bar,
  DatafeedErrorCallback,
  HistoryCallback,
  LibrarySymbolInfo,
  OnReadyCallback,
  ResolutionString,
  ResolveCallback,
  SearchSymbolsCallback,
  SubscribeBarsCallback,
  SymbolResolveExtension,
  PeriodParams,
} from "@/public/trading-view/charting_library/charting_library";
import { subscribeOnStream, unsubscribeFromStream } from "./streaming";

type PeriodParamsWithOptionalCountback = Omit<PeriodParams, "countBack"> & {
  countBack?: number;
};

import type { Bar as ApiBar, CandlesResponse } from "@/types";

const lastBarsCache = new Map<string, ApiBar>();

/**
 * TradingView resolution → backend candle interval. The new backend exposes
 * `1m / 5m / 15m / 1h / 4h / 1d`.
 */
const resolutionToInterval = (r: ResolutionString): string => {
  switch (r) {
    case "1":
      return "1m";
    case "5":
      return "5m";
    case "15":
      return "15m";
    case "60":
      return "1h";
    case "240":
      return "4h";
    case "1D":
    case ("D" as ResolutionString):
      return "1d";
    default:
      return "1m";
  }
};

const configurationData = {
  supported_resolutions: ["1", "5", "15", "60", "240", "1D"] as ResolutionString[],
  exchanges: [{ value: "Lightchain", name: "Lightchain", desc: "Lightchain" }],
  symbols_types: [{ name: "crypto", value: "crypto" }],
  supports_marks: true,
  supports_timescale_marks: true,
  scales: { textColor: "#131722", fontSize: 12 },
};

export default {
  onReady: (callback: OnReadyCallback) => {
    setTimeout(() => callback(configurationData));
  },
  searchSymbols: (
    _userInput: string,
    _exchange: string,
    _symbolType: string,
    _onResult: SearchSymbolsCallback,
  ) => {
    /* noop */
  },
  resolveSymbol: (
    symbolName: string,
    onResolve: ResolveCallback,
    onError: DatafeedErrorCallback,
    _extension?: SymbolResolveExtension,
  ) => {
    const [symbol] = symbolName.split("_");
    const symbolInfo: LibrarySymbolInfo = {
      name: symbol ?? symbolName,
      ticker: symbolName,
      description: symbolName,
      type: "crypto",
      session: "24x7",
      timezone: "Etc/UTC",
      exchange: "Lightchain",
      minmov: 1,
      pricescale: 1e12,
      has_intraday: true,
      intraday_multipliers: ["1", "5", "15", "60", "240"],
      visible_plots_set: "ohlc",
      has_weekly_and_monthly: false,
      supported_resolutions: configurationData.supported_resolutions,
      volume_precision: 8,
      data_status: "streaming",
      listed_exchange: "Lightchain",
      format: "price",
    };
    setTimeout(() => {
      try {
        onResolve(symbolInfo);
      } catch (error: unknown) {
        onError(error instanceof Error ? error.message : String(error));
      }
    });
  },
  getBars: (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParamsWithOptionalCountback,
    onResult: HistoryCallback,
    onError: DatafeedErrorCallback,
  ) => {
    const { from, to, firstDataRequest } = periodParams;

    setTimeout(async () => {
      try {
        const [, address] = symbolInfo.ticker!.split("_");
        const url = new URL(`${process.env.NEXT_PUBLIC_API_URL}/tokens/${address}/candles`);
        url.searchParams.append("interval", resolutionToInterval(resolution));
        url.searchParams.append("from", from.toString());
        url.searchParams.append("to", to.toString());

        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as CandlesResponse;
        if (!json.data || json.data.length === 0) {
          onResult([], { noData: true });
          return;
        }

        const bars: Bar[] = json.data
          .map((b) => ({
            time: b.time * 1000, // unix seconds → ms
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }))
          .sort((a, b) => a.time - b.time);

        if (firstDataRequest) {
          const last = json.data[json.data.length - 1];
          if (last) lastBarsCache.set(symbolInfo.ticker!, last);
        }
        onResult(bars, { noData: false });
      } catch (error: unknown) {
        onError(error instanceof Error ? error.message : String(error));
      }
    });
  },
  subscribeBars: (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onRealtimeCallback: SubscribeBarsCallback,
    subscriberUID: string,
    _onResetCacheNeededCallback: () => void,
  ) => {
    subscribeOnStream(
      symbolInfo,
      resolution,
      onRealtimeCallback,
      subscriberUID,
      lastBarsCache.get(symbolInfo.ticker!),
    );
  },
  unsubscribeBars: (subscriberUID: string) => {
    unsubscribeFromStream(subscriberUID);
  },
};
