/** 本机 / 局域网地址：Ollama、LM Studio、ComfyUI、vLLM 这类，没有渠道报价。 */

export function isLocalBaseUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  let host = "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return /localhost|127\.0\.0\.1|::1/.test(raw);
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function localZeroPrices(capability: string): Record<string, string> {
  if (capability === "llm") return { priceInput: "0", priceOutput: "0" };
  if (capability === "image") return { priceImage: "0" };
  if (capability === "video") return { priceVideo: "0" };
  if (capability === "tts") return { priceTts: "0" };
  return {};
}

export function originRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
