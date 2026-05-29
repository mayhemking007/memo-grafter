import assert from "node:assert/strict";
import {
  MemoGrafterCrawler,
  type CrawlerPass,
  type CrawlerReport,
} from "../../src/index.js";

const calls: string[] = [];
const passes: CrawlerPass[] = [
  {
    name: "inspect-memory-placeholders",
    run: () => {
      calls.push("inspect-memory-placeholders");
      return {
        inspected: 2,
        annotated: 0,
        skipped: 2,
        notes: ["crawler scaffold smoke test"],
      };
    },
  },
  {
    name: "inspect-entity-placeholders",
    run: () => {
      calls.push("inspect-entity-placeholders");
      return {
        inspected: 1,
        annotated: 0,
        skipped: 1,
      };
    },
  },
];

const crawler = new MemoGrafterCrawler({ passes });
const report: CrawlerReport = await crawler.runOnce();

assert.deepEqual(calls, [
  "inspect-memory-placeholders",
  "inspect-entity-placeholders",
]);
assert.equal(report.ok, true);
assert.equal(report.passes.length, 2);
assert.equal(report.passes[0]?.result?.inspected, 2);
assert.equal(report.passes[1]?.result?.skipped, 1);

console.log("crawler smoke passed");
console.log(JSON.stringify(report, null, 2));
