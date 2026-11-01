#!/usr/bin/env python3
"""new.py - set up a code-to-video work folder; choose the look once the idea exists (spec S24, S25).
Python 3.9+ standard library. Exit 0 = done; 1 = setup incomplete, or lint findings; 2 = refused or bad input.

  init      WORK --brief-file FILE [--duration S] [--aspect 16:9|9:16|1:1] [--format F] [--revise DIR]
            [--reference FILE] [--offline]
            brief.txt verbatim, the starter in film/, plan.md from templates/plan.md, .c2v/state.json; checks node
            20+, python 3.9+, ffmpeg and ffprobe (libx264, aac, ebur128, tmix) and a browser; installs only into WORK:
            playwright-core (two tries, 120 s each) and, when no browser exists at all, a headless shell (one try,
            300 s). Never node, python or ffmpeg; never sudo. Missing items: one line each with this OS's command.
  styles    WORK                  after plan.md's Idea, Hook and Signature: open, brand, new:NAME and the cards
  look      WORK CHOICE [--from ID]  CHOICE = card id | open | brand | new:NAME; writes film/style.js
  card-lint FILE ... | --all      the card template rules (spec 3.5); --all = scripts/style-cards.md
  denylist  PATH ...              fails on a phrase of the retired study brief or a dev brief

Formats. templates/plan.md: {{slug}} {{brief}} {{register}} {{register_word}} {{tier}} {{rounds}} {{format}}
{{duration}} {{aspect}} {{names}} {{lines}} {{settings}} {{reading_set}} are filled, and so are spec 3.7's bracketed
facts (<slug>, [calm|neutral|energetic], "[quoted]", [S|M|L|LF|R], Format: [..], names [..], lines [..]); it carries
the lines "Idea:", "Hook:" and "Signature:" (text after the colon is the prompt; a trailing " *", A+'s required-line
mark, is ignored) and a "Look:" line of "label: value" fields joined by " · ". film/film.js: the first "names: []"
and "text: []" lines get the demands. film/style.js: comment lines, then "window.__style = <JSON>;". Test limits:
C2V_CHILD_TIMEOUT (s) caps every child; C2V_HEARTBEAT_MS paces install lines.
"""
import sys

sys.dont_write_bytecode = True  # spec 2.0: before any other import
import argparse, hashlib, json, os, platform, re, shlex, shutil, signal, subprocess, time  # noqa: E401,E402

HERE = os.path.dirname(os.path.realpath(__file__))
SKILL = os.path.dirname(HERE)
CARDS = os.path.join(HERE, "style-cards.md")
STARTER = os.path.join(SKILL, "templates", "html-starter")
TEMPLATE = os.path.join(SKILL, "templates", "plan.md")
LIB = os.path.join(STARTER, "lib")

# Tier (S24), precedence R, LF, L, M, S; tier thresholds and round budgets live here, not in registers.json.
LF_OVER_S, L_OVER_S, S_UP_TO_S = 180, 60, 10
ROUNDS = {"S": 1, "M": 2, "L": 2, "LF": 2, "R": 1}
LAUNCH = re.compile(r"\b(launch|launches|launching|impressive)\b|发布会|震撼", re.I)
# The format guess (S24; the format names come from registers.json). A whole-film property (transparent, looping)
# decides wherever the brief states it. Otherwise the first deliverable the brief names decides, so an element inside
# it ("an explainer ... with a lower third") does not; a verb, topic or adjective (explain, how X works, onboarding,
# promotional) decides only when the brief names no deliverable ("Explain our pricing in a 15 s teaser" is a teaser).
# An overlay or a sting may also be one part of the film: named as a part ("with a lower third", "End with a logo
# reveal", "加字幕条", "a logo reveal at the end") or rejected ("no lower thirds"), it names no deliverable, so "A 45 s
# video explaining X, with a lower third for the presenter" is an explainer, not an overlay with no frozen-share check.
PARTS = ("overlay", "sting")
PART_BEFORE = re.compile(  # up to four words between: "with a 3 s logo sting"; "help with", "come up with": no part
    r"(?<![\w'’-])(?:with|w/|plus|including|featuring|followed[ \t]+by|then|finally|lastly|add(?:s|ed|ing)?|"
    r"include[sd]?|(?:end(?:s|ed|ing)?|clos(?:e|es|ed|ing)|finish(?:es|ed|ing)?|open(?:s|ed|ing)?|start(?:s|ed|ing)?|"
    r"begin(?:s|ning)?)(?:[ \t]+(?:it|things|off|up))?[ \t]+on),?(?:[ \t]+[\w'’-]+(?:\.\d+)?){0,4}[ \t]+\Z"
    # Chinese: 加/配/带/包括/以 + a measure word or nothing (加字幕条, 加一个5秒的logo动画, not 带音效的logo动画, whose head is
    # the sting), or 片尾/结尾/最后 + a verb (片尾放logo动画, not 片头logo动画, an intro sting)
    r"|(?:加|配|带|附)上(?:[一两几]?[个段条句款版张]|一些|些)?(?:[^\s，。！？；：,.!?;:的]{1,4}的)?\Z"
    r"|(?:(?<![参更])加(?![速拿载密盟班入工油热强])|配(?![色合置音乐])|带(?![来动领给])|带有|附|包含|包括|含有?|"
    r"(?<![可所用足难])以(?![及后前上下来外内]))(?:(?:[一两几]?[个段条句款版张]|一些|些)(?:[^\s，。！？；：,.!?;:的]{1,4}的)?)?\Z"
    r"|(?:结尾处?|最后|片尾|片头|开头)[放用是来出上接跟再给][^\s，。！？；：,.!?;:]{0,3}\Z", re.I)
NOT_PART = re.compile(  # nor ending or opening the user's other videos with it: "end each episode with a logo sting"
    r"(?<![\w'’-])(?:help(?:s|ed|ing)?(?:[ \t]+(?:me|us|them|out)){0,2}|c[oa]me[ \t]+up|coming[ \t]+up|"
    r"(?:end|clos|open|start|finish|begin)\w*[ \t]+(?:(?:each|every)(?:[ \t]+[\w'’-]+){1,3}|"
    r"(?:all[ \t]+)?(?:our|my|your|their|all)(?:[ \t]+[\w'’-]+){0,2}[ \t]+[\w'’-]+s))[ \t]+\Z"
    r"|给[^\s，。！？；：,.!?;:]{0,8}(?:视频|直播|节目|影片|片子|录像)\Z", re.I)  # 给视频配字幕条: for the user's video
PART_AFTER = re.compile(r"[ \t]+(?:at|in)[ \t]+the[ \t]+(?:very[ \t]+)?(?:end|start|beginning|close)\b(?![ \t]+of[ \t]+"
                        r"(?:each|every|all|any|our|your|my|their|other|these|those)\b)"  # "of each video": no part
                        r"|[^\s，。！？；：,.!?;:]{0,2}(?:结尾|收尾|作结|收场)|(?:放在|放到|出现在)(?:最后|结尾|片尾|开头|片头)",
                        re.I)
FOOTAGE_AFTER = re.compile(  # for the user's own footage it is the deliverable: "add a lower third to my video"
    r"[ \t]+(?:to|onto|on|over|for)[ \t]+(?:the[ \t]+(?:end|start|beginning|top|bottom)[ \t]+of[ \t]+)?"
    r"(?:(?:each|every|all)(?:[ \t]+of)?(?:[ \t]+(?:my|our|your|their|the))?|my|our|your|their)(?:[ \t]+[\w'’-]+){0,2}?"
    r"[ \t]+(?:videos?|films?|clips?|footage|recordings?|(?:live)?streams?|episodes?|vlogs?|podcasts?|reels?|"
    r"uploads?)\b", re.I)
# An overlay noun after the brief names the film being made (explain, how X works, how to, 讲解, 科普, or a film noun that
# is not the user's own: "A 45 s video explaining X. The presenter gets a lower third", "Explain X.\n- Lower third: Jane
# Doe") is a part of that film unless asked for as one ("as a lower third"). A wrong overlay skips the frozen share and
# the poster; a wrong part keeps every check, so a doubtful overlay is a part. A sting keeps its noun: it adds a check.
FILM_RE = re.compile(r"(?<![\w'’-])(?:videos?|films?|clips?|animations?|movies?|reels?)(?![\w'’-])"
                     r"(?![ \t-]*(?:overlays?|lower[- ]thirds?)\b)|(?:视频|动画|短片|影片)(?!字幕条)", re.I)
OWN_BEFORE = re.compile(r"(?<![\w'’-])(?:my|our|your|their|his|her|for)(?:[ \t]+[\w'’-]+){0,3}[ \t]+\Z"
                        r"|(?:(?:我|我们|你|你们|他们|她们|公司|客户)的|给|为|帮)[^\s，。！？；：,.!?;:]{0,6}\Z", re.I)
AS_BEFORE = re.compile(r"(?<![\w'’-])(?:as|into)[ \t]+(?:an?|one)(?:[ \t]+[\w'’-]+(?:\.\d+)?){0,4}[ \t]+\Z|做成\Z", re.I)
# "overlay" the verb names no format: "Overlay the stats on the gameplay", "and overlay the numbers as they change".
VERB_BEFORE = re.compile(r"(?:[.!?;:\n(]|(?<![\w'’-])(?:please|then|and|or|to|also|just|can|could|will|would|should|"
                         r"must|we|you|i))[ \t]*\Z", re.I)
VERB_AFTER = re.compile(r"[ \t]+(?:the|our|a|an|some|it|them|this|that|these|those|my|your|their|his|her|its|each|every|"
                        r"all)(?![\w'’-])", re.I)
FILM_NOUN = r"(?:videos?|films?|clips?|spots?|pieces?|reels?|animations?|movies?)\b|(?:视频|动画|短片|片)"
FORMAT_PROPS = [("overlay", r"\btransparent (background|video)\b|\balpha channel\b|(?<!半)透明的?(背景|底|通道)|带透明"),
                ("loop", rf"\bloopable\b|\blooping (?:{FILM_NOUN}|(?:gif|background)s?\b)|\bseamless(ly)? loop|"
                         r"\bloops? seamlessly\b|\bas a loop\b|循环播放")]
FORMAT_WORDS = [  # deliverables: a format noun, or a cue below followed by a film noun ("an onboarding video")
    ("overlay", r"\boverlays?\b|\blower[- ]thirds?\b|字幕条"),
    ("sting", r"\bstings?\b|\blogo (animation|reveal)\b|\bbumper\b|\bident\b|logo ?动画"),
    ("teaser", r"\bteasers?\b|\btrailers?\b|预告"),
    ("data", r"\bdata[- ](story|stories|video|viz|visuali[sz]ation)\b|\bdataviz\b|数据(故事|视频|可视化)"),
    ("tutorial", rf"\btutorials?\b|\bwalk-?through\b|\bhow-to\b|\bonboarding\s+(?:{FILM_NOUN})|教程"),
    ("explainer", rf"\bexplainers?\b|(?:讲解|科普)(?:{FILM_NOUN})"),
    ("promo", rf"\bpromos?\b|\bpromotional\s+(?:{FILM_NOUN})|\badverts?\b|\bcommercials?\b|宣传片|广告")]
FORMAT_CUES = [  # verbs, topics and adjectives: they name no deliverable
    ("tutorial", r"\bhow to\b|\bonboarding\b"),
    ("explainer", r"\bexplain(s|ing)?\b|\bhow (it|\w+) works?\b|讲解|科普"),
    ("promo", r"\bpromotional\b")]
FILM_CUE = re.compile(r"\bhow to\b|" + dict(FORMAT_CUES)["explainer"], re.I)  # cues that say what the film is
DEFAULT_FORMAT = "promo"
ASKS = {  # demand -> (asked, refused): S21 needs to know whether the brief asks for music
    "music": (r"\b(music|musical|soundtrack|songs?|jingle|bgm|musik|musique|música)\b|音乐|配乐|背景乐|音楽|音樂|음악",
              r"\b(no|without|ohne|keine?|sans|pas de|sin)\s+(background\s+)?(music|soundtrack|songs?|musik|musique|"
              r"música)\b|(不要|无|無)(音乐|配乐|音樂)|音楽(なし|無し|は?不要)|음악\s*없"),
    "voiceover": (r"\bvoice[- ]?overs?\b|\bnarrat(ion|ed|or)\b|旁白|配音",
                  r"\b(no|without)\s+(voice[- ]?overs?|narration)\b|(不要|无)(旁白|配音)"),
    "silent": (r"\bsilent (video|film|clip|version|cut)s?\b|\b(be|is|it) silent\b|\b(no|without) (sound|audio)\b|"
               r"无声|静音", r"$^")}
CJK = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af"
CJK_RE = re.compile(f"[{CJK}]")
TRIGGERS = [("references/renderers/remotion.md", r"\bremotion\b"),  # spec 3.3 triggers decidable from the brief
            ("references/renderers/other.md", r"\b(manim|three\.?js|lottie|blender)\b")]
NAME_STOP = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february",
             "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
             "english", "chinese", "japanese", "korean", "french", "german", "spanish"}
# A word of a name: a letter of any script but CJK (accents included, combining ones too), then letters or digits.
WORD_RE = re.compile(rf"[^\W\d_{CJK}](?:[^\W_{CJK}]|[\u0300-\u036f])*(?:[.'’-](?:[^\W_{CJK}]|[\u0300-\u036f])+)*")
QUOTE_RE = re.compile(r'"([^"\n]{1,200})"|“([^”\n]{1,200})”|「([^」\n]{1,200})」|『([^』\n]{1,200})』|‘([^’\n]{1,200})’|'
                      r"(?<![\w])'([^'\n]{1,200}?)'(?![\w])")

# The look (S25, S29).
STAGES = ("lit", "flat", "medium-paper", "medium-cutpaper", "medium-pixel", "medium-print", "emissive", "footage",
          "transparent")
OPEN_LOOK = {"stage": "", "ground": {}, "palette": {}, "accent": {}, "light": "", "depth": "", "texture": {},
             "type": {}, "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "lib/time.js tokens",
                                    "blur": {"translation": "shutter", "camera": "shutter", "pop": "crisp",
                                             "impact": "crisp"}, "arrival": "", "overshoot": {"kind": "spring"},
                                    "holds": {"kind": "still"}, "camera": ""},
             "energy": {}, "seams": {"native": "the subject's own state changes"}, "sound": {},
             "composition": {"dominant_min": 0.4}, "guards": {}, "start": {}, "helpers": [], "expect": []}
OPEN_DEFAULTS = ("smooth 30 fps; the curve tokens of lib/time.js; shutter blur on fast translations and camera moves; "
                 "crisp pops; overshoot only from a real spring; still holds; a dominant element of about 40% of the "
                 "frame; seams from the subject's own state changes")
LOOK_FIELDS = {"stage": "the stage recipe: " + ", ".join(STAGES), "ground": "what the ground is and how it moves",
               "palette": "two or three colours and a neutral ladder, hexes with where each comes from (logo, site, "
                          "screenshot), or \"designed for this film\"",
               "accent": "what the accent marks", "type": "faces for display and read text (OFL, or the brand's files)"}
LOOK_LABELS = {k: k for k in ("stage", "ground", "palette", "accent", "type", "texture", "clock", "blur", "holds",
                              "light", "depth")}
LOOK_LABELS.update(faces="type", how="holds")
PLAN_KEYS = ("Idea", "Hook", "Signature")
BRACKETS = [("slug", r"(?m)(?<=^# Plan: )<slug>"), ("register", r"\[calm\|neutral\|energetic\]"),  # spec 3.7's A+ text
            ("register_word", r'"\[quoted\]"'), ("tier", r"\[S\|M\|L\|LF\|R\]"), ("format", r"(?<=Format: )\[\.\.\]"),
            ("names", r"(?<=names )\[\.\.\]"), ("lines", r"(?<=lines )\[\.\.\]")]
PLAN_STOP = re.compile(r"^\s*(?:[-*]\s+)?(?:\*\*)?(Directions|Deliberate|Decisions|Idea|Obvious|Hook|Signature|Ending|"
                       r"Register|Demands|Brief|Picture|Beats|Tier|Format|Questions)\b", re.I)
STYLE_WORD = (r"[\s-]*(?:style|styled|look|aesthetic|animation|animated|art|artwork|illustration|inspired|influenced|"
              r"esque|themed|posters?)\b")
STYLE_BEFORE = re.compile(r"(?:\bin\s+the\s+(?:style|manner|spirit|vein|tradition)\s+of|\b(?:inspired|influenced)\s+by|"
                          r"\bstyled\s+(?:after|like|on)|(?<![\w-])(?:à|a)\s+la|\breminiscent\s+of)\s+(?:the\s+)?$",
                          re.I)
# A style the brief rejects ("Not hand-drawn", "Avoid line art", "We cannot use line art", "不要逐帧手绘", "不需要逐帧手绘",
# "不喜欢线条动画") is no style it names: a negation on the same line and in the same clause, at most three words before
# the name (two characters in Chinese: 别再用像素风, not 不要太长的线条动画), none of which ends its scope ("No music in
# this hand-drawn teaser" rejects only the music; "not just hand-drawn" rejects nothing). A preposition after a want,
# or right after the negation, does not end it: "No need for line art", "not looking for hand-drawn", "not a fan of
# pixel art", "not into line art", "Not in pixel art".
SCOPE_END = ("in|on|at|for|of|with|by|from|into|about|over|under|than|as|that|which|who|where|when|while|but|so|"
             "because|just|only|merely|also")
WANT_PREP = (r"(?:need|needs|needed|looking|look|asking|ask|going|go|opting|opt|aiming|aim|room|call|care|hoping|hope|"
             r"wish|wishing|wanting)[ \t]+for|(?:going|go|sticking|stick)[ \t]+with|(?:fan|fans|fond|tired|sick|bored|"
             r"thinking|think)[ \t]+of|(?:keen|big|sold|hung|set)[ \t]+on|(?:interested|interest)[ \t]+in|"
             r"(?:crazy|excited|mad|wild)[ \t]+about"
             # and "want it to look" counts as one word: "We don't want it to look hand-drawn"
             r"|(?:want|need|make|let|have|get)(?:s|ed|ing)?[ \t]+(?:it|this|that|them|(?:the|our)[ \t]+[\w'’-]+)[ \t]+"
             r"(?:to[ \t]+)?(?:look|be|feel|seem|appear|sound)(?:[ \t]+(?:like|as))?")
REJECT = re.compile(rf"(?<![\w'’-])(?:not|no|never|nor|neither|without|avoid(?:s|ing)?|skip|except|nothing|cannot|"
                    rf"\w+n['’]t|(?:do|does|did|is|are|was|were|has|have|had|could|would|should|must|need|ca|wo)nt|"
                    rf"rather than|other than|instead of|anything but|"
                    rf"(?:steer|stay|keep|move)[ \t]+(?:clear|away)[ \t]+(?:of|from))(?=[ \t]|\Z)"
                    rf"(?:[ \t]+(?:(?:really|that|so|too|very)[ \t]+)?into(?![\w'’-])"
                    rf"|[ \t]+(?:in|as|like|with)(?![\w'’-]))?"
                    rf"(?:(?:[ \t]+|-)(?:(?:{WANT_PREP})(?![\w'’-])"
                    rf"|(?!(?:{SCOPE_END})(?![\w'’-]))[\w'’]+)){{0,3}}[ \t]*\Z"
                    rf"|(?:不要|不用|不想要?|不需要?|不必|没必要|无需|不(?:是很|太|怎么)?喜欢|不爱|讨厌|避免|拒绝|禁止|勿|"
                    rf"不考虑|不采用|不使用|不接受|排除|(?<![是要])不是|(?<![特分区级类个告识差性])别(?:再|老)?(?:用|做|搞|弄))"
                    rf"[{CJK}]{{0,2}}\Z", re.I)
# A rejection right after the name: "Hand-drawn is not what we want", "Line art is out", "Line art? No.", "Pixel art: no".
REJECT_AFTER = re.compile(r"[ \t]+(?:is|are)(?:[ \t]+not|n['’]?t)[ \t]+(?:what[ \t]+we|wanted|welcome|allowed|okay|ok|"
                          r"an[ \t]+option|for[ \t]+us|our[ \t]+style|the[ \t]+look|right)(?![\w'’-])"
                          r"|[ \t]+(?:is|are)[ \t]+(?:out|banned|forbidden|off[ \t]+the[ \t]+table|a[ \t]+no(?:-go)?)(?![\w'’-])"
                          r"|[ \t]*[?:][ \t]*(?:no|nope|never|absolutely[ \t]+not|definitely[ \t]+not)(?![\w'’-])", re.I)
BRAND = re.compile(r"(?<![\w&])#[0-9a-fA-F]{6}\b|\bbrand[\s-]+(?:guide|guidelines|kit|colou?rs?|palette|fonts?|assets|"
                   r"book|system)\b|\bstyle\s*guide\b|\bdesign\s+(?:system|tokens)\b|\b(?:our|attached|supplied)\s+"
                   r"logo\b|\blogo\s+files?\b|品牌(?:规范|色|手册|资产|视觉)", re.I)
SKIP = {"node_modules", "__pycache__", ".DS_Store", ".git", "bun.lock", "package-lock.json"}

# The hashed denylist: sha256 of each phrase of the retired study brief and both dev briefs, lowercased, as its a-z0-9
# words joined by one space (Chinese, Japanese, Korean: its characters, unjoined), so no shipped file spells them.
DENY = frozenset("""
6b59de758aeee2cb06d6054a98369b644fc0f834baa29dc858c0a81e97a9ab6c ec03a2792ee02da195157e03994094b5fdc5fd98637b05041dd2100530d7cc98
3605242d563dece6915af1b16b36f5fd40d3711de7882b93b0c3d0249b2d494c b70994cc9d1bf6101b5f2f9cf18267bbfdc70911a06449fa990b299f996a9218
d2d85c1906ba7e68409fd7e713f1ae6a54bf02853763dea4cbdf2516d0030dff d557731aaecda4c4c6477f08003c548cb5a4a68a7ce0e690e52bd84b94371e00
057c6cc02fec4ec89a004e96d34a1f450ffe26830f21802cce24a9ff4d4cba5b 682fbae20f3428bcec4c117c57bea18d438c4758d972909b41dbe22884e0d6b8
2ffe5768d51d33d14eb6801a2cea09dc75c00cec85d32a0046bcba3d87edf93c e482af5364b4d367fe613d206d28c4d579136295210a88d5ee05f5290d5a1443
75df76099a9891bd04997205ebb385c871d75028f76bfbb9ee8103902a5d5eec 81b65f0981e8ac51d64d247aa64209eddba165fe45006e2358dc573ee6d650ab
d3a59b48909c9706a03595fe0b90958e8ea5e790722ccc6b96ab608c159502d0 409dc430e802db4b304e8d5fba93a59c1b96ab612f4b5eed40993069028cf0c8
b5b87330e98b207efdeb654d74417140fb37c5a78cbb6814cf778e9c378e28b5 27e2e103abc298b5e5b5b0f2b1ca175131d17b4526c4972095cd477a81a9a699
""".split())
DENY_WORDS, DENY_CHARS = 6, 8  # the longest phrase the scan matches: Latin words, CJK characters

# The card template (spec 3.5): fields, JSON shape, and the values tools read.
CARD_WORDS, REVIEWER_WORDS, PITFALLS, FACES = 450, 30, (3, 6), (2, 3)
HEX_CARDS = ("bauhaus", "synthwave")
FIELDS = ("Fit", "Reviewer", "Transfer", "Variation", "Pitfalls", "Fidelity", "Ref")
TOP = {"register": list, "mood": str, "stage": str, "ground": dict, "palette": dict, "accent": dict, "light": str,
       "depth": str, "texture": dict, "type": dict, "motion": dict, "energy": dict, "seams": dict, "sound": dict,
       "composition": dict, "guards": dict, "start": dict, "helpers": list, "expect": list}
MOTION = {"clock": dict, "curves": str, "blur": dict, "arrival": str, "overshoot": dict, "holds": dict, "camera": str}
ENUMS = {"stage": STAGES, "motion.clock.kind": ("smooth", "stepped", "snapped"), "motion.clock.fps": (24, 25, 30, 60),
         "motion.holds.kind": ("still", "creep", "alive"), "energy.beat": ("none", "landings", "pulse", "build-on-beat"),
         "composition.balance": ("centred", "asymmetric", "off-centre")}
REQUIRED = ("motion.clock.kind", "motion.clock.fps", "motion.holds.kind")
BLURS = ("shutter", "directional", "smear", "crisp", "drawn", "none")
ALIVE = ("boil", "idle", "ambient", "live-ui", "camera", "environment")
GUARDS = {"peak_pxf_30fps": False, "read_contrast_min": False, "min_stroke_px": False, "integer_scale": True}
UNITS = {"s", "ms", "px", "fps", "f", "db", "dbtp", "lu", "lufs", "hz", "khz", "k", "x", "p", "pt", "em", "rem", "vh",
         "vw", "deg", "min", "sec", "kb", "mb"}
EXT = "mjs|cjs|ts|py|md|json|html?|css|png|jpe?g|gif|svg|webp|mp4|mov|webm|mkv|wav|mp3|aac|m4a|woff2?|ttf|otf|txt|sh|lock|ya?ml|toml"
PATH_RES = [re.compile(r"[\w.-]*/[\w./-]*\.(?:js|%s)\b" % EXT),  # a path with a file extension
            re.compile(r"(?<![\w.])(?:~/|\.\.?/|/(?:Users|home|tmp|var|opt|usr|etc|Volumes|private)/)[\w./-]+"),
            re.compile(r"\b[A-Za-z]:\\[\w\\.-]+"),
            re.compile(r"\b[\w-]+\.(?:%s)\b" % EXT)]  # a bare file name; name.js reads as a library (three.js)
HEX_RE = re.compile(r"(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])")
HASH_RE = re.compile(r"(?<![#\w])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}(?!\w)", re.I)
HEAD_RE = re.compile(r"^##[ \t]+(?P<id>[^:\n]+?):[ \t]*(?P<en>[^\n]*?)[ \t]*\((?P<zh>[^()\n]*)\)[ \t]*$")
FIELD_RE = re.compile(r"^\*\*(Fit|Reviewer|Transfer|Variation|Pitfalls|Fidelity|Ref \(n=\d+\))\.\*\*[ \t]*(.*)$")
FIT_RE = re.compile(r"^Use for\s+(?P<use>.+?)\.\s+Not for\s+(?P<no>.+?)\.\s+Confused with:?\s*(?P<conf>.+?)\.?\s*$",
                    re.S | re.I)


# ---------------------------------------------------------------- small helpers
class Refusal(Exception):
    """A refused step: printed as one line, exit 2."""


def say(msg=""):
    print(msg, flush=True)


def env_num(name, default, scale=1.0):
    try:
        v = float(os.environ.get(name, "")) * scale
        return v if v > 0 else default
    except ValueError:
        return default


def limit(default):
    return env_num("C2V_CHILD_TIMEOUT", default)


def words(text):
    return len(text.split())


def tool():
    """The command a step prints: C+ ships c2v.py, which passes styles and look through to new.py."""
    return os.path.join(HERE, "c2v.py" if os.path.isfile(os.path.join(HERE, "c2v.py")) else "new.py")


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def strict_json(text):
    def pairs(kv):
        d = {}
        for k, v in kv:
            if k in d:
                raise ValueError(f"duplicate key {k!r}")
            d[k] = v
        return d

    def no_const(name):
        raise ValueError(f"{name} is not JSON")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=no_const)


def load_json(path, what):
    try:
        return strict_json(read_text(path))
    except (OSError, ValueError) as e:
        raise Refusal(f"cannot read {what} ({path}): {e}")


def save_json(path, doc):
    write_text(path + ".tmp", json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    os.replace(path + ".tmp", path)


def js(value):
    return json.dumps(value, ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def os_family():
    s = platform.system()
    if s in ("Darwin", "Windows"):
        return {"Darwin": "macos", "Windows": "windows"}[s]
    ids = set()
    try:
        with open("/etc/os-release", encoding="utf-8") as fh:
            for line in fh:
                k, _, v = line.strip().partition("=")
                if k in ("ID", "ID_LIKE"):
                    ids.update(v.strip('"').lower().split())
    except OSError:
        pass
    return next((f for f, keys in (("debian", {"debian", "ubuntu"}), ("fedora", {"fedora", "rhel", "centos"}),
                                   ("arch", {"arch"}), ("alpine", {"alpine"})) if ids & keys), "other")


INSTALL = {  # never run by new.py: printed for the user
    "ffmpeg": {"macos": "brew install ffmpeg", "debian": "sudo apt-get install ffmpeg", "fedora": "sudo dnf install ffmpeg",
               "arch": "sudo pacman -S ffmpeg", "alpine": "sudo apk add ffmpeg", "windows": "winget install ffmpeg"},
    "node": {"macos": "brew install node", "debian": "sudo apt-get install nodejs npm", "fedora": "sudo dnf install nodejs",
             "arch": "sudo pacman -S nodejs npm", "alpine": "sudo apk add nodejs npm",
             "windows": "winget install OpenJS.NodeJS.LTS"},
    "python": {"macos": "brew install python", "debian": "sudo apt-get install python3", "fedora": "sudo dnf install python3",
               "arch": "sudo pacman -S python", "alpine": "sudo apk add python3", "windows": "winget install Python.Python.3.12"},
}


def install_line(what):
    return INSTALL[what].get(os_family(), f"install {what} with this system's package manager")


def run(cmd, timeout, cwd=None, env=None, log=None, label=""):
    """Run a child in its own process group and kill the whole group at `timeout` s, so a grandchild that holds the
    output cannot stall setup. With `log`, output is appended there and a progress line prints every C2V_HEARTBEAT_MS;
    else it is returned. Returns (exit code or None if it could not start, output, timed out)."""
    kw = {"cwd": cwd, "env": env, "stdin": subprocess.DEVNULL, "stderr": subprocess.STDOUT}
    if os.name == "posix":
        kw["start_new_session"] = True
    else:
        kw["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    fh = open(log, "ab") if log else None
    kw["stdout"] = fh or subprocess.PIPE
    every = env_num("C2V_HEARTBEAT_MS", 10.0, 0.001)
    try:
        p = subprocess.Popen(cmd, **kw)
    except OSError as e:
        if fh:
            fh.close()
        return None, str(e), False
    out, timed_out, t0 = b"", False, time.monotonic()
    try:
        while True:
            left = max(0.0, timeout - (time.monotonic() - t0))
            try:
                if fh:
                    p.wait(timeout=min(left, every))
                else:
                    out = p.communicate(timeout=left)[0] or b""
                break
            except subprocess.TimeoutExpired:
                if time.monotonic() - t0 >= timeout:
                    timed_out = True
                    break
                say(f"  still {label}: {time.monotonic() - t0:.0f} s of at most {timeout:g} s")
        if timed_out:
            try:
                if os.name == "posix":
                    os.killpg(p.pid, signal.SIGKILL)
                else:
                    p.kill()
            except OSError:
                pass
            if fh:
                p.wait()
            else:
                out = p.communicate()[0] or b""
    finally:
        if fh:
            fh.close()
    return p.returncode, out.decode("utf-8", "replace"), timed_out


def inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:  # different drives
        return False


def ancestors(path):
    path = os.path.realpath(path)
    while True:
        yield path
        if os.path.dirname(path) == path:
            return
        path = os.path.dirname(path)


def copy_tree(src, dst):
    """File contents only, never modes: a read-only skill still yields a writable film/."""
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        out = os.path.join(dst, os.path.relpath(root, src))
        os.makedirs(out, exist_ok=True)
        for f in sorted(files):
            if f not in SKIP and not f.endswith(".pyc"):
                shutil.copyfile(os.path.join(root, f), os.path.join(out, f))


# ---------------------------------------------------------------- reading the brief
DECADE_BEFORE = re.compile(r"(?:['’]|\b(?:the|early|mid|late)[\s-]{1,3})$", re.I)
DECADE_AFTER = re.compile(r"[\s-]{1,3}(?:style|styled|era|inspired|themed|aesthetic|vibes?|retro|throwback|nostalgia)\b",
                          re.I)
# A count written with an s is no length: hundreds of anything ("serves 100s of teams"), tens of thousands ("10s of
# thousands of users"). "30s of animation" stays a length.
COUNT = re.compile(r"\d00s(?=\s{1,3}of\b)|\d+0s(?=\s{1,3}of\s{1,3}(?:hundreds|thousands|millions|billions)\b)",
                   re.I)
# A common film length written N0s right before a format noun is that length, not a doubtful decade: "a 30s teaser"
# keeps its 30 s when the brief also gives a part's length ("the intro is 10 seconds"). 40s, 50s, 70s and 80s, rare as
# lengths and common as decades, are never lengths ("An 80s synthwave teaser." states no length).
SURE_N0S = re.compile(r"[1-369]0s(?=[ \t-]{1,3}(?:teasers?|promos?|explainers?|tutorials?|stings?|loops?|ads?|spots?|"
                      r"clips?|cuts?|versions?|edits?|intros?|outros?|bumpers?|idents?|overlays?)\b)", re.I)


def decade(brief, m):
    """A length match written N0s that reads as a decade: "an 80s-style teaser", "the 80s", "'80s", "mid-90s". Both
    looks are bounded (10 characters before, a match after), so scanning a brief stays linear."""
    return bool(re.fullmatch(r"\d0s", m.group(0))) and bool(
        DECADE_BEFORE.search(brief, max(0, m.start() - 10), m.start()) or DECADE_AFTER.match(brief, m.end()))


def guess_duration(brief):
    """The length the brief states, and its words; the earliest wins, except that a bare N0s outside a decade's context
    ("an 80s synthwave teaser", "a 30s, upbeat") may still be a decade, so any other length in the brief wins over it
    (not over SURE_N0S: "a 30s teaser"); 40s, 50s, 70s and 80s are no length. A count (COUNT: "100s of teams") is no
    length."""
    m = re.search(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b",
                  brief, re.I)
    if m:
        return 60 * float(m.group(1)) + float(m.group(2)), m.group(0)
    best = None  # ((may be a decade, start), seconds, words)
    for rx, mult in ((r"(?<![\w.])(\d+(?:\.\d+)?)(?:[\s-]*(?:seconds?|secs?)\b|(?:\s+|-)s\b)", 1),
                     (r"(?<![\w.])(\d{1,3}(?:\.\d+)?)s\b", 1),  # 30s; four digits read as a decade (1990s)
                     (r"(?<![\w.])(\d+(?:\.\d+)?)[\s-]*(?:minutes?|mins?)\b", 60),
                     (r"(\d+(?:\.\d+)?)\s*秒", 1), (r"(\d+(?:\.\d+)?)\s*分钟", 60)):
        for m in re.finditer(rx, brief, re.I):
            if decade(brief, m) or COUNT.match(brief, m.start()) or re.fullmatch(r"[4578]0s", m.group(0)):
                continue
            key = (bool(re.fullmatch(r"\d0s", m.group(0))) and not SURE_N0S.match(brief, m.start()), m.start())
            if best is None or key < best[0]:
                best = (key, float(m.group(1)) * mult, m.group(0))
    return (best[1], best[2]) if best else (None, None)


def guess_aspect(brief):
    m = re.search(r"(?<!\d)(\d{3,4})\s*[x×]\s*(\d{3,4})(?!\d)", brief)
    if m:
        r = int(m.group(1)) / int(m.group(2))
        return min((abs(r - v), a) for a, v in (("16:9", 16 / 9), ("9:16", 9 / 16), ("1:1", 1.0)))[1], m.group(0)
    for a, rx in (("9:16", r"\b9:16\b|\bvertical\b|\bportrait\b|竖屏"), ("1:1", r"\b1:1\b|\bsquare\b|方形"),
                  ("16:9", r"\b16:9\b|\bhorizontal\b|\blandscape\b|横屏")):
        m = re.search(rx, brief, re.I)
        if m:
            return a, m.group(0)
    return "16:9", None


def film_named_at(brief):
    """Where the brief first names the film being made, or None: a FILM_CUE, or a film noun that is not the user's own
    (OWN_BEFORE: our product video, for the keynote video). Each film noun is checked in a bounded look."""
    film = next((m for m in FILM_RE.finditer(brief) if not OWN_BEFORE.search(brief, max(0, m.start() - 40), m.start())),
                None)
    at = [m.start() for m in (FILM_CUE.search(brief), film) if m]
    return min(at) if at else None


def a_part(brief, m, fmt, film_at):
    """Whether an overlay or sting noun is a part of the film, rejected, or a verb (VERB_BEFORE), rather than the
    deliverable (PARTS). Every look is bounded (at most 120 characters before it, one phrase after), so scanning a brief
    stays linear."""
    at = m.start()
    no = REJECT.search(brief, max(0, at - 120), at)  # "no lower thirds", not "don't let the lower third cover a face"
    if no and not re.search(r"(?<![\w'’-])(?:the|this|our|your|my|their|its)(?![\w'’-])", no.group(0), re.I):
        return True
    if m.group(0).lower() == "overlay" and VERB_AFTER.match(brief, m.end()) and (
            at < 20 and not brief[:at].strip() or VERB_BEFORE.search(brief, max(0, at - 20), at)):
        return True
    if FOOTAGE_AFTER.match(brief, m.end()):
        return False
    before = PART_BEFORE.search(brief, max(0, at - 80), at)
    if before and not NOT_PART.search(brief, max(0, before.start() - 60), before.start()) or PART_AFTER.match(brief,
                                                                                                             m.end()):
        return True
    return fmt == "overlay" and film_at is not None and film_at < at and not AS_BEFORE.search(brief, max(0, at - 80),
                                                                                              at)


def guess_format(brief, formats):
    for fmt, rx in FORMAT_PROPS:
        m = re.search(rx, brief, re.I)
        if m and fmt in formats:
            return fmt, m.group(0)
    film_at = film_named_at(brief)
    hits = [(m.start(), m.group(0), fmt) for fmt, rx in FORMAT_WORDS if fmt in formats for m in
            [next((m for m in re.finditer(rx, brief, re.I) if fmt not in PARTS or not a_part(brief, m, fmt, film_at)),
                  None)] if m]
    hits = hits or [(m.start(), m.group(0), fmt) for fmt, rx in FORMAT_CUES if fmt in formats
                    for m in [re.search(rx, brief, re.I)] if m]
    return (min(hits)[2], min(hits)[1]) if hits else (DEFAULT_FORMAT, None)


def register_hits(R, brief):
    """S26 precedence (case-blind whole English words, Chinese words anywhere): the first register with a word in
    the brief, and all its words found, in brief order."""
    for reg in R["precedence"]["register"]["brief_words"]:
        w = R["registers"][reg]["words"]
        hits = [(m.start(), x) for x in w["en"] for m in [re.search(rf"\b{re.escape(x)}\b", brief, re.I)] if m]
        hits += [(brief.index(x), x) for x in w["zh"] if x in brief]
        if hits:
            return reg, [x for _, x in sorted(hits)]
    return R["precedence"]["register"]["default"], []


def guess_tier(revise, reference, duration, brief):
    """S24 precedence R, LF, L, M, S; the gate (S19) may import this to recompute the tier."""
    if revise:
        return "R", "a revision (--revise)"
    if duration is not None and duration > LF_OVER_S:
        return "LF", f"{duration:g} s, over {LF_OVER_S} s"
    m = LAUNCH.search(brief)
    if m or reference:
        return "L", f"\"{m.group(0)}\" in the brief" if m else "a supplied reference"
    if duration is not None and duration > L_OVER_S:
        return "L", f"{duration:g} s, over {L_OVER_S} s"
    if duration is not None and duration <= S_UP_TO_S:
        return "S", f"{duration:g} s, at most {S_UP_TO_S} s"
    return "M", f"{duration:g} s" if duration is not None else "no length in the brief"


def demands(brief):
    """Demands to confirm: quoted strings (lines shown exactly) and capitalised product names, accents included
    (Café Olé, Über Eats). A capitalised run that starts a sentence, a bullet or a quoted line is no name unless its
    first word has capitals inside (GitHub, iPhone) or is an acronym: that first word may be a verb (Make Nimbus) or the
    name's own (Acme Cloud), so the run's tail alone would be a wrong name. An acronym counts only beside a capitalised
    word (VS Code, not CI); calendar words are skipped. Also whether the brief asks for music, a voice-over, or
    silence."""
    lines, spans = [], []
    for m in QUOTE_RE.finditer(brief):
        s = next(g for g in m.groups() if g is not None).strip()
        spans.append(m.span())
        if s and s not in lines:
            lines.append(s)
    names, run, prev_end, lead = [], [], None, False  # lead: inside a run that starts a sentence

    acro = lambda w: len(w) > 1 and w.isupper()  # noqa: E731

    def flush():
        if run and not all(map(acro, run)) and " ".join(run) not in names:
            names.append(" ".join(run))
        del run[:]
    for m in WORD_RE.finditer(brief):
        w, a = m.group(), m.start()
        before, after = brief[:a].rstrip(" \t\"'“‘(-*•"), brief[m.end():].lstrip()
        initial = (not before or before[-1] in ".!?:;\r\n") and not (after and CJK_RE.match(after[0]))
        inner = any(ch.isupper() for ch in w[1:]) and not acro(w)
        cap = len(w) > 1 and (w[0].isupper() or inner)
        joined = prev_end is not None and brief[prev_end:a] == " "
        if any(s <= a < e for s, e in spans) or not cap or w.lower() in NAME_STOP:
            flush()
            lead = False
        elif (lead and joined) or (initial and not inner and not acro(w)):
            flush()
            lead = True
        else:
            if not (run and joined):
                flush()
            run.append(w)
            lead = False
        prev_end = m.end()
    flush()
    asks = {k: bool(re.search(yes, brief, re.I)) and not re.search(no, brief, re.I) for k, (yes, no) in ASKS.items()}
    return dict({"names": names, "text": lines}, **asks)


def poster_s(R, dur, fmt):
    if R["formats"].get(fmt, {}).get("poster") is False:
        return 0.0
    if dur is None:
        return None
    row = next(r for r in R["pacing"]["poster_allowance"] if r["film_up_to_s"] is None or dur <= r["film_up_to_s"])
    return min(row["s"], row["share"] * dur) if "share" in row else row["s"]


def settings_line(R, reg, fmt, dur):
    """The register and format numbers a planner needs, all read from registers.json (spec 4.6)."""
    r, f = R["registers"][reg], R["formats"].get(fmt, {})
    loud, dens, ent = r["loudness"], r["cue_density_note_per_10s"], r["entrance_default_s"]
    parts = [f"loudness {loud['target_lufs']:g} LUFS (accepted {loud['accept_lufs'][0]:g} to {loud['accept_lufs'][1]:g}),"
             f" true peak at most {loud['true_peak_max_dbtp']:g} dBTP", f"no music: room tone at {r['room_tone_db']:g} dB",
             f"cues NOTE {dens[0]:g}-{dens[1]:g} per 10 s, each at least {r['cue_margin_lu']:g} LU over the bed",
             f"entrances {ent[0]:g}-{ent[1]:g} s when the card gives none"]
    if f.get("frozen_share") is False:
        parts.append("frozen share skipped (overlay)")
    else:
        add, fz = f.get("frozen_share_add_pct", 0), r["frozen_share_pct"]
        parts.append(f"frozen share WARN {fz['warn'] + add:g}% / FAIL {fz['fail'] + add:g}%")
    p = poster_s(R, dur, fmt)
    parts.append(f"poster allowance {p:g} s" if p is not None else "poster allowance " + "; ".join(
        (f"min({row['s']:g} s, {row['share']:g} of the film)" if "share" in row else f"{row['s']:g} s")
        + (f" up to {row['film_up_to_s']:g} s" if row["film_up_to_s"] is not None else " above")
        for row in R["pacing"]["poster_allowance"]))
    if r["hook"] or f.get("hook"):
        h = R["pacing"]["hook_rule"]
        parts.append("hook: no frozen run in the first " + (f"{min(h['window_s'], h['window_share'] * dur):g} s" if dur
                     is not None else f"min({h['window_s']:g} s, {h['window_share']:g} of the film)"))
    parts.append("each hold lasts what its read text needs: hold() sizes it")
    if "seam_fail_levels" in f:
        parts.append("the last frame meets the first")
    return " · ".join(parts)


# ---------------------------------------------------------------- toolchain
PW_REL = {  # inside a Playwright cache's <kind>-<revision> folder, as render.mjs looks
    "chromium_headless_shell": [f"chrome-headless-shell-{p}/chrome-headless-shell" for p in
                                ("mac-arm64", "mac-x64", "linux64", "linux-arm64")] +
                               ["chrome-headless-shell-win64/chrome-headless-shell.exe", "chrome-linux/headless_shell",
                                "chrome-mac/headless_shell", "chrome-win/headless_shell.exe"],
    "chromium": [f"chrome-{p}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" for p in
                 ("mac-arm64", "mac-x64")] + ["chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-linux64/chrome",
                                              "chrome-linux-arm64/chrome", "chrome-linux/chrome", "chrome-win64/chrome.exe",
                                              "chrome-win/chrome.exe"]}


def is_exe(p):
    return bool(p) and os.path.isfile(p) and os.access(p, os.X_OK)


def system_browsers(home, env):
    mac, win = "Contents/MacOS/", "Google/Chrome/Application/chrome.exe"
    return [p for p in [f"/Applications/Google Chrome.app/{mac}Google Chrome", f"/Applications/Chromium.app/{mac}Chromium",
                        os.path.join(home, f"Applications/Google Chrome.app/{mac}Google Chrome"),
                        os.path.join(home, f"Applications/Chromium.app/{mac}Chromium"), "/usr/bin/google-chrome",
                        "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
                        "/snap/bin/chromium"] + [os.path.join(env[v], win) for v in
                                                 ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA") if env.get(v)]]


def newest(caches, kind):
    found = []
    for c in caches:
        try:
            found += [(int(n.rsplit("-", 1)[1]), os.path.join(c, n)) for n in os.listdir(c)
                      if re.fullmatch(rf"{kind}-\d+", n)]
        except OSError:
            continue
    for _, d in sorted(found, reverse=True):
        for rel in PW_REL[kind]:
            if is_exe(os.path.join(d, rel)):
                return os.path.join(d, rel), f"Playwright cache {os.path.basename(d)}"
    return None


def find_browser(work, env, home, system=None):
    """S24 order: $CHROME, the newest Playwright headless shell, the newest Playwright Chromium, system Chrome or
    Chromium; then a headless shell this tool put in <work>/.c2v/browsers. (path, where) or None."""
    if is_exe(env.get("CHROME")):
        return env["CHROME"], "$CHROME"
    caches = [c for c in (env.get("PLAYWRIGHT_BROWSERS_PATH"), os.path.join(home, "Library/Caches/ms-playwright"),
                          os.path.join(home, ".cache/ms-playwright"),
                          env.get("LOCALAPPDATA") and os.path.join(env["LOCALAPPDATA"], "ms-playwright")) if c and c != "0"]
    hit = newest(caches, "chromium_headless_shell") or newest(caches, "chromium")
    hit = hit or next(((p, "system") for p in (system_browsers(home, env) if system is None else system) if is_exe(p)),
                      None)
    if hit:
        return hit
    hit = newest([os.path.join(work, ".c2v", "browsers")], "chromium_headless_shell")
    return (hit[0], "the work folder") if hit else None


def find_playwright(work):
    """playwright-core as render.mjs resolves it from the page: film/, the work folder, and up."""
    for d in ancestors(os.path.join(work, "film")):
        pj = os.path.join(d, "node_modules", "playwright-core", "package.json")
        if os.path.isfile(pj):
            try:
                return os.path.dirname(pj), strict_json(read_text(pj)).get("version", "?")
            except (OSError, ValueError):
                return os.path.dirname(pj), "?"
    return None


def tool_version(cmd, env, rx=r"version\s+(\S+)"):
    """(version, "") or (None, why it failed)."""
    rc, out, timed_out = run(cmd, limit(60.0), env=env)
    if timed_out:
        return None, f"timed out after {limit(60.0):g} s"
    if rc != 0:
        return None, (out.strip().splitlines() or [f"exit {rc}"])[-1]
    m = re.search(rx, out)
    return (m.group(1) if m else "?"), ""


def system_checks(env):
    """python, node and ffmpeg: name -> (ok, detail)."""
    found = {"python": (sys.version_info >= (3, 9), platform.python_version())}
    node = shutil.which("node", path=env.get("PATH"))
    v, err = tool_version([node, "--version"], env, r"v?(\d+\.\d+\.\d+)") if node else (None, "not found")
    found["node"] = (bool(v) and v[0].isdigit() and int(v.split(".")[0]) >= 20,
                     f"{v} ({node})" if v else f"{node or 'node'}: {err}")
    ff, fp = (shutil.which(n, path=env.get("PATH")) for n in ("ffmpeg", "ffprobe"))
    if not ff or not fp:
        found["ffmpeg"] = (False, f"{'ffmpeg' if not ff else 'ffprobe'} not found")
        return found
    (v, err), (pv, perr) = tool_version([ff, "-hide_banner", "-version"], env), \
        tool_version([fp, "-hide_banner", "-version"], env)
    if not v or not pv:
        found["ffmpeg"] = (False, f"{ff if not v else fp}: {err or perr}")
        return found
    have = run([ff, "-hide_banner", "-encoders"], limit(60.0), env=env)[1] + \
        run([ff, "-hide_banner", "-filters"], limit(60.0), env=env)[1]
    lack = [n for n in ("libx264", "aac", "ebur128", "tmix") if not re.search(rf"\s{n}\s", have)]
    found["ffmpeg"] = (not lack, f"ffmpeg {v}, ffprobe {pv}" + (f": lacks {', '.join(lack)}" if lack else ""))
    return found


def npm_kind(env):
    """npm, or Bun's npm shim (`npm --version` prints Bun's 1.x, or npm resolves to bun): (path, version, is_bun)."""
    npm = shutil.which("npm", path=env.get("PATH"))
    v = tool_version([npm, "--version"], env, r"(\d+\.\d+\.\d+)")[0] if npm else None
    return (npm, v, v.startswith("1.") or os.path.basename(os.path.realpath(npm)).startswith("bun")) if v else None


def pin():
    try:
        return "playwright-core@" + strict_json(read_text(os.path.join(HERE, "package.json")))["dependencies"][
            "playwright-core"]
    except (OSError, ValueError, KeyError, TypeError):
        return "playwright-core"


def install_form(work, bun):
    """S3's work-folder forms, plus a work-folder package.json first, so npm and Bun never walk up into an enclosing
    project (critic C1). Returns (cache variable, cache folder, the line a person can run)."""
    var, cache = ("BUN_INSTALL_CACHE_DIR", "bun-cache") if bun else ("npm_config_cache", "npm-cache")
    cache = os.path.join(work, ".c2v", cache)
    if os.name == "nt":
        return var, cache, (f'cd /d "{work}" && (if not exist package.json echo {{}}> package.json) && set "{var}={cache}"'
                            f" && npm install {pin()}")
    q = shlex.quote
    return var, cache, (f"(cd {q(work)} && {{ [ -f package.json ] || echo '{{}}' > package.json; }} && {var}={q(cache)}"
                        f" npm install {q(pin())})")


def install_playwright(work, env, npm, log):
    var, cache, shown = install_form(work, npm[2])
    if not os.path.exists(os.path.join(work, "package.json")):
        write_text(os.path.join(work, "package.json"), '{"private": true}\n')
    # The work folder's cache replaces the caller's (every `npm run` script exports npm_config_cache), in any case:
    # npm reads its config variables case-blind, so a leftover NPM_CONFIG_CACHE could still win.
    child_env = {"npm_config_audit": "false", "npm_config_fund": "false",
                 **{k: v for k, v in env.items() if k.lower() != var.lower()}, var: cache}
    cap = limit(120.0)
    for attempt in (1, 2):
        say(f"install playwright-core into the work folder: attempt {attempt} of 2, at most {cap:g} s "
            f"({'Bun' if npm[2] else 'npm'} {npm[1]}; log .c2v/install.log)")
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(f"--- attempt {attempt}: {npm[0]} install {pin()} (cwd {work}, {var}={cache})\n")
        rc, _, timed_out = run([npm[0], "install", pin()], cap, cwd=work, env=child_env, log=log,
                               label="installing playwright-core")
        if rc == 0 and not timed_out and find_playwright(work):
            return True, shown
        say(f"  attempt {attempt} failed: " + ("timed out" if timed_out else f"exit {rc}" if rc else
                                              "npm finished but playwright-core is not in the work folder"))
    return False, shown


def install_browser(work, env, node, pw_dir, log):
    browsers = os.path.join(work, ".c2v", "browsers")
    cmd, cap = [node, os.path.join(pw_dir, "cli.js"), "install", "chromium-headless-shell"], limit(300.0)
    say(f"install a headless shell into .c2v/browsers: one attempt, at most {cap:g} s (log .c2v/install.log)")
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(f"--- headless shell: {' '.join(cmd)} (PLAYWRIGHT_BROWSERS_PATH={browsers})\n")
    rc, _, timed_out = run(cmd, cap, env=dict(env, PLAYWRIGHT_BROWSERS_PATH=browsers), log=log,
                           label="installing the headless shell")
    return rc == 0 and not timed_out, (f"PLAYWRIGHT_BROWSERS_PATH={shlex.quote(browsers)} node {shlex.quote(cmd[1])} "
                                       "install chromium-headless-shell")


# ---------------------------------------------------------------- init
def reading_set(work, tier, brief, fmt, d, reference, assume=()):
    """What to read before the first render, by tier (spec 3.4, 4.5), plus references the brief or flags trigger
    (spec 3.3). Only files that exist, or are listed in `assume`, with their word counts."""
    ref = lambda n: os.path.join(SKILL, "references", n)  # noqa: E731
    files = [os.path.join(SKILL, "SKILL.md")]
    if tier == "R":
        files += [os.path.join(work, "film", "film.js"), os.path.join(work, "style-card.md")]
    else:
        files += [ref("craft.md"), os.path.join(work, "plan.md"), os.path.join(work, "film", "lib", "README.md"),
                  os.path.join(work, "film", "film.js")]
        files += [ref(n) for n, on in (("reference-study.md", reference), ("delivery.md", tier == "LF"),
                                       ("cjk.md", CJK_RE.search(brief)), ("overlay.md", fmt == "overlay"),
                                       ("sound.md", d["music"] or d["voiceover"])) if on]
        files += [os.path.join(SKILL, n) for n, rx in TRIGGERS if re.search(rx, brief, re.I)]
    out = []
    for f in files:
        try:
            out.append((f, words(read_text(f))))
        except (OSError, UnicodeDecodeError):
            if f in assume:
                out.append((f, None))
    return out


def plan_line(text, key):
    return re.search(rf"^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?{key}(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$", text, re.M)


def plan_register(plan, brief, R):
    """S19 (9): plan.md's Register line as vqa.py's gate takes it; 'none' gives the default register."""
    v = plan_line(plan, "Register")
    m = v and re.compile(r'(\w+)\s*\(\s*brief word\s*:\s*(?:none|"([^"]+)"|“([^”]+)”)\s*\)', re.I).match(
        plan, *v.span(1))
    w = m and (m.group(2) or m.group(3))
    q = w and re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", brief, re.I)
    if m and m.group(1).lower() in R["registers"] and (q or not w):
        return m.group(1).lower() if w else R["precedence"]["register"]["default"], w, m.span(1)


def plan_prompts(tpl):
    return {k: (m.group(1).strip() if m else None) for k in PLAN_KEYS for m in [plan_line(tpl, k)]}


def fill_film(film_js, d):
    src, lacking = read_text(film_js), []
    for key in ("names", "text"):
        m = re.search(rf"^([ \t]*{key}[ \t]*:[ \t]*)\[[ \t]*\]", src, re.M)
        if m:
            src = src[:m.start()] + m.group(1) + js(d[key]) + src[m.end():]
        else:
            lacking.append(key)
    write_text(film_js, src)
    return lacking


def cmd_init(a):
    R = load_json(os.path.join(HERE, "registers.json"), "registers.json")
    work = os.path.realpath(a.work)
    if inside(work, SKILL):
        raise Refusal(f"{work} is inside the skill folder, which is read-only: use video-work/<slug> in the user's "
                      "project")
    try:
        with open(a.brief_file, "rb") as fh:
            raw = fh.read()
    except OSError:
        raise Refusal(f"no brief file {a.brief_file}: save the request verbatim as brief.txt first")
    brief = raw.decode("utf-8", "replace")
    checks = [(not brief.strip(), f"{a.brief_file} is empty: save the request verbatim"),
              (a.format and a.format not in R["formats"], f"--format {a.format}: one of {', '.join(R['formats'])}"),
              (a.duration is not None and not 0 < a.duration < float("inf"),  # inf and nan are no JSON numbers
               "--duration: a finite number of seconds, above 0"),
              (a.revise and not os.path.isdir(a.revise), f"--revise {a.revise}: no such folder"),
              (a.reference and not os.path.isfile(a.reference), f"--reference {a.reference}: no such file"),
              (not os.path.isfile(TEMPLATE) or not os.path.isdir(STARTER),
               f"this package lacks {TEMPLATE} or {STARTER}: run new.py from a built candidate")]
    for bad, why in checks:
        if bad:
            raise Refusal(why)
    dst = os.path.join(work, "brief.txt")
    try:
        os.makedirs(os.path.join(work, ".c2v"), exist_ok=True)
        if os.path.exists(dst) and not os.path.samefile(dst, a.brief_file):
            with open(dst, "rb") as fh:
                if fh.read() != raw:
                    raise Refusal(f"{dst} holds a different brief: start a new work folder (to revise this film: a new "
                                  f"folder with --revise {work})")
        elif not os.path.exists(dst):
            with open(dst, "wb") as fh:
                fh.write(raw)
    except OSError as e:
        raise Refusal(f"cannot write the work folder {work}: {e}")

    dur, dur_src = (a.duration, "--duration") if a.duration is not None else guess_duration(brief)
    aspect, asp_src = (a.aspect, "--aspect") if a.aspect else guess_aspect(brief)
    fmt, fmt_src = (a.format, "--format") if a.format else guess_format(brief, R["formats"])
    reg, hits = register_hits(R, brief)
    tier, tier_why = guess_tier(a.revise, a.reference, dur, brief)
    rounds = ROUNDS[tier]
    per_chapter = bool(R.get("tiers", {}).get(tier, {}).get("budgets_per_chapter"))
    d = demands(brief)
    notes, film, plan = [], os.path.join(work, "film"), os.path.join(work, "plan.md")
    if not os.path.exists(film) and a.revise:
        src = os.path.join(a.revise, "film")
        src = src if os.path.isfile(os.path.join(src, "index.html")) else a.revise
        if not os.path.isfile(os.path.join(src, "index.html")):
            raise Refusal(f"--revise {a.revise}: no film/index.html or index.html there")
        copy_tree(src, film)
        if os.path.isfile(os.path.join(a.revise, "style-card.md")) and not os.path.exists(os.path.join(work,
                                                                                                       "style-card.md")):
            shutil.copyfile(os.path.join(a.revise, "style-card.md"), os.path.join(work, "style-card.md"))
    elif not os.path.exists(film):
        copy_tree(STARTER, film)
        lacking = fill_film(os.path.join(film, "film.js"), d) if os.path.isfile(os.path.join(film, "film.js")) else []
        notes += [f"WARN film/film.js has no \"{k}: []\" line: the demands are in .c2v/state.json only" for k in lacking]
    tpl = read_text(TEMPLATE)
    if not os.path.exists(plan):
        rs = reading_set(work, tier, brief, fmt, d, a.reference, assume=(plan,))
        tokens = {"slug": os.path.basename(work), "brief": brief.rstrip("\n"), "register": reg,
                  "register_word": f"\"{hits[0]}\"" if hits else "none", "tier": tier, "format": fmt,
                  "rounds": f"{rounds} per chapter" if per_chapter else str(rounds), "aspect": aspect,
                  "duration": f"{dur:g} s" if dur is not None else "not given", "names": js(d["names"]),
                  "lines": js(d["text"]), "settings": settings_line(R, reg, fmt, dur),
                  "reading_set": ", ".join(os.path.relpath(f, work if inside(f, work) else SKILL) for f, _ in rs)}
        text, done = re.sub(r"\{\{([a-z_]+)\}\}", lambda m: tokens.get(m.group(1), m.group(0)), tpl), set()
        for key, rx in BRACKETS:  # the bracketed facts of spec 3.7's template, filled like tokens
            text, n = re.subn(rx, lambda m, v=tokens[key]: v, text)
            done |= {key} if n else set()
        write_text(plan, text)
        notes += [f"WARN templates/plan.md: unknown token {{{{{t}}}}}" for t in
                  sorted(set(re.findall(r"\{\{([a-z_]+)\}\}", tpl)) - set(tokens))]
        notes += [f"WARN templates/plan.md has no {{{{{t}}}}}: plan.md lacks it" for t in
                  ("register", "register_word", "tier", "format", "names", "lines")
                  if "{{%s}}" % t not in tpl and t not in done]
        notes += [f"WARN templates/plan.md has no \"{k}:\" line: styles cannot see it filled" for k, v in
                  plan_prompts(tpl).items() if v is None]
    if not os.path.exists(os.path.join(work, ".gitignore")):
        write_text(os.path.join(work, ".gitignore"), "# code-to-video work folder: installs, caches and renders stay out "
                   "of version control\nnode_modules/\n.c2v/\nrenders/\npackage-lock.json\nbun.lock\n")

    state_path = os.path.join(work, ".c2v", "state.json")
    old, own = {}, {}
    for p in [state_path] + ([os.path.join(a.revise, ".c2v", "state.json")] if a.revise else []):
        try:
            got = strict_json(read_text(p))
            own = own or (got if p == state_path else {})
            old = old if "look" in old else got
        except (OSError, ValueError):
            pass
    rs = reading_set(work, tier, brief, fmt, d, a.reference)
    brief_src = lambda flag, src, got: flag if src == flag else f"brief: \"{src}\"" if src else got  # noqa: E731
    state = {"schema": 1, "skill": SKILL, "work": work, "slug": os.path.basename(work),
             "brief": {"file": "brief.txt", "sha256": hashlib.sha256(raw).hexdigest()},
             "tier": tier, "tier_reason": tier_why, "rounds": rounds, "rounds_per_chapter": per_chapter,
             "duration_s": dur, "duration_source": brief_src("--duration", dur_src, None),
             "aspect": aspect, "aspect_source": brief_src("--aspect", asp_src, "default"),
             "format": fmt, "format_source": brief_src("--format", fmt_src, "default"),
             "register": {"value": reg, "source": "brief" if hits else "default", "word": hits[0] if hits else None,
                          "words": hits},
             "demands": d, "reference": os.path.realpath(a.reference) if a.reference else None,
             "revise": os.path.realpath(a.revise) if a.revise else None, "offline": bool(a.offline),
             "plan_prompts": plan_prompts(tpl), "reading_set": [{"path": f, "words": n} for f, n in rs]}
    if "look" in old:
        state["look"] = old["look"]
    if "c2v" in own:  # c2v.py's record (no_vision, reviewer, reviewed rounds): this folder's own, never --revise's
        state["c2v"] = own["c2v"]

    env, log, missing = dict(os.environ), os.path.join(work, ".c2v", "install.log"), []
    home = env.get("HOME") or os.path.expanduser("~")
    found = system_checks(env)
    pw, browser = find_playwright(work), find_browser(work, env, home)
    if all(ok for ok, _ in found.values()) and not a.offline:  # never install while node or ffmpeg is missing (S24 b)
        npm = None if pw else npm_kind(env)
        if not pw and npm:
            ok, shown = install_playwright(work, env, npm, log)
            state.setdefault("installs", []).append({"what": "playwright-core", "ok": ok, "form": "bun" if npm[2] else
                                                     "npm"})
            pw = find_playwright(work)
            if not ok:
                missing.append(f"playwright-core: two installs failed (log {log}); run: {shown}")
        elif not pw:
            missing.append(f"npm, to install playwright-core (it comes with Node): {install_line('node')}")
        if not browser and pw:
            ok, shown = install_browser(work, env, shutil.which("node", path=env.get("PATH")), pw[0], log)
            state.setdefault("installs", []).append({"what": "chromium-headless-shell", "ok": ok})
            browser = find_browser(work, env, home)
            if not browser:
                missing.append(f"a browser: the headless shell install failed (log {log}); run: {shown}; or install "
                               "Google Chrome, or set $CHROME to a Chrome or Chromium binary")
    missing += [m for ok, m in (
        (found["python"][0], f"python 3.9 or newer (found {found['python'][1]}): {install_line('python')}"),
        (found["node"][0], f"node 20 or newer ({found['node'][1]}): {install_line('node')}"),
        (found["ffmpeg"][0], f"ffmpeg and ffprobe with libx264, aac, ebur128 and tmix ({found['ffmpeg'][1]}): "
                             f"{install_line('ffmpeg')}")) if not ok]
    if not pw and not any(m.startswith(("playwright-core", "npm")) for m in missing):
        missing.append(f"playwright-core ({'offline' if a.offline else 'not installed while the items above are missing'}"
                       f"): rerun this command once the rest is in place, or run: "
                       f"{install_form(work, (npm_kind(env) or (0, 0, False))[2])[2]}")
    if not browser and not any(m.startswith("a browser") for m in missing):
        missing.append(f"a browser ({'offline' if a.offline else 'no Chrome or Chromium found'}): install Google Chrome, "
                       "or set $CHROME to a Chrome or Chromium binary, or rerun this command once playwright-core is in "
                       "place (it installs a headless shell into the work folder)")
    found.update({"browser": (bool(browser), f"{browser[0]} ({browser[1]})" if browser else "none"),
                  "playwright-core": (bool(pw), f"{pw[1]} ({pw[0]})" if pw else "none")})
    state["doctor"] = {k: v[1] for k, v in found.items()}
    save_json(state_path, state)
    for n in notes:
        say(n)
    if missing:
        say("new.py init: setup is not complete. Tell the user exactly what is missing and how to install it, then "
            "stop; never install system packages yourself:")
        for m in missing:
            say(f"  MISSING {m}")
        return 1
    say(f"work folder ready: {work} (brief.txt verbatim, plan.md, film/, .gitignore, .c2v/state.json)")
    say(f"tier      {tier} ({tier_why}); review rounds {rounds}{' per chapter' if per_chapter else ''}, one more only "
        "while a High is open")
    say(f"register  {reg} " + ("(brief words: " + ", ".join(f'"{h}"' for h in hits) + "; calm words win in any genre)"
                               if hits else "(no register word in the brief: a chosen card's register applies)")
        + "; correct it on plan.md's Register line, quoting the brief")
    say(f"format    {fmt} " + ("(--format)" if fmt_src == "--format" else f"(brief word: \"{fmt_src}\")" if fmt_src
                               else "(no format word in the brief: a guess)"))
    say(f"length    {dur:g} s ({dur_src}) · aspect {aspect}" if dur is not None else
        f"length    not in the brief: choose one in plan.md · aspect {aspect}")
    say(f"demands   names {js(d['names'])} · lines {js(d['text'])}: confirm or delete them in plan.md and film/film.js")
    say("sound     " + ("the brief asks for music" if d["music"] else "no music asked: room tone and cues")
        + ("; a voice-over" if d["voiceover"] else "") + ("; the brief asks for silence" if d["silent"] else ""))
    say("setup     " + " · ".join(f"{k} {v[1]}" for k, v in found.items()))
    say("read now  " + " · ".join(f"{f} ({n:,} words)" for f, n in rs))
    say(f"next      fill plan.md (brief facts, Idea, Obvious version, Hook, Signature, Ending), then choose the look:\n"
        f"          python3 -B {tool()} styles {work}")
    return 0


# ---------------------------------------------------------------- plan, cards, styles, look
def load_work(work):
    work = os.path.realpath(work)
    for f in ("plan.md", "brief.txt", ".c2v/state.json"):
        if not os.path.isfile(os.path.join(work, f)):
            raise Refusal(f"{work} has no {f}: run new.py init first")
    with open(os.path.join(work, "brief.txt"), "rb") as fh:
        raw = fh.read()
    return work, read_text(os.path.join(work, "plan.md")), raw, load_json(os.path.join(work, ".c2v", "state.json"),
                                                                           "the work folder's state")


def blank(value, prompt, none_ok=False):
    """Why a plan value is not filled in yet, or None; "none" is a real Look value (an open look may have no accent).
    A trailing "*" (a template's required-line mark) is ignored on both sides, so a line that keeps its prompt and
    drops only the star is still not filled."""
    v, p = (" ".join(re.sub(r"\s*\*\s*$", "", s or "").split()) for s in (value, prompt))
    if not v:
        return "empty"
    if p and v == p:
        return "still the template's prompt"
    if "__" in v or re.fullmatch(r"[\s.…_?<>\[\]()-]*|tbd|todo|n/?a" + ("" if none_ok else "|none"), v, re.I):
        return "a placeholder"
    return None


def refuse_before_idea(plan, state, what):
    """S25: the look follows the idea, so styles and look wait for plan.md's Idea, Hook and Signature lines."""
    prompts = state.get("plan_prompts") or {}
    bad = [(k, "missing" if not m else blank(m.group(1), prompts.get(k))) for k in PLAN_KEYS
           for m in [plan_line(plan, k)]]
    bad = [(k, why) for k, why in bad if why]
    if bad:
        raise Refusal(f"{what} waits for the idea, so the look follows it: fill plan.md's "
                      + ", ".join(k for k, _ in bad) + f" line{'s' if len(bad) > 1 else ''} first ("
                      + "; ".join(f"{k}: {why}" for k, why in bad) + ")")


class Card:
    """One "## <id>: <English name> (<中文名>)" section: its prose fields, its JSON block, its index line."""

    def __init__(self, section):
        self.text = section.rstrip() + "\n"
        lines = self.text.splitlines()
        m = HEAD_RE.match(lines[0]) if lines[0].startswith("## ") else None
        self.head = bool(m)
        self.id = m.group("id").strip() if m else lines[0][3:].split(":")[0].strip() if lines[0].startswith("## ") else ""
        self.en, self.zh = (m.group("en").strip(), m.group("zh").strip()) if m else ("", "")
        self.fields, self.stray, self.json, self.json_error = {}, [], None, None
        cur, fence, block, closed = None, False, None, False  # block: the first ```json fence's lines
        for line in lines[1:]:
            if line.startswith("```"):
                if not fence and block is None and line[3:].strip().lower() == "json":
                    block = []
                elif fence and block is not None:
                    closed = True
                fence, cur = not fence, None
                continue
            if fence:
                if block is not None and not closed:
                    block.append(line)
                continue
            f = FIELD_RE.match(line)
            if f:
                cur = "Ref" if f.group(1).startswith("Ref") else f.group(1)
                self.fields[cur] = f.group(2).strip()
            elif not line.strip():
                cur = None
            elif cur:
                self.fields[cur] += " " + line.strip()
            else:
                self.stray.append(line)
        if block is None or not closed:
            self.json_error = "no ```json block" if block is None else "the ```json block is not closed"
        else:
            try:
                self.json = strict_json("\n".join(block))
            except ValueError as e:
                self.json_error = str(e)
            if self.json is not None and not isinstance(self.json, dict):
                self.json, self.json_error = None, "the JSON block must be an object"
        self.fit = FIT_RE.match(self.fields.get("Fit", ""))

    def index_line(self):
        f = self.fit
        return (f"{self.id} ({self.zh}): " + (f"use for {f.group('use')}; not for {f.group('no')}; confused with "
                                             f"{f.group('conf')}" if f else self.fields.get("Fit", "")))


def split_cards(text):
    parts = re.split(r"(?m)^(?=## )", text)
    return (parts[0] if not parts[0].startswith("## ") else ""), [Card(p) for p in parts if p.startswith("## ")]


def shipped_cards():
    if not os.path.isfile(CARDS):
        raise Refusal(f"this package has no {CARDS}")
    return split_cards(read_text(CARDS))[1]


def named_at(brief, rx, one_word=False):
    """Where the brief first names a style by rx and does not reject it there (REJECT, REJECT_AFTER). A one-word name
    also needs a style word after it (pixel art, Bauhaus-inspired) or a style phrase before it (in the style of
    Bauhaus), because one word alone is often an ordinary word (every pixel, the game's HUD, the Bauhaus museum)."""
    for m in re.finditer(rx, brief, re.I):
        at = m.start()
        if one_word and m.end() == m.end(1):  # no style word after: look for a style phrase before
            before = STYLE_BEFORE.search(brief, max(0, at - 40), at)
            if not before:
                continue
            at = before.start()  # "not in the style of Bauhaus" rejects it
        if not REJECT.search(brief, max(0, at - 120), at) and not REJECT_AFTER.match(brief, m.end()):
            return m.start()
    return None


def named_in(brief, cards):
    """Cards the brief names, in brief order: the Chinese name anywhere; an id or English name of two or more parts
    (hand-drawn, line art, 3D Render) on its own; a one-word id or name with a style word after or before it (see
    named_at); never where the brief rejects the style."""
    hits = []
    for c in cards:
        at = [named_at(brief, f"({re.escape(c.zh)})")] if c.zh else []
        for parts in [[p for p in re.split(r"[\s-]+", n) if p] for n in {c.id, c.en}]:
            if parts:
                at.append(named_at(brief, r"(?<![\w-])(" + r"[\s-]+".join(map(re.escape, parts)) +
                                   rf")(?:{STYLE_WORD}|(?![\w-]))", one_word=len(parts) == 1))
        at = [a for a in at if a is not None]
        if at:
            hits.append((min(at), c.id))
    return [cid for _, cid in sorted(hits)]


def cmd_styles(a):
    work, plan, raw, state = load_work(a.work)
    refuse_before_idea(plan, state, "styles")
    cards, brief = shipped_cards(), raw.decode("utf-8", "replace")
    named, brand = named_in(brief, cards), BRAND.search(brief)
    seed = hashlib.sha256(raw).hexdigest()
    say(f"Choose the look for the idea in plan.md. Read every line, then run one:\n"
        f"  python3 -B {tool()} look {work} <choice>")
    for name, what, mark in (
            ("open", "design the look from the idea; the default when the brief names no style and supplies no brand "
                     "assets", "" if named or brand else "the default for this brief"),
            ("brand", "a supplied brand system: every Look value from its assets",
             f"the brief mentions brand assets (\"{brand.group(0)}\")" if brand and not named else ""),
            ("new:<name>", "a named style with no card: copies the nearest card into the work folder to edit "
                           "(references/new-style.md)", "")):
        say(f"{name:<11} {what}" + (f"   <- {mark}" if mark else ""))
    for c in sorted(cards, key=lambda c: hashlib.sha256(f"{seed}:{c.id}".encode()).hexdigest()):
        say(c.index_line() + ("   <- named in the brief" if c.id in named else ""))
    say("A card or brand look needs one sentence on plan.md's Look line saying why the idea needs it.")
    return 0


def plan_look(plan):
    """plan.md's Look line (or the lines under a "## Look" heading): "label: value" fields joined by " · ". A field
    with no colon is still the template's prompt."""
    lines = plan.splitlines()
    head = re.compile(r"^\s*(?:[-*]\s+)?(?:\*\*)?Look(?:\*\*)?\s*:(?:\*\*)?(.*)$")
    start = next((i for i, line in enumerate(lines) if head.match(line)), None)
    if start is None:
        start = next((i for i, line in enumerate(lines) if re.match(r"^#+\s*Look\b", line)), None)
        if start is None:
            return {}
        lines[start] = "Look:"
    taken = [head.match(lines[start]).group(1)]
    for line in lines[start + 1:]:
        if not line.strip() and taken == [""]:
            continue
        if not line.strip() or line.lstrip().startswith(("#", "|")) or PLAN_STOP.match(line):
            break
        taken.append(line)
    fields = {}
    for seg in re.split(r"\s+·\s+|\n", "\n".join(taken)):
        m = re.match(r"\s*([A-Za-z]+)[^:\n]*:(.*)$", seg)
        if m and m.group(1).lower() in LOOK_LABELS:
            key, value = LOOK_LABELS[m.group(1).lower()], m.group(2).strip(" ·\t")
            if key not in fields or not blank(value, None, True):
                fields[key] = value
    return fields


def card_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def nearest(name, cards):
    """The card sharing the most words with NAME (its id, English name and Fit line); ties go to the first id."""
    want = set(re.findall(r"[a-z0-9]+", name.lower()))
    score = lambda c: len(want & set(re.findall(r"[a-z0-9]+", f"{c.id} {c.en} {c.fields.get('Fit', '')}".lower())))  # noqa: E731
    best = sorted(cards, key=lambda c: (-score(c), c.id))[0]
    return best, score(best)


def cmd_look(a):
    work, plan, raw, state = load_work(a.work)
    R = load_json(os.path.join(HERE, "registers.json"), "registers.json")
    choice, cards = a.choice.strip(), shipped_cards()
    by_id = {c.id: c for c in cards}
    new = choice.startswith("new:") and card_slug(choice[4:])
    if not (choice in ("open", "brand") or choice in by_id or new):
        raise Refusal(f"look {choice}: choose open, brand, new:<name> or a card id ({', '.join(sorted(by_id))})")
    if new in by_id:
        raise Refusal(f"look {choice}: {new} is a shipped card: run look {new}")
    if a.from_id and (not new or a.from_id not in by_id):
        raise Refusal(f"--from takes a card id ({', '.join(sorted(by_id))}) and goes with new:<name> only")
    refuse_before_idea(plan, state, f"look {choice}")
    if not os.path.isdir(os.path.join(work, "film")):
        raise Refusal(f"{work}/film is missing: run new.py init first")
    sr, pr = state.get("register") or {}, plan_register(plan, raw.decode("utf-8", "replace"), R)
    word = sr.get("word") if sr.get("source") == "brief" else None
    reg, word = pr[:2] if pr else (sr.get("value") or "neutral", word)
    reg_src = f"brief word \"{word}\"" if word else "default (no register word)"
    fmt = state.get("format") or DEFAULT_FORMAT
    card_md = os.path.join(work, "style-card.md")
    existing = Card(read_text(card_md)) if os.path.isfile(card_md) else None
    if existing and not existing.head:
        raise Refusal("style-card.md has no '## <id>: <name> (<中文名>)' heading, so new.py did not write it: move it "
                      "away first")
    if existing and existing.id not in by_id and existing.id != new:  # a shipped card's copy is new.py's to replace
        raise Refusal(f"style-card.md holds the run-time card '{existing.id}': move it away first")
    notes, fill, fields, card, origin = [], [], {}, None, None
    if choice in ("open", "brand"):
        kind, cid = choice, choice
        body = json.loads(json.dumps(OPEN_LOOK))
        fields = plan_look(plan)
        first = (fields.get("stage") or "").lower().split()[:1]
        body["stage"] = first[0].strip(".,;") if first and first[0].strip(".,;") in STAGES else ""
        fill = [k for k in LOOK_FIELDS if blank(fields.get(k), None, True) or (k == "stage" and not body["stage"])]
        src = dict({k: "open-look default" for k in body}, stage="plan.md Look line")
        if existing:  # a stale card would tell the reviewers the wrong style
            os.remove(card_md)
            notes.append(f"NOTE removed style-card.md, the {existing.id} card of an earlier look")
    else:
        if new:
            name, cid, kind = choice[4:].strip(), new, "run-time"
            if existing and existing.id == cid:
                card, origin = existing, (state.get("look") or {}).get("card")
            else:
                base, n = (by_id[a.from_id], -1) if a.from_id else nearest(name, cards)
                lines = base.text.splitlines()
                write_text(card_md, "\n".join([f"## {cid}: {name} ({base.zh})"] + lines[1:]) + "\n")
                card, origin = Card(read_text(card_md)), base.id
                why = "--from" if n < 0 else f"it shares {n} word{'s' * (n != 1)} with '{name}'" if n else \
                    f"no card shares a word with '{name}'; pass --from ID to pick another"
                notes.append(f"look new:{name}: copied the nearest card, {base.id} ({why}), to style-card.md as a "
                             f"run-time card. Edit it as references/new-style.md says, then rerun: python3 -B {tool()} "
                             f"look {work} new:{name}")
            notes += [f"NOTE card-lint style-card.md: {f}" for f in lint_card(card, lib_names())]
        else:
            card, kind, cid, origin = by_id[choice], "card", choice, choice
        if card.json is None:
            raise Refusal(f"{'style-card.md' if new else 'the ' + cid + ' card'}: {card.json_error}; run card-lint")
        if not new:
            write_text(card_md, card.text)
        body = {k: v for k, v in card.json.items() if k != "register" and not (new and k == "expect")}  # spec 3.5
        src = {k: f"card {cid}" if kind == "card" else f"run-time card {cid} (from {origin})" for k in body}
        regs = card.json.get("register") if isinstance(card.json.get("register"), list) else []
        regs = [r for r in regs if r in R["registers"]]
        if not word and regs:  # S26: only when the brief has no word
            reg, reg_src = regs[0], f"card {cid}"
    if pr and not word and plan[slice(*pr[2])].lower() != reg:
        write_text(os.path.join(work, "plan.md"), plan[:pr[2][0]] + reg + plan[pr[2][1]:])
        notes.append(f"NOTE plan.md's Register line now names {reg}")
    style = dict({"id": f"new:{cid}" if kind == "run-time" else cid, "look": kind, "register": reg, "format": fmt},
                 **body)
    r, f = R["registers"][reg], R["formats"].get(fmt, {})
    style["numbers"] = {"entrance_default_s": r["entrance_default_s"], "breath_cap_s": r["breath_cap_s"],
                        "hook": bool(r["hook"] or f.get("hook")), "poster": f.get("poster") is not False,
                        "sound_by_default": f.get("sound_by_default") is not False, "holds": R["holds"],
                        "text_floor_px_1080p": R["text"]["floor_px_1080p"]}
    # lib/look.js sizes the page from this when render.mjs gets no --width/--height (handoff cards.md, new.py item 2)
    fw, fh = {"9:16": (1080, 1920), "1:1": (1080, 1080)}.get(state.get("aspect"), (1920, 1080))
    style["frame"] = {"width": fw, "height": fh}
    style["fill"] = fill
    if fields:
        style["look_fields"] = fields
    write_text(os.path.join(work, "film", "style.js"),
               f"// film/style.js, written by new.py look {choice}; it is rewritten whenever look runs, so put look\n"
               "// choices on plan.md's Look line, not here. Where each value came from: ../.c2v/state.json (look).\n"
               "window.__style = {\n" + ",\n".join(f" {js(k)}: {js(v)}" for k, v in style.items()) + "\n};\n")
    sources = dict(src, id="new.py look", look="new.py look", fill="plan.md Look line", register=reg_src,
                   format=state.get("format_source") or "default", numbers=f"registers.json (register {reg}, format "
                                                                           f"{fmt})",
                   frame=f"aspect {state.get('aspect') or '16:9'} (new.py init)")
    if fields:
        sources["look_fields"] = "plan.md Look line"
    has_card = kind not in ("open", "brand")
    state["look"] = {"choice": choice, "kind": kind, "card": origin, "style_js": "film/style.js",
                     "style_card": "style-card.md" if has_card else None,
                     "card_sha256": hashlib.sha256(read_text(card_md).encode()).hexdigest() if has_card else None,
                     "register": {"value": reg, "source": reg_src}, "sources": sources, "fill": fill}
    save_json(os.path.join(work, ".c2v", "state.json"), state)
    say(f"look {choice}: wrote film/style.js (register {reg}: {reg_src}; format {fmt})")
    for n in notes:
        say(n)
    if not has_card:
        if fill:
            say("Fill these on plan.md's Look line as \"label: value\" fields joined by \" · \", then rerun this "
                "command; render.mjs --lint refuses while film/style.js lists empty Look fields:")
            for k in fill:
                say(f"  {k}: " + ("the brand's hexes, each with its source (logo, site, screenshot)" if k == "palette" and
                                  kind == "brand" else LOOK_FIELDS[k]))
        else:
            say("Look fields from plan.md: " + " · ".join(f"{k}: {v}" for k, v in fields.items()))
        say(f"Open-look motion defaults (in film/style.js): {OPEN_DEFAULTS}.")
        return 0
    clock = (card.json.get("motion") or {}).get("clock") or {}
    rates = clock.get("rates") if isinstance(clock.get("rates"), dict) else {}
    say(f"clock     {clock.get('kind', '?')}, {clock.get('fps', '?')} fps" + "".join(
        f"{'; ' if i == 0 else ', '}{k} {v}/s" for i, (k, v) in enumerate(rates.items())))
    faces = (card.json.get("type") or {}).get("faces") if isinstance(card.json.get("type"), dict) else None
    if isinstance(faces, dict):
        say("faces     " + " · ".join(f"{role}: " + " or ".join(map(str, o if isinstance(o, list) else [o]))
                                      for role, o in faces.items())
            + ": put the chosen face in film/fonts/; offline, use the starter's faces and say so in the report")
    say("---- style-card.md " + "-" * 40)
    sys.stdout.write(read_text(card_md))
    return 0


# ---------------------------------------------------------------- card-lint and the denylist
def deny_hits(text):
    """(line, text) for every denylisted phrase: Latin runs of up to DENY_WORDS words (punctuation between them
    ignored) and CJK runs of 2 to DENY_CHARS characters, each hashed as DENY's comment says."""
    toks = [(m.group().lower(), m.start(), bool(CJK_RE.match(m.group())))
            for m in re.finditer(f"[A-Za-z0-9]+|[{CJK}]", text)]
    hits, i = [], 0
    while i < len(toks):
        j = i
        while j < len(toks) and toks[j][2] == toks[i][2]:
            j += 1
        run, cjk = toks[i:j], toks[i][2]
        for s in range(len(run)):
            for n in range(2 if cjk else 1, min(DENY_CHARS if cjk else DENY_WORDS, len(run) - s) + 1):
                if hashlib.sha256(("" if cjk else " ").join(t[0] for t in run[s:s + n]).encode()).hexdigest() in DENY:
                    a, b = run[s][1], run[s + n - 1][1] + len(run[s + n - 1][0])
                    hits.append((text.count("\n", 0, a) + 1, text[a:b]))
        i = j
    return hits


def lib_names():
    """Names defined in templates/html-starter/lib/*.js (functions, consts, export lists, object keys), per file."""
    out = {}
    for f in sorted(os.listdir(LIB)) if os.path.isdir(LIB) else []:
        if f.endswith(".js"):
            src = read_text(os.path.join(LIB, f))
            s = set(re.findall(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)", src) +
                    re.findall(r"\b(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)", src) +
                    re.findall(r"(?m)^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\([^)\n]*\)\s*\{|:)", src))
            for grp in re.findall(r"\bexport\s*\{([^}]*)\}", src) + re.findall(r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=",
                                                                               src):
                s.update(p.split(" as ")[-1].split(":")[-1].strip() for p in grp.split(",") if p.strip())
            out[f[:-3]] = s
    return out


def bare_numbers(text):
    """Numbers not marked "(start)" later in their clause. A token that starts with a letter, or holds letters that are
    not units, is a name (3D, S9, H.264, 3d-render), not a number."""
    found = []
    for clause in re.split(r";|→|->|(?<=[.!?])\s+", text):
        mark = clause.rfind("(start)")
        for m in re.finditer(r"\S+", clause):
            tok = m.group().strip("()[]{}\"'“”‘’,;:.!?…—")
            if (re.search(r"\d", tok) and not re.match(r"[A-Za-z]", tok) and m.start() > mark
                    and all(x.lower() in UNITS for x in re.findall(r"[A-Za-z]+", tok))):
                found.append(tok)
    return found


def dig(j, path):
    for k in path.split("."):
        j = j.get(k) if isinstance(j, dict) else None
    return j


def lint_json(j, lib):
    out = []
    for prefix, shape, here in (("", TOP, j), ("motion.", MOTION, j.get("motion") if isinstance(j.get("motion"), dict)
                                                else {})):
        for k, t in shape.items():
            if k not in here:
                out.append(f"JSON lacks \"{prefix}{k}\"")
            elif not isinstance(here[k], t):
                out.append(f"JSON \"{prefix}{k}\" must be {'a list' if t is list else 'an object' if t is dict else 'text'}")
        out += [f"JSON has an unknown field \"{prefix}{k}\" (the template has {', '.join(shape)})" for k in here
                if k not in shape]
    regs = j.get("register")
    if isinstance(regs, list) and (not regs or len(set(map(str, regs))) != len(regs) or
                                   any(x not in ("calm", "neutral", "energetic") for x in regs)):
        out.append(f"register {regs}: one or more of calm, neutral, energetic, each once (a mood word goes in \"mood\")")
    if isinstance(j.get("mood"), str) and len(j["mood"].split()) > 1:
        out.append(f"mood \"{j['mood']}\": one word or empty")
    for path, allowed in ENUMS.items():
        v = dig(j, path)
        if (v is not None or path in REQUIRED) and (v not in allowed or isinstance(v, bool)):
            out.append(f"{path} {v!r}: one of {', '.join(map(str, allowed))}")
    rates = dig(j, "motion.clock.rates")
    if rates is not None and (not isinstance(rates, dict) or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in rates.values())):
        out.append("motion.clock.rates: section -> drawings per second, above 0")
    if dig(j, "motion.clock.kind") == "stepped" and not rates:
        out.append("motion.clock: a stepped clock needs rates (section -> drawings per second)")
    blur = dig(j, "motion.blur")
    out += [f"motion.blur.{k} {v!r}: one of {', '.join(BLURS)}" for k, v in (blur or {}).items() if v not in BLURS] \
        if isinstance(blur, dict) else []
    alive = dig(j, "motion.holds.alive")
    alive = alive if isinstance(alive, list) else [] if alive is None else [alive]
    if dig(j, "motion.holds.kind") == "alive" and not alive:
        out.append("motion.holds: kind alive needs \"alive\" (" + ", ".join(ALIVE) + ")")
    out += [f"motion.holds.alive {x!r}: one of {', '.join(ALIVE)}" for x in alive if x not in ALIVE]
    share = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and 0 < x <= 1  # noqa: E731
    dom, dmin = dig(j, "composition.dominant"), dig(j, "composition.dominant_min")
    if dom is not None and not (isinstance(dom, list) and len(dom) == 2 and all(map(share, dom)) and dom[0] <= dom[1]):
        out.append("composition.dominant: [min, max], shares of the frame's larger side from 0 to 1")
    if dmin is not None and not share(dmin):
        out.append("composition.dominant_min: a share of the frame's larger side from 0 to 1")
    if dig(j, "composition.emptiness") not in (None, True, False):
        out.append("composition.emptiness: true or false")
    for k, boolean in GUARDS.items():
        v = dig(j, f"guards.{k}")
        if v is not None and (isinstance(v, bool) != boolean or not isinstance(v, (int, float))):
            out.append(f"guards.{k}: {'true or false' if boolean else 'a number'}")
    faces = dig(j, "type.faces")
    if not isinstance(faces, dict) or not faces:
        out.append("type.faces: role -> two or three OFL face options")
    for role, opts in (faces or {}).items() if isinstance(faces, dict) else []:
        if not isinstance(opts, list) or not FACES[0] <= len(opts) <= FACES[1] or not all(
                isinstance(o, str) and o.strip() for o in opts):
            out.append(f"type.faces.{role}: two or three OFL face options")
        else:
            out += [f"type.faces.{role}: never {o} (overused; borrow 1.1)" for o in opts if re.search(
                r"fraunces|playfair", o, re.I) or (role == "display" and re.fullmatch(r"inter( display)?", o.strip(), re.I))]
    for h in j.get("helpers") if isinstance(j.get("helpers"), list) else []:
        stem, _, name = str(h).rpartition(".")
        if not (name in lib.get(stem, ()) if stem else any(name in s for s in lib.values())):
            out.append(f"helper {h!r} is not defined in templates/html-starter/lib")
    out += [f"expect {e!r}: name the S-item whose landing removes it" for e in
            (j.get("expect") if isinstance(j.get("expect"), list) else []) if not re.search(r"\bS\d{1,2}\b", str(e))]
    return out


def lint_card(card, lib):
    """Every rule of the card template (spec 3.5, S25), one line each; [] = clean."""
    out = [] if card.head else ["heading must read '## <id>: <English name> (<中文名>)'"]
    if card.head:
        out += [why for bad, why in ((not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", card.id),
                                      f"id '{card.id}': lowercase letters, digits and hyphens"),
                                     (not card.en, "heading has no English name"),
                                     (not CJK_RE.search(card.zh), "heading has no Chinese name in parentheses")) if bad]
    out += [f"missing field **{f}{' (n=1)' if f == 'Ref' else ''}.**" for f in FIELDS if not card.fields.get(f)]
    if words(card.text) > CARD_WORDS:
        out.append(f"{words(card.text)} words by wc -w (prose and JSON together): at most {CARD_WORDS}")
    if card.fields.get("Fit") and not card.fit:
        out.append("Fit must read 'Use for …. Not for …. Confused with: <style> (<trait>); …'")
    if words(card.fields.get("Reviewer", "")) > REVIEWER_WORDS:
        out.append(f"Reviewer has {words(card.fields['Reviewer'])} words: at most {REVIEWER_WORDS}")
    var = card.fields.get("Variation", "")
    out += [f"Variation lacks \"{p}\"" for p in ("Structures:", "Openings:", "Endings:") if var and p.lower() not in
            var.lower()]
    ends = [e for e in re.split(r"(?i)endings:", var)[-1].split(";") if e.strip()] if "endings:" in var.lower() else []
    if ends and all("lockup" in e.lower() for e in ends):
        out.append("Variation: every ending is a lockup; give at least one that is not")
    k = card.fields.get("Pitfalls", "").count("→") + card.fields.get("Pitfalls", "").count("->")
    if card.fields.get("Pitfalls") and not PITFALLS[0] <= k <= PITFALLS[1]:
        out.append(f"Pitfalls has {k} 'failure → fix' pairs: {PITFALLS[0]} to {PITFALLS[1]}")
    for f, t in [(f, t) for f, t in card.fields.items() if f != "Ref"] + [("text outside the fields",
                                                                           " ".join(card.stray))]:
        out += [f"bare number \"{x}\" in {f}: put it in the JSON, mark it \"(start)\", or move it to the Ref line"
                for x in bare_numbers(t)]
    out += [f"hex {h}: hexes only in {' and '.join(HEX_CARDS)}" for h in HEX_RE.findall(card.text)
            if card.id not in HEX_CARDS]
    out += [f"file path \"{p}\": no file paths in a card" for rx in PATH_RES for p in rx.findall(card.text)]
    out += [f"hash \"{h}\": no hashes in a card" for h in HASH_RE.findall(card.text)]
    out += ["BPM: a tempo belongs to a film, not to the style"] if re.search(r"\bbpm\b", card.text, re.I) else []
    out += [f"line {ln}: a denylisted phrase (\"{t}\"): the retired study brief and the dev briefs never appear"
            for ln, t in deny_hits(card.text)]
    out += lint_json(card.json, lib) if card.json is not None else [f"JSON: {card.json_error}"]
    return list(dict.fromkeys(out))


def cmd_card_lint(a):
    if a.all == bool(a.files):
        raise Refusal("card-lint takes FILE ... or --all")
    lib, total, count = lib_names(), 0, 0
    for path in [CARDS] if a.all else a.files:
        try:
            text = read_text(path)
        except (OSError, UnicodeDecodeError) as e:
            raise Refusal(f"cannot read {path}: {e}")
        pre, cards = split_cards(text)
        if not cards:  # no "## " heading at all: the whole file is one card, and its heading is a finding
            cards = [Card("## \n" + text)]
            cards[0].id = os.path.basename(path)
        seen = set()
        for c in cards:
            found = ([f"id '{c.id}' is already used by an earlier card"] if c.id in seen else []) + lint_card(c, lib)
            seen.add(c.id)
            count, total = count + 1, total + len(found)
            for f in found:
                say(f"card-lint: {os.path.basename(path)}: {c.id or '?'}: {f}")
        for ln, t in deny_hits(pre):
            total += 1
            say(f"card-lint: {os.path.basename(path)}: line {ln}: a denylisted phrase (\"{t}\")")
    say(f"card-lint: {count} card{'s' * (count != 1)}, {total} finding{'s' * (total != 1)}")
    return 1 if total else 0


def cmd_denylist(a):
    files, hits = [], 0
    for p in a.paths:
        if os.path.isdir(p):
            for root, dirs, names in os.walk(p):
                dirs[:] = sorted(d for d in dirs if d not in SKIP)
                files += [os.path.join(root, n) for n in sorted(names) if n not in SKIP]
        elif os.path.isfile(p):
            files.append(p)
        else:
            raise Refusal(f"no such file or folder {p}")
    for f in files:
        try:
            with open(f, "rb") as fh:
                raw = fh.read()
        except OSError as e:  # a gate fails closed: an unreadable file is not a clean one
            raise Refusal(f"cannot read {f}: {e}")
        for ln, t in [] if b"\0" in raw else deny_hits(raw.decode("utf-8", "replace")):  # NUL: binary (fonts)
            hits += 1
            say(f"denylist: {f}:{ln}: \"{t}\"")
    say(f"denylist: {len(files)} file{'s' * (len(files) != 1)}, {hits} hit{'s' * (hits != 1)}")
    return 1 if hits else 0


# ---------------------------------------------------------------- CLI
class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        sys.stderr.write(f"{self.prog}: error: {message}\n")
        sys.exit(2)


def main(argv=None):
    ap = Parser(prog="new.py", description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True, parser_class=Parser, metavar="COMMAND")
    p = sp.add_parser("init", help="set up a work folder: brief, plan, starter, toolchain")
    p.add_argument("work", help="the work folder, video-work/<slug> (never inside the skill)")
    p.add_argument("--brief-file", required=True, help="the request saved verbatim; copied to WORK/brief.txt")
    p.add_argument("--duration", type=float, help="film length in seconds (default: from the brief)")
    p.add_argument("--aspect", choices=("16:9", "9:16", "1:1"), help="frame shape (default: from the brief, else 16:9)")
    p.add_argument("--format", help="teaser, sting, data, overlay, loop, explainer, tutorial or promo (default: from "
                   "the brief)")
    p.add_argument("--revise", metavar="DIR", help="revise the film in DIR (tier R): its film/ is copied")
    p.add_argument("--reference", metavar="FILE", help="a reference video (tier L)")
    p.add_argument("--offline", action="store_true", help="check only: install nothing")
    p.set_defaults(f=cmd_init)
    p = sp.add_parser("styles", help="the looks to choose from, once plan.md has its idea")
    p.add_argument("work")
    p.set_defaults(f=cmd_styles)
    p = sp.add_parser("look", help="choose the look: writes film/style.js")
    p.add_argument("work")
    p.add_argument("choice", help="a card id, open, brand or new:<name>")
    p.add_argument("--from", dest="from_id", metavar="ID", help="with new:<name>: the card to copy")
    p.set_defaults(f=cmd_look)
    p = sp.add_parser("card-lint", help="check style cards against the template (spec 3.5)")
    p.add_argument("files", nargs="*", metavar="FILE")
    p.add_argument("--all", action="store_true", help="lint scripts/style-cards.md")
    p.set_defaults(f=cmd_card_lint)
    p = sp.add_parser("denylist", help="fail on a phrase of the retired study brief or a dev brief")
    p.add_argument("paths", nargs="+", metavar="PATH")
    p.set_defaults(f=cmd_denylist)
    a = ap.parse_args(argv)
    try:
        return a.f(a)
    except Refusal as e:
        say(f"new.py {a.cmd}: {e}")
        return 2


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        print(f"new.py: python 3.9 or newer is needed (found {platform.python_version()}): {install_line('python')}")
        sys.exit(1)
    sys.exit(main())
