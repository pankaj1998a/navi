"""Files for the critic loop (SKILL.md section 1a): templates to fill, and a check that they were filled.

Run with any Python 3 (standard library only):
  python3 critic.py init  [--dir critic]          # write critic/observations.md to fill in (step A)
  python3 critic.py round [--dir critic]          # write the next critic/round_NN.md to fill in (step D)
  python3 critic.py prompt --ref <abs path> --render <abs path> [--pack <png> ...]   # blind reviewer prompt
  python3 critic.py check [--dir critic] [--min-rounds 3]   # is the loop complete? exit 1 if not

`check` fails when the observation sheet still has unfilled lines, a round file still has an unfilled
blind review or critic, a missing or incomplete score line, no fix plan or no keep/revert decision, or there are fewer
than --min-rounds completed rounds. It prints what is missing. It cannot judge the quality of a finding:
write each one from the images.
"""
import argparse
import os
import re
import sys

TODO = "TODO"

OBSERVATIONS = f"""# Observation sheet
Fill every TODO with checkable facts measured from the reference (zoomed crops included).

## 1. Orientation and view
- Which end points to image-left / image-right: {TODO}
- Visible faces and their share of the visible width (e.g. front 35%, right side 65%): {TODO}
- Camera height (how much top surface, how flat the ellipses of round parts): {TODO}
- Lens (parallel or converging verticals): {TODO}

## 2. Frame
- Object box as image fractions (left, top, right, bottom) and width:height: {TODO}

## 3. Parts (largest first: position, size relative to the whole, shape, count)
- {TODO}

## 4. Colour map (per part: hue family, light/dark, saturated/muted; stripes, borders, trim)
- {TODO}

## 5. Material map (per part: chrome / brushed / matte metal, gloss / matte paint, glass, rubber, wood, fabric...)
- {TODO}

## 6. Light (highlight side and sharpness, shadow-side darkness, contact shadow, glows)
- {TODO}

## 7. Background
- {TODO}

## 8. Signature details (5-10 small features that make it recognizable)
- {TODO}
"""

CRITICS = [
    ("1 viewpoint", "facing side; visible faces and their proportions; camera height; lens; box size and centre vs the critic_pack numbers"),
    ("2 silhouette", "width:height ratio; each major part's relative size and position; outline bumps, notches, tapers, curves; open gaps; thickness of thin members"),
    ("3 parts", "cell by cell: each reference part right / wrong / missing in the render; invented parts; every count; every signature detail"),
    ("4 colour", "per part: hue, lightness, saturation with the direction of each error; stripes and borders; share of each colour"),
    ("5 material", "per part: chrome / brushed / matte metal, gloss or matte paint, glass, rubber, wood, fabric; reflections and highlight shapes; CG-plastic look"),
    ("6 light", "key side; highlight strength and sharpness; shadow-side darkness; exposure; contact shadow; glows"),
    ("7 integrity", "floating or intersecting parts, gaps, faceting, black faces, noise, cut-off parts (contact sheet every few rounds)"),
]


BLIND_PROMPT = """You are a strict, independent grader of 3D recreations. You know nothing about how the render was made.
Open every image below with read_file and look closely before answering. Do not edit any file.
REFERENCE (the target object): {ref}
RENDER (a Blender recreation of it): {render}
{pack}
Score each aspect 1-10 (10 nearly identical; 7-9 clearly matching, minor differences; 6 noticeably different but
related; 5 partly matching, major differences; 2-4 mostly wrong; 1 nothing recognizable), judging each one alone:
- shape: silhouette, proportions, thickness of arms/legs/frames, part layout, camera viewpoint
- color: palette, which colour each part has, where stripes and accents run
- texture: material feel and finish (glossy or matte paint, chrome, brushed or dark steel, glass, rubber, wood...)
- detail: small parts present and faithful (handles, rams, links, bolts, seams, dials, treads...); missing or
  invented parts lower it
- lighting: light direction and softness, highlight strength, shadow side, contact shadow, exposure
For every aspect below 9, list its three most visible differences, each as: where - reference shows X, render
shows Y. Be concrete and unforgiving: a toy-like, chunky, matte or simplified look is a defect, not a style.
Reply as JSON: {{"shape": n, "color": n, "texture": n, "detail": n, "lighting": n,
"differences": {{"shape": [...], "color": [...], "texture": [...], "detail": [...], "lighting": [...]}}}}"""


def round_template(n):
    lines = [f"# Round {n:02d}",
             f"Evidence: critic/pack/round_{n:02d}_overview.png, critic/pack/round_{n:02d}_details.png",
             "Finding format: - [critical|major|minor] where: reference shows X -> render shows Y -> cause -> fix",
             "A critic with no findings writes `- checked: <what you compared>`. Replace every TODO.", "",
             "## blind review (workflow critic panel, or a fresh subagent given `critic.py prompt`)",
             f"blind: shape {TODO}, color {TODO}, texture {TODO}, detail {TODO}, lighting {TODO}",
             f"- {TODO} (paste its differences; the critics below must answer each one)", ""]
    for name, checks in CRITICS:
        lines += [f"## {name}", f"Check: {checks}", f"- {TODO}", ""]
    lines += ["## scores",
              f"scores: view {TODO}, silhouette {TODO}, parts {TODO}, colour {TODO}, material {TODO}, light {TODO}, integrity {TODO}",
              "", "## plan (any score <= 5: a rebuild of the worst component or a batch of >= 8 details; round 1 also fixes the global look)", f"- {TODO}",
              "", "## decision (after rendering the candidate: kept or reverted, and why)", f"- {TODO}", ""]
    return "\n".join(lines)


def round_files(d):
    out = []
    for name in os.listdir(d) if os.path.isdir(d) else []:
        m = re.fullmatch(r"round_(\d+)\.md", name)
        if m:
            out.append((int(m.group(1)), os.path.join(d, name)))
    return sorted(out)


def section(text, title):
    m = re.search(r"^## " + re.escape(title) + r"[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else None


def check_round(path):
    text = open(path, encoding="utf-8").read()
    problems = []
    for name, _ in CRITICS:
        body = section(text, name)
        if body is None:
            problems.append(f"critic '{name}' section missing")
            continue
        items = [l for l in body.splitlines() if l.strip().startswith("-")]
        if not items or any(TODO in l for l in items):
            problems.append(f"critic '{name}' not filled")
        elif not any(re.search(r"\[(critical|major|minor)\]|checked:", l) for l in items):
            problems.append(f"critic '{name}' has no [severity] finding or 'checked:' line")
    body = section(text, "blind review")
    if body is None or TODO in body:
        problems.append("blind review not filled")
    m = re.search(r"scores:\s*(.*)", text)
    scores = re.findall(r"(view|silhouette|parts|colour|color|material|light|integrity)\s*[:=]?\s*(\d+(?:\.\d+)?)",
                        m.group(1)) if m else []
    if len(scores) < 7:
        problems.append("score line missing or incomplete (need all seven numbers)")
    for title in ("plan", "decision"):
        body = section(text, title)
        if body is None or TODO in body or not body.strip():
            problems.append(f"'{title}' not filled")
    return problems, {k: float(v) for k, v in scores}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["init", "round", "prompt", "check"])
    ap.add_argument("--ref")
    ap.add_argument("--render")
    ap.add_argument("--pack", nargs="*", default=[])
    ap.add_argument("--dir", default="critic")
    ap.add_argument("--min-rounds", type=int, default=3)
    a = ap.parse_args()
    obs = os.path.join(a.dir, "observations.md")
    if a.cmd in ("init", "round"):
        os.makedirs(os.path.join(a.dir, "pack"), exist_ok=True)

    if a.cmd == "init":
        if not os.path.exists(obs):
            open(obs, "w", encoding="utf-8").write(OBSERVATIONS)
        print(f"Fill in {os.path.abspath(obs)} from the reference before writing modeling code.")
        return 0

    if a.cmd == "prompt":
        if not (a.ref and a.render):
            ap.error("prompt needs --ref and --render (absolute paths)")
        pack = "\n".join(f"COMPARISON {i + 1}: {p} (blue bar = reference, orange bar = render; in the details image each "
                         f"cell pairs the same region, reference left)" for i, p in enumerate(os.path.abspath(q) for q in a.pack))
        print(BLIND_PROMPT.format(ref=os.path.abspath(a.ref), render=os.path.abspath(a.render), pack=pack))
        return 0

    if a.cmd == "round":
        rounds = round_files(a.dir)
        if rounds:
            problems, _ = check_round(rounds[-1][1])
            if problems:
                print(f"round_{rounds[-1][0]:02d}.md is not finished: " + "; ".join(problems))
                print("Finish it (findings, scores, plan, decision) before starting the next round.")
                return 1
        n = rounds[-1][0] + 1 if rounds else 1
        path = os.path.join(a.dir, f"round_{n:02d}.md")
        open(path, "w", encoding="utf-8").write(round_template(n))
        print(f"Round {n}: build the pack with critic_pack.py --out {a.dir}/pack/round_{n:02d}, view both images, "
              f"then fill {os.path.abspath(path)}.")
        return 0

    problems = []
    if not os.path.exists(obs):
        problems.append("observations.md missing (run: critic.py init)")
    elif TODO in open(obs, encoding="utf-8").read():
        problems.append("observations.md still has TODO lines")
    rounds = round_files(a.dir)
    done = 0
    for n, path in rounds:
        p, scores = check_round(path)
        if p:
            problems.append(f"round_{n:02d}.md: " + "; ".join(p))
        else:
            done += 1
            low = sorted(scores.items(), key=lambda kv: kv[1])[:2]
            print(f"round_{n:02d}: complete; lowest {', '.join(f'{k} {v:g}' for k, v in low)}")
    if done < a.min_rounds:
        problems.append(f"{done} complete round(s), need at least {a.min_rounds}")
    if problems:
        print("CRITIC LOOP INCOMPLETE:\n- " + "\n- ".join(problems))
        return 1
    print(f"CRITIC LOOP OK: {done} complete rounds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
