/**
 * js/knot/paint.js — draws the rope. Raw WebGL2, nothing imported: the landing
 * page must never load three.js.
 *
 * Every point of the rope goes up in one small texture each frame. The vertex
 * shader runs a smooth curve (a cubic B-spline) through the points and sweeps a
 * thin, rounded band along it; the light is worked out per pixel. Over and under
 * are real depth, so a tight bend, or a strand dragged across another, sorts
 * itself out with no seams.
 *
 * The two loops are the two in assets/logo.png: loop 0 is a washer (its width
 * turns with the bend), loop 1 a belt (its width keeps one direction, so at each
 * end you see its edge fold over and then its inside).
 *
 * The shadow a strand drops on the one below comes from a small, blurred
 * picture of the knot's heights, so it is soft and right for any shape the rope
 * is pulled into. CONTRACTS.md §18.
 */

const RINGS = 420, COLS = 36;               // along a loop, and round a strand

// p: squareness of the band's section · b: its thickness · z: weave height ·
// belt: per loop, 0 washer, 1 belt · tilt: per loop, how far a belt's fold leans ·
// tune: floor, curve, linear, shadow · round: how round the band is lit ·
// g: rim, grain in the dark, grain in the light · sigma: shadow softness
export const LOOK = {
  p: 2.6, b: 0.15, z: 0.5, belt: [0, 1], tilt: [0, 0.7],
  tune: [0.02, 0.66, 0.32, 0.75], round: 0.66, g: [0.1, 0.05, 0.13],
  light: [-0.42, -0.62, 0.66], sigma: 0.46, grain: 1.5,
};

// from the logo: neutral grey in the shadows, warm tan in the light
const RAMP = [[0, 40, 40, 42], [0.12, 54, 53, 52], [0.28, 78, 72, 64], [0.44, 116, 102, 85], [0.6, 160, 139, 112], [0.76, 202, 180, 150], [0.9, 240, 224, 202], [1, 255, 248, 236]];
const GOLD = [226, 166, 92];

const HEAD = `
precision highp float;
uniform sampler2D uRope;    // rows 0-1 (a loop each): x, y, weave, width · rows 2-3: from the weave, cos, sin round a bend, lift
uniform vec2 uView;
uniform vec4 uShape;        // points per loop, squareness, thickness, weave height
uniform vec2 uBelt, uTilt;
in vec3 aP;                 // along (0…1), round (0…2π), loop
vec4 ctl(float i, int row) { int n = int(uShape.x); int k = int(i); k -= (k / n) * n; if (k < 0) k += n; return texelFetch(uRope, ivec2(k, row), 0); }
vec4 spline(vec4 a, vec4 b, vec4 c, vec4 d, float t) { float t2 = t * t, t3 = t2 * t; return (a * (1. - 3. * t + 3. * t2 - t3) + b * (4. - 6. * t2 + 3. * t3) + c * (1. + 3. * t + 3. * t2 - 3. * t3) + d * t3) / 6.; }
`;

// where a vertex is: the curve, its frame, and the band's section round it
const SWEEP = `
  float f = aP.x * uShape.x, i = floor(f), t = f - i; int lp = int(aP.z), lq = lp + 2;
  vec4 a = ctl(i - 1., lp), b = ctl(i, lp), c = ctl(i + 1., lp), d = ctl(i + 2., lp);
  vec4 p = spline(a, b, c, d, t);
  float t2 = t * t;
  vec3 v = (a.xyz * (-1. + 2. * t - t2) + b.xyz * (-4. * t + 3. * t2) + c.xyz * (1. + 2. * t - 3. * t2) + d.xyz * t2) / 2.;
  vec4 e = spline(ctl(i - 1., lq), ctl(i, lq), ctl(i + 1., lq), ctl(i + 2., lq), t);
  float l = max(length(v.xy), 1e-4);
  vec2 T = v.xy / l, Nn = vec2(T.y, -T.x);
  float w = p.w, zed = p.z * uShape.w * w + e.w, slope = (v.z * uShape.w * w) / l;
  float belt = lp == 0 ? uBelt.x : uBelt.y;
  vec2 tn = normalize(mix(vec2(1., 0.), e.yz, belt));
  vec3 Wd = vec3(Nn, 0.) * tn.x - vec3(T, 0.) * tn.y;
  float ph = -(lp == 0 ? uTilt.x : uTilt.y) * tn.y * abs(tn.y);
  Wd = normalize(Wd * cos(ph) + vec3(0., 0., sin(ph)));
  vec3 Bn = cross(Wd, normalize(vec3(T, slope))); Bn /= max(length(Bn), 1e-3);
  float p2 = 2. / uShape.y, ca = cos(aP.y), sa = sin(aP.y);
  vec3 pos = vec3(p.xy, zed) + Wd * (sign(ca) * pow(abs(ca), p2) * w) + Bn * (sign(sa) * pow(abs(sa), p2) * w * uShape.z);
  gl_Position = vec4(pos.x / uView.x * 2. - 1., 1. - pos.y / uView.y * 2., -pos.z / 4000., 1.);
`;

const VS = `#version 300 es
${HEAD}
uniform vec4 uGlow, uEnds; uniform float uHalf;
out vec3 vX, vY; out vec2 vPx; out float vA, vZ, vW, vGlow;
void main() {
  ${SWEEP}
  vX = Wd; vY = Bn; vA = aP.y; vZ = pos.z; vW = w; vPx = pos.xy;
  // a lobe lit up for its link runs gold from its end towards the weave
  int k = lp * 2 + (e.x < 0. ? 0 : 1);
  float g = k == 0 ? uGlow.x : k == 1 ? uGlow.y : k == 2 ? uGlow.z : uGlow.w;
  float end = k == 0 ? uEnds.x : k == 1 ? uEnds.y : k == 2 ? uEnds.z : uEnds.w, u = abs(e.x);
  vGlow = g < 0.01 ? 0. : smoothstep(0., 0.5, g * 1.6 - max(0., end - u) / end) * smoothstep(uHalf * 0.45, uHalf * 1.15, u) * 0.62;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vX, vY; in vec2 vPx; in float vA, vZ, vW, vGlow;
uniform vec4 uShape, uTune; uniform vec3 uLight, uG; uniform vec2 uView; uniform float uGrainPx, uRound, uAlpha;
uniform sampler2D uAbove, uGrain, uRamp;
out vec4 o;
void main() {
  float ca = cos(vA), sa = sin(vA), k = 2. - 2. / uShape.y;
  vec2 n = normalize(vec2(sign(ca) * pow(abs(ca), k) * uRound, sign(sa) * pow(abs(sa), k)));
  vec3 N = normalize(vX * n.x + vY * n.y);
  if (N.z < 0.) N.z = -N.z;
  // how much of what is round here lies above this point (see HFS)
  float h = vZ / ((uShape.w + uShape.z) * vW);
  vec4 B = texture(uAbove, vec2(vPx.x / uView.x, 1. - vPx.y / uView.y) + vec2(uLight.x, -uLight.y) * vW * 0.18 / uView);
  float lv = (h + 0.84) / 0.5;
  float above = lv < 1. ? mix(B.r, B.g, max(lv, 0.)) : lv < 2. ? mix(B.g, B.b, lv - 1.) : lv < 3. ? mix(B.b, B.a, lv - 2.) : B.a * max(0., 4. - lv);
  float d = dot(N, normalize(uLight)), lit = max(0., d * 0.86 + 0.14);
  float v = uTune.x + uTune.y * lit * lit + uTune.z * lit;
  v += pow(1. - clamp(N.z, 0., 1.), 3.) * uG.x * smoothstep(-0.2, 0.8, d);
  v *= 1. - uTune.w * smoothstep(0., 0.62, above);
  float g = texture(uGrain, gl_FragCoord.xy / (256. * uGrainPx)).r - 0.5;
  v += g * mix(uG.y, uG.z, smoothstep(0.05, 0.4, v)) * (1. - 0.6 * smoothstep(0.75, 1., v));
  v = clamp(v, 0.004, 0.996);
  vec3 col = mix(texture(uRamp, vec2(v, 0.25)).rgb, texture(uRamp, vec2(v, 0.75)).rgb, vGlow);
  o = vec4(col * uAlpha, uAlpha);
}`;

// The heights, small. Four channels, each "is it above this level", so they
// can be blurred like any picture and still be read back as "how much is above".
const HVS = `#version 300 es
${HEAD}
out float vH;
void main() { ${SWEEP} vH = pos.z / ((uShape.w + uShape.z) * w); }`;
const HFS = `#version 300 es
precision highp float; in float vH; out vec4 o;
void main() { o = smoothstep(vec4(-0.75, -0.25, 0.25, 0.75), vec4(-0.25, 0.25, 0.75, 1.25), vec4(vH)); }`;

const QVS = `#version 300 es
in vec3 aP; out vec2 vUv; void main() { vUv = aP.xy; gl_Position = vec4(aP.xy * 2. - 1., 0., 1.); }`;
const BFS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main() { vec4 s = vec4(0.); float W = 0.; for (int i = -12; i <= 12; i++) { float x = float(i) * 0.25, w = exp(-0.5 * x * x); s += w * texture(uTex, vUv + uDir * x); W += w; } o = s / W; }`;

/**
 * @returns {null | { resize(w, h, ratio), draw(rope, glow, alpha), look, lost }}
 * null when there is no WebGL2 here; throws if a shader will not build.
 */
export function createPainter(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  const look = { ...LOOK };

  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0; i--;) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
    return { p, u };
  };
  const main = program(VS, FS), height = program(HVS, HFS), blur = program(QVS, BFS);

  // the swept mesh: rings along each loop, columns round each strand
  const verts = new Float32Array(2 * (RINGS + 1) * (COLS + 1) * 3), idx = new Uint32Array(2 * RINGS * COLS * 6);
  let vi = 0, ii = 0;
  for (let l = 0; l < 2; l++) for (let r = 0; r <= RINGS; r++) for (let c = 0; c <= COLS; c++) { verts[vi++] = r / RINGS; verts[vi++] = c / COLS * Math.PI * 2; verts[vi++] = l; }
  for (let l = 0; l < 2; l++) for (let r = 0; r < RINGS; r++) for (let c = 0; c < COLS; c++) {
    const a = l * (RINGS + 1) * (COLS + 1) + r * (COLS + 1) + c, b = a + COLS + 1;
    idx.set([a, b, a + 1, a + 1, b, b + 1], ii); ii += 6;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const quad = gl.createVertexArray(); gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const tex = (filter, wrap) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, wrap], [gl.TEXTURE_WRAP_T, wrap]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const ropeTex = tex(gl.NEAREST, gl.CLAMP_TO_EDGE);
  let data = null, N = 0;

  const rampTex = tex(gl.LINEAR, gl.CLAMP_TO_EDGE);
  {
    const W = 256, px = new Uint8Array(W * 2 * 4), mix = (a, b, t) => a + (b - a) * t;
    for (let i = 0; i < W; i++) {
      const v = i / (W - 1); let j = 0;
      while (j < RAMP.length - 2 && RAMP[j + 1][0] < v) j++;
      const f = Math.min(1, Math.max(0, (v - RAMP[j][0]) / (RAMP[j + 1][0] - RAMP[j][0])));
      for (let n = 0; n < 3; n++) {
        px[i * 4 + n] = mix(RAMP[j][n + 1], RAMP[j + 1][n + 1], f);
        px[(W + i) * 4 + n] = v < 0.72 ? mix(GOLD[n] * 0.2, GOLD[n], v / 0.72) : mix(GOLD[n], 255, (v - 0.72) / 0.28 * 0.75);
      }
      px[i * 4 + 3] = px[(W + i) * 4 + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const grainTex = tex(gl.LINEAR, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, grain(256));

  // the two small pictures the blur goes back and forth between
  const small = [0, 1].map(() => ({ t: tex(gl.LINEAR, gl.CLAMP_TO_EDGE), f: gl.createFramebuffer() }));
  const depth = gl.createRenderbuffer();
  let sw = 0, sh = 0, W = 1, H = 1, ratio = 1;
  function sizeSmall(w, h) {
    if (w === sw && h === sh) return;
    sw = w; sh = h;
    for (const s of small) {
      gl.bindTexture(gl.TEXTURE_2D, s.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.t, 0);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, small[0].f); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function bind(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
  function shape(pr) {
    gl.useProgram(pr.p); bind(0, ropeTex, pr.u.uRope);
    gl.uniform2f(pr.u.uView, W, H); gl.uniform4f(pr.u.uShape, N, look.p, look.b, look.z);
    gl.uniform2f(pr.u.uBelt, look.belt[0], look.belt[1]); gl.uniform2f(pr.u.uTilt, look.tilt[0], look.tilt[1]);
  }

  return {
    look,
    get lost() { return gl.isContextLost(); },
    resize(w, h, r) {
      W = w; H = h; ratio = r;
      canvas.width = Math.max(1, Math.round(w * r)); canvas.height = Math.max(1, Math.round(h * r));
      sizeSmall(Math.max(16, Math.round(w / 4)), Math.max(16, Math.round(h / 4)));
    },
    /** @param glow per lobe end: loop 0 arm, loop 0 foot, loop 1 arm, loop 1 foot */
    draw(rope, glow = [0, 0, 0, 0], alpha = 1) {
      if (gl.isContextLost()) return;
      const n = rope.px.length / 2, sc = rope.sc;
      if (!data || N !== n) {
        N = n; data = new Float32Array(N * 4 * 4);
        gl.bindTexture(gl.TEXTURE_2D, ropeTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 4, 0, gl.RGBA, gl.FLOAT, null);
      }
      for (let i = 0; i < 2 * N; i++) {
        const o = i * 4, q = o + 2 * N * 4;
        data[o] = rope.x(i); data[o + 1] = rope.y(i); data[o + 2] = rope.pz[i]; data[o + 3] = rope.rad[i < N ? 0 : 1] * sc * rope.fat[i];
        data[q] = rope.u[i] * sc; data[q + 1] = rope.side[i]; data[q + 2] = rope.turn[i]; data[q + 3] = rope.lift[i] * sc;
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ropeTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 4, gl.RGBA, gl.FLOAT, data);

      // heights, small, then blurred both ways
      gl.bindFramebuffer(gl.FRAMEBUFFER, small[0].f); gl.viewport(0, 0, sw, sh);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bindVertexArray(vao); shape(height); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
      gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(quad); gl.useProgram(blur.p);
      const s = look.sigma * 0.5 * (rope.rad[0] + rope.rad[1]) * sc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, small[1].f); bind(0, small[0].t, blur.u.uTex); gl.uniform2f(blur.u.uDir, s / W, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, small[0].f); bind(0, small[1].t, blur.u.uTex); gl.uniform2f(blur.u.uDir, 0, s / H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // the rope
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bindVertexArray(vao); shape(main);
      bind(1, small[0].t, main.u.uAbove); bind(2, grainTex, main.u.uGrain); bind(3, rampTex, main.u.uRamp);
      gl.uniform3fv(main.u.uLight, look.light); gl.uniform4fv(main.u.uTune, look.tune); gl.uniform3fv(main.u.uG, look.g);
      gl.uniform1f(main.u.uRound, look.round); gl.uniform1f(main.u.uGrainPx, look.grain * ratio); gl.uniform1f(main.u.uAlpha, alpha);
      gl.uniform4f(main.u.uGlow, glow[0], glow[1], glow[2], glow[3]);
      gl.uniform4fv(main.u.uEnds, rope.ends.map((e) => e * sc)); gl.uniform1f(main.u.uHalf, rope.half * sc);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    },
  };
}

/** Fine, even grain: seeded white noise, ranked so every level is used equally. */
function grain(n) {
  let s = 11;
  const a = Float32Array.from({ length: n * n }, () => (s = (s * 16807) % 2147483647) / 2147483647);
  const order = Array.from(a.keys()).sort((p, q) => a[p] - a[q]), out = new Uint8Array(n * n);
  order.forEach((k, r) => { out[k] = Math.floor(r / (n * n) * 256); });
  return out;
}
