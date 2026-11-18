/** OS 금지 특수문자를 '_'로 치환합니다. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'download';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFileName(fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, fileName: string, mime = 'application/json;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}
