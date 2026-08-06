import { getCachedBlockhash } from "./blockhash-cache";

describe("getCachedBlockhash", () => {
  it("reuses the blockhash within the TTL window", async () => {
    const connection = {
      getLatestBlockhash: jest
        .fn()
        .mockResolvedValue({ blockhash: "b1", lastValidBlockHeight: 1 }),
    } as unknown as { getLatestBlockhash: jest.Mock };

    const first = await getCachedBlockhash(connection, 1_000);
    const second = await getCachedBlockhash(connection, 1_000);
    expect(first.blockhash).toBe("b1");
    expect(second.blockhash).toBe("b1");
    expect(connection.getLatestBlockhash).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the TTL expires", async () => {
    const connection = {
      getLatestBlockhash: jest
        .fn()
        .mockResolvedValueOnce({ blockhash: "b1", lastValidBlockHeight: 1 })
        .mockResolvedValueOnce({ blockhash: "b2", lastValidBlockHeight: 2 }),
    } as unknown as { getLatestBlockhash: jest.Mock };

    await getCachedBlockhash(connection, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const refreshed = await getCachedBlockhash(connection, 0);
    expect(refreshed.blockhash).toBe("b2");
    expect(connection.getLatestBlockhash).toHaveBeenCalledTimes(2);
  });
});
