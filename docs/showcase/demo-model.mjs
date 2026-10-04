// Deliberately fixed, illustrative prices. No provider or AI request runs in this demo.
export const demoAssets = Object.freeze(
  [
    {
      symbol: "BTC",
      name: "Bitcoin",
      price: 64280,
      shape: [
        96, 97, 96, 98, 99, 98, 97, 96, 98, 100, 99, 101, 100, 99, 101, 102, 100, 101, 99, 98, 100,
        102, 101, 103, 102, 101, 103, 104, 102, 103, 104,
      ],
    },
    {
      symbol: "ETH",
      name: "Ethereum",
      price: 3120,
      shape: [
        104, 103, 105, 102, 101, 102, 103, 100, 99, 101, 100, 102, 103, 101, 99, 98, 100, 99, 97,
        98, 100, 99, 101, 100, 98, 97, 98, 96, 98, 97, 96,
      ],
    },
    {
      symbol: "SOL",
      name: "Solana",
      price: 146.8,
      shape: [
        84, 85, 83, 86, 88, 87, 90, 89, 91, 93, 90, 92, 94, 93, 96, 95, 97, 94, 96, 98, 97, 99, 101,
        100, 98, 101, 102, 100, 103, 102, 104,
      ],
    },
    {
      symbol: "AVAX",
      name: "Avalanche",
      price: 34.2,
      shape: [
        102, 101, 100, 101, 103, 102, 100, 99, 98, 100, 102, 101, 100, 99, 101, 102, 103, 101, 100,
        102, 101, 100, 99, 101, 100, 102, 101, 100, 99, 101, 100,
      ],
    },
    {
      symbol: "LINK",
      name: "Chainlink",
      price: 15.7,
      shape: [
        105, 104, 106, 103, 102, 104, 102, 100, 101, 99, 98, 100, 101, 99, 98, 97, 99, 98, 96, 95,
        97, 98, 96, 95, 94, 96, 95, 93, 94, 92, 93,
      ],
    },
  ].map((asset) => Object.freeze({ ...asset, shape: Object.freeze(asset.shape) })),
);

const rangeCounts = Object.freeze({ "1D": 12, "1W": 21, "1M": 31 });

export function samplePrices(symbol, range = "1W") {
  const asset = demoAssets.find((item) => item.symbol === symbol);
  if (!asset || !Object.hasOwn(rangeCounts, range))
    throw new RangeError("Unknown sample selection");
  return asset.shape
    .slice(-rangeCounts[range])
    .map((value) => (value * asset.price) / asset.shape.at(-1));
}

export function inspectTrend(prices) {
  if (
    !Array.isArray(prices) ||
    prices.length < 2 ||
    prices.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new RangeError("At least two positive sample prices are required");
  }
  const change = (prices.at(-1) / prices[0] - 1) * 100;
  const recent = prices.slice(-5);
  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const distance = (prices.at(-1) / average - 1) * 100;
  return {
    change,
    average,
    distance,
    direction:
      distance > 0.25
        ? "Above recent average"
        : distance < -0.25
          ? "Below recent average"
          : "Near recent average",
  };
}

export function chartCoordinates(prices, width = 760, height = 240, padding = 16) {
  inspectTrend(prices);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    width <= padding * 2 ||
    height <= padding * 2
  )
    throw new RangeError("Invalid chart dimensions");
  const minimum = Math.min(...prices);
  const span = Math.max(...prices) - minimum;
  return prices.map((price, index) => ({
    x: padding + (index / (prices.length - 1)) * (width - padding * 2),
    y:
      span === 0
        ? height / 2
        : height - padding - ((price - minimum) / span) * (height - padding * 2),
  }));
}

export function normalizeDemoWatchlist(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((symbol) => demoAssets.some((asset) => asset.symbol === symbol))),
  ];
}

export function filterDemoAssets(query, watched, onlyWatched = false) {
  const text = String(query).trim().toLowerCase();
  const symbols = normalizeDemoWatchlist(watched);
  return demoAssets.filter(
    (asset) =>
      (!onlyWatched || symbols.includes(asset.symbol)) &&
      `${asset.symbol} ${asset.name}`.toLowerCase().includes(text),
  );
}
