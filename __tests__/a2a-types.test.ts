import { isDataPart, isFilePart, isTextPart } from "../src/a2a/types";

describe("A2A type guards", () => {
  it("detects text parts", () => {
    expect(isTextPart({ kind: "text", text: "hi" })).toBe(true);
    expect(isTextPart({ kind: "data", data: {} })).toBe(false);
  });

  it("detects file parts", () => {
    expect(
      isFilePart({
        kind: "file",
        file: { uri: "https://example.com/file" },
      }),
    ).toBe(true);
    expect(isFilePart({ kind: "text", text: "nope" })).toBe(false);
  });

  it("detects data parts", () => {
    expect(isDataPart({ kind: "data", data: { foo: "bar" } })).toBe(true);
    expect(isDataPart({ kind: "file", file: { uri: "x" } })).toBe(false);
  });
});
