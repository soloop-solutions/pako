import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_MAX_SIZE_BYTES,
  formatAttachmentSize,
  isImageAttachmentType,
  validateAttachmentFile,
} from "@/lib/attachment-validation";

describe("validateAttachmentFile", () => {
  it("accepts an image within the size limit", () => {
    expect(validateAttachmentFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("accepts a PDF within the size limit", () => {
    expect(validateAttachmentFile({ type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("rejects an unsupported type", () => {
    expect(validateAttachmentFile({ type: "text/plain", size: 1024 })).toBe("unsupported-type");
  });

  it("rejects a file over the size limit", () => {
    expect(validateAttachmentFile({ type: "image/png", size: ATTACHMENT_MAX_SIZE_BYTES + 1 })).toBe("too-large");
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateAttachmentFile({ type: "image/png", size: ATTACHMENT_MAX_SIZE_BYTES })).toBeNull();
  });
});

describe("isImageAttachmentType", () => {
  it("recognizes image content types", () => {
    expect(isImageAttachmentType("image/png")).toBe(true);
    expect(isImageAttachmentType("image/jpeg")).toBe(true);
  });

  it("does not treat a PDF as an image", () => {
    expect(isImageAttachmentType("application/pdf")).toBe(false);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
