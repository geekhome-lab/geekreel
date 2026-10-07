/**
 * 分镜镜头语言：景别、运镜、机位。没写就从画面推断，出图时写进提示词。
 */

import type { CameraAngle, CameraMove, DramaBible, DramaShot, ShotSize } from "@vw/core";
import { cameraAngleLabels, cameraMoveLabels, shotSizeLabels } from "@vw/core";

export function parseShotSize(raw: unknown): ShotSize | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ecu" || s.includes("大特写")) return "ecu";
  if (s === "cu" || s.includes("特写")) return "cu";
  if (s === "ms" || s.includes("中景")) return "ms";
  if (s === "fs" || s.includes("全景") || s.includes("全身")) return "fs";
  if (s === "els" || s.includes("大远景")) return "els";
  if (s === "ls" || s.includes("远景")) return "ls";
  return undefined;
}

export function parseCameraMove(raw: unknown): CameraMove | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "static" || s.includes("固定") || s.includes("静止")) return "static";
  if (s === "push" || s.includes("推进") || s.includes("推近")) return "push";
  if (s === "pull" || s.includes("拉远") || s.includes("拉开")) return "pull";
  if (s === "pan" || s.includes("横摇") || s.includes("摇镜")) return "pan";
  if (s === "tilt" || s.includes("俯仰")) return "tilt";
  if (s === "follow" || s.includes("跟随") || s.includes("跟上")) return "follow";
  if (s === "orbit" || s.includes("环绕")) return "orbit";
  return undefined;
}

export function parseCameraAngle(raw: unknown): CameraAngle | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "eye" || s.includes("平视")) return "eye";
  if (s === "high" || s.includes("俯拍") || s.includes("俯视")) return "high";
  if (s === "low" || s.includes("仰拍") || s.includes("仰视")) return "low";
  if (s === "over" || s.includes("过肩")) return "over";
  return undefined;
}

export function inferShotSize(text: string): ShotSize {
  if (/大特写|瞳孔|嘴唇|眼白/.test(text)) return "ecu";
  if (/特写|面部|脸部|手部/.test(text)) return "cu";
  if (/大远景|天际|全城|山河/.test(text)) return "els";
  if (/远景|空镜|远眺/.test(text)) return "ls";
  if (/全景|全身|门口|站在/.test(text)) return "fs";
  return "ms";
}

export function inferCameraMove(text: string): CameraMove {
  if (/推进|推近|走近|逼近/.test(text)) return "push";
  if (/拉远|拉开|退后/.test(text)) return "pull";
  if (/横摇|摇过|横扫/.test(text)) return "pan";
  if (/俯仰|抬头|低头/.test(text)) return "tilt";
  if (/跟随|追上|跟上|追着/.test(text)) return "follow";
  if (/环绕|绕着/.test(text)) return "orbit";
  return "static";
}

export function inferCameraAngle(text: string): CameraAngle {
  if (/俯拍|俯视|从上往下/.test(text)) return "high";
  if (/仰拍|仰视|从下往上/.test(text)) return "low";
  if (/过肩|肩后/.test(text)) return "over";
  return "eye";
}

export function applyShotLanguage(bible: DramaBible): DramaBible {
  return {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => fillShotLanguage(shot)),
    })),
  };
}

export function fillShotLanguage(shot: DramaShot): DramaShot {
  const hay = `${shot.visual}\n${shot.imagePrompt}\n${shot.line}`;
  return {
    ...shot,
    shotSize: shot.shotSize ?? parseShotSize(shot.shotSize) ?? inferShotSize(hay),
    cameraMove: shot.cameraMove ?? parseCameraMove(shot.cameraMove) ?? inferCameraMove(hay),
    angle: shot.angle ?? parseCameraAngle(shot.angle) ?? inferCameraAngle(hay),
  };
}

export function shotLanguageLine(shot?: Pick<DramaShot, "shotSize" | "cameraMove" | "angle"> | null): string {
  if (!shot?.shotSize && !shot?.cameraMove && !shot?.angle) return "";
  const size = shot.shotSize ? shotSizeLabels[shot.shotSize] : "中景";
  const move = shot.cameraMove ? cameraMoveLabels[shot.cameraMove] : "固定";
  const angle = shot.angle ? cameraAngleLabels[shot.angle] : "平视";
  return `镜头语言：${size}，${move}，${angle}。按这个景别和运镜拍，不要自己改成别的。`;
}
