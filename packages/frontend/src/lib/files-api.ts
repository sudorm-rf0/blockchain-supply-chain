import { BACKEND_URL } from "./env";
import { request, requestWithRetry } from "./http";
import type { FileRecord, FilesResponse } from "./types";

export { FileRecord, FilesResponse };

export async function uploadFile(
  formData: FormData,
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files`, {
    method: "POST",
    body: formData,
  });
}

export function uploadFileWithProgress(
  file: File,
  fields: { tradeId?: string; documentId?: string; description?: string },
  onProgress: (progress: { loaded: number; total: number; percent: number }) => void,
): Promise<FileRecord> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (fields.tradeId) form.append("tradeId", fields.tradeId);
    if (fields.documentId) form.append("documentId", fields.documentId);
    if (fields.description) form.append("description", fields.description);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/files`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileRecord);
        } catch {
          reject(new Error("上传响应解析失败"));
        }
        return;
      }
      let message = `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string | string[] };
        message = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message ?? message;
      } catch {
        // 保留 HTTP 状态作为错误信息。
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.send(form);
  });
}

export async function getFiles(params: {
  page: number;
  limit: number;
  status?: string;
  tradeId?: string;
}): Promise<FilesResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.status) query.set("status", params.status);
  if (params.tradeId) query.set("tradeId", params.tradeId);
  return request(`${BACKEND_URL}/api/files?${query.toString()}`);
}

export async function getFile(id: string): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`);
}

export async function fetchFileVersions(id: string): Promise<FileRecord[]> {
  return request(`${BACKEND_URL}/api/files/${id}/versions`);
}

export async function fetchFileBlob(id: string): Promise<Blob> {
  const response = await requestWithRetry(
    `${BACKEND_URL}/api/files/${id}/content`,
    {},
    {},
  );
  return response.blob();
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  return request(`${BACKEND_URL}/api/files/${id}?confirm=true`, {
    method: "DELETE",
  });
}

export async function reviewFile(
  id: string,
  body: { status: "APPROVED" | "REJECTED"; remark?: string },
): Promise<FileRecord> {
  return request(`${BACKEND_URL}/api/files/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, confirm: true }),
  });
}

export async function batchReviewFiles(
  ids: string[],
  body: { status: "APPROVED" | "REJECTED"; remark?: string },
): Promise<{ ok: boolean; updated: number; skipped: number }> {
  return request(`${BACKEND_URL}/api/files/batch-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, ...body, confirm: true }),
  });
}

export async function buildDocumentAttest(
  fileId: string,
  body: { walletAddress: string; tradeId?: string },
): Promise<{ transaction: string; blockhash: string; documentPda: string; message: string }> {
  return request(`${BACKEND_URL}/api/files/${fileId}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function confirmDocumentAttest(
  fileId: string,
  body: { txSignature: string; documentPda: string; tradeId?: string },
): Promise<{
  ok: boolean;
  txSignature: string | null;
  documentPda: string | null;
  attestedAt: string | null;
}> {
  return request(`${BACKEND_URL}/api/files/${fileId}/attest/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
