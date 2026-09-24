#!/usr/bin/env python3
"""
EduSphere promo — editorial timeline.

Computes exact scene/plate timings from the REAL narration clips, and emits
scenes.json consumed by assemble.py (video graph, audio mix, captions).

Narration timing rule: scene duration = voice duration + tail (breathing room).
Each scene is a sequence of plates; plates are joined with 0.6s xfades, so
sum(plates) = scene_duration + internal_fades * 0.6.
"""
import json, os, re, subprocess

ROOT = "/home/user/EduSphere-Education-Management-Platform/tools/promo"
FF = "/home/user/video-tools/bin/ffmpeg"
VOICE = "/home/user/video-tools/assets/voice"
UI = "/home/user/video-tools/assets/ui"
IMG = f"{ROOT}/frames"
OUT = "/home/user/video-tools/assets"

XFADE = 0.6

# fallback VO durations (seconds) used only until a clip exists
FALLBACK = {11: 7.6, 12: 6.9, 13: 4.2, 14: 17.0}

# narration text per scene (exactly what the voice-00 clips say)
SCRIPT = {
    1:  "Running a modern school is more than teaching. There are students to manage, teachers to coordinate, attendance to track, results to process, finances to monitor, and parents to keep informed.",
    2:  "Meet EduSphere — the education management platform that brings it all together, connecting the people, the information and the operations that keep schools moving.",
    3:  "At the platform level, administrators oversee every institution on EduSphere through one organized, secure ecosystem — registrations, subscription plans, support and platform analytics, all in one place.",
    4:  "For each school, EduSphere connects the entire operation. A student is admitted, assigned to a class, and appears on the teacher's register. Lessons, assignments, examinations and report cards flow through the same system — from admissions to academics, finance, staff and communication.",
    5:  "Teachers get the tools they need to focus on teaching. Open today's class, take attendance in moments, plan lessons, create assignments, assess students and submit results — all from one workspace.",
    6:  "Students stay connected through their own digital portal — keeping track of their timetable, lessons, assignments, examinations, attendance and results, wherever they are.",
    7:  "And parents stay informed. Follow each child's attendance, results, assignments and fees, receive school announcements and payment receipts, and book parent-teacher meetings — all in one place.",
    8:  "EduSphere keeps the whole school community connected with centralized announcements, messages and notifications — from the school office, to teachers, students and parents.",
    9:  "From school fees, payments and receipts to expenses, budgets, payroll and staff leave, EduSphere keeps every part of the school's operations organized and transparent.",
    10: "Every institution also builds its own professional digital presence — a branded public website with its story, admissions, news, events and contact, updated straight from the dashboard.",
    11: "Whether you manage an Islamic school or a Western academy, EduSphere adapts to your institution's identity, language and workflow.",
    12: "Built for multiple institutions, EduSphere keeps every school's information properly separated within one powerful platform.",
    13: "Whether at a desk or on the move, your school stays connected.",
    14: "Administration. Academics. Communication. Finance. One school. One platform. Everything connected. Modernize your school with EduSphere.",
}

TAILS = {1: 1.0, 2: 0.8, 3: 0.9, 4: 0.4, 5: 0.7, 6: 0.6, 7: 0.7, 8: 0.6,
         9: 0.7, 10: 0.8, 11: 0.8, 12: 0.7, 13: 0.9, 14: 2.0}

def plate(src, dur, z0, z1, fx=0.5, fy=0.5):
    return {"src": src, "dur": round(dur, 3), "z0": z0, "z1": z1, "fx": fx, "fy": fy}

# plates per scene; durations are auto-balanced to hit the scene target
PLATES = {
    1:  [plate(f"{IMG}/sc01-campus.jpg", 0, 1.02, 1.10, .50, .55),
         plate(f"{IMG}/sc01-admin.jpg", 0, 1.12, 1.04, .50, .50),
         plate(f"{IMG}/sc01-teacher.jpg", 0, 1.04, 1.11, .45, .50),
         plate(f"{IMG}/sc01-parent.jpg", 0, 1.12, 1.05, .50, .48)],
    2:  [plate(f"{UI}/home.png", 0, 1.14, 1.00, .50, .52),
         plate(f"{UI}/brandcard.png", 0, 1.00, 1.06, .50, .50)],
    3:  [plate(f"{UI}/superadmin.png", 0, 1.00, 1.07, .50, .50),
         plate(f"{UI}/superadmin.png", 0, 1.30, 1.36, .457, .503)],
    4:  [plate(f"{UI}/admindash.png", 0, 1.05, 1.00, .50, .50),
         plate(f"{UI}/students.png", 0, 1.00, 1.06, .50, .50),
         plate(f"{UI}/admindash.png", 0, 1.30, 1.36, .60, .35)],
    5:  [plate(f"{UI}/teacher-att.png", 0, 1.00, 1.04, .50, .50),
         plate(f"{UI}/teacher-att.png", 0, 1.30, 1.35, .55, .60),
         plate(f"{UI}/teacher-assign.png", 0, 1.02, 1.08, .50, .48)],
    6:  [plate(f"{UI}/student-phone.png", 0, 1.00, 1.05, .50, .52),
         plate(f"{UI}/student-phone.png", 0, 1.22, 1.28, .50, .62)],
    7:  [plate(f"{UI}/parent-phone.png", 0, 1.02, 1.00, .50, .55),
         plate(f"{UI}/parent-toast.png", 0, 1.05, 1.12, .48, .40)],
    8:  [plate(f"{UI}/comm.png", 0, 1.00, 1.05, .50, .50),
         plate(f"{UI}/comm.png", 0, 1.28, 1.34, .48, .30)],
    9:  [plate(f"{UI}/finance.png", 0, 1.00, 1.04, .50, .50),
         plate(f"{UI}/finance.png", 0, 1.26, 1.32, .50, .55),
         plate(f"{UI}/payroll.png", 0, 1.02, 1.05, .50, .48)],
    10: [plate(f"{UI}/website-islamic.png", 0, 1.02, 1.00, .50, .50),
         plate(f"{UI}/website-islamic.png", 0, 1.22, 1.28, .45, .33),
         plate(f"{UI}/website-islamic.png", 0, 1.22, 1.27, .50, .78)],
    11: [plate(f"{UI}/split-photos.png", 0, 1.00, 1.04, .50, .50),
         plate(f"{UI}/split-sites.png", 0, 1.00, 1.05, .50, .45)],
    12: [plate(f"{UI}/multi.png", 0, 1.00, 1.08, .50, .53)],
    13: [plate(f"{UI}/devices.png", 0, 1.02, 1.08, .50, .50)],
    14: [plate(f"{UI}/pillars-1.png", 0, 1.00, 1.03, .50, .55),
         plate(f"{UI}/pillars-2.png", 0, 1.03, 1.00, .50, .50),
         plate(f"{UI}/pillars-3.png", 0, 1.00, 1.02, .50, .52)],
}

def probe_duration(path):
    out = subprocess.run([FF, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m: return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

def build():
    scenes = []
    t_scene = 0.0
    missing = []
    for s in range(1, 15):
        clip = f"{VOICE}/sc{s:02d}.mp3"
        dur = probe_duration(clip) if os.path.exists(clip) else None
        if dur is None:
            dur = FALLBACK[s]; missing.append(s)
        tail = TAILS[s]
        scene_dur = dur + tail
        plates = PLATES[s]
        n_int = len(plates) - 1
        total_needed = scene_dur + n_int * XFADE  # internal xfades only
                                              # (scene boundaries are beat cuts)
        # distribute duration across plates proportional to even default
        per = total_needed / len(plates)
        for i, p in enumerate(plates):
            p["dur"] = round(per, 3)
        # slight per-plate variation for visual rhythm (alternating +/-5%)
        if len(plates) >= 3:
            var = per * 0.06
            for i in range(len(plates)):
                plates[i]["dur"] = round(per + (var if i % 2 == 0 else -var * (len(plates) % 2 or 1)), 3)
            drift = (sum(p["dur"] for p in plates) - total_needed)
            plates[-1]["dur"] = round(plates[-1]["dur"] - drift, 3)
        scenes.append({
            "scene": s, "start": round(t_scene, 3),
            "vo_start": round(t_scene + 0.35, 3),
            "vo_dur": round(dur, 3), "tail": tail,
            "dur": round(scene_dur, 3),
            "clip": clip if not missing or s not in missing else None,
            "script": SCRIPT[s], "plates": plates,
        })
        t_scene += scene_dur
    total = t_scene
    plan = {
        "total": round(total, 3), "xfade": XFADE,
        "missing_narration": missing, "scenes": scenes,
    }
    with open(f"{OUT}/scenes.json", "w") as fh:
        json.dump(plan, fh, indent=1)
    print(f"timeline: {total:.1f}s total ({total/60:.2f} min); missing narration: {missing or 'none'}")
    for s in scenes:
        print(f"  S{s['scene']:>2} start {s['start']:7.2f}  dur {s['dur']:6.2f}  vo {s['vo_dur']:6.2f}  plates {len(s['plates'])}")
    return plan

if __name__ == "__main__":
    build()
