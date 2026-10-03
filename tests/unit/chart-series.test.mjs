import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../app/components/chart-series.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { buildChartSeries, samplePoints, VOLUME_COLORS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("chart sampling preserves endpoints, order and the original input", () => {
  const values = Array.from({ length: 500 }, (_, index) => index);
  const sampled = samplePoints(values);
  assert.equal(sampled.length, 180);
  assert.equal(sampled[0], 0);
  assert.equal(sampled.at(-1), 499);
  assert.equal(new Set(sampled).size, 180);
  assert.deepEqual(
    [...sampled].sort((a, b) => a - b),
    sampled,
  );
  assert.equal(values.length, 500);
  assert.notEqual(samplePoints(values, 500), values);
  for (const limit of [0, 1, 2.5, Infinity])
    assert.throws(() => samplePoints(values, limit), RangeError);
});

test("volume colors follow the matching price time, not unrelated array positions", () => {
  const history = {
    prices: [
      [1000, 10],
      [2000, 20],
      [3000, 15],
      [4000, 25],
    ],
    volumes: [
      [500, 1],
      [1000, 2],
      [2500, 3],
      [3500, 4],
      [4000, 0],
    ],
  };
  const series = buildChartSeries(history, "1D");
  assert.deepEqual(
    series.volumes.map((point) => point.color),
    [
      VOLUME_COLORS.unknown,
      VOLUME_COLORS.unknown,
      VOLUME_COLORS.rising,
      VOLUME_COLORS.falling,
      VOLUME_COLORS.rising,
    ],
  );
  assert.equal(series.volumes.at(-1).value, 0);
  assert.deepEqual(
    series.prices.map((point) => point.time),
    [1, 2, 3, 4],
  );
});

test("one-hour charts keep the boundary and use earlier prices only for volume context", () => {
  const history = {
    prices: [
      [3_599_000, 10],
      [3_600_000, 12],
      [3_601_000, 8],
    ],
    volumes: [
      [3_599_000, 4],
      [3_600_000, 3],
      [3_601_000, 2],
    ],
  };
  const series = buildChartSeries(history, "1H", 7_200_000);
  assert.deepEqual(series.prices, [
    { time: 3600, value: 12 },
    { time: 3601, value: 8 },
  ]);
  assert.deepEqual(
    series.volumes.map((point) => point.color),
    [VOLUME_COLORS.rising, VOLUME_COLORS.falling],
  );
  assert.deepEqual(buildChartSeries(history, "1H", 10_000_000), { prices: [], volumes: [] });
});

test("empty charts remain empty instead of manufacturing a data point", () => {
  assert.deepEqual(buildChartSeries({ prices: [], volumes: [] }, "ALL"), {
    prices: [],
    volumes: [],
  });
});
