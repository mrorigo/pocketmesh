jest.mock("@a2a-js/sdk/client", () => {
  const fromCardUrl = jest.fn();
  return {
    A2AClient: {
      fromCardUrl,
    },
  };
});

import { createA2AClient } from "../src/a2a/client";
import { A2AClient } from "@a2a-js/sdk/client";

describe("createA2AClient", () => {
  it("delegates to the SDK factory", async () => {
    const customFetch = jest.fn();
    (A2AClient.fromCardUrl as jest.Mock).mockResolvedValueOnce("client");
    const result = await createA2AClient("https://agent", { fetchImpl: customFetch });
    expect(A2AClient.fromCardUrl).toHaveBeenCalledWith("https://agent", {
      fetchImpl: customFetch,
    });
    expect(result).toBe("client");
  });
});
