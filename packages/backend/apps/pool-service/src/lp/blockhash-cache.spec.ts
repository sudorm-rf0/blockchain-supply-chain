import { getCachedBlockhash } from "./blockhash-cache";

describe("pool getCachedBlockhash", () => {
  it("caches and refreshes", async () => {
    const connection = {
      getLatestBlockhash: jest
        .fn()
        .mockResolvedValueOnce({ blockhash: "p1", lastValidBlockHeight: 1 })
        .mockResolvedValueOnce({ blockhash: "p2", lastValidBlockHeight: 2 }),
    } as unknown as { getLatestBlockhash: jest.Mock };

    const first = await getCachedBlockhash(connection, 1_000);
    const cached = await getCachedBlockhash(connection, 1_000);
    expect(first.blockhash).toBe("p1");
    expect(cached.blockhash).toBe("p1");
    expect(connection.getLatestBlockhash).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const refreshed = await getCachedBlockhash(connection, 0);
    expect(refreshed.blockhash).toBe("p2");
    expect(connection.getLatestBlockhash).toHaveBeenCalledTimes(2);
  });
});
