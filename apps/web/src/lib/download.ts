import type { FileResponse } from "@pako/shared";

// Saves a server-built file (xlsx/pdf/zip) the generated client returned as a FileResponse.
export function downloadFileResponse(file: FileResponse, fallbackFileName: string): void {
  const url = URL.createObjectURL(file.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName ?? fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
