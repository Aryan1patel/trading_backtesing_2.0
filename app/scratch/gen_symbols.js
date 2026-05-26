/**
 * gen_symbols.js — Phase 5
 * Generates mock 1D OHLC data for non-AAPL symbols by scaling the AAPL daily data.
 * Run: node app/scratch/gen_symbols.js
 */

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "../public/data");

// Load base AAPL data (the 1D file)
const aaplFile = path.join(dataDir, "sample_candles.json");
const aapl = JSON.parse(fs.readFileSync(aaplFile, "utf8"));

// price factor relative to AAPL — creates distinct price levels per symbol
const SYMBOLS = {
  MSFT:  { factor: 2.21,  volFactor: 0.55, seed: 17 },  // ~420 range
  TSLA:  { factor: 1.34,  volFactor: 1.80, seed: 37 },  // ~250 range
  GOOGL: { factor: 0.93,  volFactor: 0.35, seed: 53 },  // ~175 range
  NVDA:  { factor: 4.72,  volFactor: 0.22, seed: 71 },  // ~900 range
  AMZN:  { factor: 1.01,  volFactor: 0.70, seed: 89 },  // ~190 range
  META:  { factor: 2.68,  volFactor: 0.48, seed: 43 },  // ~510 range
  NFLX:  { factor: 3.61,  volFactor: 0.30, seed: 61 },  // ~680 range
};

// Simple seeded pseudo-random for reproducibility
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

for (const [symbol, { factor, volFactor, seed }] of Object.entries(SYMBOLS)) {
  const rand = seededRand(seed);
  const scaled = aapl.map((bar) => {
    // Add a tiny per-bar noise (±0.3%) so the chart looks different per symbol
    const noise = 1 + (rand() - 0.5) * 0.006;
    return {
      time: bar.time,
      open:   +((bar.open  * factor * noise)).toFixed(2),
      high:   +((bar.high  * factor * noise)).toFixed(2),
      low:    +((bar.low   * factor * noise)).toFixed(2),
      close:  +((bar.close * factor * noise)).toFixed(2),
      volume: Math.round(bar.volume * volFactor),
    };
  });

  const outPath = path.join(dataDir, `${symbol}_1D.json`);
  fs.writeFileSync(outPath, JSON.stringify(scaled));
  console.log(`✓ ${symbol}_1D.json  (${scaled.length} bars, last close: ${scaled.at(-1).close})`);
}

console.log("\nDone.");
