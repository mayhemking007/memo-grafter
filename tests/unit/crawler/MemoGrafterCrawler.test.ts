import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoGrafterCrawler, type CrawlerPass } from "../../../src/index.js";

describe("MemoGrafterCrawler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes configured passes in order", async () => {
    const calls: string[] = [];
    const crawler = new MemoGrafterCrawler({
      passes: [
        {
          name: "first",
          run: () => {
            calls.push("first");
            return {};
          },
        },
        {
          name: "second",
          run: () => {
            calls.push("second");
            return {};
          },
        },
      ],
    });

    await crawler.runOnce();

    expect(calls).toEqual(["first", "second"]);
  });

  it("returns a report containing each pass result", async () => {
    const crawler = new MemoGrafterCrawler({
      passes: [
        {
          name: "inspect-memories",
          run: () => ({
            inspected: 3,
            annotated: 0,
            skipped: 3,
            notes: ["scaffold only"],
          }),
        },
      ],
    });

    const report = await crawler.runOnce();

    expect(report.ok).toBe(true);
    expect(report.passes).toHaveLength(1);
    expect(report.passes[0]).toMatchObject({
      name: "inspect-memories",
      ok: true,
      result: {
        inspected: 3,
        annotated: 0,
        skipped: 3,
        notes: ["scaffold only"],
      },
    });
    expect(report.startedAt).toEqual(expect.any(String));
    expect(report.finishedAt).toEqual(expect.any(String));
    expect(report.durationMs).toEqual(expect.any(Number));
  });

  it("captures a failing pass in the report and continues by default", async () => {
    const crawler = new MemoGrafterCrawler({
      passes: [
        {
          name: "fails",
          run: () => {
            throw new Error("maintenance pass failed");
          },
        },
        {
          name: "continues",
          run: () => ({ inspected: 1 }),
        },
      ],
    });

    const report = await crawler.runOnce();

    expect(report.ok).toBe(false);
    expect(report.passes).toHaveLength(2);
    expect(report.passes[0]).toMatchObject({
      name: "fails",
      ok: false,
      error: {
        message: "maintenance pass failed",
      },
    });
    expect(report.passes[1]).toMatchObject({
      name: "continues",
      ok: true,
      result: {
        inspected: 1,
      },
    });
  });

  it("stops execution after the first failing pass when configured", async () => {
    const calls: string[] = [];
    const crawler = new MemoGrafterCrawler({
      stopOnPassError: true,
      passes: [
        {
          name: "fails",
          run: () => {
            calls.push("fails");
            throw new Error("stop here");
          },
        },
        {
          name: "should-not-run",
          run: () => {
            calls.push("should-not-run");
            return {};
          },
        },
      ],
    });

    const report = await crawler.runOnce();

    expect(calls).toEqual(["fails"]);
    expect(report.ok).toBe(false);
    expect(report.passes).toHaveLength(1);
    expect(report.passes[0]).toMatchObject({
      name: "fails",
      ok: false,
    });
  });

  it("does not create duplicate loops when started twice", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const crawler = new MemoGrafterCrawler({
      intervalMs: 100,
      passes: [
        {
          name: "count",
          run: () => {
            runs += 1;
            return {};
          },
        },
      ],
    });

    crawler.start();
    crawler.start();

    await vi.advanceTimersByTimeAsync(100);
    crawler.stop();

    expect(runs).toBe(1);
  });

  it("is safe to stop when not running", () => {
    const crawler = new MemoGrafterCrawler();

    expect(() => crawler.stop()).not.toThrow();
  });

  it("skips scheduled ticks while a run is still executing", async () => {
    vi.useFakeTimers();
    let runs = 0;
    let finishRun: (() => void) | undefined;
    const slowPass: CrawlerPass = {
      name: "slow",
      run: async () => {
        runs += 1;
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return {};
      },
    };
    const crawler = new MemoGrafterCrawler({
      intervalMs: 100,
      passes: [slowPass],
    });

    crawler.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(runs).toBe(1);

    finishRun?.();
    await vi.advanceTimersByTimeAsync(0);
    crawler.stop();
  });
});
