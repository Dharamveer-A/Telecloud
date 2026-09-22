import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, detectCountry } from "../src/lib/countries";

describe("Frontend Countries Utility", () => {
  it("should have a populated list of countries", () => {
    assert.ok(COUNTRIES.length > 30, "Countries list should contain at least 30 entries");
    for (const c of COUNTRIES) {
      assert.ok(c.name, "Country must have a name");
      assert.ok(c.code, "Country must have a 2-letter ISO code");
      assert.ok(c.dialCode.startsWith("+"), "Country dial code must start with +");
      assert.ok(c.flag, "Country must have a flag emoji");
    }
  });

  it("should find specific key countries by code", () => {
    const india = COUNTRIES.find((c) => c.code === "IN");
    assert.ok(india);
    assert.equal(india.dialCode, "+91");

    const us = COUNTRIES.find((c) => c.code === "US");
    assert.ok(us);
    assert.equal(us.dialCode, "+1");

    const uk = COUNTRIES.find((c) => c.code === "GB");
    assert.ok(uk);
    assert.equal(uk.dialCode, "+44");
  });

  it("detectCountry should return a valid Country object", () => {
    const detected = detectCountry();
    assert.ok(detected);
    assert.ok(detected.name);
    assert.ok(detected.code);
    assert.ok(detected.dialCode.startsWith("+"));
  });
});
