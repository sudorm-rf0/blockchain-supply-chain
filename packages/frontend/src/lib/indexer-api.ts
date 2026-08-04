import { INDEXER_API_URL } from "./env";
import { request } from "./http";
import type { IndexerStatus } from "./types";

export { IndexerStatus };

export async function fetchIndexerStatus(): Promise<IndexerStatus> {
  return request(`${INDEXER_API_URL}/api/indexer/status`, { cache: "no-store" });
}
