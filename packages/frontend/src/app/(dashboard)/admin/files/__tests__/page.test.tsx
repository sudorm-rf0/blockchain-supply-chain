import { Suspense } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminFilesPage from "../page";
import type { FileRecord, FilesResponse } from "@/lib/types";

const { getFilesMock, reviewFileMock, batchReviewMock, analyzeFileMock, getFileMock, toastSuccess, toastError, replaceMock } =
  vi.hoisted(() => ({
    getFilesMock: vi.fn(),
    reviewFileMock: vi.fn(),
    batchReviewMock: vi.fn(),
    analyzeFileMock: vi.fn(),
    getFileMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    replaceMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/lib/api", () => ({
  getFiles: (...args: unknown[]) => getFilesMock(...args),
  reviewFile: (...args: unknown[]) => reviewFileMock(...args),
  batchReviewFiles: (...args: unknown[]) => batchReviewMock(...args),
  analyzeFile: (...args: unknown[]) => analyzeFileMock(...args),
  getFile: (...args: unknown[]) => getFileMock(...args),
}));

vi.mock("@/components/FilePreviewDialog", () => ({
  FilePreviewDialog: () => <div data-testid="file-preview" />,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

function makeFiles(overrides: Partial<FileRecord>[] = []): FilesResponse {
  const items: FileRecord[] = [
    {
      id: "f1",
      filename: "invoice-v1.pdf",
      size: 1024,
      mimeType: "application/pdf",
      path: "/uploads/f1.pdf",
      hash: "abc",
      status: "PENDING",
      uploaderName: "张三",
      createdAt: "2026-08-06T10:00:00.000Z",
      ...overrides[0],
    },
    {
      id: "f2",
      filename: "waybill.png",
      size: 2048,
      mimeType: "image/png",
      path: "/uploads/f2.png",
      hash: "def",
      status: "PENDING",
      uploaderName: "李四",
      createdAt: "2026-08-06T11:00:00.000Z",
      ...overrides[1],
    },
  ];
  return { items, total: items.length, page: 1, limit: 10 };
}

async function renderPage(status = "PENDING"): Promise<void> {
  // Next 15 用 use(Promise) 读 searchParams：组件会 suspend，需在 await act 内渲染。
  await act(async () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <AdminFilesPage searchParams={Promise.resolve({ status })} />
      </Suspense>,
    );
  });
}

describe("AdminFilesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFilesMock.mockResolvedValue(makeFiles());
    reviewFileMock.mockResolvedValue({ ok: true });
    batchReviewMock.mockResolvedValue({ ok: true, updated: 2, skipped: 0 });
    analyzeFileMock.mockResolvedValue({ ok: true });
    getFileMock.mockResolvedValue(makeFiles().items[0]);
  });

  it("renders the file list with uploader names", async () => {
    await renderPage();
    expect(await screen.findByText("invoice-v1.pdf")).toBeTruthy();
    expect(screen.getByText("waybill.png")).toBeTruthy();
  });

  it("approves a file after confirmation", async () => {
    await renderPage();
    await screen.findByText("invoice-v1.pdf");

    fireEvent.click(screen.getAllByRole("button", { name: /通过/ })[0]);
    expect(await screen.findByText("确认审核通过？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /确认通过/ }));

    await waitFor(() => {
      expect(reviewFileMock).toHaveBeenCalledWith("f1", { status: "APPROVED" });
    });
    expect(toastSuccess).toHaveBeenCalledWith("审核通过");
  });

  it("shows an error toast when approval fails", async () => {
    reviewFileMock.mockRejectedValue(new Error("db down"));
    await renderPage();
    await screen.findByText("invoice-v1.pdf");

    fireEvent.click(screen.getAllByRole("button", { name: /通过/ })[0]);
    await screen.findByText("确认审核通过？");
    fireEvent.click(screen.getByRole("button", { name: /确认通过/ }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("db down");
    });
  });

  it("loads ALL files when the URL status is ALL (sidebar 全部文件)", async () => {
    await renderPage("ALL");
    await screen.findByText("invoice-v1.pdf");
    expect(getFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  it("reloads the list when the URL status changes (sidebar navigation)", async () => {
    const view = await act(async () =>
      render(
        <Suspense fallback={<div>loading</div>}>
          <AdminFilesPage searchParams={Promise.resolve({ status: "PENDING" })} />
        </Suspense>,
      ),
    );
    await screen.findByText("invoice-v1.pdf");
    getFilesMock.mockClear();

    await act(async () => {
      view.rerender(
        <Suspense fallback={<div>loading</div>}>
          <AdminFilesPage searchParams={Promise.resolve({ status: "ALL" })} />
        </Suspense>,
      );
    });
    await waitFor(() => {
      expect(getFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined }),
      );
    });
  });

  it("re-analyze refreshes the file record without crashing the list", async () => {
    await renderPage();
    await screen.findByText("invoice-v1.pdf");

    fireEvent.click(screen.getAllByRole("button", { name: /重新分析/ })[0]);

    await waitFor(() => {
      expect(analyzeFileMock).toHaveBeenCalledWith("f1");
      expect(getFileMock).toHaveBeenCalledWith("f1");
    });
    // 列表仍正常渲染 hash（此前会把分析结果误当 FileRecord 导致 undefined.slice 崩溃）
    expect(screen.getByText("abc")).toBeTruthy();
  });
});
