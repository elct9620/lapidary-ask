import { describe, it, expect } from "vitest";
import app from "../src/app";

describe("GET /", () => {
  it("returns JSON health check response", async () => {
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
