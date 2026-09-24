# EduSphere Promotional Video — Production Pipeline

The 3-minute cinematic platform promo ("One school. One platform. Everything connected.")
shown on the global homepage in the "Watch How EduSphere Works" section.

## Outputs (served by the web app)

Canonical web assets live in `public/assets/promo/`:

| File | Purpose |
| --- | --- |
| `edusphere-promo-720p.mp4` | Default stream (mobile / default) |
| `edusphere-promo-1080p.mp4` | Full-HD stream (desktop ≥1280px) |
| `edusphere-promo-poster.jpg` | Player poster (finale brand card frame) |
| `edusphere-promo.vtt` / `.srt` | English captions (sentence-level) |
| `promo-meta.json` | Duration & scene map |

`tools/promo/dist/` holds the raw pipeline outputs (git-ignored) — regenerate with the
commands below instead of committing.

## Pipeline

```bash
# prerequisites (once)
#   * static ffmpeg with libx264 (e.g. pip install imageio-ffmpeg) -> /home/user/video-tools/bin/ffmpeg
#   * npm i @resvg/resvg-js  -> /home/user/video-tools/node_modules
#   * python3 -m venv ... && pip install numpy

npm run seed            # if you need the demo institutions in a scratch DB (render/data.js reads it)

# 1) UI plates (SVG -> 4K PNG, 2x supersampled)
node tools/promo/render/run.js
node tools/promo/render/composites.js

# 2) Original score + SFX (numpy synthesis)
/home/user/video-tools/venv/bin/python tools/promo/audio/music.py 186

# 3) Timeline: probes tools/promo/voice/scNN.mp3 durations -> scenes.json
python3 tools/promo/timeline.py

# 4) Assembly: per-scene encodes -> concat -> audio mix (-16 LUFS) -> 720p + captions
python3 tools/promo/assemble.py            # add --skip-video to reuse existing scene segments

# 5) Stage web assets (poster + optimized masters + captions)
ffmpeg -y -ss 177.5 -i tools/promo/dist/edusphere-promo.mp4 -frames:v 1 -q:v 2 public/assets/promo/edusphere-promo-poster.jpg
ffmpeg -y -i tools/promo/dist/edusphere-promo.mp4 -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -c:a copy -movflags +faststart public/assets/promo/edusphere-promo-1080p.mp4
cp tools/promo/dist/edusphere-promo-720p.mp4 tools/promo/dist/edusphere-promo.vtt tools/promo/dist/edusphere-promo.srt tools/promo/dist/promo-meta.json public/assets/promo/
```

## Content rules baked into the renders

* Only features that exist in this codebase are shown (roles: Super Admin, Institution
  Admin, Teacher, Student, Parent; modules listed in the task brief). No invented stats,
  testimonials, customers, partner logos or URLs.
* The school-website URL shown (`https://edusphere.site/schools/demo-quraniyya`) matches
  the real `/schools/:slug` route and the URL card computed in `public/js/dashboard.js`.
* All people/records are DEMO data from `server/seed.js` — never real tenant data.
* Official logo used as-is from `public/assets/edusphere-logo.png`; no Arabic on the global
  brand; Arabic appears only inside the Islamic-school demo content.
* Captions: `tools/promo/dist/edusphere-promo.{vtt,srt}` (26 cues, word-proportional timing
  split per sentence against the real narration timings).
