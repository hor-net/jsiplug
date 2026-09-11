/**
 * MultiOscilloscope.js
 *
 * Multi-trace oscilloscope component (2D Canvas).
 *
 * The class is fully generic: there is NO hardcoded "input" / "output"
 * trace. The caller registers any number of traces (each with its own
 * id, color, line width, gain, offset, zIndex and visibility) via
 * `addTrace(id, opts)`. `pushRaw()` then matches each payload layout
 * id against the registered traces (case-insensitive exact match) and
 * renders every visible trace as a min/max envelope per pixel column.
 *
 * Design (the "display buffer is just a screen-wide min/max array" model):
 *
 *   1. Each registered trace owns TWO Float32Arrays the size of the
 *      canvas width in CSS pixels (`_bufferSize`, default = canvas
 *      width):
 *        maxBuffer[i] = most positive sample in column i
 *        minBuffer[i] = most negative sample in column i
 *      Convention: index 0 = oldest column (leftmost on screen),
 *      index bufferSize-1 = newest (rightmost). The display scrolls
 *      RIGHT-TO-LEFT as new samples arrive (newest is pushed to the
 *      right edge; old samples shift left and fall off).
 *
 *   2. pushRaw() decodes the incoming interleaved Float32 samples,
 *      deinterleaves every layout entry the user has registered, and
 *      treats the payload as a full history snapshot, reducing it to
 *      min/max blocks directly in the display buffers, oldest first.
 *      Overlapping snapshots must NOT be queued as new audio.
 *
 *   3. Between snapshots the rAF tick scrolls left, paced by wall-clock
 *      at bufferSize / duration px/sec, holding the newest value at
 *      the right edge until the next authoritative snapshot arrives.
 *
 *   4. Drawing strokes one VERTICAL BAR per pixel column per visible
 *      trace (from minBuffer[i] to maxBuffer[i]), back-to-front in
 *      trace draw order (zIndex ascending), each with its own colour,
 *      with `gain` and `offset` applied at render time so the user can
 *      tweak them without mutating the ring buffer.
 *
 *   5. A separate `samples` Float32Array on each trace mirrors the
 *      most recent raw deinterleaved chunk in chronological order:
 *      samples[0] is the OLDEST sample in the chunk (5 s ago end of
 *      the scope), samples[visibleSamples-1] is the NEWEST ("now").
 *      It's purely for inspection / debugging / tests — it does NOT
 *      drive rendering.
 *
 *   6. Each trace has its OWN Y-axis range (`yRange: [yMin, yMax]`,
 *      settable via `addTrace(id, { yRange })` or `setYRange(id, ...)`),
 *      so multiple traces with DIFFERENT units (e.g. linear amplitude
 *      in -1..+1 vs a gain curve in dB -12..+12) can be plotted on the
 *      same canvas at their proper y-positions. The scope-level
 *      minY/maxY is just the default for traces without their own
 *      yRange. Each trace can also opt out of the joint auto-scale
 *      step with `autoScale: false` (use this for traces already in
 *      a meaningful unit — dB, %, etc. — where absolute scaling must
 *      be preserved across the session).
 *
 *   Push rate is decoupled from animation rate: the C++ pushes at
 *   IDLE_TIMER_RATE (~20 Hz) which can deliver any number of samples
 *   per push; the rAF tick always scrolls at ~60 Hz regardless.
 */
(function (global) {
  'use strict';

  // Default colour cycle used when pushRaw encounters an unregistered
  // trace id (so the component never silently drops data). Production
  // should call `addTrace(id, { color, ... })` explicitly; this is just
  // a safety net.
  const DEFAULT_PALETTE = [
    '#43CDFF', // cyan    (matches the V1 "out" colour)
    '#FFCD43', // yellow  (matches the V1 "in" colour)
    '#9CDB7A', // green
    '#D587E5', // magenta
    '#FF8A5C', // orange
    '#5CC5FF', // sky
    '#FFD23F', // amber
    '#A1FF8A', // mint
    '#FF6BB5', // pink
    '#B0B0B0', // grey
  ];

  class MultiOscilloscope {
    constructor(options = {}) {
      // ----- mode detection -----
      // DOM mode: caller passed `id` (a DOM element id); we own a canvas.
      // Rect mode: no DOM; caller owns the canvas/ctx and just wants the
      //            math (pushRaw + draw).
      this._mode = (typeof options.id === 'string' && options.id.length > 0)
        ? 'dom' : 'rect';

      // ----- common state -----
      this.minY = options.minY !== undefined ? +options.minY : -1.0;
      this.maxY = options.maxY !== undefined ? +options.maxY :  1.0;
      this.axisColor = options.axisColor || 'rgba(255, 255, 255, 0.4)';

      // ----- display-side parameters -----
      this._sampleRate = +options.sampleRate || 48000;
      // _duration = how many seconds of audio the display represents.
      this._duration   = +options.duration   || 5.0;
      // _bufferSize = number of pixel columns (== canvas width in CSS px).
      // Each entry holds the min/max envelope of the corresponding time
      // slice; the slice length is computed from duration/bufferSize.
      this._bufferSize  = options.bufferSize || 800;

      // ----- per-trace storage -----
      // The class is fully dynamic: callers register any number of
      // traces via addTrace(id, opts). NO trace is hardcoded.
      //   _channelMap: Map<id, TraceState>
      //   _traceDrawOrder: string[] — ids sorted by zIndex ascending,
      //                                   back-to-front for rendering
      this._channelMap     = new Map();
      this._traceDrawOrder = [];

      // ----- optional per-instance layout filter -----
      // If non-null (a Set of strings), only channel ids in the set are
      // auto-registered / consumed during pushRaw. Used by the split-
      // scope flow where two instances share a multi-channel payload
      // but each instance is responsible for only ONE channel.
      // Defaults to null (consume all channels, legacy behavior).
      this._layoutFilter = (options.layoutFilter instanceof Set)
        ? options.layoutFilter : null;

      // ----- optional per-instance auto-scale toggle -----
      // When true (default), values in each push are normalized so that
      // the loudest sample in the chunk maps to ~0.95 of the display
      // range — useful for linear-amplitude signals (input waveform)
      // where absolute level is unknown.
      // When false, values are plotted at their absolute values against
      // the configured minY/maxY — useful for traces that are ALREADY
      // in a meaningful unit (dB gain, percentage, etc.) and where
      // absolute scaling must be preserved across the session.
      // user-zoom is honored in BOTH modes.
      this._autoScale = options.autoScale !== false;

      // ----- shared timing state (one scroll, multiple traces) -----
      this._scrollAccum   = 0;
      this._lastScrollTime = null;
      // The C++ transport is a rolling full-history snapshot. Its first
      // frame seeds the display; later frames contribute only their newly
      // elapsed tail to the FIFO used by the smooth rAF scroll.
      this._hasScopeSnapshot = false;
      this._lastScopeSnapshotMs = null;
      this._scopeSampleAccum = 0;

      // ----- optional grid -----
      this._grid = null;

      // ----- base64 scratch (reused across pushRaw calls) -----
      this._decodeBuf = null;

      // ----- DOM-mode internals -----
      this._canvas  = null;
      this._ctx     = null;
      this._backCanvas = null;
      this._backCtx    = null;
      this._dpr = 1;
      this._domElement = null;
      this._animationHandle = null;
      this._animationInterval = null;

      if (this._mode === 'dom') {
        this._initDOM(options);
        this._startAnimation();
      } else {
        // Rect mode (no DOM): the caller owns the canvas/ctx and just
        // wants the math (pushRaw + draw). Build a minimal _rect so
        // getPixelY() works.
        this._rect = {
          L: options.L || 0, T: options.T || 0,
          W: options.W || 800, H: options.H || 200
        };
        this._bufferSize = this._rect.W;
        this._canvas = null;
        this._ctx = null;
        this._dpr = 1;
      }
    }

    // ================================================================
    // Trace registration / inspection
    // ================================================================

    /**
     * Allocate a fresh TraceState object (used by addTrace and by
     * _resizeCanvas when the canvas width changes).
     *
     * Each trace stores:
     *   - TWO ring buffers per pixel column (maxBuffer / minBuffer) for
     *     rendering
     *   - a FIFO queue (`queue`) of [max, min] pairs waiting for the rAF
     *     scroll loop to consume
     *   - a sub-pixel accumulator for fractional column shifts
     *   - a `samples` Float32Array (inspectable: [0]=newest) for tests
     *     and debugging
     *   - cosmetic opts (color / lineWidth / gain / offset / zIndex /
     *     _visible) that apply at render time
     */
    _newTraceState(id, opts) {
      opts = opts || {};
      // Defensive: if addTrace is called BEFORE the first valid resize,
      // `_bufferSize` is the constructor default (800). We clamp to >=2
      // here so the per-column min/max ring buffer is never zero-length
      // (which would silently break the render pipeline even though the
      // grid would still draw).
      const len = (this._bufferSize > 0) ? this._bufferSize : 800;
      // `sources` makes this a *derived* trace: instead of being fed by
      // pushRaw, its per-column envelope is computed at render time as
      // `sources[1] - sources[0]` column-by-column (so sources[1] is
      // the "positive" side, sources[0] the "negative" side; for the
      // common `['in','out']` usage the visualised curve is
      // out - in, i.e. positive where the upstream effect BOOSTS the
      // signal and negative where it CUTS it). Derived traces don't
      // allocate their own ring buffer / queue / scratch — they read
      // straight from the source traces' ring buffers at draw time so
      // they always mirror what's currently shown.
      let sources = null;
      if (Array.isArray(opts.sources) && opts.sources.length === 2
          && typeof opts.sources[0] === 'string'
          && typeof opts.sources[1] === 'string') {
        sources = [String(opts.sources[0]), String(opts.sources[1])];
      }
      // Per-trace Y-axis range. Useful when overlaying traces that
      // live in DIFFERENT units (e.g. linear amplitude in -1..+1 vs
      // a gain curve in dB -12..+12). Defaults to the scope's
      // global minY/maxY.
      let yMin = this.minY;
      let yMax = this.maxY;
      if (Array.isArray(opts.yRange) && opts.yRange.length === 2
          && Number.isFinite(+opts.yRange[0])
          && Number.isFinite(+opts.yRange[1])
          && (+opts.yRange[1]) > (+opts.yRange[0])) {
        yMin = +opts.yRange[0];
        yMax = +opts.yRange[1];
      } else {
        if (Number.isFinite(+opts.yMin)) yMin = +opts.yMin;
        if (Number.isFinite(+opts.yMax) && (+opts.yMax) > yMin) yMax = +opts.yMax;
      }
      return {
        id,
        color:      opts.color      || '#FFFFFF',
        lineWidth:  (opts.lineWidth !== undefined) ? +opts.lineWidth : 1.5,
        gain:       (opts.gain      !== undefined) ? +opts.gain      : 1.0,
        offset:     (opts.offset    !== undefined) ? +opts.offset    : 0.0,
        zIndex:     (opts.zIndex    !== undefined) ? +opts.zIndex    : 0,
        _visible:   opts.visible !== undefined ? !!opts.visible : true,

        // How to draw the trace per pixel column:
        //   'bar'  (default): vertical bar from minBuffer[i] to maxBuffer[i]
        //                     (the classic waveform "filled envelope" look).
        //   'line': polyline through the signed peak of each column, no fill.
        //          Use for state-like traces (gain, envelope follower) where
        //          peaks must retain their amplitude while scrolling.
        _renderStyle: (opts.renderStyle === 'line') ? 'line'
                  : (opts.renderStyle === 'envelope') ? 'envelope' : 'bar',

        // Per-trace transparency multiplier applied to ctx.globalAlpha
        // at render time (default 1.0 = opaque). Use < 1.0 to fade a
        // background trace behind a foreground one for layering.
        _alpha: (Number.isFinite(+opts.alpha) && (+opts.alpha) >= 0 && (+opts.alpha) <= 1)
                  ? +opts.alpha : 1.0,

        // Per-trace Y-axis range (override of the scope's default).
        // The renderer maps value -> pixel-y using these bounds
        // independently of the other traces, so two traces with
        // different units (linear amplitude vs dB) can be plotted
        // on the same canvas at their proper y-positions.
        yMin,
        yMax,

        // Per-trace auto-scale toggle. When true (default), the trace
        // participates in the joint-peak auto-scale (so its values
        // are normalised to fill the display range). When false, the
        // trace's values are plotted at their absolute values (use this
        // for traces already in a meaningful unit: dB, %, etc.).
        // When `autoScale: false` is set globally on the scope, this
        // per-trace flag has no effect (the entire auto-scale step is
        // skipped). When it's set per-trace, only false-traces are
        // excluded from the joint scale.
        _autoScale: (opts.autoScale !== undefined) ? !!opts.autoScale : true,

        // Derived-only (`sources` set): the per-column envelope is
        // computed at render time, ring buffer / queue / scratch are
        // not used. Non-derived traces keep these unchanged.
        sources,
        maxBuffer:  new Float32Array(len),
        minBuffer:  new Float32Array(len),
        queue:      [],        // entries are [maxSigned, minSigned] pairs
        fracAccum:  0,

        scratch: null,          // reused Float32Array for pushRaw deinterleave

        // Inspection buffer (most recent raw deinterleaved chunk).
        // [0] = newest, [visibleSamples-1] = oldest.
        samples:        null,
        visibleSamples: 0,
      };
    }

    /**
     * Register or update a trace by id.
     *
     * The id is an arbitrary string. The same id may be reused across
     * pushRaw() payloads (case-insensitive match). Style options are
     * `color`, `lineWidth`, `gain`, `offset`, `zIndex`, `visible`,
     * `renderStyle` ('bar' [default] or 'line'), `alpha` (0..1, default 1.0).
     *
     * `renderStyle: 'bar'` (default) draws one vertical bar per pixel
     * column from minBuffer[i] to maxBuffer[i]. This is the
     * "min/max envelope as filled area" look used for audio waveform
     * displays.
     *
     * `renderStyle: 'line'` draws a polyline through the extremum with
     * greatest absolute magnitude in each column, preserving its sign. Niente
     * fill verticale: solo una linea. Useful for state-like traces
     * (gain, envelope follower output, threshold) where you want to
     * see the temporal evolution of a single value, not the
     * oscillation envelope. Gaps (columns where both maxBuffer and
     * minBuffer are exactly 0 — the "no data" sentinel) are skipped
     * so the line breaks cleanly across silence instead of snapping
     * to the centre.
     *
     * Existing traces can be re-styled by calling `addTrace(id, opts)`
     * again — any provided option is applied on top; the trace's ring
     * buffers and queue are preserved (only `zIndex` triggers a
     * draw-order resort).
     *
     * @returns {TraceState} the (possibly updated) trace state.
     */
    addTrace(id, opts) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('[MultiOsc] addTrace: id must be a non-empty string');
      }
      opts = opts || {};
      let c = this._channelMap.get(id);
      if (!c) {
        c = this._newTraceState(id, opts);
        this._channelMap.set(id, c);
        this._traceDrawOrder.push(id);
        this._resortDrawOrder();
      } else {
        if (opts.color     !== undefined) c.color     = opts.color;
        if (opts.lineWidth !== undefined) c.lineWidth = +opts.lineWidth;
        if (opts.gain      !== undefined) c.gain      = +opts.gain;
        if (opts.offset    !== undefined) c.offset    = +opts.offset;
        if (opts.zIndex    !== undefined) {
          c.zIndex = +opts.zIndex;
          this._resortDrawOrder();
        }
        if (opts.visible   !== undefined) c._visible = !!opts.visible;
        if (opts.autoScale !== undefined) c._autoScale = !!opts.autoScale;
        if (opts.renderStyle === 'line') c._renderStyle = 'line';
        else if (opts.renderStyle === 'envelope') c._renderStyle = 'envelope';
        else if (opts.renderStyle === 'bar') c._renderStyle = 'bar';
        if (opts.alpha !== undefined
            && Number.isFinite(+opts.alpha)
            && (+opts.alpha) >= 0 && (+opts.alpha) <= 1) {
          c._alpha = +opts.alpha;
        }
        if (Array.isArray(opts.yRange) && opts.yRange.length === 2
            && Number.isFinite(+opts.yRange[0])
            && Number.isFinite(+opts.yRange[1])
            && (+opts.yRange[1]) > (+opts.yRange[0])) {
          c.yMin = +opts.yRange[0];
          c.yMax = +opts.yRange[1];
        } else {
          if (opts.yMin !== undefined && Number.isFinite(+opts.yMin)) c.yMin = +opts.yMin;
          if (opts.yMax !== undefined && Number.isFinite(+opts.yMax) && (+opts.yMax) > c.yMin) c.yMax = +opts.yMax;
        }
        if (opts.sources   !== undefined) {
          // Switching a trace between "regular" and "derived" doesn't
          // invalidate its existing ring buffers (we never push data
          // into them when sources is set); just update the binding.
          if (Array.isArray(opts.sources) && opts.sources.length === 2
              && typeof opts.sources[0] === 'string'
              && typeof opts.sources[1] === 'string') {
            c.sources = [String(opts.sources[0]), String(opts.sources[1])];
          } else if (opts.sources === null) {
            c.sources = null;
          }
        }
      }
      return c;
    }

    /**
     * Remove a trace entirely. Its render buffers, queue and inspection
     * buffer are released. Idempotent.
     */
    removeTrace(id) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      this._channelMap.delete(id);
      const i = this._traceDrawOrder.indexOf(id);
      if (i >= 0) this._traceDrawOrder.splice(i, 1);
      return true;
    }

    /**
     * Toggle or set the visibility flag for a trace. Hidden traces are
     * skipped by the renderer but keep updating their buffers / queue.
     */
    setTraceVisible(id, visible) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      c._visible = !!visible;
      return true;
    }

    /**
     * Update only the gain of a trace (applied at render time, so the
     * ring buffers are not mutated). Returns false if the trace is
     * missing.
     */
    setTraceGain(id, gain) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      c.gain = +gain;
      return true;
    }

    /**
     * Update only the DC offset of a trace (render-time).
     */
    setTraceOffset(id, offset) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      c.offset = +offset;
      return true;
    }

    /**
     * Restrict this instance to consume only the listed channel ids.
     * Used by the split-scope flow: two MultiOscilloscope instances
     * sharing the same multi-channel payload each "own" one channel.
     * Set to null (or use the constructor's `layoutFilter` option)
     * to consume all channels (default).
     */
    setLayoutFilter(channelIds) {
      this._layoutFilter = (channelIds instanceof Set)
        ? channelIds
        : null;
    }

    /**
     * Override the y-axis mapping range for a single trace. Useful
     * when overlaying traces with different units (linear amplitude
     * vs dB) on the same canvas. After this call, that trace's
     * getPixelYFor() returns positions relative to the new range
     * instead of the scope's global minY/maxY.
     */
    setYRange(id, yMin, yMax) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      if (!Number.isFinite(+yMin) || !Number.isFinite(+yMax) || (+yMax) <= (+yMin)) return false;
      c.yMin = +yMin;
      c.yMax = +yMax;
      return true;
    }

    /**
     * Toggle auto-scale participation for one trace. When false,
     * the trace's values bypass the joint auto-scale step in pushRaw
     * and are plotted at their absolute values (use this for traces
     * already in a meaningful unit: dB, %, etc.).
     */
    setAutoScale(id, on) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      c._autoScale = !!on;
      return true;
    }

    /**
     * Zero out a trace's display history, queue and inspection buffer.
     * The trace itself stays registered (so subsequent pushRaw calls
     * will keep rendering it).
     */
    clearTrace(id) {
      const c = this._channelMap.get(id);
      if (!c) return false;
      c.maxBuffer.fill(0);
      c.minBuffer.fill(0);
      c.queue.length = 0;
      c.fracAccum = 0;
      if (c.samples && c.samples.length > 0) {
        c.samples.fill(0);
      } else {
        c.samples = new Float32Array(0);
      }
      c.visibleSamples = 0;
      return true;
    }

    /**
     * Zero every registered trace's history.
     */
    clearAll() {
      for (const id of this._traceDrawOrder) {
        this.clearTrace(id);
      }
    }

    /**
     * Resort `_traceDrawOrder` in-place by ascending zIndex. Stable
     * enough for the typical few-trace case.
     */
    _resortDrawOrder() {
      this._traceDrawOrder.sort((a, b) => {
        const ca = this._channelMap.get(a);
        const cb = this._channelMap.get(b);
        const za = ca ? ca.zIndex : 0;
        const zb = cb ? cb.zIndex : 0;
        return za - zb;
      });
    }

    /**
     * Auto-register a trace with a palette colour the first time
     * pushRaw encounters it. This is a safety net — production should
     * call `addTrace(id, opts)` explicitly so the colour / line width
     * are deterministic. A single console.warn is emitted per id.
     */
    _autoRegister(id) {
      const idx = this._channelMap.size;
      const c = this._newTraceState(id, {
        color: DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length],
      });
      this._channelMap.set(id, c);
      this._traceDrawOrder.push(id);
      this._resortDrawOrder();
      console.warn('[MultiOsc] auto-registered trace "' + id +
        '" with palette colour; call addTrace("' + id +
        '", { color, ... }) to control its style.');
      return c;
    }

    // ================================================================
    // DOM-mode setup
    // ================================================================
    _initDOM(options) {
      this._domElement = document.getElementById(options.id);
      if (!this._domElement) {
        throw new Error('[MultiOsc] no DOM element with id="' + options.id + '"');
      }
      this._id = options.id;
      this._domElement.style.position = 'relative';
      this._domElement.style.overflow = 'hidden';
      const bg = this._domElement.getAttribute('data-background');
      if (bg) this._domElement.style.background = bg;

      // Front buffer (visible).
      this._canvas = document.createElement('canvas');
      this._canvas.style.cssText = [
        'position:absolute', 'top:0', 'left:0',
        'width:100%', 'height:100%', 'display:block',
        'pointer-events:none'
      ].join(';');
      this._domElement.appendChild(this._canvas);

      // Back buffer (double-buffered: draw to it, present via drawImage).
      this._backCanvas = document.createElement('canvas');
      this._backCanvas.style.cssText = [
        'position:absolute', 'top:0', 'left:0',
        'width:0', 'height:0', 'visibility:hidden',
        'pointer-events:none'
      ].join(';');
      this._domElement.appendChild(this._backCanvas);

      this._ctx = this._canvas.getContext('2d');
      this._backCtx = this._backCanvas.getContext('2d');
      this._dpr = 1;
      this._rect = { L: 0, T: 0, W: 0, H: 0 };

      this._resizeCanvas();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => this._resizeCanvas());
        ro.observe(this._domElement);
      }
    }

    _resizeCanvas() {
      if (!this._canvas) return;
      const rect = this._canvas.getBoundingClientRect();
      // Bail for ANY non-positive dimension (0 OR undefined OR NaN).
      // A previous version only checked `=== 0`, which silently fell
      // through when getBoundingClientRect() returned {width:undefined}
      // (unlaid-out canvas, display:none, scaling wrapper not yet
      // applied, etc.) — the branch would then set `_bufferSize =
      // undefined`, leaving every trace's maxBuffer at length 0 and
      // breaking the entire draw pipeline even though the grid kept
      // rendering.
      const rectW = +rect.width;
      const rectH = +rect.height;
      if (!(rectW > 0) || !(rectH > 0)) return;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio)
        ? window.devicePixelRatio : 1;
      const w = Math.round(rectW * dpr);
      const h = Math.round(rectH * dpr);
      if (this._canvas.width !== w)    this._canvas.width = w;
      if (this._canvas.height !== h)   this._canvas.height = h;
      if (this._backCanvas) {
        if (this._backCanvas.width !== w)  this._backCanvas.width = w;
        if (this._backCanvas.height !== h) this._backCanvas.height = h;
      }
      this._dpr = dpr;
      this._rect = { L: 0, T: 0, W: rectW, H: rectH };
      // Resize each trace's display buffers to match the new canvas
      // width, preserving recent history by anchoring to the right edge.
      const resizePair = (oldArr, newLen) => {
        const out = new Float32Array(newLen);
        const oldLen = oldArr.length;
        if (newLen >= oldLen) {
          for (let i = 0; i < oldLen; i++) out[newLen - oldLen + i] = oldArr[i];
        } else {
          for (let i = 0; i < newLen; i++) out[i] = oldArr[oldLen - newLen + i];
        }
        return out;
      };
      for (const id of this._traceDrawOrder) {
        const ch = this._channelMap.get(id);
        if (ch.maxBuffer.length !== rectW) {
          ch.maxBuffer = resizePair(ch.maxBuffer, rectW);
          ch.minBuffer = resizePair(ch.minBuffer, rectW);
        }
      }
      this._bufferSize = rectW;

      // Drop the pending queues + per-trace accumulators: any queued
      // peaks were computed for the previous buffer size and would
      // land in the wrong columns after the resize. The next pushRaw
      // will rebuild.
      for (const id of this._traceDrawOrder) {
        const ch = this._channelMap.get(id);
        ch.queue = [];
        ch.fracAccum = 0;
      }
      this._scrollAccum = 0;
      this._lastScrollTime = null;
      this._hasScopeSnapshot = false;
    }

    // ================================================================
    // Animation: rAF scroll + draw
    // ================================================================
    _startAnimation() {
      if (this._animationHandle || this._animationInterval) return;
      const raf = (typeof requestAnimationFrame !== 'undefined')
        ? requestAnimationFrame
        : ((cb) => setTimeout(() => cb(performance.now()), 16));
      const tick = (now) => {
        this._animationHandle = raf(tick);
        try { this._animate(now); }
        catch (e) { console.error('[MultiOsc]', e); }
      };
      this._animationHandle = raf(tick);
    }

    _scopeNowMs() {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
    }

    // One rAF frame. The FIFO receives only new snapshot tail data, so
    // this preserves continuous scrolling between host messages.
    _animate(now) {
      this._scrollByTime(now);
      this._render();
    }

    _stopAnimation() {
      if (this._animationHandle) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(this._animationHandle);
        } else {
          clearTimeout(this._animationHandle);
        }
        this._animationHandle = null;
      }
      if (this._animationInterval) {
        clearInterval(this._animationInterval);
        this._animationInterval = null;
      }
    }

    /**
     * Per-frame time-based scroll: shift every trace's display buffer
     * LEFT by `floor(scrollAccum)` columns, refilling from its own FIFO
     * queue (consumed FIFO) and writing 0 when the queue is empty.
     * scrollAccum is incremented by (dt * bufferSize / duration) so
     * the visible speed matches the configured time window exactly.
     * All traces scroll in lockstep.
     */
    _scrollByTime(nowMs) {
      const N = this._bufferSize;
      if (N < 2) return;

      const last = (this._lastScrollTime == null) ? nowMs : this._lastScrollTime;
      const dt = Math.max(0, nowMs - last);
      this._lastScrollTime = nowMs;

      // We DO NOT freeze the scroll when the host stops shipping samples.
// The user's expectation is that the existing waveform keeps
// scrolling leftward until it fully falls off the left edge, then the
// canvas naturally becomes empty. The "right edge latch" above
// guarantees the tail stays visible while the buffer empties. The
// old _lastPushTimeMs / _freezeGraceMs freeze logic is preserved as a
// comment-only marker; if you want the display to halt instead of
// drain, re-introduce the early-return below and keep the right-edge
// zero-fill.

      const pxPerMs = N / (this._duration * 1000.0);
      this._scrollAccum = (this._scrollAccum || 0) + dt * pxPerMs;

      let whole = Math.floor(this._scrollAccum);
      this._scrollAccum -= whole;

      // Cap each frame so a long pause (tab backgrounded, debugger, etc)
      // doesn't drain the entire buffer in one giant jump on resume.
      if (whole > N) whole = N;

      // Iterate the draw-order list so we drain EVERY registered trace
      // (no independent timing per trace). For each trace we use its
      // OWN buffer length as the copyWithin bound, not this._bufferSize:
      // same reason as in _drawTo — if the two ever drift we don't want
      // to silently skip the trace or write out of bounds.
      //
      // When the queue is empty (host stopped shipping samples, e.g.
      // transport Stop), the right edge is LATCHED: we shift the buffer
      // left and DON'T write anything to the new right column, so the
      // most recent value stays "stuck" at the rightmost position. As
      // the scroll continues, that latched value scrolls leftward
      // through the canvas and eventually falls off the left edge, at
      // which point the canvas is fully empty. This matches the user's
      // expectation: "the oscilloscope should keep scrolling its
      // current contents off-screen, not snap to a frozen frame and
      // not snap to a blank canvas either".
      for (const id of this._traceDrawOrder) {
        const ch = this._channelMap.get(id);
        if (!ch || !ch.maxBuffer || !ch.minBuffer) continue;
        const Nch = ch.maxBuffer.length;
        if (Nch <= 0) continue;
        const maxB = ch.maxBuffer;
        const minB = ch.minBuffer;
        const q = ch.queue;
        const iterCount = Math.min(whole, Nch);
        for (let i = 0; i < iterCount; i++) {
          maxB.copyWithin(0, 1, Nch);
          minB.copyWithin(0, 1, Nch);
          if (q.length > 0) {
            const pair = q.shift();   // [maxSigned, minSigned]
            maxB[Nch - 1] = pair[0];
            minB[Nch - 1] = pair[1];
          }
          // Queue empty: do NOT write 0 to the right edge — the
          // value already there (the previous Nch-1 element, now
          // latched at Nch-1 after copyWithin) stays as the "stuck"
          // tail. This is the key change for graceful Stop handling.
        }
      }
    }

    // ================================================================
    // Push: min/max per column into display buffer
    // ================================================================
    /**
     * Decode the base64-encoded interleaved Float32 payload from the
     * C++, extract every trace we know how to display (exact id match
     * in the payload's `layout`, case-insensitive), apply JOINT
     * auto-scale across all present traces so their relative levels
     * stay meaningful, then for each trace split its samples into
     * min/max blocks (one per pixel column) and replace its display
     * history in chronological order. Each payload is a FULL snapshot,
     * not an incremental chunk; replaying it via the scrolling FIFO
     * would duplicate history (or reverse time if queued newest-first).
     *
     * Traces that are NOT pre-registered via addTrace() are
     * auto-registered on the first encounter with a palette colour
     * (a console.warn is emitted once per id).
     *
     * @param {string} b64Data     base64-encoded Float32Array
     * @param {number} numBins     number of bins per channel
     * @param {string[]} layout    channel ids in interleaved order
     * @param {number} zoom        user-controlled manual multiplier
     *                             applied on top of the auto-scale
     */
    pushRaw(b64Data, numBins, layout, zoom) {
      if (!b64Data || !numBins || !layout || layout.length === 0) return;
      const decoded = this._decodeB64Float32(b64Data);
      const numChannels = layout.length;
      const total = numChannels * numBins;
      if (decoded.length < total) {
        console.warn('[MultiOsc] pushRaw: payload too small',
          decoded.length, 'expected', total);
        return;
      }

      // Auto-register any layout id we don't know yet so the component
      // is "register-on-first-push" friendly. Trace ids are matched
      // case-insensitive against layout ids. Production code should
      // still call addTrace() explicitly so the colour / line width /
      // zIndex are deterministic; this is just a safety net.
      //
      // If `_layoutFilter` is set (non-null), only channels in the
      // filter are considered. Used by the split-scope flow where two
      // MultiOscilloscope instances share a 2-channel payload but
      // each one only consumes its own channel: without the filter,
      // the auto-register step would attach the OTHER scope's trace
      // to this instance too, polluting its display.
      const filter = this._layoutFilter;
      for (let c = 0; c < numChannels; c++) {
        const lid = layout[c];
        if (typeof lid !== 'string' || lid.length === 0) continue;
        if (filter && !filter.has(lid)) continue;
        if (this._channelMap.has(lid)) continue;
        const lower = lid.toLowerCase();
        let clash = false;
        for (const existing of this._channelMap.keys()) {
          if (existing.toLowerCase() === lower) { clash = true; break; }
        }
        if (!clash) this._autoRegister(lid);
      }

      // For each registered trace, find its index in the interleaved
      // layout by EXACT (case-insensitive) id match. Traces not
      // present in this push are skipped silently.
      const present = []; // [{ ch, samples, scaled }]
      let jointPeak = 0;
      let hasOptIn = false;

      for (const id of this._traceDrawOrder) {
        const ch = this._channelMap.get(id);
        if (!ch) continue;
        const lowerId = id.toLowerCase();
        let layoutIdx = -1;
        for (let c = 0; c < numChannels; c++) {
          if (typeof layout[c] === 'string'
              && layout[c].toLowerCase() === lowerId) {
            layoutIdx = c;
            break;
          }
        }
        if (layoutIdx < 0) {
          // If a layout filter is active AND the matching layout
          // entry was found, then the trace's id must ALREADY have
          // been filtered out at the auto-register step above. If we
          // get here it's because the trace is registered but its
          // id is NOT in the payload layout (filter or not). Just
          // skip the trace silently.
          continue;
        }

        if (!ch.scratch || ch.scratch.length < numBins) {
          ch.scratch = new Float32Array(numBins);
        }
        const samples = ch.scratch;
        for (let i = 0; i < numBins; i++) {
          samples[i] = decoded[i * numChannels + layoutIdx];
        }
        // Per-trace auto-scale opt-in: traces with `_autoScale: false`
        // (e.g. the dB gain curve where absolute scaling matters) are
        // excluded from the joint-peak calculation AND from the scale
        // step below, so their values plot at their actual dB position
        // regardless of how loud the input waveform is.
        const optIn = ch._autoScale !== false;
        if (optIn) {
          hasOptIn = true;
          for (let i = 0; i < numBins; i++) {
            const a = samples[i] < 0 ? -samples[i] : samples[i];
            if (a > jointPeak) jointPeak = a;
          }
        }
        present.push({ ch, samples, scaled: optIn });
      }

      if (present.length === 0) return;

      // ============================================================
      // Auto-scale across the OPT-IN traces only.
      // ============================================================
      // Each trace carries its own auto-scale opt-in (`ch._autoScale`,
      // default true). We compute the joint peak across the opt-in
      // traces and normalize those values so the loudest one fills the
      // display. Opt-out traces (e.g. the dB gain curve where absolute
      // scaling matters) keep their values verbatim and will plot at
      // their absolute position dictated by their per-trace yRange.
      // Capped at +12 dB (4x).
      //
      // `userZoom` is ALSO applied only to opt-in traces: if no trace
      // opted in, `userZoom` is a no-op. This guarantees that an
      // absolute-unit trace (e.g. dB) is never silently scaled by a
      // zoom knob that was meant for a different trace on the same
      // scope.
      const userZoom = (Number.isFinite(+zoom) && +zoom > 0) ? +zoom : 1.0;
      const optIn = present.filter((p) => p.scaled);
      if (hasOptIn && optIn.length > 0) {
        const targetPeak = 0.95;
        const maxAmpFactor = 4.0;
        let scale = 1.0;
        if (jointPeak > 1e-4) {
          scale = targetPeak / jointPeak;
          if (scale > maxAmpFactor) scale = maxAmpFactor;
        }
        scale *= userZoom;
        if (scale !== 1.0) {
          for (const { samples } of optIn) {
            for (let i = 0; i < numBins; i++) samples[i] *= scale;
          }
        }
      }
      // No opt-in traces: leave every trace's values verbatim. The
      // `userZoom` knob is intentionally NOT applied to opt-out traces
      // here — its semantic is "zoom into the loudness-normalised
      // waveform", not "scale every absolute-unit value on the canvas".

      // The C++ sends a complete five-second ring, oldest first. Seed
      // the display from the first snapshot only. Every later snapshot
      // contributes just its elapsed tail to the FIFO, restoring the
      // committed rAF scrolling path without replaying five seconds of
      // history (the source of the sawtooth/snap-back).
      this._duration = numBins / this._sampleRate;
      const pixelColumns = this._bufferSize;
      const samplesPerPixel = numBins / pixelColumns;
      const nowMs = this._scopeNowMs();
      let initial = !this._hasScopeSnapshot;
      let newSamples = numBins;
      if (!initial) {
        const elapsed = Math.max(0, nowMs - this._lastScopeSnapshotMs);
        this._scopeSampleAccum += elapsed * this._sampleRate / 1000.0;
        newSamples = Math.floor(this._scopeSampleAccum);
        this._scopeSampleAccum -= newSamples;
        // A suspended UI can miss a complete history window. Re-seed in
        // that case; otherwise append only the newest tail.
        if (newSamples >= numBins) {
          initial = true;
          newSamples = numBins;
          this._scopeSampleAccum = 0;
        }
      }
      this._hasScopeSnapshot = true;
      this._lastScopeSnapshotMs = nowMs;

      for (const { ch, samples } of present) {
        if (!ch.samples || ch.samples.length !== numBins) {
          ch.samples = new Float32Array(numBins);
        }
        for (let i = 0; i < numBins; i++) ch.samples[i] = samples[i];
        ch.visibleSamples = numBins;

        const isLine = ch._renderStyle === 'line';
        const reduce = (start, end) => {
          let maxSigned = -Infinity;
          let minSigned = Infinity;
          for (let i = start; i < end; i++) {
            const v = samples[i];
            // -200 dB marks an unavailable gain sample, not a peak.
            if (!Number.isFinite(v) || (isLine && Math.abs(v) > 60)) continue;
            if (v > maxSigned) maxSigned = v;
            if (v < minSigned) minSigned = v;
          }
          if (!isFinite(maxSigned)) maxSigned = isLine ? -200 : 0;
          if (!isFinite(minSigned)) minSigned = isLine ? -200 : 0;
          return [maxSigned, minSigned];
        };

        if (initial) {
          // Initial history: one min/max envelope per display column.
          ch.queue.length = 0;
          ch.fracAccum = 0;
          for (let p = 0; p < pixelColumns; p++) {
            const start = Math.floor(p * samplesPerPixel);
            const end = Math.min(numBins,
              Math.max(start + 1, Math.floor((p + 1) * samplesPerPixel)));
            const pair = reduce(start, end);
            ch.maxBuffer[p] = pair[0];
            ch.minBuffer[p] = pair[1];
          }
        } else if (newSamples > 0) {
          // Incremental tail: preserve fractional pixel timing exactly as
          // the committed FIFO path did, but reduce only fresh samples.
          const columnsFloat = newSamples / samplesPerPixel;
          ch.fracAccum += columnsFloat - Math.floor(columnsFloat);
          let pixelColumnsToQueue = Math.floor(columnsFloat);
          if (ch.fracAccum >= 1.0) {
            pixelColumnsToQueue += Math.floor(ch.fracAccum);
            ch.fracAccum -= Math.floor(ch.fracAccum);
          }
          const tailStart = numBins - newSamples;
          for (let p = 0; p < pixelColumnsToQueue; p++) {
            const start = tailStart + Math.floor(p * newSamples / pixelColumnsToQueue);
            const end = Math.min(numBins,
              Math.max(start + 1, tailStart + Math.floor((p + 1) * newSamples / pixelColumnsToQueue)));
            ch.queue.push(reduce(start, end));
          }
          // Bound backlog if the host returns after a long UI stall.
          while (ch.queue.length > pixelColumns) ch.queue.shift();
        }
      }
      if (initial) {
        // The seeded image is already five seconds wide: start future rAF
        // movement from this instant rather than skipping it immediately.
        this._scrollAccum = 0;
        this._lastScrollTime = nowMs;
      }
    }

    // ================================================================
    // Grid
    // ================================================================
    setGrid(options) {
      if (!options) { this._grid = null; return; }
      this._grid = Object.assign({
        minValue: this.minY,
        maxValue: this.maxY,
        lineColor: 'rgba(255,255,255,0.20)',
        centerColor: 'rgba(255,255,255,0.45)',
        textColor: 'rgba(255,255,255,0.55)',
        duration: this._duration,
        showLabels: true,
        background: null
      }, options);
    }

    // ================================================================
    // Render
    // ================================================================
    /**
     * Force-render one frame. The animation loop already does this;
     * calling it manually is harmless (and is what the e2e tests use
     * after a single pushRaw()).
     */
    draw() { this._render(); }

    _render() {
      // Be tolerant of environments where getContext('2d') returned
      // null (e.g. jsdom). The animation loop also no-ops in that case.
      if (!this._ctx) return;
      const cssW = this._canvas.width / this._dpr;
      const cssH = this._canvas.height / this._dpr;
      this._rect = { L: 0, T: 0, W: cssW, H: cssH };

      // Paint the frame on the back buffer.
      const back = this._backCtx;
      if (!back) return;
      back.setTransform(1, 0, 0, 1, 0, 0);
      back.clearRect(0, 0, this._backCanvas.width, this._backCanvas.height);
      back.scale(this._dpr, this._dpr);
      this._drawTo(back, cssW, cssH);

      // Atomic replace via one drawImage. `copy` avoids both a separately
      // composited clear-frame and alpha accumulation from repeatedly
      // source-over compositing a translucent waveform onto the front canvas.
      const front = this._ctx;
      front.setTransform(1, 0, 0, 1, 0, 0);
      const previousComposite = front.globalCompositeOperation;
      front.globalCompositeOperation = 'copy';
      front.drawImage(this._backCanvas, 0, 0);
      front.globalCompositeOperation = previousComposite || 'source-over';
    }

    _drawTo(ctx, cssW, cssH) {
      const g = this._grid;
      if (g && g.background) {
        ctx.fillStyle = g.background;
        ctx.fillRect(0, 0, cssW, cssH);
      } else {
        ctx.fillStyle = 'rgba(10, 10, 12, 0.9)';
        ctx.fillRect(0, 0, cssW, cssH);
      }
      ctx.strokeStyle = this.axisColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, cssW, cssH);

      if (g) this._drawGrid(ctx, g, cssW, cssH);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssW, cssH);
      ctx.clip();

      // For every VISIBLE registered trace, draw one VERTICAL BAR
      // per pixel column from minBuffer[i] to maxBuffer[i], with
      // `gain` and `offset` applied at render time (so changing them
      // mutates only the displayed y, not the underlying ring
      // buffer). Channels are drawn back-to-front in _traceDrawOrder
      // (already sorted by zIndex ascending at registration time).
      // The loop bound is ch.maxBuffer.length (the buffer's actual
      // pixel-column count), NOT this._bufferSize. They should always
      // agree (updated together in _resizeCanvas), but a brittle
      // `length !== _bufferSize` guard used to silently short-circuit
      // every trace if they ever drifted apart — that was the bug
      // where "only the grid is visible". Reading the buffer's own
      // length guarantees the bar loop can never be skipped because
      // of a stale _bufferSize.
      const dpr = this._dpr;
      const ySnap = (v) => Math.round(v * dpr) / dpr;
      if (this._channelMap.size > 0
          && this._bufferSizeDriftWarned !== true) {
        const anyCh = this._channelMap.values().next().value;
        if (anyCh && anyCh.maxBuffer && this._bufferSize !== anyCh.maxBuffer.length) {
          console.warn('[MultiOsc] _bufferSize=' + this._bufferSize +
            ' drifted from trace maxBuffer.length=' +
            anyCh.maxBuffer.length + ' — recovering from the per-trace length.');
          this._bufferSizeDriftWarned = true;
        }
      }
      for (const id of this._traceDrawOrder) {
        const ch = this._channelMap.get(id);
        if (!ch || !ch._visible) continue;

        // Per-trace alpha (transparency). Defaults to 1.0 (opaque).
        // Set via addTrace(id, { alpha: 0.6 }) for layering multiple
        // traces on the same canvas — e.g. a faint waveform in the
        // background and a foreground state curve (gain) at full
        // opacity. We mutate globalAlpha on the context for this
        // trace only and restore it after the stroke; this is safe
        // because every trace gets its own pass through this loop
        // before the next render() call.
        const prevAlpha = ctx.globalAlpha;
        // `_applyAlphaToColor()` below already applies ch._alpha. Keep the
        // canvas alpha untouched so 0.7 means exactly 70%, not 0.7 × 0.7.
        ctx.globalAlpha = 1;

        // Resolve per-trace source buffers. For a regular trace we
        // just read its own maxBuffer/minBuffer. For a derived trace
        // (`ch.sources` set, see addTrace/sources opt) we read straight
        // from the source traces' ring buffers and compute the
        // per-column envelope on the fly as `plus[i] - minus[i]`. No
        // extra storage, always in sync with what's actually shown.
        let N;
        let getColumn;       // (i) -> [maxV, minV]
        if (ch.sources && ch.sources.length === 2) {
          const minusCh = this._channelMap.get(ch.sources[0]);
          const plusCh  = this._channelMap.get(ch.sources[1]);
          const ok = minusCh && plusCh
            && minusCh.maxBuffer && plusCh.maxBuffer
            && minusCh.minBuffer && plusCh.minBuffer
            && minusCh.maxBuffer.length === plusCh.maxBuffer.length;
          if (!ok) {
            // Source trace missing or buffer length mismatch — skip
            // this derived trace silently (it's optional metadata).
            continue;
          }
          N = plusCh.maxBuffer.length;
          const minusMax = minusCh.maxBuffer;
          const minusMin = minusCh.minBuffer;
          const plusMax  = plusCh.maxBuffer;
          const plusMin  = plusCh.minBuffer;
          getColumn = (i) => {
            const delta = ((plusMax[i] + plusMin[i])
                         - (minusMax[i] + minusMin[i])) / 2;
            return [delta, delta];
          };
        } else {
          if (!ch.maxBuffer) continue;
          N = ch.maxBuffer.length;
          if (N <= 0) continue;
          getColumn = (i) => [ch.maxBuffer[i], ch.minBuffer[i]];
        }

        const traceColor = MultiOscilloscope._applyAlphaToColor(ch.color, ch._alpha);
        ctx.strokeStyle = traceColor;
        ctx.fillStyle = traceColor;
        ctx.lineWidth = ch.lineWidth;
        ctx.lineCap = (ch._renderStyle === 'line' || ch._renderStyle === 'envelope') ? 'round' : 'butt';
        ctx.lineJoin = (ch._renderStyle === 'line' || ch._renderStyle === 'envelope') ? 'round' : 'miter';
        ctx.beginPath();
        const chGain = ch.gain;
        const chOffset = ch.offset;
        const chHasGain = (chGain !== 1.0);
        const chHasOffset = (chOffset !== 0.0);
        if (ch._renderStyle === 'envelope') {
          // ============================================================
          // ENVELOPE STYLE: two polylines, one through maxBuffer[i]
          // (upper edge) and one through minBuffer[i] (lower edge).
          // ============================================================
          // The classic oscilloscope look: you see both positive and
          // negative half-cycles as two parallel traces (no vertical
          // fill between them). Each polyline breaks on empty columns
          // so silence shows as a gap, not as a flat line snapped to
          // the centre. Both lines share the same colour/gain/offset.
          // Use this for waveform traces where you want to see both
          // half-cycles of the signal without the heavy "filled area"
          // look of the bar style.
          // Canvas has only ONE current path position. Interleaving
          // top/bottom lineTo calls connects the contours across every
          // column and paints a solid zigzag area instead of two outlines.
          // Draw each contour in a separate pass.
          for (let side = 0; side < 2; side++) {
            ctx.beginPath();
            let pathOpen = false;
            for (let i = 0; i < N; i++) {
              const [maxV, minV] = getColumn(i);
              const isEmpty = maxV === 0 && minV === 0;
              const isSilence = Math.abs(maxV) > 60 || Math.abs(minV) > 60;
              if (isEmpty || isSilence) { pathOpen = false; continue; }
              let v = side === 0 ? maxV : minV;
              if (chHasGain) v *= chGain;
              if (chHasOffset) v += chOffset;
              const y = ySnap(this.getPixelYFor(ch, v));
              if (!pathOpen) {
                ctx.moveTo(i + 0.5, y);
                pathOpen = true;
              } else {
                ctx.lineTo(i + 0.5, y);
              }
            }
            ctx.stroke();
          }
        } else if (ch._renderStyle === 'line') {
          // ============================================================
          // LINE STYLE: polyline through the signed peak of each column.
          // ============================================================
          // Use max for boosts and min for cuts (greatest magnitude).
          // Averaging min/max changes the displayed peak as a transient
          // moves between pixel buckets, even when the source is unchanged.
          // Gain/offset remain render-time adjustments; no temporal smoothing.
          let pathOpen = false;
          for (let i = 0; i < N; i++) {
            let [maxV, minV] = getColumn(i);
            // Preserve the existing empty-column behavior. Check BOTH
            // bounds so a bucket spanning unity and a cut still gets drawn.
            if (maxV === 0 && minV === 0) { pathOpen = false; continue; }
            // Only entirely missing buckets retain the silence sentinel
            // after reduction. Leave a gap, never extend the previous gain
            // into a fabricated plateau. Mixed buckets use their valid peak.
            if (Math.abs(maxV) > 60 || Math.abs(minV) > 60) {
              pathOpen = false;
              continue;
            }
            let v = Math.abs(minV) > Math.abs(maxV) ? minV : maxV;
            if (chHasGain)  v *= chGain;
            if (chHasOffset) v += chOffset;
            const y = ySnap(this.getPixelYFor(ch, v));
            if (!pathOpen) {
              ctx.moveTo(i + 0.5, y);
              pathOpen = true;
            } else {
              ctx.lineTo(i + 0.5, y);
            }
          }
          ctx.stroke();
        } else {
          // ============================================================
          // BAR STYLE (default): vertical bar from minBuffer[i] to
          // maxBuffer[i] per pixel column. The classic waveform
          // "filled envelope" look.
          // ============================================================
          for (let i = 0; i < N; i++) {
            let [maxV, minV] = getColumn(i);
            if (maxV === 0 && minV === 0) continue;  // empty column
            if (chHasGain) {
              maxV *= chGain;
              minV *= chGain;
            }
            if (chHasOffset) {
              maxV += chOffset;
              minV += chOffset;
            }
            const yTop = ySnap(this.getPixelYFor(ch, maxV));
            const yBot = ySnap(this.getPixelYFor(ch, minV));
            // One opaque geometry operation per CSS pixel. Stroked 1px
            // segments overlap on their anti-aliased edges, accumulating
            // alpha and making a requested 0.7 waveform look fully opaque.
            // A device-aligned rect is filled exactly once, so trace alpha
            // has the visual value configured by the caller.
            const top = Math.min(yTop, yBot);
            const height = Math.max(1 / dpr, Math.abs(yBot - yTop));
            ctx.fillRect(i, top, 1, height);
          }
        }

        // Restore the caller's canvas state for the next trace.
        ctx.globalAlpha = prevAlpha;
      }
      ctx.restore();
    }

    _drawGrid(ctx, g, cssW, cssH) {
      const left = 36, right = 16, top = 14, bottom = 14;
      const plotW = cssW - left - right;
      const plotH = cssH - top - bottom;

      // Horizontal value lines.
      const steps = 5;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = top + t * plotH;
        const value = g.maxValue - t * (g.maxValue - g.minValue);
        const isCenter = Math.abs(value) < 1e-6;
        ctx.beginPath();
        ctx.strokeStyle = isCenter ? g.centerColor : g.lineColor;
        ctx.lineWidth = isCenter ? 1.0 : 0.5;
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotW, y);
        ctx.stroke();
        if (g.showLabels) {
          ctx.fillStyle = g.textColor;
          ctx.font = '11px Arial';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(value.toFixed(1), left - 4, y);
        }
      }

      // Vertical time lines + labels.
      const vt = 4;
      for (let i = 0; i <= vt; i++) {
        const t = i / vt;
        const x = left + t * plotW;
        const secondsAgo = g.duration * (1 - t);
        ctx.beginPath();
        ctx.strokeStyle = (i === 0 || i === vt) ? g.centerColor : g.lineColor;
        ctx.lineWidth = (i === 0 || i === vt) ? 1.0 : 0.5;
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + plotH);
        ctx.stroke();
        if (g.showLabels) {
          ctx.fillStyle = g.textColor;
          ctx.font = '11px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const lbl = secondsAgo === 0 ? 'now' :
            (secondsAgo < 1 ? `-${Math.round(secondsAgo * 1000)}ms`
                              : `-${secondsAgo.toFixed(2)}s`);
          ctx.fillText(lbl, x, top + plotH + 2);
        }
      }
    }

    getPixelY(val) {
      const range = this.maxY - this.minY;
      if (range === 0) return this._rect.T + this._rect.H / 2;
      const normalized = (val - this.minY) / range;
      return this._rect.T + this._rect.H - (normalized * this._rect.H);
    }

    /**
     * Per-trace y-position mapping: uses the trace's own yMin/yMax
     * range (set via `addTrace(id, { yRange: [min, max] })` or via the
     * `yMin`/`yMax` options) instead of the scope's global minY/maxY.
     * Used by the renderer so two traces with different units (e.g.
     * linear amplitude and dB) can share the same canvas at their
     * correct y-positions.
     */
    getPixelYFor(ch, val) {
      const yMin = ch.yMin;
      const yMax = ch.yMax;
      const range = yMax - yMin;
      if (range === 0) return this._rect.T + this._rect.H / 2;
      const normalized = (val - yMin) / range;
      return this._rect.T + this._rect.H - (normalized * this._rect.H);
    }

    // ================================================================
    // Color helper: convert a CSS color (hex, rgb(), rgba(), name) to
    // an rgba() string with the given alpha multiplier applied.
    // ================================================================
    // We use this instead of mutating ctx.globalAlpha because some
    // Canvas2D implementations have shown buggy interactions between
    // globalAlpha and clip() / save() / restore() round-trips, especially
    // when the canvas is double-buffered via drawImage(). Applying the
    // alpha directly to the color string is a 100% reliable path.
    //
    // Optimization: cache the converted color string on the trace state
    // so we don't reparse the hex on every frame. The cache is keyed by
    // (color, _alpha) and invalidated when either changes (via
    // addTrace updates).
    static _applyAlphaToColor(color, alpha) {
      if (alpha === undefined || alpha === null || alpha >= 0.9999) return color;
      // Parse "#rrggbb" / "#rgb" / "rgb(r,g,b)" / "rgba(r,g,b,a)".
      // Anything else (CSS named colors, hsl(), etc.) we pass through
      // and rely on the browser's parser via a hidden <canvas> trick.
      let r = 0, g = 0, b = 0;
      const s = String(color).trim();
      let m;
      if ((m = /^#([0-9a-fA-F]{6})$/.exec(s))) {
        const h = m[1];
        r = parseInt(h.slice(0,2), 16);
        g = parseInt(h.slice(2,4), 16);
        b = parseInt(h.slice(4,6), 16);
      } else if ((m = /^#([0-9a-fA-F]{3})$/.exec(s))) {
        r = parseInt(m[1][0]+m[1][0], 16);
        g = parseInt(m[1][1]+m[1][1], 16);
        b = parseInt(m[1][2]+m[1][2], 16);
      } else if ((m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(s))) {
        r = +m[1]; g = +m[2]; b = +m[3];
      } else {
        // Fallback: paint a 1x1 hidden canvas to extract rgba components.
        try {
          const probe = document.createElement('canvas');
          probe.width = 1; probe.height = 1;
          const pctx = probe.getContext('2d');
          pctx.fillStyle = s;
          pctx.fillRect(0, 0, 1, 1);
          const data = pctx.getImageData(0, 0, 1, 1).data;
          r = data[0]; g = data[1]; b = data[2];
        } catch (e) {
          return color;   // give up — pass through unchanged
        }
      }
      return 'rgba(' + (r|0) + ',' + (g|0) + ',' + (b|0) + ',' + alpha + ')';
    }

    // ================================================================
    // base64 → Float32Array (reused ArrayBuffer)
    // ================================================================
    _decodeB64Float32(b64) {
      const bin = atob(b64);
      const byteLen = bin.length;
      if (!this._decodeBuf || this._decodeBuf.byteLength !== byteLen) {
        this._decodeBuf = new ArrayBuffer(byteLen);
      }
      const view = new Uint8Array(this._decodeBuf);
      for (let i = 0; i < byteLen; i++) view[i] = bin.charCodeAt(i);
      return new Float32Array(this._decodeBuf);
    }
  }

  // ================================================================
  // Exports
  // ================================================================
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiOscilloscope;
  }
  if (typeof global !== 'undefined') global.MultiOscilloscope = MultiOscilloscope;
  if (typeof window !== 'undefined') window.MultiOscilloscope = MultiOscilloscope;
})(typeof window !== 'undefined' ? window : this);
