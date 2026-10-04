import { expect, test } from "bun:test";
import { jwtHs256 } from "./video";

test("可灵 JWT 是三段 HS256", () => {
  const token = jwtHs256({ iss: "ak", exp: 100 }, "secret");
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  expect(payload.iss).toBe("ak");
});
