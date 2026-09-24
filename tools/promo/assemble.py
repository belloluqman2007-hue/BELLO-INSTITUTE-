#!/usr/bin/env python3
"""
EduSphere promo — final assembly (segmented, memory-safe).

Renders each scene as its own bounded-memory MP4, concatenates them, then
mixes the full audio (narration placed per scene, original score
sidechain-ducked under the voice, SFX at editorial beats) in a light
second pass, and normalises to -16 LUFS.

Outputs in tools/promo/dist/:
  edusphere-promo.mp4         1080p master (H.264 + AAC, faststart)
  edusphere-promo-720p.mp4    720p web variant
  edusphere-promo.vtt / .srt  caption tracks (sentence-level)
  promo-meta.json             duration & scene map for the website
"""
import json, os, subprocess, sys, re

ROOT = "/home/user/EduSphere-Education-Management-Platform/tools/promo"
FF = "/home/user/video-tools/bin/ffmpeg"
A = "/home/user/video-tools/assets"
FPS = 30
SEG = f"{A}/segments"

plan = json.load(open(f"{A}/scenes.json"))
X = plan["xfade"]
total = plan["total"]
missing = plan["missing_narration"]
preview_only = bool(missing)
os.makedirs(SEG, exist_ok=True)

# ---------------------------------------------------------------- scenes
def render_scene(sc):
    sid = sc["scene"]
    out = f"{SEG}/scene-{sid:02d}.mp4"
    inputs, fils, labels = [], [], []
    for i, p in enumerate(sc["plates"]):
        inputs += ["-loop", "1", "-framerate", str(FPS), "-i", p["src"]]
        frames = int(round(p["dur"] * FPS))
        z = f"{p['z0']}+({p['z1']-p['z0']})*on/{max(1, frames)}"
        fils.append(
            f"[{i}:v]scale=2688:1512:force_original_aspect_ratio=increase,"
            f"crop=2688:1512,setsar=1,"
            f"zoompan=z='{z}':x='(iw-iw/zoom)*{p['fx']}':y='(ih-ih/zoom)*{p['fy']}':d={frames+1}:"
            f"s=1920x1080:fps={FPS},trim=duration={p['dur']},setpts=PTS-STARTPTS,"
            f"fps={FPS},settb=AVTB,format=yuv420p[vp{i}]")
        labels.append(p["dur"])
    chain = "[vp0]"
    accum = labels[0]
    for n in range(1, len(labels)):
        off = round(accum - X, 3)
        tag = f"[vx{n}]" if n < len(labels) - 1 else "[vpre]"
        fils.append(f"{chain}[vp{n}]xfade=transition=fade:duration={X}:offset={off}{tag}")
        chain = f"[vx{n}]" if n < len(labels) - 1 else "[vpre]"
        accum = accum + labels[n] - X
    if len(labels) == 1:
        fils.append("[vp0]copy[vpre]")
    tail_filters = []
    if sid == 1:
        tail_filters.append("fade=t=in:st=0:d=0.45")
    if sid == 14:
        tail_filters.append(f"fade=t=out:st={sc['dur'] - 0.9:.3f}:d=0.9")
    tail_filters.append("eq=contrast=1.045:saturation=1.06:brightness=0.004")
    fils.append(f"[vpre]{','.join(tail_filters)},setpts=PTS-STARTPTS[vout]")
    fc = f"{SEG}/scene-{sid:02d}.txt"
    open(fc, "w").write(";\n".join(fils))
    cmd = [FF, "-y"] + inputs + ["-/filter_complex", fc, "-map", "[vout]", "-an",
                                 "-r", str(FPS), "-c:v", "libx264", "-preset", "medium",
                                 "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
                                 "-level", "4.1", "-video_track_timescale", "15360",
                                 "-t", f"{sc['dur']:.3f}", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
        print(f"SCENE {sid} FAILED\n", r.stderr[-1500:])
        sys.exit(1)
    return out

if "--skip-video" not in sys.argv:
    for sc in plan["scenes"]:
        out = render_scene(sc)
        print(f"scene {sc['scene']:02d} ok ({os.path.getsize(out)/1e6:.1f} MB)")

# ---------------------------------------------------------------- concat
dist = f"{ROOT}/dist"
os.makedirs(dist, exist_ok=True)
suffix = "-preview" if preview_only else ""
lst = f"{SEG}/concat.txt"
with open(lst, "w") as fh:
    for sc in plan["scenes"]:
        fh.write(f"file '{SEG}/scene-{sc['scene']:02d}.mp4'\n")
vcat = f"{SEG}/video-full.mp4"
r = subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst,
                    "-c", "copy", vcat], capture_output=True, text=True)
if r.returncode != 0:
    print("concat failed:", r.stderr[-800:]); sys.exit(1)
print("video concat ok")

# ---------------------------------------------------------------- audio mix
audio_args = []
n_vo = len(plan["scenes"])
for sc in plan["scenes"]:
    clip = f"/home/user/video-tools/assets/voice/sc{sc['scene']:02d}.mp3"
    if sc["scene"] in missing:
        audio_args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    else:
        audio_args += ["-i", clip]

fils = []
vo_tags = []
for i, sc in enumerate(plan["scenes"]):
    ms = int(round(sc["vo_start"] * 1000))
    fils.append(f"[{1 + i}:a]aresample=48000,apad=whole_dur={total + 1},atrim=duration={total},adelay={ms}|{ms}[vo{i}]")
    vo_tags.append(f"[vo{i}]")
fils.append("".join(vo_tags) + f"amix=inputs={len(vo_tags)}:normalize=0,"
            "equalizer=f=120:t=q:w=1:g=1.5,equalizer=f=8000:t=q:w=1.5:g=2,"
            "acompressor=threshold=0.35:ratio=2.6:attack=6:release=140:makeup=2,asplit=2[voa][vob]")

music_id = 1 + n_vo
audio_args += ["-i", f"{A}/audio/music.wav"]
fils.append(f"[{music_id}:a]aresample=48000,atrim=duration={total},volume=0.62[music]")
fils.append("[music][vob]sidechaincompress=threshold=0.020:ratio=9:attack=18:release=480:makeup=1[musduck]")

sfx_events = []
ss = {sc["scene"]: sc["start"] for sc in plan["scenes"]}
for s in (2, 3, 5, 6, 9, 10, 11, 12):
    sfx_events.append(("whoosh", ss[s], 0.50))
sfx_events.append(("rise", ss[2] - 1.4, 0.9))
sfx_events.append(("rise", ss[14] - 1.6, 1.0))
sc7 = plan["scenes"][6]
sfx_events.append(("chime", sc7["start"] + sc7["plates"][0]["dur"] - X + 0.45, 0.55))
sfx_events.append(("chime", ss[8] + 0.8, 0.30))
for s, off in ((4, 5.4), (5, 2.2), (9, 9.2)):
    sfx_events.append(("click", ss[s] + off, 0.5))

sfx_tags = []
for j, (name, at, vol) in enumerate(sfx_events):
    iid = music_id + 1 + j
    audio_args += ["-i", f"{A}/audio/sfx-{name}.wav"]
    ms = max(0, int(round(at * 1000)))
    fils.append(f"[{iid}:a]aresample=48000,volume={vol},adelay={ms}|{ms},apad=whole_dur={total + 1},atrim=duration={total}[sfx{j}e]")
    sfx_tags.append(f"[sfx{j}e]")

mix = ["[voa]", "[musduck]"] + sfx_tags
fils.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0,"
            "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")

fca = f"{SEG}/audio.txt"
open(fca, "w").write(";\n".join(fils))
master = f"{dist}/edusphere-promo{suffix}.mp4"
cmd = [FF, "-y", "-i", vcat] + audio_args + [
    "-/filter_complex", fca, "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart", "-t", f"{total:.3f}", master]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print("audio mux failed:", r.stderr[-1600:]); sys.exit(1)
print(f"master ok: {master} ({os.path.getsize(master)/1e6:.1f} MB, {total:.1f}s)")

# ---------------------------------------------------------------- 720p
v720 = f"{dist}/edusphere-promo-720p{suffix}.mp4"
r = subprocess.run([FF, "-y", "-i", master, "-vf", "scale=1280:720",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "112k",
                    "-movflags", "+faststart", v720], capture_output=True, text=True)
if r.returncode != 0:
    print("720p failed:", r.stderr[-800:]); sys.exit(1)
print(f"720p ok ({os.path.getsize(v720)/1e6:.1f} MB)")

# ---------------------------------------------------------------- captions
def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p for p in (x.strip() for x in parts) if p]

def fmt(ts, ms_sep="."):
    h = int(ts // 3600); m = int((ts % 3600) // 60); s = ts % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ms_sep)

cues = []
for sc in plan["scenes"]:
    sents = split_sentences(sc["script"])
    words = [max(1, len(x.split())) for x in sents]
    tw = sum(words); tc = sc["vo_start"]
    for sent, w in zip(sents, words):
        d = sc["vo_dur"] * w / tw
        cues.append((tc, min(tc + d, sc["start"] + sc["dur"]), sent))
        tc += d

vtt = ["WEBVTT", "", "NOTE EduSphere — Education Management Platform promotional video", ""]
srt = []
for i, (a_, b_, sent) in enumerate(cues, 1):
    vtt.append(f"{i}\n{fmt(a_)} --> {fmt(b_)}\n{sent}\n")
    srt.append(f"{i}\n{fmt(a_, ',')} --> {fmt(b_, ',')}\n{sent}\n")
open(f"{dist}/edusphere-promo.vtt", "w").write("\n".join(vtt))
open(f"{dist}/edusphere-promo.srt", "w").write("\n".join(srt))
print(f"captions ok: {len(cues)} cues")

meta = {
    "title": "EduSphere — Education Management Platform",
    "tagline": "One school. One platform. Everything connected.",
    "duration": round(total, 2), "preview": preview_only,
    "missingNarration": missing,
    "scenes": [{"scene": s["scene"], "start": s["start"], "dur": s["dur"]} for s in plan["scenes"]],
}
json.dump(meta, open(f"{dist}/promo-meta.json", "w"), indent=1)
print("meta ok")
print("PREVIEW BUILD" if preview_only else "FINAL BUILD COMPLETE")
