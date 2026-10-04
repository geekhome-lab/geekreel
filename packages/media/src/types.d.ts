declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}

declare module "ffprobe-static" {
  const mod: { path: string | null };
  export default mod;
}
