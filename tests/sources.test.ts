import { describe, expect, it } from "vitest";
import { isAllowedSourceUrl, normalizeSourceUrl } from "@/lib/hosts";
import { creditLabel, parseChannel } from "@/lib/sources";
import { authorFromInfo, isShortVideo } from "@/worker/vod";

describe("TikTok Live comme source", () => {
  it("reconnaît les liens et les pseudos TikTok", () => {
    expect(parseChannel("https://www.tiktok.com/@Jean.Dupont")).toMatchObject({ platform: "TIKTOK", login: "jean.dupont", url: "https://www.tiktok.com/@jean.dupont/live" });
    expect(parseChannel("tiktok.com/@gta_fan/live")).toMatchObject({ platform: "TIKTOK", login: "gta_fan" });
    expect(parseChannel("@jean.dupont", "TIKTOK")).toMatchObject({ platform: "TIKTOK", login: "jean.dupont", displayName: "@jean.dupont" });
    expect(parseChannel("pseudo", "TIKTOK")?.platform).toBe("TIKTOK");
    // Une vidéo n'est pas une chaîne
    expect(parseChannel("https://www.tiktok.com/@x/video/123")).toBeNull();
    expect(parseChannel("https://www.tiktok.com/foryou")).toBeNull();
  });
  it("crédite tiktok.com/@pseudo", () => {
    expect(creditLabel("TIKTOK", "gta_fan", "@gta_fan")).toBe("tiktok.com/@gta_fan");
  });
  it("le plugin streamlink tiktok accepte l'URL produite", () => {
    // Motif recopié du plugin streamlink 8.6.3 (src/streamlink/plugins/tiktok.py)
    const pattern = /https?:\/\/(?:www\.)?tiktok\.com\/@(?<channel>[^/?]+)(?:$|\/live)/;
    expect(pattern.test(parseChannel("@abc", "TIKTOK")!.url)).toBe(true);
  });
});

describe("import de clips existants", () => {
  it("accepte les liens de clips des quatre plateformes", () => {
    for (const url of [
      "https://clips.twitch.tv/FunnyClipSlug-abc",
      "https://www.twitch.tv/pseudo/clip/FunnyClipSlug-abc",
      "https://kick.com/pseudo/clips/clip_01ABC",
      "https://kick.com/pseudo?clip=clip_01ABC",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.tiktok.com/@pseudo/video/7300000000000000000",
      "https://vm.tiktok.com/ZMabc123/",
      "https://vt.tiktok.com/ZSabc123/",
    ]) {
      expect(isAllowedSourceUrl(url), url).toBe(true);
    }
  });
  it("garde la porte fermée au réseau interne", () => {
    expect(isAllowedSourceUrl("https://tiktok.com.evil.com/x")).toBe(false);
    expect(isAllowedSourceUrl("https://eviltiktok.com/x")).toBe(false);
    expect(isAllowedSourceUrl("http://www.tiktok.com/@x/video/1")).toBe(false); // https obligatoire
    expect(isAllowedSourceUrl("https://www.tiktok.com:8443/@x/video/1")).toBe(false); // pas de port
    expect(isAllowedSourceUrl("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedSourceUrl("https://[::1]/x")).toBe(false);
  });
  it("normalise les liens TikTok pour l'extracteur yt-dlp", () => {
    expect(normalizeSourceUrl("https://tiktok.com/@a/video/123?is_from_webapp=1")).toBe("https://www.tiktok.com/@a/video/123");
    expect(normalizeSourceUrl("https://m.youtube.com/shorts/x")).toBe("https://www.youtube.com/shorts/x");
    expect(normalizeSourceUrl("https://clips.twitch.tv/abc")).toBe("https://clips.twitch.tv/abc");
  });
  it("distingue un clip court d'un replay", () => {
    expect(isShortVideo(45, {})).toBe(true);
    expect(isShortVideo(150, {})).toBe(true);
    expect(isShortVideo(151, {})).toBe(false);
    expect(isShortVideo(3 * 3600, {})).toBe(false);
    expect(isShortVideo(undefined, {})).toBe(false);
    expect(isShortVideo(60, { startSec: 10 })).toBe(false); // plage demandée = analyse
  });
  it("crédite l'auteur d'origine", () => {
    expect(authorFromInfo({ extractor_key: "TikTok", uploader: "gta_fan", channel: "GTA Fan 🔥" })).toBe("tiktok.com/@gta_fan");
    expect(authorFromInfo({ extractor_key: "TwitchClips", channel: "Squeezie", uploader: "un_clippeur" })).toBe("Squeezie");
    expect(authorFromInfo({ extractor_key: "Youtube", uploader: "Chaîne" })).toBe("Chaîne");
  });
});
