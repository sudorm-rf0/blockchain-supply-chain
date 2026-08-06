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

function makePngFile(): File {
  return new File(["fake-png"], "invoice.png", { type: "image/png" });
}

function dropFile(file: File): void {
  act(() => {
    dropzoneState.onDrop([file]);
  });
}

describe("UploadPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    uploadMock.mockResolvedValue({ id: "f1", hash: "abc123", version: 1 });
  });

  it("renders the upload form", () => {
    render(<UploadPage />);
    expect(screen.getAllByText("上传文件").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /上传文件/ })).toBeTruthy();
  });

  it("warns when submitting without a file", () => {
    render(<UploadPage />);
    fireEvent.click(screen.getByRole("button", { name: /上传文件/ }));
    expect(toastError).toHaveBeenCalledWith("请先选择文件");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("uploads a selected file and shows success", async () => {
    render(<UploadPage />);
    dropFile(makePngFile());
    fireEvent.click(screen.getByRole("button", { name: /上传文件/ }));

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(1);
    });
    expect(uploadMock.mock.calls[0][0].name).toBe("invoice.png");
    expect(toastSuccess).toHaveBeenCalledWith("上传成功");
  });

  it("shows an error toast when upload fails", async () => {
    uploadMock.mockRejectedValue(new Error("network down"));
    render(<UploadPage />);
    dropFile(makePngFile());
    fireEvent.click(screen.getByRole("button", { name: /上传文件/ }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("network down");
    });
  });
});
