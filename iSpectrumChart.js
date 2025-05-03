/**
 * Spectrum analyzer chart component
 */
class iSpectrumChart extends iControl {
    constructor(options) {
        super(options);
        
        // Get decay time from options or use default (5000ms)
        const decayTime = Number(options.decayTime) || 5000;
        
        // Create spectrum layers collection
        this._spectrumLayers = new Map();
        
        // Update decay properties for exponential decay
        this._decayTimeConstant = decayTime; // tau in milliseconds
        
        // Add FPS tracking and animation properties
        this._frameCount = 0;
        this._lastTime = performance.now();
        this._fps = 0;
        this._isAnimating = false;
        
        // Default values
        this._minDb = Number(options.minDb) || -120;
        this._maxDb = Number(options.maxDb) || 0;
        this._minFreq = 20;
        this._maxFreq = 20000;
        
        // Add tilt property (dB/octave) - default is 0 (no tilt)
        this._defaultTilt = Number(options.tilt) || 0;
        // Add a map to store per-spectrum tilt values
        this._tiltMap = new Map();
        
        // Appearance preferences
        this._preferences = {
            grid: {
                normalLine: {
                    width: 0.5,
                    color: '#ccc'
                },
                emphasizedLine: {
                    width: 2,
                    color: '#999'
                },
                frequencyMarker: {
                    color: '#999'
                }
            },
            text: {
                color: '#000',
                normal: {
                    font: 'Arial',
                    size: 12,
                    weight: 'normal'
                },
                emphasized: {
                    font: 'Arial',
                    size: 14,
                    weight: 'bold'
                }
            },
            background: '#ffffff',
            spectrum: {
                lineColor: '#2196F3',
                fillColor: 'rgba(33, 150, 243, 0.3)',
                peakColor: '#FF5722'
            }
        };
    
        // Override defaults with user preferences if provided
        if (options.preferences) {
            this._preferences = this._deepMerge(this._preferences, options.preferences);
        }
        
        // Add scales management
        this._scales = new Map();
        this._scales.set('default', {
            minDb: this._minDb,
            maxDb: this._maxDb,
            position: 'left',
            color: this._preferences.text.color
        });

        this._setupPixelRatioListener();
        
        // Create canvas elements
        this._setupCanvases();
        
        // Initialize WebGL
        this._initWebGL();
        
        // Setup resize observer
        this._resizeObserver = new ResizeObserver(() => this._updateCanvasSize());
        this._resizeObserver.observe(this._domElement);
        
        // Initial setup with zero data
        this._updateCanvasSize();
        this._drawGrid();
        this._drawInitialSpectrum();
        
        // Start the animation loop
        this._startAnimation();
    
        // Add click handler for peak hold reset
        this._domElement.addEventListener('click', () => {
            for (const spectrum of this._spectrumLayers.values()) {
                spectrum.peakHoldData.fill(-120);
            }
        });
    
        // Add tooltip
        this._setupTooltip();
    }

    // Add this new method to set up the listener
    _setupPixelRatioListener() {
        const mediaQuery = `(resolution: ${window.devicePixelRatio}dppx)`;
        this._pixelRatioMediaQuery = window.matchMedia(mediaQuery);

        // Use an arrow function to maintain 'this' context
        this._handlePixelRatioChange = () => {
            console.log(`Device pixel ratio changed to: ${window.devicePixelRatio}`);
            this._updateCanvasSize(); // Call the existing update method
        };

        // Add the listener
        // Note: 'change' event is recommended over addListener/removeListener for modern browsers
        if (this._pixelRatioMediaQuery.addEventListener) {
            this._pixelRatioMediaQuery.addEventListener('change', this._handlePixelRatioChange);
        } else {
            // Fallback for older browsers
            this._pixelRatioMediaQuery.addListener(this._handlePixelRatioChange);
        }
    }

    // Helper method for deep merging objects
    _deepMerge(target, source) {
        const result = {...target};
        for (const key in source) {
            if (source[key] instanceof Object && key in target) {
                result[key] = this._deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    _setupCanvases() {
        // Create two canvas elements
        this._gridCanvas = document.createElement('canvas');
        this._spectrumCanvas = document.createElement('canvas');
        
        // Style the canvases for stacking
        const canvasStyle = {
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: '0',
            left: '0',
            display: 'block'
        };
        
        Object.assign(this._gridCanvas.style, canvasStyle);
        Object.assign(this._spectrumCanvas.style, canvasStyle);
        
        // Set container position to relative for absolute positioning of canvases
        this._domElement.style.position = 'relative';
        this._domElement.style.backgroundColor = this._preferences.background;
        
        // Add canvases to DOM
        this._domElement.appendChild(this._gridCanvas);
        this._domElement.appendChild(this._spectrumCanvas);
        
        // Get contexts
        this._gridCtx = this._gridCanvas.getContext('2d');
        this._spectrumCtx = this._spectrumCanvas.getContext('webgl', {
            antialias: true,
            alpha: true
        });
    }

    _setupTooltip() {
        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText = 'position:absolute;display:none;background-color:rgba(0,0,0,0.8);color:white;padding:8px;border-radius:4px;font-size:12px;pointer-events:none;z-index:1000;';
        this._domElement.appendChild(this._tooltip);
        this._tooltipTimeout = null;
    
        // Add mouse event listeners
        this._domElement.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this._domElement.addEventListener('mouseout', this._handleMouseOut.bind(this));
    }
    
    _updateCanvasSize() {
        const rect = this._domElement.getBoundingClientRect();
        this._topBottomPadding = 30;
        this._leftPadding = 40;
        this._rightPadding = 20;
        
        // Add extra padding if there's a right-side scale
        if ([...this._scales.values()].some(scale => scale.position === 'right')) {
            this._rightPadding = 40;
        }
        
        this._dpr  = window.devicePixelRatio || 1;

        // keep your CSS size the same
        this._gridCanvas.style.width     = `${rect.width}px`;
        this._gridCanvas.style.height    = `${rect.height}px`;
        this._spectrumCanvas.style.width = `${rect.width}px`;
        this._spectrumCanvas.style.height= `${rect.height}px`;

        // bump up the actual backing-store resolution by dpr
        this._gridCanvas.width     = Math.round(rect.width  * this._dpr);
        this._gridCanvas.height    = Math.round(rect.height * this._dpr);
        this._spectrumCanvas.width = Math.round(rect.width  * this._dpr);
        this._spectrumCanvas.height= Math.round(rect.height * this._dpr);

        // now scale the 2D context so all your draw calls (which use CSS coords) map 1:1
        this._gridCtx.resetTransform();  
        this._gridCtx.scale(this._dpr, this._dpr);
            
        this._drawGrid();
    }

    _freqToX(freq) {
        // unchanged — returns a CSS-pixel X (0…rect.width)
        const logMin  = Math.log10(this._minFreq),
              logMax  = Math.log10(this._maxFreq),
              logFreq = Math.log10(freq);
        const cssWidth = this._gridCanvas.width / this._dpr;
        return this._leftPadding + 
               ((logFreq - logMin)/(logMax - logMin)) * 
               (cssWidth - this._leftPadding - this._rightPadding);
      }

    _xToFreq(x) {
        x= x*this._dpr;
        const logMin = Math.log10(this._minFreq);
        const logMax = Math.log10(this._maxFreq);
        const normalizedX = (x - this._leftPadding) / 
                          (this._gridCanvas.width - this._leftPadding - this._rightPadding);
        const logFreq = normalizedX * (logMax - logMin) + logMin;
        return Math.pow(10, logFreq);
    }
    

    addScale(id, options = {}) {
        const defaultScale = {
            minDb: -120,
            maxDb: 0,
            position: 'right',
            color: this._preferences.text.color,
            scaleId: id
        };
        
        this._scales.set(id, { ...defaultScale, ...options });
        this._updateCanvasSize(); // Recalculate padding for new scale
    } 

    setMindB(mindB, scaleId = 'default') {
        const scale = this._scales.get(scaleId) || this._scales.get('default');
        scale.minDb = mindB;
        this._updateCanvasSize(); // Recalculate padding for new scale   
    }

    // Add helper method to get dB value based on scale
    _dbToY(db, scaleId = 'default') {
        const scale = this._scales.get(scaleId) || this._scales.get('default');
        const cssHeight      = this._gridCanvas.height / this._dpr;
        const availableH     = cssHeight - (this._topBottomPadding * 2);
        return this._topBottomPadding +
               (1 - ((db - scale.minDb)/(scale.maxDb - scale.minDb))) * availableH;
      }
      
    // Add a method to set the tilt value (dB/octave)
    setTilt(tiltValue, spectrumId = null) {
        
        const clampedTilt =  tiltValue;
        
        if (spectrumId) {
            // Set tilt for a specific spectrum
            this._tiltMap.set(spectrumId, clampedTilt);
        } else {
            // Set default tilt for all spectrums that don't have a specific tilt
            this._defaultTilt = clampedTilt;
        }
        
        // Redraw the spectrum with the new tilt
        if (this._isAnimating) {
            // If we're animating, the tilt will be applied in the next frame
            return;
        }
        
        // Otherwise, force a redraw
        this._drawFrame();
    }
    
    // Helper method to get the tilt value for a specific spectrum
    _getTilt(spectrumId) {
        return this._tiltMap.has(spectrumId) ? this._tiltMap.get(spectrumId) : this._defaultTilt;
    }
    
    // Helper method to convert bin index to frequency
    _binToFreq(binIndex, totalBins) {
        // Map bin index to frequency using logarithmic scale
        const normalizedIndex = binIndex / (totalBins - 1);
        const logMin = Math.log10(this._minFreq);
        const logMax = Math.log10(this._maxFreq);
        const logFreq = logMin + normalizedIndex * (logMax - logMin);
        return Math.pow(10, logFreq);
    }
    
    // Helper method to apply tilt to a dB value based on frequency and spectrum ID
    _applyTilt(db, freq, spectrumId = null) {
        const tilt = this._getTilt(spectrumId);
        if (tilt === 0) return db; // No tilt
        
        // Calculate how many octaves from the minimum frequency
        const octavesFromMin = Math.log2(freq / this._minFreq);
        
        // Apply the tilt (dB/octave * number of octaves)
        return db + (tilt * octavesFromMin);
    }

    _yToDb(y, scaleId = 'default') {
        y = y*this._dpr;
        const scale = this._scales.get(scaleId) || this._scales.get('default');
        const availableHeight = this._gridCanvas.height - (this._topBottomPadding * 2);
        const normalizedY = (y - this._topBottomPadding) / availableHeight;
        return scale.maxDb - (normalizedY * (scale.maxDb - scale.minDb));
    }

    _calculateDbStep() {
        if (this._fixedDbStep !== undefined) {
            return this._fixedDbStep;
        }
        const minSpacing = 20;
        const availableHeight = this._gridCanvas.height / this._dpr - (this._topBottomPadding * 2);
        const dbRange = this._maxDb - this._minDb;
        const maxDivisions = Math.floor(availableHeight / minSpacing);

        // Candidate steps: multiples of 3, starting from 2, 3, 4, 6, 8, 9, 10, 12, 15, 18, etc.
        const candidates = [];
        for (let i = 3; i <= 24; i++) {
            if (i % 3 === 0) {
                candidates.push(i);
            }
        }

        let chosenStep = candidates[candidates.length - 1];
        for (let step of candidates) {
            if (Math.ceil(dbRange / step) <= maxDivisions) {
                chosenStep = step;
                break;
            }
        }

        // If the scale is symmetrical, force steps to be symmetric about zero
        if (this._minDb === -this._maxDb) {
            // Ensure the number of steps from 0 to maxDb equals the number from 0 to minDb
            // and that 0 is always a label
            const nSteps = Math.floor(this._maxDb / chosenStep);
            // Recalculate chosenStep so that 0 is always included and both sides are symmetric
            chosenStep = this._maxDb / nSteps;
        }

        this._fixedDbStep = chosenStep;
        return this._fixedDbStep;
    }

    _drawGrid() {
        const ctx = this._gridCtx;
        ctx.clearRect(0, 0, this._gridCanvas.width, this._gridCanvas.height);
        
        // Style setup
        ctx.strokeStyle = this._preferences.grid.normalLine.color;
        ctx.fillStyle = this._preferences.text.color;
        ctx.font = `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px ${this._preferences.text.normal.font}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        const leftPadding = this._leftPadding;
        //const drawWidth = this._gridCanvas.width - leftPadding;
        const cssWidth = this._gridCanvas.width / this._dpr;

        // Calculate min/max X coordinates first
        const minX = this._freqToX(this._minFreq);
        const maxX = this._freqToX(this._maxFreq);
        
        // Define frequency bands and continue with existing code
        const freqBandsBelow100 = Array.from({length: 9}, (_, i) => (i + 2) * 10);
        const freqBands100to1000 = Array.from({length: 9}, (_, i) => (i + 1) * 100);
        const freqBands1000to10000 = Array.from({length: 10}, (_, i) => (i + 1) * 1000);
        const labeledFreqs = [100, 1000, 10000];
        const emphasizedFreqs = [100, 1000, 10000];

        const drawFreqLine = (freq, isLabeled) => {
            const x = this._freqToX(freq);
            if (freq >= this._maxFreq) return;
            
            ctx.beginPath();
            ctx.lineWidth = emphasizedFreqs.includes(freq) ? 
                this._preferences.grid.emphasizedLine.width : 
                this._preferences.grid.normalLine.width;
            ctx.strokeStyle = emphasizedFreqs.includes(freq) ? 
                this._preferences.grid.emphasizedLine.color : 
                this._preferences.grid.normalLine.color;
            ctx.moveTo(x, this._topBottomPadding);
            ctx.lineTo(x, this._gridCanvas.height/this._dpr - this._topBottomPadding);  // Fixed reference
            ctx.stroke();
            
            if (isLabeled || emphasizedFreqs.includes(freq)) {
                ctx.textAlign = 'center';
                const textStyle = emphasizedFreqs.includes(freq) ? 
                    this._preferences.text.emphasized : 
                    this._preferences.text.normal;
                ctx.font = `${textStyle.weight} ${textStyle.size}px ${textStyle.font}`;
                let label = freq.toString();
                if (freq === 1000) label = '1K';
                if (freq === 10000) label = '10K';
                ctx.fillStyle = this._preferences.text.color;
                ctx.fillText(label, x, this._gridCanvas.height/this._dpr - this._preferences.text.normal.size);  // Fixed reference
            }
        };

        // Draw min/max frequency lines with emphasis
        ctx.beginPath();
        ctx.lineWidth = this._preferences.grid.emphasizedLine.width;
        ctx.strokeStyle = this._preferences.grid.frequencyMarker.color;
        
        // Min frequency (20 Hz)
        ctx.moveTo(minX, this._topBottomPadding);
        ctx.lineTo(minX, this._gridCanvas.height/this._dpr - this._topBottomPadding);
        ctx.stroke();
        
        // Max frequency (20K)
        ctx.beginPath();
        ctx.moveTo(maxX, this._topBottomPadding);
        ctx.lineTo(maxX, this._gridCanvas.height/this._dpr - this._topBottomPadding);
        ctx.stroke();
        
        // Draw emphasized frequency labels
        const emphasizedFont = this._preferences.text.emphasized;
        ctx.font = `${emphasizedFont.weight} ${emphasizedFont.size}px "${emphasizedFont.font}"`;
        ctx.textAlign = 'center';
        ctx.fillStyle = this._preferences.text.color;
        ctx.fillText('20', minX, this._gridCanvas.height/this._dpr - this._preferences.text.normal.size);  // Fixed reference
        ctx.fillText('20K', maxX, this._gridCanvas.height/this._dpr - this._preferences.text.normal.size);  // Fixed reference
        
        // Restore styles for regular grid
        ctx.strokeStyle = '#ccc';
        ctx.font = '12px Arial';
        
        // Draw all frequency bands
        freqBandsBelow100.forEach(freq => drawFreqLine(freq, false));
        freqBands100to1000.forEach(freq => drawFreqLine(freq, labeledFreqs.includes(freq)));
        freqBands1000to10000.forEach(freq => drawFreqLine(freq, labeledFreqs.includes(freq)));

        // Draw dB lines and labels for each scale
        for (const [scaleId, scale] of this._scales) {
            let dbStep = this._calculateDbStep(scale);
            const padding = scale.position === 'left' ? this._leftPadding : cssWidth - this._rightPadding;

            ctx.strokeStyle = this._preferences.grid.normalLine.color;
            ctx.fillStyle = scale.color;

            // If symmetrical, recalculate step to ensure symmetry and 0 inclusion
            if (scale.minDb === -scale.maxDb) {
                // Find the largest integer step that divides maxDb evenly
                let nSteps = Math.floor(scale.maxDb / dbStep);
                dbStep = scale.maxDb / nSteps;
                // Now generate labels: maxDb, ..., 0, ..., minDb
                let dbLabels = [];
                for (let i = nSteps; i >= -nSteps; i--) {
                    dbLabels.push(Math.round((i * dbStep) * 100) / 100);
                }

                // Draw grid lines and labels
                for (let db of dbLabels) {
                    const y = this._dbToY(db, scaleId);

                    ctx.beginPath();
                    ctx.lineWidth = db === 0 ? this._preferences.grid.emphasizedLine.width : 0.5;
                    ctx.strokeStyle = db === 0 ? '#888' : this._preferences.grid.normalLine.color;
                    ctx.moveTo(this._leftPadding, y);
                    ctx.lineTo(cssWidth - this._rightPadding, y);
                    ctx.stroke();

                    ctx.font = db === 0
                        ? `${this._preferences.text.emphasized.weight} ${this._preferences.text.emphasized.size}px "${this._preferences.text.emphasized.font}"`
                        : `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px "${this._preferences.text.normal.font}"`;
                    ctx.fillStyle = scale.color;
                    ctx.textAlign = scale.position === 'left' ? 'right' : 'left';
                    ctx.textBaseline = 'middle';
                    const textPadding = scale.position === 'left' ? -5 : 5;
                    ctx.fillText(`${db}`, padding + textPadding, y);
                }
            } else {
                // Generate labels from maxDb down to minDb, always including 0
                let dbLabels = [];
                for (let db = scale.maxDb; db >= scale.minDb - 0.0001; db -= dbStep) {
                    dbLabels.push(Math.round(db * 100) / 100); // round to avoid floating point errors
                }
                // Ensure 0 is included
                if (!dbLabels.includes(0) && scale.minDb < 0 && scale.maxDb > 0) {
                    dbLabels.push(0);
                    dbLabels = dbLabels.sort((a, b) => b - a);
                }

                // Draw grid lines and labels
                for (let db of dbLabels) {
                    const y = this._dbToY(db, scaleId);

                    ctx.beginPath();
                    ctx.lineWidth = db === 0 ? this._preferences.grid.emphasizedLine.width : 0.5;
                    ctx.strokeStyle = db === 0 ? '#888' : this._preferences.grid.normalLine.color;
                    ctx.moveTo(this._leftPadding, y);
                    ctx.lineTo(cssWidth - this._rightPadding, y);
                    ctx.stroke();

                    ctx.font = db === 0
                        ? `${this._preferences.text.emphasized.weight} ${this._preferences.text.emphasized.size}px "${this._preferences.text.emphasized.font}"`
                        : `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px "${this._preferences.text.normal.font}"`;
                    ctx.fillStyle = scale.color;
                    ctx.textAlign = scale.position === 'left' ? 'right' : 'left';
                    ctx.textBaseline = 'middle';
                    const textPadding = scale.position === 'left' ? -5 : 5;
                    ctx.fillText(`${db}`, padding + textPadding, y);
                }
            }
        }
        
        // Draw minDb and maxDb lines and labels with emphasis
        const minY = this._dbToY(this._minDb);
        const maxY = this._dbToY(this._maxDb);
        
        // Draw emphasized lines
        ctx.beginPath();
        ctx.lineWidth = this._preferences.grid.emphasizedLine.width;
        ctx.strokeStyle = this._preferences.grid.frequencyMarker.color;
        
        // Min line
        ctx.moveTo(leftPadding, minY);
        ctx.lineTo(this._freqToX(this._maxFreq), minY);
        ctx.stroke();
        
        // Max line
        ctx.beginPath();
        ctx.moveTo(leftPadding, maxY);
        ctx.lineTo(this._freqToX(this._maxFreq), maxY);
        ctx.stroke();
        
        // Restore original styles
        ctx.strokeStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textBaseline = 'middle';  // Keep consistent text baseline for all labels
    }
    
    _calculateFPS() {
        this._frameCount++;
        const currentTime = performance.now();
        const elapsed = currentTime - this._lastTime;
    
        if (elapsed >= 1000) {
            this._fps = Math.round((this._frameCount * 1000) / elapsed);
            this._frameCount = 0;
            this._lastTime = currentTime;
        }
        return this._fps;
    }

    _startAnimation() {
        if (!this._isAnimating) {
            this._isAnimating = true;
            this._animate();
        }
    }

    _animate() {
        if (!this._isAnimating) return;

        this._drawFrame();
        requestAnimationFrame(() => this._animate());
    }

    // Add new methods for spectrum management
    // Update the addSpectrum method to include frequencies array
    addSpectrum(id, options = {}) {
        const defaultSpectrum = {
            zIndex: this._spectrumLayers.size,
            decayData: new Array(8192).fill({ value: -120, startTime: 0 }),
            peakHoldData: new Array(8192).fill(-120),
            frequencies: null,
            isPeakHoldEnabled: true,
            isDecayEnabled: true,  // Add decay control option
            scaleId: 'default',  // Always set default scale
            preferences: {
                lineColor: '#2196F3',
                fillColor: 'rgba(33, 150, 243, 0.3)',
                peakColor: '#FF5722',
                showFill: true,
                showPeak: true
            }
        };
    
        // First spread the defaults, then spread the options to override if specified
        const spectrum = { ...defaultSpectrum, ...options };
        
        // Ensure scaleId exists in scales Map, fallback to default if not
        if (!this._scales.has(spectrum.scaleId)) {
            spectrum.scaleId = 'default';
        }
        
        this._spectrumLayers.set(id, spectrum);
    }

    removeSpectrum(id) {
        this._spectrumLayers.delete(id);
    }

    // Update the updateSpectrum method to accept frequencies
    updateSpectrum(id, data, frequencies) {
        const spectrum = this._spectrumLayers.get(id);
        if (!spectrum) return;
    
        const currentTime = performance.now();
        
        // Update frequencies if provided
        if (frequencies) {
            spectrum.frequencies = frequencies;
        }
        
        // Ensure decay and peak data arrays match input data length
        if (spectrum.decayData.length !== data.length) {
            spectrum.decayData = new Array(data.length).fill({ value: -120, startTime: 0 });
            spectrum.peakHoldData = new Array(data.length).fill(-120);
        }
        
        // Apply tilt to the data before further processing
        const tiltedData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            // Calculate the frequency for this bin if not provided
            const freq = frequencies?.[i] ?? this._binToFreq(i, data.length);
            
            // Apply tilt to the dB value, using the spectrum ID
            tiltedData[i] = this._applyTilt(data[i], freq, id);
        }
        
        // Update peak hold data with tilted values
        if (spectrum.isPeakHoldEnabled) {
            spectrum.peakHoldData = spectrum.peakHoldData.map((peak, i) => 
                Math.max(peak, tiltedData[i]));
        }
        
        // Update values, keeping track of decay
        for (let i = 0; i < data.length; i++) {
            if (tiltedData[i] > spectrum.decayData[i].value || !spectrum.isDecayEnabled ) {
                spectrum.decayData[i] = {
                    value: tiltedData[i], 
                    startValue: tiltedData[i],
                    startTime: currentTime
                };
            }
        }
    }

    // Update _drawFrame method to handle variable data length
    // Add this helper method after _calculateDbStep and before _drawGrid
    _reduceSpectrumData(points, tolerance = 0.1) {
        if (points.length < 2) return points;
        
        const reduced = [points[0]];
        let lastValue = points[0].y;
        let lastX = points[0].x;
        let skipCount = 0;
        
        // Use a larger minimum step size for initial reduction
        const minStep = Math.max(1, Math.floor(points.length / 200));
        
        for (let i = minStep; i < points.length - 1; i += minStep) {
            const point = points[i];
            const diff = Math.abs(point.y - lastValue);
            const xDiff = point.x - lastX;
            
            if (diff > tolerance || xDiff > 20 || skipCount > 10) {
                reduced.push(point);
                lastValue = point.y;
                lastX = point.x;
                skipCount = 0;
            } else {
                skipCount++;
            }
        }
        
        reduced.push(points[points.length - 1]);
        return reduced;
    }

    _interpolatePoints(points) {
        if (points.length < 2) return points;
        
        // Pre-calculate total width for frequency scaling
        const totalWidth = points[points.length - 1].x - points[0].x;
        const baseSteps = 5;
        const maxSteps = 10; // Reduced for better performance
        
        // Pre-allocate array with estimated size
        const result = new Array(points.length * maxSteps);
        let resultIndex = 0;
        result[resultIndex++] = points[0];
        
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            
            // Calculate steps based on x position (more points for lower frequencies)
            const freqFactor = 1 - (p1.x - points[0].x) / totalWidth;
            const xDistance = p2.x - p1.x;
            const steps = Math.min(maxSteps, 
                Math.max(baseSteps, 
                    Math.ceil(baseSteps + (maxSteps - baseSteps) * freqFactor * (xDistance / 50))
                )
            );
            
            // Pre-calculate step values
            const stepX = (p2.x - p1.x) / steps;
            const stepY = (p2.y - p1.y) / steps;
            
            // Linear interpolation with pre-calculated steps
            for (let t = 1; t < steps; t++) {
                result[resultIndex++] = {
                    x: p1.x + stepX * t,
                    y: p1.y + stepY * t
                };
            }
        }
        
        result[resultIndex++] = points[points.length - 1];
        return result.slice(0, resultIndex);
    }

    // Update the drawing code in _drawFrame to use quadratic curves directly
    _drawFrame() {
        const gl = this._spectrumCtx;
        const currentTime = performance.now();
        
        // Cache frequently used values
        const width = this._spectrumCanvas.width;
        const height = this._spectrumCanvas.height;
        
        // Clear WebGL canvas
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.viewport(0, 0, width, height);
        
        // Sort spectrums by z-index
        const sortedSpectrums = [...this._spectrumLayers.entries()]
            .sort((a, b) => a[1].zIndex - b[1].zIndex);
        
        // Pre-calculate common values
        const startX = this._freqToX(this._minFreq);
        const endX = this._freqToX(this._maxFreq);
        
        // Enable blending for transparency
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // Draw each spectrum
        for (const [id, spectrum] of sortedSpectrums) {
            const scale = this._scales.get(spectrum.scaleId || 'default');
            const bottomY = this._dbToY(scale.minDb, spectrum.scaleId);
            
            // Prepare and draw main spectrum
            const points = this._prepareSpectrumPoints(spectrum, currentTime, scale);
            this._drawSpectrum(gl, points, startX, endX, bottomY, spectrum.preferences);
    
            // Draw peak hold if enabled
            if (spectrum.isPeakHoldEnabled && spectrum.preferences.showPeak) {
                const peakPoints = this._preparePeakPoints(spectrum, scale);
                this._drawPeakHold(gl, peakPoints, spectrum.preferences);
            }
        }
    
        // Update FPS counter (less frequently)
        if (currentTime - this._lastTime >= 1000) {
            this._calculateFPS();
        }
    }
    
    _drawInitialSpectrum() {
        const gl = this._spectrumCtx;
        
        // Enable blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // Create vertices for the flat line
        const vertices = new Float32Array([
            this._freqToX(this._minFreq), this._dbToY(this._minDb),
            this._freqToX(this._maxFreq), this._dbToY(this._minDb)
        ]);
        
        // Set up WebGL state
        gl.useProgram(this._shaderProgram);
        gl.enableVertexAttribArray(this._positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        
        // Upload vertices and set attributes
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        gl.vertexAttribPointer(this._positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        // Set uniforms
        gl.uniform2f(this._resolutionLocation, gl.canvas.width, gl.canvas.height);
        const lineColor = this._parseColor(this._preferences.spectrum.lineColor);
        gl.uniform4fv(this._colorLocation, new Float32Array(lineColor));
        
        // Draw the line
        gl.lineWidth(2);
        gl.drawArrays(gl.LINES, 0, 2);
    }

    _prepareSpectrumPoints(spectrum, currentTime, scale) {
        const points = new Array(spectrum.decayData.length);
        
        // Batch process all points
        for (let i = 0; i < spectrum.decayData.length; i++) {
            const freq = spectrum.frequencies?.[i] ?? 
                this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (spectrum.decayData.length - 1));
            
            if(spectrum.isDecayEnabled && spectrum.decayData[i].startTime > 0) {
                const elapsed = currentTime - spectrum.decayData[i].startTime;
                const startValue = spectrum.decayData[i].startValue ?? spectrum.decayData[i].value;
                if (elapsed < this._decayTimeConstant) {
                    spectrum.decayData[i].value = startValue + (scale.minDb - startValue) * (elapsed / this._decayTimeConstant);
                } else {
                    spectrum.decayData[i].value = scale.minDb;
                }
            }
            
            // The tilt is already applied in updateSpectrum, so we don't need to apply it here
            let dbValue = spectrum.decayData[i].value;
            
            // Clamp the value to ensure it stays within minDb and maxDb range
            const clampedValue = Math.min(scale.maxDb, Math.max(scale.minDb, dbValue));
            
            points[i] = {
                x: this._freqToX(freq),
                y: this._dbToY(clampedValue, spectrum.scaleId)
            };
        }

        return points; //this._interpolatePoints(points);
    }

    _preparePeakPoints(spectrum, scale) {
        return this._interpolatePoints(
            spectrum.peakHoldData.map((value, i) => {
                const freq = spectrum.frequencies?.[i] ?? 
                    this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (spectrum.peakHoldData.length - 1));
                
                // The tilt is already applied in updateSpectrum, so we don't need to apply it here
                let peakValue = value;
                
                return {
                    x: this._freqToX(freq),
                    // Clamp the peak value to ensure it stays within minDb and maxDb range
                    y: this._dbToY(Math.min(scale.maxDb, Math.max(scale.minDb, peakValue)), spectrum.scaleId)
                };
            })
        );
    }

    _initWebGL() {
        const gl = this._spectrumCtx;
        
        // Clear color to transparent
        gl.clearColor(0, 0, 0, 0);
        
        // Vertex shader for spectrum
        const vsSource = `
            attribute vec2 a_position;
            uniform vec2 u_resolution;
            
            void main() {
                // Convert from pixels to clip space
                vec2 zeroToOne = a_position / u_resolution;
                vec2 zeroToTwo = zeroToOne * 2.0;
                vec2 clipSpace = zeroToTwo - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            }
        `;
        
        // Fragment shader for spectrum
        const fsSource = `
            precision mediump float;
            uniform vec4 u_color;
            
            void main() {
                gl_FragColor = u_color;
            }
        `;
        
        // Create shader program
        const vertexShader = this._createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this._createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        this._shaderProgram = this._createProgram(gl, vertexShader, fragmentShader);
        
        // Get attribute and uniform locations
        this._positionLocation = gl.getAttribLocation(this._shaderProgram, 'a_position');
        this._resolutionLocation = gl.getUniformLocation(this._shaderProgram, 'u_resolution');
        this._colorLocation = gl.getUniformLocation(this._shaderProgram, 'u_color');
        
        // Create buffers
        this._positionBuffer = gl.createBuffer();
    }
    
    _createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
    
    _createProgram(gl, vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }
    
    // Replace the existing _drawSpectrum method
    _drawSpectrum(ctx, points, startX, endX, bottomY, preferences) {
        const gl = ctx;
        
        // Set up WebGL state
        gl.useProgram(this._shaderProgram);
        gl.enableVertexAttribArray(this._positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        gl.vertexAttribPointer(this._positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        // Set uniforms
        gl.uniform2f(this._resolutionLocation, gl.canvas.width, gl.canvas.height);
        
        // Draw fill if enabled
        if (preferences.showFill) {
            // Reset WebGL state for fill
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            
            const vertices = new Float32Array(this._prepareVertices(points, startX, endX, bottomY));
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
            
            const fillColor = this._parseColor(preferences.fillColor);
            // Set color directly without creating new array
            gl.uniform4f(this._colorLocation, fillColor[0], fillColor[1], fillColor[2], fillColor[3]);
            
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 2);
        }
        
        // Draw line using triangles
        const pixelRatio = window.devicePixelRatio || 1;
        const lineWidth = (preferences.lineWidth || 2) * pixelRatio;
        const lineVertices = this._prepareLineVertices(points, lineWidth);
        gl.bufferData(gl.ARRAY_BUFFER, lineVertices, gl.STATIC_DRAW);
        const lineColor = this._parseColor(preferences.lineColor);
        gl.uniform4f(this._colorLocation, lineColor[0], lineColor[1], lineColor[2], lineColor[3]);
        
        gl.drawArrays(gl.TRIANGLES, 0, lineVertices.length / 2);
    }

    _drawPeakHold(ctx, points, preferences) {
        const gl = ctx;
        
        // Enable blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // Prepare vertices for the peak line using triangles
        const pixelRatio = window.devicePixelRatio || 1;
        const lineWidth = (preferences.peakWidth || preferences.lineWidth || 2) * pixelRatio;
        const vertices = this._prepareLineVertices(points, lineWidth);
        
        // Set up WebGL state
        gl.useProgram(this._shaderProgram);
        gl.enableVertexAttribArray(this._positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        
        // Upload vertices and set attributes
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        gl.vertexAttribPointer(this._positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        // Set uniforms
        gl.uniform2f(this._resolutionLocation, gl.canvas.width, gl.canvas.height);
        const peakColor = this._parseColor(preferences.peakColor);
        gl.uniform4fv(this._colorLocation, new Float32Array(peakColor));
        
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
    }
    
    _prepareVertices(points, startX, endX, bottomY) {
        // For TRIANGLE_STRIP, we need to alternate between curve points and bottom points
        const vertices = new Float32Array(points.length * 4);
        let idx = 0;
        
        // Add points alternating between curve and bottom
        for (const point of points) {
            // Add curve point
            vertices[idx++] = point.x * this._dpr;
            vertices[idx++] = point.y * this._dpr;
            
            // Add corresponding bottom point
            vertices[idx++] = point.x * this._dpr;
            vertices[idx++] = bottomY  * this._dpr;
        }
        
        return vertices;
    }
    
    _prepareLineVertices(points, lineWidth = 2) {
        if (points.length < 2) return new Float32Array();
        
        // Calculate vertices for a series of rectangles
        const vertices = new Float32Array((points.length - 1) * 12); // 6 vertices per segment (2 triangles)
        let idx = 0;
        
        for (let i = 0; i < points.length - 1; i++) {
            var p1 = points[i];
            var p2 = points[i + 1];
            
            // Calculate the line direction vector
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            
            // Normalize the direction vector
            const length = Math.sqrt(dx * dx + dy * dy);
            const nx = -dy / length * (lineWidth / 2);
            const ny = dx / length * (lineWidth / 2);
            
            // Add vertices for two triangles (6 vertices total)
            // First triangle
            vertices[idx++] = (p1.x + nx) * this._dpr;  // v1.x
            vertices[idx++] = (p1.y + ny) * this._dpr;  // v1.y
            vertices[idx++] = (p1.x - nx) * this._dpr;  // v2.x
            vertices[idx++] = (p1.y - ny) * this._dpr;  // v2.y
            vertices[idx++] = (p2.x + nx) * this._dpr;  // v3.x
            vertices[idx++] = (p2.y + ny) * this._dpr;  // v3.y
            
            // Second triangle
            vertices[idx++] = (p1.x - nx) * this._dpr;  // v4.x
            vertices[idx++] = (p1.y - ny) * this._dpr;  // v4.y
            vertices[idx++] = (p2.x - nx) * this._dpr;  // v5.x
            vertices[idx++] = (p2.y - ny) * this._dpr;  // v5.y
            vertices[idx++] = (p2.x + nx) * this._dpr;  // v6.x
            vertices[idx++] = (p2.y + ny) * this._dpr;  // v6.y
        }
        
        return vertices;
    }
    
    _parseColor(color) {
        // Handle rgba format
        if (color.startsWith('rgba')) {
            const matches = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
            if (matches) {
                return [
                    parseInt(matches[1]) / 255,
                    parseInt(matches[2]) / 255,
                    parseInt(matches[3]) / 255,
                    parseFloat(matches[4])
                ];
            }
        }
        
        // Handle rgb format
        if (color.startsWith('rgb')) {
            const matches = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (matches) {
                return [
                    parseInt(matches[1]) / 255,
                    parseInt(matches[2]) / 255,
                    parseInt(matches[3]) / 255,
                    1.0
                ];
            }
        }
        
        // Handle hex format
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            return [r, g, b, 1.0];
        }
        
        // Default fallback
        return [0, 0, 0, 1];
    }
        
    updatePreferences(preferences) {
        this._preferences = {...this._preferences, ...preferences};
        this._domElement.style.backgroundColor = this._preferences.background;
        if (preferences.decayTime) {
            this._decayTimeConstant = preferences.decayTime;
        }
        if (preferences.text) {
            this._scales.get('default').color = preferences.text.color;    
        }
        // Handle spectrum-specific preferences
        if (preferences.spectrumPreferences) {
            for (const [id, prefs] of Object.entries(preferences.spectrumPreferences)) {
                const spectrum = this._spectrumLayers.get(id);
                if (spectrum) {
                    spectrum.preferences = {
                        ...spectrum.preferences,
                        ...prefs
                    };
                    
                    // Apply tilt if specified
                    if (prefs.tilt !== undefined) {
                        this.setTilt(prefs.tilt, id);
                    }
                }
            }
        }

        // Redraw both grid and spectrums when preferences change
        this._drawGrid();
        this._drawFrame();
    }

    _handleMouseMove(event) {
        // Clear any existing timeout
        if (this._tooltipTimeout) {
            clearTimeout(this._tooltipTimeout);
        }
        
        // Get mouse position relative to canvas
        const rect = this._gridCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
    
        // Only show tooltip if mouse is in the chart area
        if (x >= this._leftPadding && 
            x <= this._gridCanvas.width/this._dpr - this._rightPadding &&
            y >= this._topBottomPadding && 
            y <= this._gridCanvas.height/this._dpr - this._topBottomPadding) {
            
            // Set timeout for tooltip display
            this._tooltipTimeout = setTimeout(() => {
                // Calculate frequency and dB values
                const freq = this._xToFreq(x);
                const db = this._yToDb(y);
    
                // Format the values
                const freqDisplay = freq < 1000 ? 
                                  `${Math.round(freq)}Hz` : 
                                  `${(freq/1000).toFixed(1)}kHz`;
                const dbDisplay = `${db.toFixed(1)}dB`;
    
                // Update tooltip content and position
                this._tooltip.textContent = `${freqDisplay}, ${dbDisplay}`;
                this._tooltip.style.display = 'block';
                
                // Position tooltip avoiding screen edges
                this._tooltip.style.left = `${event.offsetX + 10}px`;
                this._tooltip.style.top = `${event.offsetY + 10}px`;
            }, 500);
        }
    }
    
    _handleMouseOut() {
        if (this._tooltipTimeout) {
            clearTimeout(this._tooltipTimeout);
        }
        this._tooltip.style.display = 'none';
    }
}
