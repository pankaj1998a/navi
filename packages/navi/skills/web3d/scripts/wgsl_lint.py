#!/usr/bin/env python3
"""Advisory static scan of the shaders in a page for common traps. Not a compiler: the browser decides.

Usage: python3 wgsl_lint.py page.html [more.html ...] [--strict]

Finds WGSL in JS template literals and <script type="...wgsl..."> blocks, and GLSL in template literals and
<script type="x-shader/..."> blocks, and prints each finding with its HTML line number:
  WGSL  reserved words used as names; comma `let`/`var` lists; `return` without `;`; assignment to a `let`, `const`
        or function parameter (scope-aware, so shadowing is fine); two module-scope declarations with one name;
        @builtin(position) reaching a fragment input twice; float levels on depth textures; `?:`; operators that
        WGSL only accepts with parentheses (`a + b ^ c`, `a & b == c`, `a || b && c`, `a < b < c`);
        `var<private> X: array<T, N>(...)` without `=`; scalar arguments next to vector ones in smoothstep, clamp,
        step, min, max and pow (WGSL does not widen a scalar to a vector there); two-argument `atan(y, x)` (GLSL's
        form; WGSL's atan takes one argument and the two-argument one is `atan2(y, x)`).
  GLSL  GLSL ES 3.00 reserved words used as names (active, patch, half, input, output, filter, sample, ...).
  WebGPU calls in the page's JavaScript: a `clearValue` object without all four of r, g, b, a (`alpha` is not a
        member) or an array that is not four numbers; `depthLoadOp: 'clear'` without `depthClearValue` (no default);
        a colour attachment with `clearValue` but no `loadOp` or `storeOp`; the 2021 `loadValue` names; a
        `hasDynamicOffset` buffer binding whose bind group entry has no `size` (it binds the whole buffer, so any
        non-zero offset is out of bounds); dynamic offsets passed when no layout sets `hasDynamicOffset`; literal
        dynamic offsets or strides that are not multiples of 256.
A finding is a lead to check, not a verdict; a clean scan is not a compile check. Run the page in a browser too.
Exit code: 0 (findings are advice); with --strict, 1 when something was found; 2 when a file cannot be read or the
command line is wrong (no page, an unknown option).
"""
import argparse, bisect, collections, re, sys

RESERVED = set("""NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast
catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast
consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit
export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl
implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut
mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of
operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public
readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static
static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid
typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly
yield""".split())

# GLSL ES 3.00 words reserved for future use. `attribute` and `varying` are left out: three.js defines them as macros.
GLSL_RESERVED = set("""coherent volatile restrict readonly writeonly resource atomic_uint noperspective patch sample
subroutine common partition active asm class union enum typedef template this goto inline noinline public static
extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3
dvec4 fvec2 fvec3 fvec4 sampler3DRect filter image1D image2D image3D imageCube iimage1D iimage2D iimage3D iimageCube
uimage1D uimage2D uimage3D uimageCube image1DArray image2DArray iimage1DArray iimage2DArray uimage1DArray
uimage2DArray imageBuffer iimageBuffer uimageBuffer sampler1D sampler1DShadow sampler1DArray sampler1DArrayShadow
isampler1D isampler1DArray usampler1D usampler1DArray sampler2DRect sampler2DRectShadow isampler2DRect usampler2DRect
samplerBuffer isamplerBuffer usamplerBuffer sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray isampler2DMSArray
usampler2DMSArray sizeof cast namespace using""".split())

KEYWORDS = set("""alias break case const const_assert continue continuing default diagnostic discard else enable false fn
for if let loop override requires return struct switch true var while""".split())
TEMPLATED = re.compile(r'^(vec[234]|mat[234]x[234]|array|ptr|atomic|bitcast|binding_array|texture_\w+|var)$')
WGSL_HINT = re.compile(r'@(vertex|fragment|compute)\b|\bfn\s+\w+\s*\([^)]*\)\s*->|\bvec[234](f|<f32>)|var<(uniform|storage|private|workgroup)')
GLSL_HINT = re.compile(r'\bvoid\s+main\s*\(|gl_FragColor|gl_Position|#version|precision\s+(high|medium|low)p|#include\s*<|'
                       r'\b(uniform|varying|attribute)\s+(float|int|vec[234]|mat[234]|sampler\w*)\b')
TOKEN = re.compile(r'\s+|(?P<id>[A-Za-z_]\w*)|(?P<num>0[xX][0-9a-fA-F]+[iu]?|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fh]?|\d+(?:[eE][+-]?\d+)?[iufh]?)'
                   r'|(?P<op><<=|>>=|->|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|/=|%=|&=|\|=|\^=|\+\+|--|[{}()\[\];,.:@<>=+\-*/%&|^!~?])|(?P<other>.)', re.S)
ASSIGN = {'=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='}
ARITH, SHIFT, REL = {'+', '-', '*', '/', '%'}, {'<<', '>>'}, {'==', '!=', '<', '>', '<=', '>='}
BITS = {'&', '|', '^'}
SCALAR_TYPES = {'f32', 'f16', 'i32', 'u32', 'bool'}
SAME_TYPE_ARGS = {'smoothstep', 'clamp', 'step', 'min', 'max', 'pow'}
COMPONENTWISE = set("""abs acos acosh asin asinh atan atanh ceil cos cosh degrees exp exp2 floor fract inverseSqrt log log2
normalize radians round saturate sign sin sinh sqrt tan tanh trunc reflect refract faceForward dpdx dpdy fwidth""".split())
SCALAR_FUNCS = {'dot', 'length', 'distance', 'determinant'}


def blocks(html):
    """Yield (language, start offset, text) for template literals and script blocks that hold shader code."""
    for m in re.finditer(r'`((?:[^`\\]|\\.)*)`', html, re.S):
        body = m.group(1)
        if GLSL_HINT.search(body):
            yield 'glsl', m.start(1), body
        elif WGSL_HINT.search(body):
            yield 'wgsl', m.start(1), body
    for m in re.finditer(r'<script[^>]*type=["\']([^"\']*)["\'][^>]*>(.*?)</script>', html, re.S | re.I):
        kind = m.group(1).lower()
        if 'wgsl' in kind:
            yield 'wgsl', m.start(2), m.group(2)
        elif 'x-shader' in kind or 'glsl' in kind:
            yield 'glsl', m.start(2), m.group(2)


def clean(code, glsl=False):
    """Blank out ${...} interpolations, comments and (GLSL) preprocessor lines, keeping every offset."""
    out, i, n = list(code), 0, len(code)

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != '\n':
                out[k] = ' '
    while i < n:
        if code.startswith('${', i):
            depth, j = 0, i
            while j < n:
                if code[j] == '{':
                    depth += 1
                elif code[j] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            blank(i, j + 1)
            out[i] = '0'  # keep an expression in place
            i = j + 1
        elif code.startswith('//', i):
            j = code.find('\n', i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
        elif code.startswith('/*', i):
            j = code.find('*/', i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
        elif glsl and code[i] == '#' and (i == 0 or code[i - 1] == '\n' or code[:i].rsplit('\n', 1)[-1].strip() == ''):
            j = code.find('\n', i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
        else:
            i += 1
    return ''.join(out)


def tokenize(code):
    toks = []
    for m in TOKEN.finditer(code):
        if m.lastgroup and m.lastgroup != 'other':
            toks.append((m.lastgroup, m.group(), m.start()))
    return toks


def mark_templates(toks):
    """Indices of '<' / '>' tokens that bracket template arguments (vec3<f32>, array<f32, 4>, var<private>...)."""
    tmpl = set()
    i = 0
    while i < len(toks) - 1:
        kind, text, _ = toks[i]
        if kind == 'id' and TEMPLATED.match(text) and toks[i + 1][1] == '<':
            depth, j = 0, i + 1
            while j < len(toks):
                t = toks[j][1]
                if t == '<':
                    depth += 1
                elif t in ('>', '>>'):
                    depth -= 2 if t == '>>' else 1
                elif t in (';', '{', '}', '=') or (t == '(' and depth <= 0):
                    break
                tmpl.add(j)
                if depth <= 0:
                    break
                j += 1
        i += 1
    return tmpl


def scan_to(code, i, stops):
    """From i, the index of the first stop char at bracket depth 0."""
    depth = 0
    while i < len(code):
        c = code[i]
        if depth == 0 and c in stops:
            return i
        if c in '([':
            depth += 1
        elif c in ')]':
            depth -= 1
        i += 1
    return len(code)


def type_of_name(t):
    m = re.match(r'(vec([234])|mat[234]x[234])', t or '')
    if m:
        return f'v{m.group(2)}' if m.group(2) else 'm'
    return 's' if t in SCALAR_TYPES else None


# --- WebGPU calls in JavaScript ------------------------------------------------------------------------------------
JS_SKIP_TYPE = re.compile(r'wgsl|x-shader|glsl|json|importmap|template', re.I)
REGEX_PREV = set('(,=:[!&|?{};')
IDENT = r'[A-Za-z_$][\w$]*'
GPU_COLOR = ('r', 'g', 'b', 'a')
DYN_ALIGN = 256  # minUniformBufferOffsetAlignment and minStorageBufferOffsetAlignment on a default device


def scripts(html, path):
    """Yield (start offset, text) of each JavaScript block; a .js/.mjs file is JavaScript as a whole."""
    if path.lower().endswith(('.js', '.mjs')):
        yield 0, html
        return
    for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', html, re.S | re.I):
        t = re.search(r'type\s*=\s*["\']?([^"\'\s>]+)', m.group(1))
        if not (t and JS_SKIP_TYPE.search(t.group(1))):
            yield m.start(2), m.group(2)


def js_scan(code):
    """One pass over JavaScript: comments blanked (offsets kept), the matching closer of every bracket outside strings,
    comments and regex literals (`pairs`), and the end of every string, template or regex literal (`skip`)."""
    out, n, pairs, skip, stack, i, prev = list(code), len(code), {}, {}, [], 0, ''
    while i < n:
        c = code[i]
        if c in '"\'':
            j = i + 1
            while j < n and code[j] not in (c, '\n'):
                j += 2 if code[j] == '\\' else 1
            skip[i], i, prev = j + 1, j + 1, 'a'
            continue
        if c == '`':
            j, depth = i + 1, 0
            while j < n and not (code[j] == '`' and depth == 0):
                if code[j] == '\\':
                    j += 1
                elif code.startswith('${', j):
                    depth += 1
                    j += 1
                elif code[j] == '}' and depth:
                    depth -= 1
                j += 1
            skip[i], i, prev = j + 1, j + 1, 'a'
            continue
        if code.startswith('//', i) or code.startswith('/*', i):
            j = code.find('\n', i) if code[i + 1] == '/' else code.find('*/', i + 2)
            j = n if j < 0 else (j if code[i + 1] == '/' else j + 2)
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            i = j
            continue
        if c == '/' and prev in REGEX_PREV | {''}:
            j, cls = i + 1, False
            while j < n and code[j] != '\n' and not (code[j] == '/' and not cls):
                if code[j] == '\\':
                    j += 1
                elif code[j] in '[]':
                    cls = code[j] == '['
                j += 1
            skip[i], i, prev = j + 1, j + 1, 'a'
            continue
        if c in '([{':
            stack.append(i)
        elif c in ')]}' and stack:
            pairs[stack.pop()] = i
        if not c.isspace():
            prev = c
        i += 1
    return ''.join(out), pairs, skip


class JS:
    """Just enough of a JavaScript reader to look inside literal call arguments: object keys, array items, and one
    identifier followed to its unique const/let/var declaration."""

    def __init__(self, code):
        self.code, self.pairs, self.skip = js_scan(code)
        self.opens = sorted(k for k in self.pairs if self.code[k] == '{')
        decl = {}
        for m in re.finditer(r'\b(?:const|let|var)\s+(' + IDENT + r')\s*=(?![=>])\s*', self.code):
            decl.setdefault(m.group(1), []).append(m.end())
        self.decl = {k: v[0] for k, v in decl.items() if len(v) == 1}
        assigned = collections.Counter(re.findall(r'(?<![\w$.])(' + IDENT + r')\s*=(?![=>])', self.code))
        self.consts = {}  # `const A = 256, B = 4;` names assigned nowhere else (a loop counter is not a constant)
        for m in re.finditer(r'\bconst\s+([^;]{1,400})', self.code):
            for k, v in re.findall(r'(?:^|,)\s*(' + IDENT + r')\s*=\s*(\d+)\s*(?=,|$|\n)', m.group(1)):
                if assigned[k] == 1:
                    self.consts[k] = int(v)

    def ws(self, i):
        while i < len(self.code) and self.code[i].isspace():
            i += 1
        return i

    def items(self, a, b):
        """Top-level comma-separated items of code[a:b] as (start, end), blank items dropped."""
        out, start, i = [], a, a
        while i < b:
            if i in self.pairs:
                i = self.pairs[i] + 1
                continue
            if i in self.skip:
                i = self.skip[i]
                continue
            if self.code[i] == ',':
                out.append((start, i))
                start = i + 1
            i += 1
        out.append((start, b))
        return [(x, y) for x, y in out if self.code[x:y].strip()]

    def props(self, o):
        """{key: (value start, value end) or None for a shorthand} of the object literal at o; None if it spreads."""
        props = {}
        for x, y in self.items(o + 1, self.pairs[o]):
            t = self.code[x:y]
            if t.lstrip().startswith('...'):
                return None
            m = re.match(r'\s*(?:(' + IDENT + r')|["\']([^"\']*)["\'])\s*(:)?', t)
            if m:
                props[m.group(1) or m.group(2)] = (x + m.end(), y) if m.group(3) else None
        return props

    def text(self, span):
        return self.code[span[0]:span[1]].strip() if span else ''

    def literal(self, i, want='{['):
        """Index of the object/array literal the value at i is, following a bare identifier to its declaration."""
        for _ in range(2):
            i = self.ws(i)
            if i < len(self.code) and self.code[i] in want and i in self.pairs:
                return i
            m = re.match(IDENT + r'\s*(?=[,;})\]\n]|$)', self.code[i:i + 80])
            if not m or m.group().strip() not in self.decl:
                return None
            i = self.decl[m.group().strip()]
        return None

    def int_value(self, t):
        """An integer literal, or a name (last part of a dotted one) declared once as `const NAME = <integer>`."""
        t = t.strip()
        if re.fullmatch(r'\d+', t):
            return int(t)
        m = re.fullmatch(r'(?:[\w$]+\.)*(' + IDENT + ')', t)
        return self.consts.get(m.group(1)) if m else None

    def enclosing(self, off):
        """The innermost '{' whose block contains off."""
        k = bisect.bisect_left(self.opens, off) - 1
        while k >= 0:
            o = self.opens[k]
            if self.pairs[o] > off:
                return o
            k -= 1
        return None

    def target(self, call_start):
        """The last name part of what a call's result is assigned to (`x.bgl = device.create...(`, `bgl: ...`)."""
        m = re.search(r'(' + IDENT + r')\s*(?<![=!<>])(?:=|:)\s*(?:await\s+)?[\w$.]*$', self.code[max(0, call_start - 200):call_start])
        return m.group(1) if m else None


class Linter:
    def __init__(self, html, path):
        self.html, self.path, self.found = html, path, []
        self.lines = html.splitlines()

    def add(self, off, kind, msg):
        line = self.html.count('\n', 0, off) + 1
        self.found.append((line, kind, msg, self.lines[line - 1].strip()[:160] if line - 1 < len(self.lines) else ''))

    # --- GLSL ---------------------------------------------------------------------------------------------------
    def glsl(self, base, raw):
        code = clean(raw, glsl=True)
        self.reserved(base, code, r'(?<![\w.])([A-Za-z_]\w*)\b', GLSL_RESERVED, 'glsl-reserved-word', 'GLSL ES 3.00 (WebGL2)')

    def reserved(self, base, code, pattern, words, kind, lang):
        """One finding per reserved word per shader block, at its first use, with the count of further uses."""
        hits = {}
        for m in re.finditer(pattern, code):
            if m.group(1) in words:
                hits.setdefault(m.group(1), []).append(m.start())
        for w, offs in hits.items():
            more = f' ({len(offs) - 1} more use{"s" if len(offs) > 2 else ""} in this shader)' if len(offs) > 1 else ''
            self.add(base + offs[0], kind, f"'{w}' is reserved in {lang}; rename it{more}")

    # --- WGSL ---------------------------------------------------------------------------------------------------
    def wgsl(self, base, raw):
        code = clean(raw)
        self.reserved(base, code, r'(?<![\w.@$])([A-Za-z_]\w*)\b', RESERVED, 'reserved-word', 'WGSL')
        for m in re.finditer(r'\b(let|var|const)\b(?:<[^>]*>)?\s+\w+', code):
            stmt = code[m.end():scan_to(code, m.end(), ';{}')]
            if re.search(r',\s*[A-Za-z_]\w*\s*(:\s*[\w<>, ]+)?=(?!=)', stmt) and '=' in stmt.split(',')[0]:
                self.add(base + m.start(), 'comma-declaration', f'one {m.group(1)} per declaration; WGSL has no comma lists')
        for m in re.finditer(r'\breturn\b', code):
            end = scan_to(code, m.end(), ';}')
            if end < len(code) and code[end] == '}':
                self.add(base + m.start(), 'missing-semicolon', "'return ...' must end with ';'")
        for m in re.finditer(r'\b(var|let|const)\b(\s*<[^>]*>)?\s+(\w+)\s*:\s*(array|vec[234]\w*|mat[234]x[234]\w*)\s*(<(?:[^<>;=]|<[^<>;=]*>)*>)?\s*\(', code):
            self.add(base + m.start(), 'declaration-syntax', f"'{m.group(3)}: type(...)' needs '=': write '{m.group(1)}{m.group(2) or ''} {m.group(3)} = {m.group(4)}{m.group(5) or ''}(...)'")
        pos_structs = set()
        for m in re.finditer(r'\bstruct\s+([A-Za-z_]\w*)\s*\{', code):
            if '@builtin(position)' in code[m.end():scan_to(code, m.end(), '}')].replace(' ', ''):
                pos_structs.add(m.group(1))
        for m in re.finditer(r'@fragment\s+fn\s+\w+\s*\(', code):
            params = code[m.end():scan_to(code, m.end(), ')')]
            n = params.replace(' ', '').count('@builtin(position)') + sum(1 for t in re.findall(r':\s*([A-Za-z_]\w*)', params) if t in pos_structs)
            if n > 1:
                self.add(base + m.start(), 'duplicate-position', '@builtin(position) reaches this fragment input twice')
        depth_tex = set(re.findall(r'\bvar\s+([A-Za-z_]\w*)\s*:\s*texture_depth\w*', code))
        for m in re.finditer(r'textureSampleLevel\s*\(\s*([A-Za-z_]\w*)', code):
            if m.group(1) in depth_tex:
                last = code[m.end():scan_to(code, m.end(), ')')].split(',')[-1].strip()
                if re.fullmatch(r'[0-9]*\.[0-9]*f?', last):
                    self.add(base + m.start(), 'depth-level', 'the level of a depth texture is an integer (0, not 0.0)')
        for m in re.finditer(r'\?', code):
            self.add(base + m.start(), 'ternary', "WGSL has no '?:'; use select(falseValue, trueValue, cond)")
        toks = tokenize(code)
        tmpl = mark_templates(toks)
        self.operators(base, toks, tmpl)
        self.scopes(base, toks, tmpl)
        self.atan_args(base, toks)

    def atan_args(self, base, toks):
        """GLSL's atan(y, x) does not exist in WGSL: its atan takes one argument and the two-argument form is atan2."""
        for i, (kind, t, off) in enumerate(toks):
            if kind != 'id' or t != 'atan' or i + 1 >= len(toks) or toks[i + 1][1] != '(' or (i and toks[i - 1][1] == '.'):
                continue
            depth, args, empty = 0, 1, True
            for j in range(i + 1, len(toks)):
                tt = toks[j][1]
                if tt in ('(', '['):
                    depth += 1
                elif tt in (')', ']'):
                    depth -= 1
                    if depth == 0:
                        break
                if depth == 1 and tt == ',':
                    args, empty = args + 1, True
                elif not (depth == 1 and tt == '('):
                    empty = False
            if empty and args > 1:  # a trailing comma, atan(x,), is still one argument
                args -= 1
            if args == 2:
                self.add(base + off, 'atan-two-args', "atan(y, x) with two arguments is GLSL; WGSL's atan takes one argument:"
                         " write atan2(y, x)")

    def operators(self, base, toks, tmpl):
        """Operators WGSL accepts only with parentheses: mixed bitwise ops, bitwise next to anything else, a shift
        next to arithmetic or another shift, && next to ||, and chained comparisons."""
        stack = [[]]  # one list of (op, offset) per bracket level, cut at , ; : = { }
        prev = None

        def check_segment(seg):
            ops = [o for o, _ in seg]
            if not ops:
                return
            s = set(ops)
            bits = s & BITS
            msg = None
            if '&&' in s and '||' in s:
                msg = "mixing '&&' and '||' needs parentheses"
            elif len(bits) > 1:
                msg = f"mixing {' and '.join(repr(b) for b in sorted(bits))} needs parentheses"
            elif bits and s - bits:
                msg = f"mixing {next(iter(bits))!r} with {sorted(s - bits)[0]!r} needs parentheses"
            elif s & SHIFT and (s & ARITH or ops.count('<<') + ops.count('>>') > 1):
                msg = 'a shift next to arithmetic or another shift needs parentheses'
            else:
                run = 0
                for o in ops + ['&&']:
                    if o in REL:
                        run += 1
                    elif o in ('&&', '||'):
                        if run > 1:
                            msg = 'chained comparisons (a < b < c) need parentheses or &&'
                        run = 0
            if msg:
                self.add(base + seg[0][1], 'operator-mix', msg)
        for i, (kind, t, off) in enumerate(toks):
            if i in tmpl:
                prev = ('tmpl', t)
                continue
            if t in ('(', '['):
                stack.append([])
            elif t in (')', ']'):
                if len(stack) > 1:  # an unbalanced closer at the top level is ignored
                    check_segment(stack.pop())
            elif t in (',', ';', ':', '{', '}', '->', '@') or t in ASSIGN:
                check_segment(stack[-1])
                stack[-1] = []
            elif kind == 'op':
                operand_before = prev is not None and (prev[0] in ('id', 'num') and prev[1] not in KEYWORDS or prev[1] in (')', ']'))
                if t in ARITH | SHIFT | REL | BITS | {'&&', '||'} and operand_before:
                    stack[-1].append((t, off))
            prev = (kind, t)
        for seg in stack:
            check_segment(seg)

    def scopes(self, base, toks, tmpl):
        """Walk declarations block by block: assignments to immutable names, module-scope redeclarations, and scalar
        arguments mixed with vectors in calls that need one type."""
        n = len(toks)
        scopes = [{}]          # name -> (kind, type)
        module_names = {}
        pending_params = None  # params of the fn whose body '{' comes next
        stmt_start = True
        i = 0

        def lookup(name):
            for sc in reversed(scopes):
                if name in sc:
                    return sc[name]
            return None

        def match(i, open_t, close_t):
            depth = 0
            for j in range(i, n):
                if toks[j][1] == open_t:
                    depth += 1
                elif toks[j][1] == close_t:
                    depth -= 1
                    if depth == 0:
                        return j
            return n - 1

        def split_args(a, b):
            args, cur, depth = [], [], 0
            for j in range(a, b):
                t = toks[j][1]
                if t in ('(', '['):
                    depth += 1
                elif t in (')', ']'):
                    depth -= 1
                if t == ',' and depth == 0:
                    args.append(cur)
                    cur = []
                else:
                    cur.append(j)
            if cur:
                args.append(cur)
            return args

        def expr_type(idx):
            """'v2'/'v3'/'v4', 's', 'm' or None for the expression made of token indices idx."""
            idx = [j for j in idx if j not in tmpl]
            if not idx:
                return None
            operands, cur, depth = [], [], 0
            for j in idx:
                t = toks[j][1]
                if t in ('(', '['):
                    depth += 1
                elif t in (')', ']'):
                    depth -= 1
                if depth == 0 and toks[j][0] == 'op' and t in REL | BITS | SHIFT | {'&&', '||'}:
                    return None
                if depth == 0 and t in ARITH and cur and not (toks[cur[-1]][0] == 'op' and toks[cur[-1]][1] not in (')', ']')):
                    operands.append(cur)
                    cur = []
                else:
                    cur.append(j)
            operands.append(cur)
            types = [operand_type(o) for o in operands]
            vecs = {t for t in types if t and t.startswith('v')}
            if len(vecs) == 1:
                return vecs.pop()
            if vecs:
                return None
            return 's' if all(t == 's' for t in types) else None

        def operand_type(idx):
            while idx and toks[idx[0]][1] in ('-', '!', '~'):
                idx = idx[1:]
            if not idx:
                return None
            k0, t0, _ = toks[idx[0]]
            j = 1
            if k0 == 'num':
                ty = 's'
            elif t0 == '(':
                close = next((p for p, jj in enumerate(idx) if jj == match(idx[0], '(', ')')), len(idx) - 1)
                ty = expr_type(idx[1:close])
                j = close + 1
            elif k0 == 'id' and len(idx) > 1 and toks[idx[1]][1] == '(':
                close_tok = match(idx[1], '(', ')')
                close = next((p for p, jj in enumerate(idx) if jj == close_tok), len(idx) - 1)
                ty = call_type(t0, split_args(idx[1] + 1, close_tok))
                j = close + 1
            elif k0 == 'id':
                d = lookup(t0)
                ty = d[1] if d else None
            else:
                return None
            while j < len(idx):  # postfix: .swizzle, .field, [index]
                t = toks[idx[j]][1]
                if t == '.' and j + 1 < len(idx):
                    f = toks[idx[j + 1]][1]
                    if ty and ty.startswith('v') and re.fullmatch(r'[xyzw]{1,4}|[rgba]{1,4}', f):  # a struct field can be named 'wy'
                        ty = 's' if len(f) == 1 else f'v{len(f)}'
                    else:
                        ty = None
                    j += 2
                elif t == '[':
                    ty = 's' if ty and ty.startswith('v') else None
                    close_tok = match(idx[j], '[', ']')
                    j = next((p for p, jj in enumerate(idx) if jj == close_tok), len(idx) - 1) + 1
                else:
                    return None
            return ty

        def call_type(name, args):
            types = [expr_type(a) for a in args]
            tn = type_of_name(name)
            if tn:
                return tn
            if name in SCALAR_FUNCS:
                return 's'
            if name == 'cross':
                return 'v3'
            if name in COMPONENTWISE and types:
                return types[0]
            if name in SAME_TYPE_ARGS | {'mix', 'select', 'atan2', 'fma'}:
                vecs = {t for t in types if t and t.startswith('v')}
                if len(vecs) == 1:
                    return vecs.pop()
                return 's' if types and all(t == 's' for t in types) else None
            return None

        def check_call(name, open_i):
            close = match(open_i, '(', ')')
            args = split_args(open_i + 1, close)
            types = [expr_type(a) for a in args]
            vecs = [t for t in types if t and t.startswith('v')]
            if vecs and 's' in types:
                shown = ', '.join({'s': 'scalar', None: '?'}.get(t, f'vec{t[1:]}' if t else '?') for t in types)
                self.add(base + toks[open_i][2], 'scalar-splat', f"{name}({shown}): WGSL does not widen a scalar here; "
                         f"write the scalar as vec{vecs[0][1:]}f(...)")

        while i < n:
            kind, t, off = toks[i]
            nxt = toks[i + 1][1] if i + 1 < n else ''
            if t == 'fn' and i + 2 < n and toks[i + 1][0] == 'id':
                name = toks[i + 1][1]
                if len(scopes) == 1:
                    self.redeclared(module_names, name, base + toks[i + 1][2])
                if toks[i + 2][1] == '(':
                    close = match(i + 2, '(', ')')
                    params = {}
                    for a in split_args(i + 3, close):
                        a = [j for j in a if j not in tmpl]
                        colon = next((p for p, j in enumerate(a) if toks[j][1] == ':'), None)
                        if colon is not None and colon > 0:  # [@attr(...)] name : type
                            ptype = toks[a[colon + 1]][1] if colon + 1 < len(a) else None
                            params[toks[a[colon - 1]][1]] = ('param', type_of_name(ptype))
                    pending_params = params
                    i = close + 1
                    continue
            if t == 'struct' and nxt and len(scopes) == 1:
                self.redeclared(module_names, nxt, base + toks[i + 1][2])
            if t == 'alias' and nxt and len(scopes) == 1:
                self.redeclared(module_names, nxt, base + toks[i + 1][2])
            if t == '{':
                scopes.append(pending_params or {})
                pending_params = None
                stmt_start = True
                i += 1
                continue
            if t == '}':
                if len(scopes) > 1:
                    scopes.pop()
                stmt_start = True
                i += 1
                continue
            if t == ';':
                stmt_start = True
                i += 1
                continue
            if t in ('let', 'var', 'const', 'override'):
                j = i + 1
                while j < n and j in tmpl:
                    j += 1
                if j < n and toks[j][0] == 'id':
                    name = toks[j][1]
                    ty = None
                    k = j + 1
                    if k < n and toks[k][1] == ':':
                        ty = type_of_name(toks[k + 1][1]) if k + 1 < n else None
                    end = k
                    while end < n and toks[end][1] not in ('=', ';'):
                        end += 1
                    if end < n and toks[end][1] == '=' and ty is None:
                        stop, depth = end + 1, 0
                        while stop < n:
                            tt = toks[stop][1]
                            if tt in ('(', '['):
                                depth += 1
                            elif tt in (')', ']'):
                                depth -= 1
                            elif tt in (';', '{', '}') and depth <= 0:
                                break
                            stop += 1
                        for jj in range(end + 1, stop):  # calls inside the initialiser
                            if toks[jj][1] in SAME_TYPE_ARGS and jj + 1 < n and toks[jj + 1][1] == '(':
                                check_call(toks[jj][1], jj + 1)
                        ty = expr_type(list(range(end + 1, stop)))
                        if len(scopes) == 1:
                            self.redeclared(module_names, name, base + toks[j][2])
                        scopes[-1][name] = (t if t != 'override' else 'const', ty)
                        i = stop
                        stmt_start = False
                        continue
                    if len(scopes) == 1:
                        self.redeclared(module_names, name, base + toks[j][2])
                    scopes[-1][name] = (t if t != 'override' else 'const', ty)
                i = j + 1
                stmt_start = False
                continue
            if t in SAME_TYPE_ARGS and nxt == '(' and (i == 0 or toks[i - 1][1] != '.'):
                check_call(t, i + 1)
            if stmt_start and kind == 'id' and t not in KEYWORDS and t != '_' and len(scopes) > 1:
                j = i + 1
                while j < n:  # lvalue: name (.field | [index])*
                    if toks[j][1] == '.' and j + 1 < n:
                        j += 2
                    elif toks[j][1] == '[':
                        j = match(j, '[', ']') + 1
                    else:
                        break
                if j < n and (toks[j][1] in ASSIGN or toks[j][1] in ('++', '--')):
                    d = lookup(t)
                    if d and d[0] in ('let', 'const', 'param'):
                        what = {'let': 'a let', 'const': 'a const', 'param': 'a function parameter'}[d[0]]
                        self.add(base + off, 'immutable-assigned', f"'{t}' is {what} (immutable); copy it into a var to change it")
            stmt_start = False
            i += 1

    def redeclared(self, names, name, off):
        if name in names:
            self.add(off, 'redeclared', f"'{name}' is declared twice at module scope (structs, functions and module variables share one namespace)")
        else:
            names[name] = off

    def run(self):
        for lang, base, raw in blocks(self.html):
            (self.glsl if lang == 'glsl' else self.wgsl)(base, raw)
        for base, raw in scripts(self.html, self.path):
            if re.search(r'beginRenderPass|createBindGroup|setBindGroup|clearValue', raw):
                self.webgpu_js(base, JS(raw))
        return self.found

    # --- WebGPU calls in JavaScript -----------------------------------------------------------------------------------
    def webgpu_js(self, base, js):
        code = js.code
        self.clear_values(base, js)
        for m in re.finditer(r'(?<![\w$.])(loadValue|depthLoadValue|stencilLoadValue)\s*:', code):
            att = js.enclosing(m.start())
            if att is None or 'view' not in (js.props(att) or {}):  # only in a render pass attachment
                continue
            new = {'loadValue': "loadOp: 'clear', clearValue: {r, g, b, a}", 'depthLoadValue': "depthLoadOp: 'clear', depthClearValue: 1",
                   'stencilLoadValue': "stencilLoadOp: 'clear', stencilClearValue: 0"}[m.group(1)]
            self.add(base + m.start(), 'load-op', f"{m.group(1)} is the 2021 API; write {new} (without a loadOp beginRenderPass throws)")
        self.dynamic_offsets(base, js)

    def clear_values(self, base, js):
        """GPUColor needs r, g, b and a (or exactly four numbers), and a depth clear has no default value."""
        code = js.code
        for m in re.finditer(r'(?<![\w$.])clearValue\s*:(?!:)|\.clearValue\s*=(?!=)', code):
            o = js.literal(m.end())
            if o is not None and code[o] == '{':
                p = js.props(o)
                missing = [k for k in GPU_COLOR if p is not None and k not in p]
                if missing:
                    extra = [k for k in p if k not in GPU_COLOR]
                    self.add(base + m.start(), 'clear-value', f"clearValue {{{', '.join(p)}}} has no {', '.join(missing)}: a GPUColor"
                             f" object needs all four of r, g, b, a{f' ({extra[0]!r} is not one of them)' if extra else ''};"
                             " beginRenderPass throws a TypeError, so the pass never runs")
            elif o is not None:
                its = js.items(o + 1, js.pairs[o])
                if len(its) != 4 and not any(code[x:y].strip().startswith('...') for x, y in its):
                    self.add(base + m.start(), 'clear-value', f"clearValue has {len(its)} numbers; a GPUColor array needs exactly"
                             " four (r, g, b, a): beginRenderPass throws a TypeError, so the pass never runs")
            if m.group().startswith('.'):
                continue
            att = js.enclosing(m.start())
            p = js.props(att) if att is not None else None
            if p and 'view' in p and 'depthLoadOp' not in p:
                lack = [k for k in ('loadOp', 'storeOp') if k not in p]
                if lack:
                    self.add(base + m.start(), 'load-op', f"this colour attachment has clearValue but no {' or '.join(lack)}; both are"
                             " required (loadOp: 'clear' to use clearValue, storeOp: 'store')")
        for m in re.finditer(r'(?<![\w$.])depthLoadOp\s*:\s*(["\'])clear\1', code):
            att = js.enclosing(m.start())
            p = js.props(att) if att is not None else None
            if p is not None and 'depthClearValue' not in p:
                hint = ' (clearValue is the colour field; the depth one is depthClearValue)' if 'clearValue' in p else ''
                self.add(base + m.start(), 'depth-clear-value', "depthLoadOp 'clear' without depthClearValue: it has no default, so"
                         f" the pass fails validation and nothing is drawn; add depthClearValue: 1.0{hint}")

    def dynamic_offsets(self, base, js):
        """hasDynamicOffset bindings need a bound size, offsets need a layout that takes them, and 256-byte alignment."""
        code = js.code
        dynamic = {}  # layout name -> binding numbers with hasDynamicOffset
        for m in re.finditer(r'\bcreateBindGroupLayout\s*\(', code):
            name = js.target(m.start())
            o = js.ws(m.end())
            p = js.props(o) if o in js.pairs and code[o] == '{' else None
            e = js.literal(p['entries'][0], '[') if p and p.get('entries') else None
            for x, y in js.items(e + 1, js.pairs[e]) if e is not None else ():
                k = js.ws(x)
                ep = js.props(k) if k in js.pairs and code[k] == '{' else None
                if ep and ep.get('binding') and ep.get('buffer'):
                    bo = js.literal(ep['buffer'][0], '{')
                    if bo is not None and re.search(r'hasDynamicOffset\s*:\s*true', code[bo:js.pairs[bo]]):
                        dynamic.setdefault(name, set()).add(js.text(ep['binding']))
        for m in re.finditer(r'\bcreateBindGroup\s*\(', code):
            o = js.ws(m.end())
            p = js.props(o) if o in js.pairs and code[o] == '{' else None
            if not p or not p.get('layout') or not p.get('entries'):
                continue
            lay = re.fullmatch(r'(?:[\w$]+\.)*(' + IDENT + ')', js.text(p['layout']))
            dyn = dynamic.get(lay.group(1)) if lay else None
            e = js.literal(p['entries'][0], '[') if dyn else None
            for x, y in js.items(e + 1, js.pairs[e]) if e is not None else ():
                k = js.ws(x)
                ep = js.props(k) if k in js.pairs and code[k] == '{' else None
                if not ep or js.text(ep.get('binding')) not in dyn or not ep.get('resource'):
                    continue
                r = js.literal(ep['resource'][0], '{')
                if r is not None:
                    rp = js.props(r)
                    unsized = rp is not None and 'size' not in rp
                else:  # the GPUBuffer itself as the resource binds all of it
                    n = re.fullmatch(IDENT, js.text(ep['resource']))
                    unsized = bool(n and n.group() in js.decl and re.match(r'(?:await\s+)?[\w$.]*createBuffer\s*\(',
                                                                             code[js.decl[n.group()]:js.decl[n.group()] + 80]))
                if unsized:
                    self.add(base + k, 'dynamic-offset-size', f"binding {js.text(ep['binding'])} has hasDynamicOffset but its buffer"
                             " binding has no size, so it binds the whole buffer and any non-zero dynamic offset is out of bounds"
                             " (every pass using it fails); set size to the bytes one draw reads (a slot of 256 or more)")
        takes_offsets = re.search(r'hasDynamicOffset\s*:\s*true', code)
        reads_limit = re.search(r'min(Uniform|Storage)BufferOffsetAlignment', code)
        for m in re.finditer(r'\.setBindGroup\s*\(', code):
            o = m.end() - 1
            args = js.items(o + 1, js.pairs[o]) if o in js.pairs else []
            if len(args) < 3:
                continue
            off = js.text(args[2])
            if not takes_offsets and (re.fullmatch(r'\[\s*\S[\s\S]*\]', off) or 'Uint32Array' in off):
                self.add(base + m.start(), 'dynamic-offset', "setBindGroup passes dynamic offsets but no bind group layout here sets"
                         " hasDynamicOffset: true (a layout: 'auto' pipeline never does), so the call fails validation")
                continue
            a = js.ws(args[2][0])
            if reads_limit or code[a] != '[' or a not in js.pairs:
                continue
            for x, y in js.items(a + 1, js.pairs[a]):
                item = code[x:y].strip()
                if re.search(r'[+\-?:]', item):
                    continue
                vals = [js.int_value(f) for f in item.split('*')]
                known = [v for v in vals if v is not None]
                prod = 1
                for v in known:
                    prod *= v
                # next to an unknown factor a small number is a count (10 * STRIDE), not the stride
                if known and prod % DYN_ALIGN and (None not in vals or prod >= 16):
                    which = '' if item == str(prod) else f" ({prod} is not)"
                    self.add(base + m.start(), 'dynamic-offset-align', f"dynamic offset {item} is not a multiple of {DYN_ALIGN}{which}:"
                             f" the default minimum offset alignment is {DYN_ALIGN}, so setBindGroup fails validation; pad each slot"
                             f" to a multiple of {DYN_ALIGN} bytes")


def lint(path):
    html = open(path, encoding='utf-8', errors='ignore').read()
    return Linter(html, path).run()


def main():
    paras = __doc__.split('\n\n')
    ap = argparse.ArgumentParser(prog='wgsl_lint.py', description=paras[0], epilog='\n\n'.join(paras[2:]),
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pages', nargs='+', metavar='page.html', help='pages (or files) whose shaders to scan')
    ap.add_argument('--strict', action='store_true', help='exit 1 when something was found (default: exit 0, findings are advice)')
    a = ap.parse_intermixed_args()  # usage errors (no page, unknown option) exit 2 with the usage line
    strict = a.strict
    total, rc = 0, 0
    for path in a.pages:
        try:
            found = lint(path)
        except OSError as e:
            print(f'{path}: cannot read: {e}')
            rc = 2
            continue
        seen = set()
        for line, kind, msg, src in sorted(found):
            if (line, kind, msg) in seen:
                continue
            seen.add((line, kind, msg))
            print(f'{path}:{line}: {kind}: {msg}\n    {src}')
        total += len(seen)
        if not found:
            print(f'{path}: no shader traps found (advisory scan, not a compile check)')
    if total:
        print(f'{total} possible shader or WebGPU-call problem(s); each is a lead to check against the source, and the browser'
              ' run decides.')
    sys.exit(rc or (1 if strict and total else 0))


if __name__ == '__main__':
    main()
