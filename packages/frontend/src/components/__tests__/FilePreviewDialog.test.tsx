import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreviewDialog } from "../FilePreviewDialog";

vi.mock("@/lib/api", () => ({
  getFile: vi.fn(),
  fetchFileBlob: vi.fn(),
  fetchFileVersions: vi.fn(),
}));

import { fetchFileBlob, fetchFileVersions, getFile } from "@/lib/api";

const mockedGetFile = vi.mocked(getFile);
const mockedFetchBlob = vi.mocked(fetchFileBlob);
const mockedFetchVersions = vi.mocked(fetchFileVersions);

describe("FilePreviewDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn(),
      }),
    );
    mockedGetFile.mockReset();
    mockedFetchBlob.mockReset();
    mockedFetchVersions.mockReset();
  });

  it("renders file metadata after loading", async () => {
    mockedGetFile.mockResolvedValue({
      id: "f1",
      filename: "invoice.pdf",
      size: 2048,
      mimeType: "application/pdf",
      hash: "abcdef1234567890",
      status: "APPROVED",
      version: 1,
      isLatest: true,
      createdAt: "2026-08-01T00:00:00.000Z",
    } as never);
    mockedFetchBlob.mockResolvedValue(new Blob(["pdf"]));
    mockedFetchVersions.mockResolvedValue([]);

    render(
      <FilePreviewDialog open onOpenChange={() => undefined} fileId="f1" />,
    );

    await waitFor(() =>
      expect(screen.getByText("invoice.pdf")).toBeInTheDocument(),
    );
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("APPROVED")).toBeInTheDocument();
  });

  it("shows unsupported preview message for other mime types", async () => {
    mockedGetFile.mockResolvedValue({
      id: "f2",
      filename: "notes.doc",
      size: 1024,
      mimeType: "application/msword",
      hash: "abcd",
      status: "PENDING",
      version: 1,
      isLatest: true,
      createdAt: "2026-08-01T00:00:00.000Z",
    } as never);
    mockedFetchBlob.mockResolvedValue(new Blob(["doc"]));
    mockedFetchVersions.mockResolvedValue([]);

    render(
      <FilePreviewDialog open onOpenChange={() => undefined} fileId="f2" />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("该文件类型不支持预览"),
      ).toBeInTheDocument(),
    );
  });
});
