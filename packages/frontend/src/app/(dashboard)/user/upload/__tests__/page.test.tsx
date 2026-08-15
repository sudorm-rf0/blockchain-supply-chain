import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import UploadPage from "../page";

const { uploadMock, toastSuccess, toastError, dropzoneState } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  dropzoneState: { onDrop: vi.fn() as (files: File[]) => void },
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: false,
    connecting: false,
    publicKey: null,
    disconnect: vi.fn(),
  }),
}));

vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: vi.fn() }),
}));

vi.mock("@/hooks/useWalletContext", () => ({
  useWalletContext: () => ({
    connection: null,
    connected: false,
    publicKey: null,
    sendTransaction: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  uploadFileWithProgress: (...args: unknown[]) => uploadMock(...args),
  buildDocumentAttest: vi.fn(),
  confirmDocumentAttest: vi.fn(),
}));

vi.mock("react-dropzone", () => ({
  useDropzone: (opts: { onDrop: (files: File[]) => void }) => {
    dropzoneState.onDrop = opts.onDrop;
    return {
      getRootProps: () => ({}),
      getInputProps: () => ({ type: "file" }),
      isDragActive: false,
      open: vi.fn(),
    };
  },
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

function makePngFile(name = "invoice.png"): File {
  return new File(["fake-png"], name, { type: "image/png" });
}

function dropFiles(files: File[]): void {
  act(() => {
    dropzoneState.onDrop(files);
  });
}

function clickUploadAll(): void {
  fireEvent.click(screen.getByRole("button", { name: /全部上传/ }));
}

describe("UploadPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    uploadMock.mockImplementation((file: File) =>
      Promise.resolve({
        id: `id-${file.name}`,
        hash: `hash-${file.name}`,
        version: 1,
      }),
    );
  });

  it("renders the upload form", () => {
    render(<UploadPage />);
    expect(screen.getAllByText("上传文件").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /全部上传/ })).toBeTruthy();
  });

  it("disables upload-all button when no file is selected", () => {
    render(<UploadPage />);
    expect(screen.getByRole("button", { name: /全部上传/ })).toBeDisabled();
  });

  it("uploads a single selected file and shows hash in the result list", async () => {
    render(<UploadPage />);
    dropFiles([makePngFile()]);
    // 拖拽框显示已选择数量
    expect(screen.getByText("已选择 1 个文件，可预览")).toBeTruthy();
    clickUploadAll();

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(1);
    });
    expect(uploadMock.mock.calls[0][0].name).toBe("invoice.png");
    // 拖拽框内成功统计 + 列表显示文件名与哈希
    expect(screen.getByText(/上传成功 1 个文件/)).toBeTruthy();
    expect(screen.getByText("invoice.png")).toBeTruthy();
    expect(screen.getByText("文件哈希：hash-invoice.png（版本 v1）")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("上传成功");
  });

  it("uploads multiple files in one batch, each with its own hash", async () => {
    render(<UploadPage />);
    dropFiles([makePngFile("a.png"), makePngFile("b.pdf")]);
    expect(screen.getByText("已选择 2 个文件，可预览")).toBeTruthy();
    clickUploadAll();

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(/上传成功 2 个文件/)).toBeTruthy();
    expect(screen.getByText("a.png")).toBeTruthy();
    expect(screen.getByText("b.pdf")).toBeTruthy();
    expect(screen.getByText("文件哈希：hash-a.png（版本 v1）")).toBeTruthy();
    expect(screen.getByText("文件哈希：hash-b.pdf（版本 v1）")).toBeTruthy();
  });

  it("shows inline failure for failed files and keeps successes", async () => {
    uploadMock.mockImplementation((file: File) =>
      file.name === "bad.pdf"
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ id: `id-${file.name}`, hash: `hash-${file.name}`, version: 1 }),
    );
    render(<UploadPage />);
    dropFiles([makePngFile("good.png"), new File(["x"], "bad.pdf", { type: "application/pdf" })]);
    clickUploadAll();

    await waitFor(() => {
      expect(screen.getByText(/1 个文件上传失败/)).toBeTruthy();
    });
    expect(screen.getByText("good.png")).toBeTruthy();
    expect(screen.getByText("bad.pdf")).toBeTruthy();
    expect(screen.getByText(/上传失败：network down/)).toBeTruthy();
    // 成功那个仍有哈希
    expect(screen.getByText("文件哈希：hash-good.png（版本 v1）")).toBeTruthy();
  });

  it("lets user remove a pending file from the list", async () => {
    render(<UploadPage />);
    dropFiles([makePngFile("remove-me.png")]);
    expect(screen.getByText("remove-me.png")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("移除该文件"));
    expect(screen.queryByText("remove-me.png")).toBeNull();
  });
});
