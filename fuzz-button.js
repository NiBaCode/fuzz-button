/*
  Fuzz Button: a real <button> covered in hair. Press it and the pile flattens, release it and it springs back.
  One file, no libraries, WebGL2.

  <fuzz-button label="Get started" color="#FFB000" text-color="#090A0C" width="320" height="110" fuzz="1"></fuzz-button>
  Add shed="1" and every press costs it some hair; it grows back when you leave it alone.

  Listen to it like any button: el.addEventListener("click", ...)
  For scripted demos: el.press(x, y), el.release(), with x and y measured from the centre of the button.
*/
(() => {
  const PAD = 72;              // room around the button for stray hairs and shed tufts
  const SEGMENTS = 5;          // each hair is a strip of this many sections
  const MAX_TUFTS = 90;
  const MAX_RIPPLES = 4;

  const HAIR_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aRoot;
  layout(location = 1) in vec2 aLean;
  layout(location = 2) in vec3 aInfo;   // x: height on the cushion, y: random, z: 1 inside the letters
  uniform vec2 uView, uHalf, uPressAt, uCursor, uDrag;
  uniform float uLen, uWidth, uPress, uHover, uTime, uBreeze, uBald;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform vec3 uDeep, uBody, uTip, uInk;
  out vec3 vColor;

  vec2 sweep;
  vec2 bow;
  float reach;

  vec2 pointAt(float t) {
    return sweep * reach * (0.3 * t + 0.7 * t * t) + bow * reach * sin(t * 3.1416) * 0.1;
  }

  void main() {
    float t = floor(float(gl_VertexID) / 2.0) / ${SEGMENTS}.0;
    float side = mod(float(gl_VertexID), 2.0) * 2.0 - 1.0;
    float cushion = aInfo.x, seed = aInfo.y, ink = aInfo.z;

    // The press: a soft footprint around the finger, the rest of the pile follows at a third
    vec2 fromPress = aRoot - uPressAt;
    float pressDist = length(fromPress);
    float footprint = exp(-pressDist * pressDist / (2.0 * uHalf.y * uHalf.y * 1.5));
    float flat_ = uPress * (0.32 + 0.68 * footprint);

    reach = uLen * (0.72 + 0.56 * seed) * (1.0 - 0.6 * flat_) * (1.0 - 0.35 * ink);
    sweep = aLean * (1.0 + 0.55 * max(flat_, 0.0));
    sweep += fromPress / (pressDist + 12.0) * max(flat_, 0.0) * 0.95;

    // The cursor parts the pile and drags it along
    vec2 fromCursor = aRoot - uCursor;
    float cursorDist = length(fromCursor);
    float touch = exp(-cursorDist * cursorDist / 2600.0) * uHover;
    sweep += fromCursor / (cursorDist + 10.0) * touch * 1.25 + uDrag * touch;

    // After a release a ring travels through the pile
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      float age = uRipples[i].z;
      if (age < 0.0) continue;
      vec2 fromRing = aRoot - uRipples[i].xy;
      float ringDist = length(fromRing);
      float offset = (ringDist - age * 420.0) / 30.0;
      float band = exp(-offset * offset) * exp(-age * 3.4);
      sweep += fromRing / (ringDist + 8.0) * band * 1.3;
      reach *= 1.0 + 0.35 * band;
    }

    // Worn patches: each hair has its own moment to go, grouped so the bald spots look natural
    float patch_ = 0.5 + 0.5 * sin(aRoot.x * 0.06 + 1.7) * cos(aRoot.y * 0.09 - 0.6);
    float keep = mix(fract(seed * 5.7), patch_, 0.45);
    float growth = smoothstep(uBald * 1.2 - 0.14, uBald * 1.2, keep);
    reach *= mix(0.13, 1.0, growth);     // bald still leaves stubble, so the surface and the letters stay readable

    // Slow air, so the button is never completely still
    float air = sin(aRoot.x * 0.021 + uTime * 1.25 + seed * 5.0) * 0.1 + sin(aRoot.y * 0.034 - uTime * 0.85) * 0.07;
    sweep += vec2(air, air * 0.55) * uBreeze;

    bow = vec2(-sweep.y, sweep.x) * (seed - 0.5) * 2.4;

    vec2 here = aRoot + pointAt(t);
    vec2 along = normalize(pointAt(t + 0.03) - pointAt(t - 0.03) + vec2(1e-4));
    float width = uWidth * (1.0 - t * t * 0.86) * (0.72 + 0.56 * fract(seed * 13.7)) * mix(0.72, 1.0, growth);
    vec2 pos = here + vec2(-along.y, along.x) * side * width;

    // Colour: dark at the root, dyed along its length, catching the light at the tip
    float overhead = 0.7 - 0.3 * aRoot.y / uHalf.y;
    vec3 c = mix(uDeep, uBody, smoothstep(0.0, 0.62, t));
    c = mix(c, uTip, smoothstep(0.5, 1.0, t) * (0.25 + 0.75 * fract(seed * 7.31)));
    c *= overhead * mix(0.66, 1.08, cushion) * (0.88 + 0.24 * fract(seed * 3.17));
    float sheen = pow(max(dot(normalize(sweep + vec2(1e-4)), vec2(-0.34, -0.94)), 0.0), 3.0);
    c += uTip * sheen * t * 0.2;
    c *= 1.0 - 0.34 * max(flat_, 0.0) * (1.0 - t) - 0.22 * touch * (1.0 - t);
    c = mix(c, uInk + 0.1 * t, ink);

    float lift = cushion * 0.34 + t * 0.42 + seed * 0.06 + ink * 0.3;
    gl_Position = vec4(pos.x / (uView.x * 0.5), -pos.y / (uView.y * 0.5), 0.88 - lift * 1.4, 1.0);
    vColor = c;
  }`;

  const TUFT_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec4 aTuft;   // x, y, angle, life from 1 to 0
  uniform vec2 uView;
  uniform vec3 uColor;
  out vec3 vColor;
  void main() {
    float t = floor(float(gl_VertexID) / 2.0) / 4.0;
    float side = mod(float(gl_VertexID), 2.0) * 2.0 - 1.0;
    float size = smoothstep(0.0, 0.3, aTuft.w);
    vec2 axis = vec2(cos(aTuft.z), sin(aTuft.z));
    vec2 across = vec2(-axis.y, axis.x);
    vec2 local = axis * (t - 0.5) * 24.0 * size + across * (sin(t * 3.1416) * 4.0 + side * 1.5 * (1.0 - t * 0.7) * size);
    vec2 pos = aTuft.xy + local;
    gl_Position = vec4(pos.x / (uView.x * 0.5), -pos.y / (uView.y * 0.5), 0.0, 1.0);
    vColor = uColor * (0.8 + 0.3 * t);
  }`;

  const FLAT_FS = `#version 300 es
  precision mediump float;
  in vec3 vColor;
  out vec4 outColor;
  void main() { outColor = vec4(vColor, 1.0); }`;

  const hexToRgb = hex => {
    const v = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  };
  const mixRgb = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const css = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(" ")})`;

  function seeded(seed) {
    return () => {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  const uniforms = (gl, p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));

  class FuzzButton extends HTMLElement {
    static observedAttributes = ["label", "color", "text-color", "fuzz", "shed"];

    connectedCallback() {
      this.calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.w = +this.getAttribute("width") || 320;
      this.h = +this.getAttribute("height") || 110;
      this.renderShell();
      this.startGL();
      this.bind();
      document.fonts?.ready.then(() => this.isConnected && this.grow());
      this.seen = true;
      this.watch = new IntersectionObserver(([e]) => { this.seen = e.isIntersecting; if (this.seen) this.wake(); });
      this.watch.observe(this);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.watch?.disconnect();
    }

    // Colour and length apply on the next frame; only new words need the hairs replanted
    attributeChangedCallback(name) {
      if (!this.gl) return;
      if (name === "label") {
        this.btn.setAttribute("aria-label", this.getAttribute("label") || "Button");
        this.textEl.textContent = this.getAttribute("label") || "";
        this.grow();
      }
      if (name === "color" || name === "text-color") this.recolor();
      this.wake();
    }

    renderShell() {
      const label = this.getAttribute("label") || "Get started";
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host { display: inline-block; }
          button {
            all: unset; position: relative; display: block; width: ${this.w}px; height: ${this.h}px;
            max-width: 100%; border-radius: 999px; cursor: pointer; touch-action: manipulation;
            -webkit-tap-highlight-color: transparent; user-select: none;
          }
          button:focus-visible { outline: 2px solid currentColor; outline-offset: 14px; }
          .body { position: absolute; inset: 0; will-change: transform; }
          .base { position: absolute; inset: 2px; border-radius: 999px; }
          .text {
            position: absolute; inset: 0; display: grid; place-items: center;
            font: 700 ${Math.round(this.h * 0.3)}px "Space Grotesk", system-ui, sans-serif;
          }
          canvas { position: absolute; left: -${PAD}px; top: -${PAD}px; pointer-events: none; }
          :host([data-fur]) .text { color: transparent !important; }
        </style>
        <button type="button" aria-label="${label.replace(/"/g, "&quot;")}">
          <span class="body"><span class="base"></span><span class="text">${label.replace(/</g, "&lt;")}</span><canvas></canvas></span>
        </button>`;
      this.btn = root.querySelector("button");
      this.body = root.querySelector(".body");
      this.base = root.querySelector(".base");
      this.textEl = root.querySelector(".text");
      this.canvas = root.querySelector("canvas");
    }

    startGL() {
      const gl = this.canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
      this.paint();
      if (!gl) return;                 // no WebGL2: it stays a plain button, still fully usable
      this.gl = gl;
      this.hair = program(gl, HAIR_VS, FLAT_FS);
      this.tuft = program(gl, TUFT_VS, FLAT_FS);
      this.hairU = uniforms(gl, this.hair, ["uView", "uHalf", "uPressAt", "uCursor", "uDrag", "uLen", "uWidth", "uPress", "uHover", "uTime", "uBreeze", "uBald", "uDeep", "uBody", "uTip", "uInk", "uRipples"]);
      this.tuftU = uniforms(gl, this.tuft, ["uView", "uColor"]);

      this.hairVao = gl.createVertexArray();
      this.hairBuf = gl.createBuffer();
      gl.bindVertexArray(this.hairVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.hairBuf);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(0, 1); gl.vertexAttribDivisor(1, 1); gl.vertexAttribDivisor(2, 1);

      this.tuftVao = gl.createVertexArray();
      this.tuftBuf = gl.createBuffer();
      gl.bindVertexArray(this.tuftVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tuftBuf);
      gl.bufferData(gl.ARRAY_BUFFER, MAX_TUFTS * 16, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);

      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);

      this.press_ = 0; this.pressVel = 0; this.pressTarget = 0;
      this.pressAt = [0, 0];
      this.hover = 0; this.hoverTarget = 0;
      this.cursor = [0, 0]; this.pointer = [0, 0]; this.drag = [0, 0];
      this.ripples = Array.from({ length: MAX_RIPPLES }, () => [0, 0, -1]);
      this.rippleNext = 0;
      this.tufts = [];
      this.tuftData = new Float32Array(MAX_TUFTS * 4);
      this.time = 0; this.last = 0; this.slow = 0; this.frames = 0;
      this.quality = 1;
      this.bald = 0; this.restless = 0;
      this.grow();
      this.setAttribute("data-fur", "");
      this.wake();
    }

    paint() {
      const color = hexToRgb(this.getAttribute("color") || "#FFB000");
      const ink = this.getAttribute("text-color") || "#090A0C";
      this.base.style.background = css(mixRgb(color, [0, 0, 0], 0.52));
      this.base.style.boxShadow = `0 ${this.h * 0.2}px ${this.h * 0.55}px rgb(0 0 0 / .55), 0 0 ${this.h * 0.75}px ${css(mixRgb(color, [0, 0, 0], 0.72))}`;
      this.textEl.style.color = ink;
      this.btn.style.color = css(color);
    }

    // Plants every hair: where it grows, which way it leans, whether it sits inside a letter
    grow() {
      const gl = this.gl;
      if (!gl) return;
      this.recolor();
      const { w, h } = this;
      const r = h / 2, spine = w / 2 - r;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const viewW = w + PAD * 2, viewH = h + PAD * 2;
      this.canvas.style.width = viewW + "px";
      this.canvas.style.height = viewH + "px";
      this.canvas.width = Math.round(viewW * dpr);
      this.canvas.height = Math.round(viewH * dpr);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.view = [viewW, viewH];

      const mask = this.letters();
      const phone = matchMedia("(pointer: coarse)").matches;
      const count = Math.round(w * h * (phone ? 1.05 : 1.7));
      const data = new Float32Array(count * 7);
      const rand = seeded(7);

      for (let i = 0; i < count; i++) {
        let x, y, edge;
        do {
          x = (rand() - 0.5) * w;
          y = (rand() - 0.5) * h;
          edge = Math.hypot(Math.max(Math.abs(x) - spine, 0), y) - r;
        } while (edge > 0);

        const cushion = Math.sin(Math.min(-edge / (r * 0.72), 1) * Math.PI / 2);
        const nearX = Math.max(-spine, Math.min(spine, x));
        const dist = Math.hypot(x - nearX, y) || 1;
        const outX = (x - nearX) / dist, outY = y / dist;
        // Combed towards the rim with a gentle swirl on top: the outline stays a clean pill, only the middle gets lively
        const swirl = 1.25 + Math.sin(x * 0.026 + 1.3) * Math.cos(y * 0.041 - 0.4) * 1.15 + (rand() - 0.5) * 0.7;
        const spread = 0.1 + 0.78 * (1 - cushion);
        const lean = (0.16 + rand() * 0.14) * cushion;
        const ink = mask(x, y);
        const stand = 1 - 0.72 * ink;         // letters stand almost upright, or they smear into each other

        const k = i * 7;
        data[k] = x;
        data[k + 1] = y;
        data[k + 2] = (outX * spread + Math.cos(swirl) * lean) * stand;
        data[k + 3] = (outY * spread + Math.sin(swirl) * lean + 0.1) * stand;
        data[k + 4] = cushion;
        data[k + 5] = rand();
        data[k + 6] = ink;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.hairBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.count = count;
    }

    recolor() {
      this.paint();
      const color = hexToRgb(this.getAttribute("color") || "#FFB000");
      this.colors = {
        deep: mixRgb(color, [0, 0, 0], 0.62),
        body: color,
        tip: mixRgb(color, [1, 0.97, 0.88], 0.42),
        ink: hexToRgb(this.getAttribute("text-color") || "#090A0C"),
      };
    }

    // The label is drawn once to a hidden canvas; a hair inside a letter takes the letter's colour
    letters() {
      const { w, h } = this;
      const label = this.getAttribute("label") || "Get started";
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      let size = h * 0.34;
      const family = getComputedStyle(this.textEl).fontFamily;
      ctx.font = `700 ${size}px ${family}`;
      size *= Math.min(1, (w - h * 0.7) / ctx.measureText(label).width);
      ctx.font = `700 ${size}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, w / 2, h / 2 + size * 0.03);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      return (x, y) => {
        const px = Math.round(x + w / 2), py = Math.round(y + h / 2);
        if (px < 0 || py < 0 || px >= w || py >= h) return 0;
        return pixels[(py * w + px) * 4 + 3] / 255;
      };
    }

    bind() {
      const b = this.btn;
      const local = e => {
        const box = b.getBoundingClientRect();
        return [e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2];
      };
      b.addEventListener("pointerenter", e => { this.pointer = local(e); this.cursor = this.pointer.slice(); this.hoverTarget = 1; this.wake(); });
      b.addEventListener("pointermove", e => { this.pointer = local(e); this.hoverTarget = 1; this.wake(); });
      b.addEventListener("pointerleave", () => { this.hoverTarget = 0; this.wake(); });
      b.addEventListener("pointerdown", e => { b.setPointerCapture?.(e.pointerId); this.press(...local(e)); });
      b.addEventListener("pointerup", e => { this.pointer = local(e); this.release(); if (e.pointerType !== "mouse") this.hoverTarget = 0; });
      b.addEventListener("pointercancel", () => this.release());
      b.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) this.press(0, 0); });
      b.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") this.release(); });
    }

    press(x = 0, y = 0) {
      if (!this.gl) return;
      this.pressAt = [x, y];
      this.pointer = [x, y];
      this.pressTarget = 1;
      this.shedHair(x, y, this.sheds() ? 10 : 8);
      this.wake();
    }

    release() {
      if (!this.gl || !this.pressTarget) return;
      this.pressTarget = 0;
      const slot = this.ripples[this.rippleNext++ % MAX_RIPPLES];
      slot[0] = this.pressAt[0]; slot[1] = this.pressAt[1]; slot[2] = 0;
      this.shedHair(this.pressAt[0], this.pressAt[1], this.sheds() ? 20 : 15);
      if (this.sheds()) { this.bald = Math.min(1, this.bald + 0.11); this.restless = 0; }
      this.wake();
    }

    sheds() { return this.hasAttribute("shed") && this.getAttribute("shed") !== "0"; }

    // A few loose hairs fly off the button
    shedHair(x, y, amount) {
      if (this.calm) return;
      for (let i = 0; i < amount && this.tufts.length < MAX_TUFTS; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 170;
        this.tufts.push({
          x: x + Math.cos(a) * 22, y: y + Math.sin(a) * 14,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 130,
          angle: Math.random() * 6.28, spin: (Math.random() - 0.5) * 10,
          life: 1, fade: 0.75 + Math.random() * 0.6,
        });
      }
    }

    wake() {
      if (this.raf || !this.gl) return;
      this.last = 0;
      this.raf = requestAnimationFrame(t => this.frame(t));
    }

    step(dt) {
      this.time += dt;
      const stiff = this.pressTarget ? 620 : 300;
      const damp = this.calm ? 40 : this.pressTarget ? 34 : 13;
      this.pressVel += ((this.pressTarget - this.press_) * stiff - this.pressVel * damp) * dt;
      this.press_ = Math.max(-0.42, Math.min(1.08, this.press_ + this.pressVel * dt));

      this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 11);
      const px = this.cursor[0], py = this.cursor[1];
      const follow = Math.min(1, dt * 20);
      this.cursor[0] += (this.pointer[0] - px) * follow;
      this.cursor[1] += (this.pointer[1] - py) * follow;
      const speedX = (this.cursor[0] - px) / Math.max(dt, 1e-3) * 0.0045;
      const speedY = (this.cursor[1] - py) / Math.max(dt, 1e-3) * 0.0045;
      this.drag[0] += (Math.max(-1.3, Math.min(1.3, speedX)) - this.drag[0]) * Math.min(1, dt * 9);
      this.drag[1] += (Math.max(-1.3, Math.min(1.3, speedY)) - this.drag[1]) * Math.min(1, dt * 9);

      for (const r of this.ripples) if (r[2] >= 0) { r[2] += dt; if (r[2] > 1.6) r[2] = -1; }

      this.tufts = this.tufts.filter(t => {
        t.vy += 640 * dt;
        t.vx *= 1 - 1.4 * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.angle += t.spin * dt;
        t.life -= t.fade * dt;
        return t.life > 0;
      });

      // Left alone, the coat grows back
      this.restless += dt;
      if (!this.sheds()) this.bald = 0;
      else if (this.restless > 1.3) this.bald = Math.max(0, this.bald - dt * 0.24);

      const p = this.press_;
      this.body.style.transform = `translateY(${(p * 3).toFixed(2)}px) scale(${(1 + p * 0.05).toFixed(4)}, ${(1 - p * 0.1).toFixed(4)})`;
    }

    draw() {
      const { gl, hairU: u, tuftU: t, colors: c, w, h } = this;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.hair);
      gl.uniform2f(u.uView, this.view[0], this.view[1]);
      gl.uniform2f(u.uHalf, w / 2, h / 2);
      gl.uniform2fv(u.uPressAt, this.pressAt);
      gl.uniform2fv(u.uCursor, this.cursor);
      gl.uniform2fv(u.uDrag, this.drag);
      gl.uniform1f(u.uLen, h * 0.15 * Math.max(0.3, Math.min(2.5, +this.getAttribute("fuzz") || 1)));
      gl.uniform1f(u.uWidth, Math.max(0.62, h * 0.0072));
      gl.uniform1f(u.uPress, this.press_);
      gl.uniform1f(u.uHover, this.hover);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uBreeze, this.calm ? 0 : 1);
      gl.uniform1f(u.uBald, this.bald);
      gl.uniform3fv(u.uDeep, c.deep);
      gl.uniform3fv(u.uBody, c.body);
      gl.uniform3fv(u.uTip, c.tip);
      gl.uniform3fv(u.uInk, c.ink);
      const rings = new Float32Array(MAX_RIPPLES * 4);
      this.ripples.forEach((r, i) => rings.set([r[0], r[1], r[2], 0], i * 4));
      gl.uniform4fv(u.uRipples, rings);
      gl.bindVertexArray(this.hairVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, Math.round(this.count * this.quality));

      if (this.tufts.length) {
        this.tufts.forEach((f, i) => this.tuftData.set([f.x, f.y, f.angle, f.life], i * 4));
        gl.useProgram(this.tuft);
        gl.uniform2f(t.uView, this.view[0], this.view[1]);
        gl.uniform3fv(t.uColor, c.body);
        gl.bindVertexArray(this.tuftVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tuftBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.tuftData.subarray(0, this.tufts.length * 4));
        gl.disable(gl.DEPTH_TEST);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 10, this.tufts.length);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.bindVertexArray(null);
    }

    frame(now) {
      this.raf = 0;
      if (!this.isConnected || !this.seen) return;
      const spent = this.last ? now - this.last : 16;
      const dt = Math.min(spent / 1000, 1 / 24);
      this.last = now;

      // Slow machine: thin the pile a little instead of dropping frames. Hairs are in random order, so a prefix stays even
      this.frames++;
      this.slow += spent > 24 ? 1 : 0;
      if (this.frames === 45) {
        if (this.slow > 22 && this.quality > 0.5) this.quality = Math.max(0.5, this.quality - 0.15);
        this.frames = this.slow = 0;
      }

      // A few steps per frame keep the spring stable however low the frame rate falls
      const steps = 3;
      for (let i = 0; i < steps; i++) this.step(dt / steps);
      this.draw();

      const settled = Math.abs(this.pressVel) < 0.01 && Math.abs(this.press_ - this.pressTarget) < 0.002 && !this.tufts.length && this.ripples.every(r => r[2] < 0) && this.hover < 0.01 && this.bald < 0.001;
      if (this.calm && settled) return;
      this.raf = requestAnimationFrame(t => this.frame(t));
    }
  }

  customElements.define("fuzz-button", FuzzButton);
})();
