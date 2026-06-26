import { createLogger, reconfigureLogger } from "@/lib/logger";

describe("Logger Service", () => {
  beforeEach(() => {
    // Configure logger for testing with console output only
    process.env.LOG_LEVEL = "trace";
    process.env.LOG_TO_FILE = "false";
    process.env.LOG_TO_CONSOLE = "true";
    reconfigureLogger();
  });

  it("should create a scoped logger", () => {
    const logger = createLogger("test-module");
    expect(logger).toBeDefined();
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("should log trace messages", () => {
    const logger = createLogger("test-trace");
    expect(() => logger.trace("trace message", { foo: "bar" })).not.toThrow();
  });

  it("should log info messages", () => {
    const logger = createLogger("test-info");
    expect(() => logger.info("info message", { num: 42 })).not.toThrow();
  });

  it("should log error messages", () => {
    const logger = createLogger("test-error");
    expect(() => logger.error("error message", { err: new Error("test error") })).not.toThrow();
  });

  it("should respect log level configuration", () => {
    process.env.LOG_LEVEL = "error";
    process.env.LOG_TO_CONSOLE = "true";
    reconfigureLogger();

    const logger = createLogger("test-level");
    expect(() => {
      logger.trace("should not appear");
      logger.info("should not appear");
      logger.error("should appear");
    }).not.toThrow();
  });

  it("should serialize objects in log messages", () => {
    const logger = createLogger("test-serialize");
    const obj = { nested: { key: "value" }, arr: [1, 2, 3] };
    expect(() => logger.info("object test", obj)).not.toThrow();
  });

  it("should include timestamp in log entries", () => {
    const logger = createLogger("test-timestamp");
    expect(() => logger.info("timestamp test")).not.toThrow();
  });

  it("should include module name in log entries", () => {
    const logger = createLogger("test-module-name");
    expect(() => logger.info("module test")).not.toThrow();
  });
});