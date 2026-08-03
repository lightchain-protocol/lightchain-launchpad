import { useEffect, useRef } from "react";
import {
  ChartingLibraryWidgetOptions,
  ResolutionString,
  widget,
} from "@/public/trading-view/charting_library";
import datafeed from "./datafeed";

type Props = {
  symbol: string;
  address: string;
};
export const TVChartContainer = (props: Props) => {
  const chartContainerRef = useRef<HTMLDivElement>(
    null
  ) as React.RefObject<HTMLInputElement>;

  useEffect(() => {
    const widgetOptions: ChartingLibraryWidgetOptions = {
      symbol: `${props.symbol}_${props.address}`,
      datafeed: datafeed,
      container: chartContainerRef.current,
      disabled_features: [
        "header_symbol_search",
        "symbol_search_hot_key",
        "header_compare",
        "volume_force_overlay",
        "use_localstorage_for_settings",
      ],
      enabled_features: [
        "create_volume_indicator_by_default",
        "iframe_loading_compatibility_mode",
      ],
      overrides: {
        volumePaneSize: "medium",
        // "paneProperties.background": "#121212",
        // "mainSeriesProperties.candleStyle.upColor": "#6CFF32",
        // "mainSeriesProperties.candleStyle.downColor": "#FF4A32",
        // "mainSeriesProperties.candleStyle.borderUpColor": "#6CFF32",
        // "mainSeriesProperties.candleStyle.borderDownColor": "#FF4A32",
        // "mainSeriesProperties.candleStyle.wickUpColor": "#6CFF32",
        // "mainSeriesProperties.candleStyle.wickDownColor": "#FF4A32",
        // "scalesProperties.textColor": "#D6DEC7",
        "paneProperties.legendProperties.showSeriesTitle": false,
        "paneProperties.legendProperties.showStudyTitles": false,
        "mainSeriesProperties.priceAxisProperties.percentage": false,
        // "priceScaleSelectionStrategyName": "left",
      },
      // numeric_formatting: { decimal_sign: "," },

      interval: "5" as ResolutionString,
      favorites: {
        intervals: ["1", "5", "15", "60", "240", "1D"] as ResolutionString[],
      },
      // timeframe: "1h",
      time_frames: [
        {
          text: "1D",
          resolution: "5" as ResolutionString,
          description: "1 day",
        },
        {
          text: "4H",
          resolution: "5" as ResolutionString,
          description: "4 Hours",
        },
        {
          text: "1H",
          resolution: "5" as ResolutionString,
          description: "1 Hour",
        },
      ],
      // marks: {
      //   buyStyle: {
      //     color: "#26a69a",
      //     text: null === (t = B[o]) || void 0 === t ? void 0 : t.buy,
      //     label: null === (r = B[o]) || void 0 === r ? void 0 : r.buy,
      //     labelFontColor: "#fff",
      //     minSize: 14,
      //   },
      //   sellStyle: {
      //     color: "#ef5350",
      //     text: null === (i = B[o]) || void 0 === i ? void 0 : i.sell,
      //     label: null === (n = B[o]) || void 0 === n ? void 0 : n.sell,
      //     labelFontColor: "#fff",
      //     minSize: 14,
      //   },
      // },
      custom_formatters: {
        priceFormatterFactory: () => ({
          format: (value) => {
            if (!value) return "0";
            const [integerPart, decimalPart] = Number(value)
              .toFixed(12)
              .split(".");
            if (!decimalPart) return integerPart ?? "0";
            let leadingZeros = 0;
            for (let digit of decimalPart) {
              if ("0" === digit) leadingZeros++;
              else break;
            }
            if (leadingZeros > 1) {
              const significantDigits = decimalPart.slice(
                leadingZeros,
                leadingZeros + 4
              );
              return `${integerPart}.0{${leadingZeros}}${significantDigits}`;
            }
            const truncatedDecimals = decimalPart.slice(0, 5);
            return `${integerPart}.${truncatedDecimals}`;
          },
        }),
      },
      library_path: "/trading-view/charting_library/",
      locale: "en",
      charts_storage_url: "https://saveload.tradingview.com",
      charts_storage_api_version: "1.1",
      // client_id: "tradingview.com",
      // user_id: "public_user_id",
      fullscreen: false,
      autosize: true,
      theme: "dark",
    };

    const tvWidget = new widget(widgetOptions);

    tvWidget.onChartReady(() => {
      tvWidget.setDebugMode(true);
      // tvWidget.headerReady().then(() => {
      //   const button = tvWidget.createButton();
      //   button.setAttribute("title", "Click to show a notification popup");
      //   button.classList.add("apply-common-tooltip");
      //   button.addEventListener("click", () =>
      //     tvWidget.showNoticeDialog({
      //       title: "Notification",
      //       body: "TradingView Charting Library API works correctly",
      //       callback: () => {
      //         console.log("Noticed!");
      //       },
      //     })
      //   );
      //   button.innerHTML = "Check API";
      // });
    });

    return () => {
      tvWidget.remove();
    };
  }, [props.address]);

  return (
    <div
      ref={chartContainerRef}
      style={{ height: "500px", borderRadius: "10px", overflow: "hidden" }}
    />
  );
};
