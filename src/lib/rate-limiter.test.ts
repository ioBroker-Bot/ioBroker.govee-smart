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
};

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
    expect(rl.dailyUsage).toBe(3);
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
    expect(rl.dailyUsage).toBe(2);
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
    expect(rl.dailyUsage).toBe(2);
  });

  it("should block when both limits are independently exceeded", async () => {
    // Daily limit reached first
    const rl = new RateLimiter(mockLog, mockTimers, 100, 1);
    await rl.tryExecute(async () => {});
    expect(rl.canMakeCall()).toBe(false);
  });

  it("should update limits dynamically", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 2, 100);
    let called = 0;

    await rl.tryExecute(async () => {
      called++;
    });
    await rl.tryExecute(async () => {
      called++;
    });
    expect(rl.canMakeCall()).toBe(false);

    // Increase limit — should allow more calls
    rl.updateLimits(4, 100);
    expect(rl.canMakeCall()).toBe(true);

    await rl.tryExecute(async () => {
      called++;
    });
    expect(called).toBe(3);
  });

  it("should reduce limits dynamically", async () => {
    const rl = new RateLimiter(mockLog, mockTimers, 10, 100);
    let called = 0;

    await rl.tryExecute(async () => {
      called++;
    });
    await rl.tryExecute(async () => {
      called++;
    });

    // Reduce to 2/min — should now be blocked
    rl.updateLimits(2, 100);
    expect(rl.canMakeCall()).toBe(false);
  });
});
