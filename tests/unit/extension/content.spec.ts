// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { scanDocument, cleanLabel } from "../../../extension/src/content/extract";
import { applyValue, clearHighlights, highlight, readValue } from "../../../extension/src/content/apply";

function form(html: string) {
  document.body.innerHTML = html;
  const handles = scanDocument(document);
  return { handles, byLabel: (l: string) => handles.find((h) => h.field.label === l)! };
}

describe("scanDocument", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads labels from for=, wrapping labels, aria and nearby text", () => {
    const { handles } = form(`
      <form>
        <label for="fn">First Name <span>*</span></label><input id="fn" name="first_name" required>
        <label>Email <input type="email" name="email"></label>
        <input aria-label="Phone" type="tel">
        <span id="lk">LinkedIn Profile</span><input aria-labelledby="lk">
        <div class="field"><div class="label">Current company</div><div><input name="q1"></div></div>
        <input placeholder="City">
        <textarea name="why" maxlength="500" aria-label="Why us?"></textarea>
        <input type="hidden" name="token" value="x">
        <input type="submit" value="Apply">
        <input type="search" aria-label="Search jobs">
        <div style="display:none"><input aria-label="Hidden question"></div>
      </form>`);
    expect(handles.map((h) => [h.field.label, h.field.type])).toEqual([
      ["First Name", "text"],
      ["Email", "email"],
      ["Phone", "tel"],
      ["LinkedIn Profile", "text"],
      ["Current company", "text"],
      ["City", "text"],
      ["Why us?", "textarea"],
    ]);
    expect(handles[0].field).toMatchObject({ required: true, name: "first_name", hasValue: false });
    expect(handles[6].field.maxLength).toBe(500);
  });

  it("groups radios and checkboxes under their question, with options", () => {
    const { handles } = form(`
      <fieldset><legend>Do you require sponsorship? *</legend>
        <label><input type="radio" name="sp" value="1"> Yes</label>
        <label><input type="radio" name="sp" value="0"> No</label>
      </fieldset>
      <div><p>Languages</p><div>
        <input type="checkbox" name="lang" id="l1"><label for="l1">Python</label>
        <input type="checkbox" name="lang" id="l2"><label for="l2">Go</label>
      </div></div>
      <label><input type="checkbox" name="agree"> I agree to the privacy policy</label>`);
    expect(handles.map((h) => h.field)).toEqual([
      expect.objectContaining({ label: "Do you require sponsorship?", type: "radio", options: ["Yes", "No"], required: true }),
      expect.objectContaining({ label: "Languages", type: "checkbox-group", options: ["Python", "Go"] }),
      expect.objectContaining({ label: "I agree to the privacy policy", type: "checkbox" }),
    ]);
  });

  it("lists real select options and notices values already there", () => {
    const { handles } = form(`
      <label for="c">Country</label>
      <select id="c"><option value="">Select...</option><option value="ca">Canada</option><option value="de" selected>Germany</option></select>
      <label for="n">Name</label><input id="n" value="Tom">`);
    expect(handles[0].field).toMatchObject({ type: "select", options: ["Canada", "Germany"], hasValue: true });
    expect(handles[1].field.hasValue).toBe(true);
  });

  it("keeps hidden upload inputs and comboboxes", () => {
    const { handles } = form(`
      <div><label for="r">Resume/CV</label><button>Attach</button><input type="file" id="r" style="display:none" accept=".pdf"></div>
      <div><label id="loc">Location</label><input role="combobox" aria-labelledby="loc" aria-controls="lb"></div>`);
    expect(handles.map((h) => [h.field.label, h.field.type])).toEqual([
      ["Resume/CV", "file"],
      ["Location", "combobox"],
    ]);
    expect(handles[0].field.accept).toBe(".pdf");
  });

  it("cleans required markers from labels", () => {
    expect(cleanLabel("  Email  *  (required) ")).toBe("Email");
  });
});

describe("applyValue and readValue", () => {
  it("fills text, select, radio, checkbox and checkbox groups the way a user would", async () => {
    const seen: string[] = [];
    document.addEventListener("input", (e) => seen.push((e.target as HTMLElement).id || "?"), true);
    const { byLabel } = form(`
      <label for="t">Current company</label><input id="t">
      <label for="s">Country</label><select id="s"><option value="">Pick</option><option value="ca">Canada</option></select>
      <fieldset><legend>Relocate?</legend><label><input type="radio" name="r"> Yes</label><label><input type="radio" name="r"> No</label></fieldset>
      <label><input type="checkbox" name="ok"> I agree</label>
      <div><p>Languages</p><label><input type="checkbox" name="l"> Python</label><label><input type="checkbox" name="l"> Go</label></div>`);

    const results = await Promise.all([
      applyValue(byLabel("Current company"), "Acme", null),
      applyValue(byLabel("Country"), "canada", null),
      applyValue(byLabel("Relocate?"), "No", null),
      applyValue(byLabel("I agree"), "yes", null),
      applyValue(byLabel("Languages"), ["Go"], null),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(seen).toContain("t");

    expect(readValue(byLabel("Current company")).value).toBe("Acme");
    expect(readValue(byLabel("Country")).value).toBe("Canada");
    expect(readValue(byLabel("Relocate?")).value).toBe("No");
    expect(readValue(byLabel("I agree")).value).toBe("yes");
    expect(readValue(byLabel("Languages")).value).toEqual(["Go"]);
  });

  it("types into a combobox and picks the matching option from its list", async () => {
    const { byLabel } = form(`<label id="l">Location</label><input role="combobox" aria-labelledby="l" aria-controls="lb"><div id="lb"></div>`);
    const input = document.querySelector("input")!;
    let picked = "";
    input.addEventListener("input", () => {
      document.getElementById("lb")!.innerHTML =
        '<div role="option">Berlin, Germany</div><div role="option">Bern, Switzerland</div>';
      document.querySelectorAll("[role=option]").forEach((o) =>
        o.addEventListener("click", () => (picked = o.textContent ?? "")),
      );
    });
    const r = await applyValue(byLabel("Location"), "Berlin, Germany", null);
    expect(r.ok).toBe(true);
    expect(picked).toBe("Berlin, Germany");
  });

  it("reports an option it cannot find instead of guessing", async () => {
    const { byLabel } = form(`<label for="s">Country</label><select id="s"><option value="ca">Canada</option></select>`);
    expect(await applyValue(byLabel("Country"), "Mars", null)).toMatchObject({ ok: false });
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("ca");
  });

  it("goes through the prototype setter so React-style inputs see the change", async () => {
    const { byLabel } = form(`<label for="t">City</label><input id="t">`);
    const input = document.getElementById("t") as HTMLInputElement;
    let own = "";
    // A framework that tracks value on the instance, like React does
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => own,
      set: (v) => {
        own = `instance:${v}`;
      },
    });
    await applyValue(byLabel("City"), "Berlin", null);
    expect(own).toBe("");
  });

  it("outlines fields by source and restores them", () => {
    const { byLabel } = form(`<label for="t">City</label><input id="t" style="outline: 1px dotted blue">`);
    const el = document.getElementById("t") as HTMLInputElement;
    highlight(byLabel("City"), "ai");
    expect(el.style.outline).toContain("2px solid");
    clearHighlights(document);
    expect(el.style.outline).toBe("1px dotted blue");
  });
});
