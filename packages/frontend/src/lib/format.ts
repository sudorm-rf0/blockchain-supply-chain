export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}
