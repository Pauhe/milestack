import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = 100;
const EPSILON = 1e-9;
const STRICT = process.env.COVERAGE_ENFORCEMENT === "hard";

function parseNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric coverage value for ${label}: ${value}`);
  }
  return n;
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function readJson(path) {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing coverage artifact: ${path}`);
  }
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function evaluateMetric(surface, metricName, pct) {
  const delta = TARGET - pct;
  if (delta > EPSILON) {
    return {
      ok: false,
      message: `${surface} ${metricName} ${pct.toFixed(2)}% (< 100.00%)`,
    };
  }

  return {
    ok: true,
    message: `${surface} ${metricName} ${pct.toFixed(2)}%`,
  };
}

function failOrWarn(message) {
  if (STRICT) {
    fail(message);
  } else {
    console.log(`⚠️ ${message}`);
  }
}

function loadBackendCoverage() {
  const summary = readJson("backend/coverage/coverage-summary.json");
  const total = summary.total;
  if (!total) {
    throw new Error("backend coverage-summary.json missing 'total' block");
  }

  return {
    surface: "backend",
    metrics: {
      lines: parseNumber(total.lines?.pct, "backend.lines.pct"),
      functions: parseNumber(total.functions?.pct, "backend.functions.pct"),
      branches: parseNumber(total.branches?.pct, "backend.branches.pct"),
      statements: parseNumber(total.statements?.pct, "backend.statements.pct"),
    },
  };
}

function loadWebCoverage() {
  const summary = readJson("web/coverage/coverage-summary.json");
  const total = summary.total;
  if (!total) {
    throw new Error("web coverage-summary.json missing 'total' block");
  }

  return {
    surface: "web",
    metrics: {
      lines: parseNumber(total.lines?.pct, "web.lines.pct"),
      functions: parseNumber(total.functions?.pct, "web.functions.pct"),
      branches: parseNumber(total.branches?.pct, "web.branches.pct"),
      statements: parseNumber(total.statements?.pct, "web.statements.pct"),
    },
  };
}

function parseLcovTotals(text) {
  const totals = {
    LF: 0,
    LH: 0,
    FNF: 0,
    FNH: 0,
    BRF: 0,
    BRH: 0,
  };

  const keys = Object.keys(totals);
  for (const line of text.split(/\r?\n/)) {
    for (const key of keys) {
      if (line.startsWith(`${key}:`)) {
        totals[key] += parseNumber(line.slice(key.length + 1), `contracts.${key}`);
      }
    }
  }

  return totals;
}

function pct(hit, found, label) {
  if (found === 0) {
    throw new Error(`contracts ${label} denominator is zero; cannot prove coverage contract`);
  }
  return (hit / found) * 100;
}

function loadContractsCoverage() {
  const lcovPath = resolve("contracts/lcov.info");
  if (!existsSync(lcovPath)) {
    throw new Error("Missing coverage artifact: contracts/lcov.info");
  }

  const lcov = readFileSync(lcovPath, "utf8");
  const totals = parseLcovTotals(lcov);

  const lines = pct(totals.LH, totals.LF, "lines");
  const functions = pct(totals.FNH, totals.FNF, "functions");
  const branches = pct(totals.BRH, totals.BRF, "branches");

  return {
    surface: "contracts",
    metrics: {
      lines,
      functions,
      branches,
      statements: lines,
    },
  };
}

function printHeader() {
  console.log("Coverage proof contract (R025)");
  console.log(
    "- Conservative truth semantics are preserved: we report measured artifacts only; no permissive mock substitution in proof checks.",
  );
  console.log("- Enforcement mode:", STRICT ? "hard (exit 1 on <100%)" : "report-only (non-blocking)");
  console.log("- Expected artifacts:");
  console.log("  - backend/coverage/coverage-summary.json");
  console.log("  - web/coverage/coverage-summary.json");
  console.log("  - contracts/lcov.info");
  console.log("");
}

function main() {
  printHeader();

  const surfaces = [loadBackendCoverage(), loadWebCoverage(), loadContractsCoverage()];
  const failures = [];

  for (const { surface, metrics } of surfaces) {
    console.log(`Surface: ${surface}`);
    for (const [metric, pct] of Object.entries(metrics)) {
      const result = evaluateMetric(surface, metric, pct);
      if (!result.ok) {
        failures.push(result.message);
        failOrWarn(result.message);
      } else {
        pass(result.message);
      }
    }
    console.log("");
  }

  if (failures.length > 0) {
    console.error("Coverage proof failed. Surfaces below 100%:");
    for (const message of failures) {
      console.error(`- ${message}`);
    }
    if (STRICT) {
      process.exit(1);
    }
    console.log("Coverage proof completed in report-only mode; strict failure was not enforced.");
    return;
  }

  console.log("🎉 Coverage proof passed: backend, web, and contracts are all at 100%.");
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
