import { RateLimiter } from "./rate-limiter";

const mockLog: ioBroker.Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  silly: () => {},
  level: "debug",
};

/** Mock timer adapter that doesn't actually schedule */
const mockTimers = {
  setInterval: () => ({}) as ioBroker.Interval,
  clearInterval: () => {},
  setTimeout: () => ({}) as ioBroker.Timeout,
  clearTimeout: () => {},
  delay: () => Promise.resolve(),
};

/** Timer adapter that captures scheduled callbacks so a test can fire them. */
function makeCapturingTimers() {
  const intervals: Array<() => void> = [];
  const timeouts: Array<() => void> = [];
  let clears = 0;
  const timers = {
    setInterval: (cb: () => void) => {
      intervals.push(cb);
      return intervals.length;
    },
    clearInterval: () => {
      clears++;
    },
    setTimeout: (cb: () => void) => {
      timeouts.push(cb);
      return timeouts.length;
    },
    clearTimeout: () => {
      clears++;
    },
    delay: () => Promise.resolve(),
  } as never;
  return { timers, intervals, timeouts, clears: () => clears };
}

describe("RateLimiter", () => {
  it("should allow calls within limits", () => {
    const rl = new RateLimiter(mockLog, mockTimers, 5, 100);
    expect(rl.canMakeCall()).toBe(true);
  });

  it("should track daily usage", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 10, 100);
    let called = 0;

    await rl.tryExecute(async () => {
      called++;
    });
    await rl.tryExecute(async () => {
      called++;
    });
    await rl.tryExecute(async () => {
      called++;
    });

    expect(called).toBe(3);
    expect(rl.getUsageSnapshot().usedToday).toBe(3);
  });

  it("should queue calls when minute limit exceeded", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 2, 100);
    let called = 0;

    await rl.tryExecute(async () => {
      called++;
    }); // 1 — ok
    await rl.tryExecute(async () => {
      called++;
    }); // 2 — ok
    const queued = await rl.tryExecute(async () => {
      called++;
    }); // 3 — queued

    expect(called).toBe(2);
    expect(queued).toBe(false);
  });

  it("should respect daily limit", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 100, 2);
    let called = 0;

    await rl.tryExecute(async () => {
      called++;
    }); // ok
    await rl.tryExecute(async () => {
      called++;
    }); // ok
    const queued = await rl.tryExecute(async () => {
      called++;
    }); // queued

    expect(called).toBe(2);
    expect(queued).toBe(false);
    expect(rl.getUsageSnapshot().usedToday).toBe(2);
  });

  it("should enqueue with priority sorting", () => {
    const rl = new RateLimiter(mockLog, mockTimers, 0, 100); // minute limit 0 = all queued
    const order: number[] = [];

    rl.enqueue(async () => {
      order.push(2);
    }, 2); // low priority
    rl.enqueue(async () => {
      order.push(0);
    }, 0); // high priority
    rl.enqueue(async () => {
      order.push(1);
    }, 1); // medium priority

    // Access internal queue to verify order
    const queue = (rl as any).queue;
    expect(queue).toHaveLength(3);
    expect(queue[0].priority).toBe(0);
    expect(queue[1].priority).toBe(1);
    expect(queue[2].priority).toBe(2);
  });

  it("should clear queue on stop", () => {
    const rl = new RateLimiter(mockLog, mockTimers, 0, 100);

    rl.enqueue(async () => {}, 1);
    rl.enqueue(async () => {}, 2);
    expect((rl as any).queue).toHaveLength(2);

    rl.stop();
    expect((rl as any).queue).toHaveLength(0);
  });

  it("should return true when executed immediately", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 10, 100);
    const result = await rl.tryExecute(async () => {});
    expect(result).toBe(true);
  });

  it("should track both minute and daily counters", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 5, 100);

    await rl.tryExecute(async () => {});
    await rl.tryExecute(async () => {});

    expect((rl as any).callsThisMinute).toBe(2);
    expect(rl.getUsageSnapshot().usedToday).toBe(2);
  });

  it("should block when both limits are independently exceeded", async () => {
    // Daily limit reached first
    const rl = new RateLimiter(mockLog, mockTimers, 100, 1);
    await rl.tryExecute(async () => {});
    expect(rl.canMakeCall()).toBe(false);
  });
});

describe("RateLimiter — timer-driven behaviour", () => {
  it("schedules the reset + process timers on start and clears them on stop", () => {
    const t = makeCapturingTimers();
    const rl = new RateLimiter(mockLog, t.timers, 5, 100);
    rl.start();
    expect(t.intervals).toHaveLength(2); // minute-reset (60s) + queue-process (2s)
    expect(t.timeouts).toHaveLength(1); // day-reset kickoff (aligned to UTC midnight)
    rl.stop();
    expect(t.clears()).toBeGreaterThanOrEqual(3); // both intervals + the kickoff timeout
  });

  it("drains the queue when the minute counter resets", async () => {
    const t = makeCapturingTimers();
    const rl = new RateLimiter(mockLog, t.timers, 1, 100);
    rl.start();
    let ran = 0;
    const inc = async (): Promise<void> => {
      ran++;
    };
    await rl.tryExecute(inc); // 1 — immediate
    await rl.tryExecute(inc); // 2 — queued (minute limit 1)
    expect(ran).toBe(1);
    t.intervals[0](); // fire minute-reset → counter 0 + processQueue drains the queue
    await Promise.resolve();
    expect(ran).toBe(2);
  });

  it("daily kickoff zeroes the counter and installs the recurring 24h interval", () => {
    const t = makeCapturingTimers();
    const rl = new RateLimiter(mockLog, t.timers, 100, 100);
    rl.start();
    (rl as any).callsToday = 42;
    expect(t.intervals).toHaveLength(2);
    t.timeouts[0](); // fire the day-reset kickoff
    expect((rl as any).callsToday).toBe(0);
    expect(t.intervals).toHaveLength(3); // + the recurring 24h reset interval
  });

  it("does NOT install the 24h interval if stopped before the kickoff fires (leak guard)", () => {
    const t = makeCapturingTimers();
    const rl = new RateLimiter(mockLog, t.timers, 100, 100);
    rl.start();
    rl.stop();
    t.timeouts[0](); // stale kickoff fires after stop
    expect(t.intervals).toHaveLength(2); // no 3rd recurring interval — the stopped-guard held
  });

  it("processQueue is a no-op after stop (and the queue is cleared)", async () => {
    const t = makeCapturingTimers();
    const rl = new RateLimiter(mockLog, t.timers, 0, 100); // limit 0 → everything queues
    let ran = 0;
    rl.enqueue(async () => {
      ran++;
    });
    rl.start();
    rl.stop();
    t.intervals.forEach(cb => cb());
    await Promise.resolve();
    expect(ran).toBe(0);
  });

  it("millisUntilNextUtcMidnight is within (0, 24h]", () => {
    const rl = new RateLimiter(mockLog, mockTimers, 5, 100);
    const ms = (rl as any).millisUntilNextUtcMidnight();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(86_400_000);
  });
});
