import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadEnvFile } from "../src/config.js";

const valid = { MEALIE_URL: "http://mealie:9000/", MEALIE_TOKEN: "abc", TZ: "America/Chicago" };

describe("loadConfig", () => {
  it("reads a minimal valid config with defaults", () => {
    const c = loadConfig(valid);
    expect(c.mealieUrl).toBe("http://mealie:9000");
    expect(c.port).toBe(8080);
    expect(c.anthropicApiKey).toBeUndefined();
    expect(c.appPasscode).toBeUndefined();
    expect(c.planStart).toBe("today");
    expect(c.leftovers).toBe(true);
    expect(c.busyDays).toEqual([]);
  });

  it("treats empty values as unset", () => {
    const c = loadConfig({ ...valid, ANTHROPIC_API_KEY: "", APP_PASSCODE: "  ", BUSY_DAYS: "" });
    expect(c.anthropicApiKey).toBeUndefined();
    expect(c.appPasscode).toBeUndefined();
  });

  it("parses planner options", () => {
    const c = loadConfig({ ...valid, BUSY_DAYS: "Tue, thursday", PLAN_START: "Monday", LEFTOVERS: "false", STAPLES: "Salt, Rice" });
    expect(c.busyDays).toEqual([2, 4]);
    expect(c.planStart).toBe("monday");
    expect(c.leftovers).toBe(false);
    expect(c.staples).toEqual(["salt", "rice"]);
  });

  it("reports every problem at once", () => {
    try {
      loadConfig({ MEALIE_URL: "mealie:9000", TZ: "Mars/Olympus", PLAN_START: "someday", BUSY_DAYS: "tue,funday", PORT: "99999" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      for (const name of ["MEALIE_URL", "MEALIE_TOKEN", "TZ", "PLAN_START", "BUSY_DAYS", "PORT"]) expect(msg).toContain(name);
    }
  });
});

describe("loadEnvFile", () => {
  it("loads a .env file without overriding variables already set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dishdeck-"));
    const file = path.join(dir, "test.env");
    fs.writeFileSync(file, "DISHDECK_TEST_A=from-file\nDISHDECK_TEST_B=from-file\n");
    process.env.DISHDECK_TEST_B = "from-env";
    expect(loadEnvFile({ ENV_FILE: file })).toBe(file);
    expect(process.env.DISHDECK_TEST_A).toBe("from-file");
    expect(process.env.DISHDECK_TEST_B).toBe("from-env");
    delete process.env.DISHDECK_TEST_A;
    delete process.env.DISHDECK_TEST_B;
  });

  it("returns undefined when there is no file", () => {
    expect(loadEnvFile({ ENV_FILE: "/nonexistent/.env" })).toBeUndefined();
  });
});
