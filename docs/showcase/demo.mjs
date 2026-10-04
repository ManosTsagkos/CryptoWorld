import {
  chartCoordinates,
  demoAssets,
  filterDemoAssets,
  inspectTrend,
  normalizeDemoWatchlist,
  samplePrices,
} from "./demo-model.mjs";

const demo = document.getElementById("interactive-demo");
const coin = document.getElementById("demo-coin");
const range = document.getElementById("demo-range");
const search = document.getElementById("demo-search");
const onlyWatched = document.getElementById("demo-only-watched");
const rows = document.getElementById("demo-market-rows");
const slider = document.getElementById("demo-cursor");
const storageKey = "cryptoworld-portfolio-sample-watchlist-v1";
let watched = [];
let storageAvailable = true;
try {
  watched = normalizeDemoWatchlist(JSON.parse(localStorage.getItem(storageKey) || "[]"));
} catch {
  storageAvailable = false;
}

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const percent = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
let prices = [];
let points = [];

function showWatchStatus() {
  document.getElementById("demo-watch-status").textContent = storageAvailable
    ? `${watched.length} sample asset${watched.length === 1 ? "" : "s"} saved in this browser.`
    : "Browser storage is unavailable; your sample watchlist is kept for this visit.";
}

function drawCursor() {
  const index = Number(slider.value);
  const point = points[index];
  const cursor = document.getElementById("demo-chart-cursor");
  cursor.setAttribute("cx", String(point.x));
  cursor.setAttribute("cy", String(point.y));
  const label = `Sample ${index + 1} of ${prices.length}: ${money(prices[index])}`;
  slider.setAttribute("aria-valuetext", label);
  document.getElementById("demo-cursor-label").textContent = label;
}

function drawChart() {
  prices = samplePrices(coin.value, range.value);
  points = chartCoordinates(prices);
  const summary = inspectTrend(prices);
  const selected = demoAssets.find((asset) => asset.symbol === coin.value);
  document.getElementById("demo-asset-name").textContent = `${selected.name} / ${selected.symbol}`;
  document.getElementById("demo-price").textContent = money(prices.at(-1));
  document.getElementById("demo-change").textContent =
    `${percent(summary.change)} in selected sample range`;
  document.getElementById("demo-change").dataset.direction = summary.change >= 0 ? "up" : "down";
  document
    .getElementById("demo-chart-line")
    .setAttribute(
      "d",
      points
        .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" "),
    );
  document.getElementById("demo-chart-title").textContent =
    `${selected.name} illustrative ${range.value} price chart`;
  document.getElementById("demo-chart-description").textContent =
    `${prices.length} fixed sample prices. First ${money(prices[0])}, last ${money(prices.at(-1))}, change ${percent(summary.change)}.`;
  slider.max = String(prices.length - 1);
  slider.value = slider.max;
  drawCursor();
  document.getElementById("demo-trend").textContent =
    "Inspect the sample to compare its latest price with the average of its last five points.";
}

function renderRows() {
  rows.replaceChildren();
  const assets = filterDemoAssets(search.value, watched, onlyWatched.checked);
  for (const asset of assets) {
    const row = document.createElement("tr");
    const assetCell = document.createElement("td");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "demo-asset-button";
    select.textContent = `${asset.symbol} · ${asset.name}`;
    select.setAttribute("aria-label", `View ${asset.name} sample chart`);
    select.addEventListener("click", () => {
      coin.value = asset.symbol;
      drawChart();
    });
    assetCell.append(select);
    const price = document.createElement("td");
    price.textContent = money(asset.price);
    const change = document.createElement("td");
    const summary = inspectTrend(samplePrices(asset.symbol, "1D"));
    change.textContent = percent(summary.change);
    change.dataset.direction = summary.change >= 0 ? "up" : "down";
    const watchCell = document.createElement("td");
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = "demo-watch-button";
    watch.setAttribute("aria-pressed", String(watched.includes(asset.symbol)));
    watch.setAttribute("aria-label", `Watch ${asset.name}`);
    watch.textContent = watched.includes(asset.symbol) ? "★ Saved" : "☆ Save";
    watch.addEventListener("click", () => {
      watched = watched.includes(asset.symbol)
        ? watched.filter((symbol) => symbol !== asset.symbol)
        : [...watched, asset.symbol];
      try {
        localStorage.setItem(storageKey, JSON.stringify(watched));
        storageAvailable = true;
      } catch {
        storageAvailable = false;
      }
      renderRows();
      showWatchStatus();
    });
    watchCell.append(watch);
    row.append(assetCell, price, change, watchCell);
    rows.append(row);
  }
  document.getElementById("demo-empty").hidden = assets.length !== 0;
  document.getElementById("demo-result-count").textContent =
    `${assets.length} sample asset${assets.length === 1 ? "" : "s"}`;
}

coin.addEventListener("change", drawChart);
range.addEventListener("change", drawChart);
slider.addEventListener("input", drawCursor);
search.addEventListener("input", renderRows);
onlyWatched.addEventListener("change", renderRows);
document.getElementById("demo-inspect").addEventListener("click", () => {
  const trend = inspectTrend(prices);
  document.getElementById("demo-trend").textContent =
    `${trend.direction}. Latest sample is ${percent(trend.distance)} from the five-point average (${money(trend.average)}). Range change: ${percent(trend.change)}. This is a simple calculation on example data, not the full app's signal engine or an AI forecast.`;
});
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  try {
    watched = normalizeDemoWatchlist(JSON.parse(event.newValue || "[]"));
  } catch {
    watched = [];
  }
  renderRows();
  showWatchStatus();
});
drawChart();
renderRows();
showWatchStatus();
demo.dataset.ready = "true";
