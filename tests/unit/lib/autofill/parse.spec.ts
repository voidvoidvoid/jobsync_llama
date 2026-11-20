import { describe, it, expect } from "vitest";
import { parseAutofillReply } from "@/lib/autofill/parse";

describe("parseAutofillReply", () => {
  it("reads the answers past thinking and fences", () => {
    const r = parseAutofillReply(
      '<think>hmm {not json}</think>```json\n{"answers":[{"id":"0:f1","value":"Berlin","confidence":"high"},{"id":"0:f2","value":["A"],"confidence":"odd"}]}\n```',
    );
    expect(r.get("0:f1")).toEqual({ value: "Berlin", confidence: "high" });
    expect(r.get("0:f2")).toEqual({ value: ["A"], confidence: "medium" });
  });

  it("accepts a bare array and survives garbage", () => {
    expect(parseAutofillReply('[{"id":"x","value":"y"}]').get("x")?.value).toBe("y");
    expect(parseAutofillReply("sorry, I cannot").size).toBe(0);
    expect(parseAutofillReply("{broken").size).toBe(0);
  });
});
