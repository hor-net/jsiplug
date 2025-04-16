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
        
        // Add peak hold data
        this._peakHoldData = new Array(200).fill(-120);
        this._isPeakHoldEnabled = true;
        
        // Appearance preferences - Move this BEFORE scales initialization
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
                frequencyMarker: {  // Add frequency marker preferences
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
            this._preferences = {...this._preferences, ...options.preferences};
        }
        
        // Add scales management - Move this AFTER preferences initialization
        this._scales = new Map();
        this._scales.set('default', {
            minDb: this._minDb,
            maxDb: this._maxDb,
            position: 'left',
            color: this._preferences.text.color
        });

        // Default values (modify to use default scale)
        this._minFreq = 20;
        this._maxFreq = 20000;
        
        // Add peak hold data
        this._peakHoldData = new Array(200).fill(-120);
        this._isPeakHoldEnabled = true;
        
        // Override defaults with user preferences if provided
        if (options.preferences) {
            this._preferences = {...this._preferences, ...options.preferences};
        }
        
        // Create two canvas elements
        this._gridCanvas = document.createElement('canvas');
        this._spectrumCanvas = document.createElement('canvas');
        
        // Style the canvases for stacking
        this._gridCanvas.style.width = '100%';
        this._gridCanvas.style.height = '100%';
        this._gridCanvas.style.position = 'absolute';
        this._gridCanvas.style.top = '0';
        this._gridCanvas.style.left = '0';
        this._gridCanvas.style.display = 'block';
        
        this._spectrumCanvas.style.width = '100%';
        this._spectrumCanvas.style.height = '100%';
        this._spectrumCanvas.style.position = 'absolute';
        this._spectrumCanvas.style.top = '0';
        this._spectrumCanvas.style.left = '0';
        this._spectrumCanvas.style.display = 'block';
        
        // Set container position to relative for absolute positioning of canvases
        this._domElement.style.position = 'relative';
        this._domElement.style.backgroundColor = this._preferences.background;
        
        // Add canvases to DOM
        this._domElement.appendChild(this._gridCanvas);
        this._domElement.appendChild(this._spectrumCanvas);
        
        // Get contexts
        this._gridCtx = this._gridCanvas.getContext('2d');
        this._spectrumCtx = this._spectrumCanvas.getContext('2d');
        
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
            // Reset peak hold data for all spectrum layers
            for (const spectrum of this._spectrumLayers.values()) {
                spectrum.peakHoldData.fill(-120);
            }
        });

        // Add tooltip elements and properties
        this._tooltip = document.createElement('div');
        this._tooltip.style.position = 'absolute';
        this._tooltip.style.display = 'none';
        this._tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this._tooltip.style.color = 'white';
        this._tooltip.style.padding = '8px';
        this._tooltip.style.borderRadius = '4px';
        this._tooltip.style.fontSize = '12px';
        this._tooltip.style.pointerEvents = 'none';
        this._domElement.appendChild(this._tooltip);

        this._tooltipTimeout = null;

        // Add mouse event listeners
        this._domElement.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this._domElement.addEventListener('mouseout', this._handleMouseOut.bind(this));
    }
    
    _updateCanvasSize() {
        const rect = this._domElement.getBoundingClientRect();
        this._topBottomPadding = 20;
        this._leftPadding = 60;
        this._rightPadding = 40;
        
        // Add extra padding if there's a right-side scale
        if ([...this._scales.values()].some(scale => scale.position === 'right')) {
            this._rightPadding = 60;
        }
        
        // Update both canvases
        this._gridCanvas.width = rect.width;
        this._gridCanvas.height = rect.height;
        this._gridCanvas.style.margin = '0';
        
        this._spectrumCanvas.width = rect.width;
        this._spectrumCanvas.height = rect.height;
        this._spectrumCanvas.style.margin = '0';
        
        this._drawGrid();
    }

    _freqToX(freq) {
        const logMin = Math.log10(this._minFreq);
        const logMax = Math.log10(this._maxFreq);
        const logFreq = Math.log10(freq);
        return this._leftPadding + ((logFreq - logMin) / (logMax - logMin)) * 
               (this._gridCanvas.width - this._leftPadding - this._rightPadding);
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

    // Add helper method to get dB value based on scale
    _dbToY(db, scaleId = 'default') {
        const scale = this._scales.get(scaleId);
        const availableHeight = this._gridCanvas.height - (this._topBottomPadding * 2);
        return this._topBottomPadding + 
               (1 - ((db - scale.minDb) / (scale.maxDb - scale.minDb))) * availableHeight;
    }

    _calculateDbStep() {
        const minSpacing = 30;
        const availableHeight = this._gridCanvas.height - (this._topBottomPadding * 2);
        const dbRange = this._maxDb - this._minDb;
        const maxDivisions = Math.floor(availableHeight / minSpacing);
        const step = Math.ceil(dbRange / maxDivisions);
        return Math.ceil(step / 3) * 3;  // Round to nearest multiple of 3
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
        const drawWidth = this._gridCanvas.width - leftPadding;
        
        // Calculate min/max X coordinates first
        const minX = this._freqToX(this._minFreq);
        const maxX = this._freqToX(this._maxFreq);
        
        // Define frequency bands and continue with existing code
        const freqBandsBelow100 = Array.from({length: 9}, (_, i) => (i + 2) * 10);
        const freqBands100to1000 = Array.from({length: 9}, (_, i) => (i + 1) * 100);
        const freqBands1000to10000 = Array.from({length: 10}, (_, i) => (i + 1) * 1000);
        const labeledFreqs = [100, 1000, 10000];
        const emphasizedFreqs = [100, 1000, 10000];

        // Draw regular frequency lines (keep only this version of drawFreqLine)
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
            ctx.lineTo(x, this._gridCanvas.height - this._topBottomPadding);  // Fixed reference
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
                ctx.fillText(label, x, this._gridCanvas.height - 5);  // Fixed reference
            }
        };

        // Draw min/max frequency lines with emphasis
        ctx.beginPath();
        ctx.lineWidth = this._preferences.grid.emphasizedLine.width;
        ctx.strokeStyle = this._preferences.grid.frequencyMarker.color;
        
        // Min frequency (20 Hz)
        ctx.moveTo(minX, this._topBottomPadding);
        ctx.lineTo(minX, this._gridCanvas.height - this._topBottomPadding);
        ctx.stroke();
        
        // Max frequency (20K)
        ctx.beginPath();
        ctx.moveTo(maxX, this._topBottomPadding);
        ctx.lineTo(maxX, this._gridCanvas.height - this._topBottomPadding);
        ctx.stroke();
        
        // Draw emphasized frequency labels
        const emphasizedFont = this._preferences.text.emphasized;
        ctx.font = `${emphasizedFont.weight} ${emphasizedFont.size}px "${emphasizedFont.font}"`;
        ctx.textAlign = 'center';
        ctx.fillStyle = this._preferences.text.color;
        ctx.fillText('20', minX, this._gridCanvas.height - 5);  // Fixed reference
        ctx.fillText('20K', maxX, this._gridCanvas.height - 5);  // Fixed reference
        
        // Restore styles for regular grid
        ctx.strokeStyle = '#ccc';
        ctx.font = '12px Arial';
        
        // Draw all frequency bands
        freqBandsBelow100.forEach(freq => drawFreqLine(freq, false));
        freqBands100to1000.forEach(freq => drawFreqLine(freq, labeledFreqs.includes(freq)));
        freqBands1000to10000.forEach(freq => drawFreqLine(freq, labeledFreqs.includes(freq)));

        // Draw dB lines and labels for each scale
        for (const [scaleId, scale] of this._scales) {
            const dbStep = this._calculateDbStep(scale);
            const padding = scale.position === 'left' ? this._leftPadding : this._gridCanvas.width - this._rightPadding;
            
            ctx.strokeStyle = this._preferences.grid.normalLine.color;
            ctx.fillStyle = scale.color;
            
            // Draw regular grid lines
            for (let db = scale.minDb; db <= scale.maxDb; db += dbStep) {
                if (db === scale.minDb || db === scale.maxDb) continue;
                const y = this._dbToY(db, scaleId);
                
                ctx.beginPath();
                ctx.lineWidth = 0.5;
                ctx.moveTo(this._leftPadding, y);
                ctx.lineTo(this._gridCanvas.width - this._rightPadding, y);
                ctx.stroke();
                
                ctx.textAlign = scale.position === 'left' ? 'right' : 'left';
                ctx.textBaseline = 'middle';
                const textPadding = scale.position === 'left' ? -5 : 5;
                ctx.fillText(`${db}`, padding + textPadding, y);
            }
            
            // Draw emphasized min/max lines
            const minY = this._dbToY(scale.minDb, scaleId);
            const maxY = this._dbToY(scale.maxDb, scaleId);
            
            ctx.lineWidth = this._preferences.grid.emphasizedLine.width;
            ctx.strokeStyle = this._preferences.grid.emphasizedLine.color;
            
            // Min/Max lines
            ctx.beginPath();
            ctx.moveTo(this._leftPadding, minY);
            ctx.lineTo(this._gridCanvas.width - this._rightPadding, minY);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(this._leftPadding, maxY);
            ctx.lineTo(this._gridCanvas.width - this._rightPadding, maxY);
            ctx.stroke();
            
            // Min/Max labels
            ctx.font = `${this._preferences.text.emphasized.weight} ${this._preferences.text.emphasized.size}px "${this._preferences.text.emphasized.font}"`;
            //ctx.fillStyle = this._preferences.grid.emphasizedLine.color;
            ctx.fillText(`${scale.minDb}`, padding + (scale.position === 'left' ? -5 : 5), minY);
            ctx.fillText(`${scale.maxDb}`, padding + (scale.position === 'left' ? -5 : 5), maxY);
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
        
        // Draw emphasized labels
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';  // Ensure consistent baseline
        ctx.font = `${emphasizedFont.weight} ${emphasizedFont.size}px "${emphasizedFont.font}"`;
        ctx.fillStyle = this._preferences.grid.emphasizedLine.color;
        ctx.fillText(`${this._minDb}`, leftPadding - 5, minY);  // Use same padding as regular labels
        ctx.fillText(`${this._maxDb}`, leftPadding - 5, maxY);  // Use same padding as regular labels
        
        // Restore original styles
        ctx.strokeStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textBaseline = 'middle';  // Keep consistent text baseline for all labels
    }
    
    // Method to update spectrum data
    // Add FPS calculation method
    _calculateFPS() {
        this._frameCount++;
        const currentTime = performance.now();
        const elapsed = currentTime - this._lastTime;

        if (elapsed >= 1000) {
            this._fps = Math.round((this._frameCount * 1000) / elapsed);
            console.log('Frames in last second:', this._frameCount); // Debug info
            this._frameCount = 0;
            this._lastTime = currentTime;
        }
        return elapsed < 1000 ? Math.round((this._frameCount * 1000) / elapsed) : this._fps;
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
        
        // Update peak hold data
        if (spectrum.isPeakHoldEnabled) {
            spectrum.peakHoldData = spectrum.peakHoldData.map((peak, i) => 
                Math.max(peak, data[i]));
        }
        
        // Update values, keeping track of decay
        for (let i = 0; i < data.length; i++) {
            if (data[i] > spectrum.decayData[i].value && spectrum.isDecayEnabled ) {
                spectrum.decayData[i] = {
                    value: data[i],
                    startTime: currentTime
                };
            } else {
              spectrum.decayData[i] = {
                  value: data[i],
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
            
            // Simplified dynamic tolerance
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
        const maxSteps = 12; // Reduced from 20 for better performance
        
        // Pre-allocate array with estimated size
        const estimatedSize = points.length * maxSteps;
        const result = new Array(estimatedSize);
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
        const ctx = this._spectrumCtx;
        const currentTime = performance.now();
        
        // Cache frequently used values
        const width = this._spectrumCanvas.width;
        const height = this._spectrumCanvas.height;
        
        // Clear canvas - use clearRect only for the area we draw in
        ctx.clearRect(this._leftPadding, this._topBottomPadding, 
            width - this._leftPadding - this._rightPadding, 
            height - 2 * this._topBottomPadding);
        
        // Sort spectrums by z-index - do this only when layers change
        const sortedSpectrums = [...this._spectrumLayers.entries()]
            .sort((a, b) => a[1].zIndex - b[1].zIndex);
        
        // Pre-calculate common values
        const startX = this._freqToX(this._minFreq);
        const endX = this._freqToX(this._maxFreq);
        
        // Draw each spectrum
        for (const [id, spectrum] of sortedSpectrums) {
            const scale = this._scales.get(spectrum.scaleId || 'default');
            const bottomY = this._dbToY(scale.minDb, spectrum.scaleId);
            const points = new Array(spectrum.decayData.length);
            
            // Batch process all points first
            for (let i = 0; i < spectrum.decayData.length; i++) {
                const freq = spectrum.frequencies?.[i] ?? 
                    this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (spectrum.decayData.length - 1));
                
                const decayData = spectrum.decayData[i];
                if(spectrum.isDecayEnabled && decayData.startTime > 0) {
                    const decayFactor = (currentTime - decayData.startTime) / (this._decayTimeConstant);
                    decayData.value = Math.max(
                        scale.minDb,
                        decayData.value - (30 * decayFactor * (1 + decayFactor))
                    );
                }
                
                points[i] = {
                    x: this._freqToX(freq),
                    y: this._dbToY(
                        Math.min(scale.maxDb, Math.max(scale.minDb, decayData.value)),
                        spectrum.scaleId
                    )
                };
            }

            // Process and draw main curve
            const interpolatedPoints = this._interpolatePoints(
                this._reduceSpectrumData(points)
            );
            
            // Draw fill if enabled
            if (spectrum.preferences.showFill) {
                ctx.beginPath();
                ctx.fillStyle = spectrum.preferences.fillColor;
                ctx.moveTo(startX, bottomY);
                for (const point of interpolatedPoints) {
                    ctx.lineTo(point.x, point.y);
                }
                ctx.lineTo(endX, bottomY);
                ctx.fill();
            }
            
            // Draw line
            ctx.beginPath();
            ctx.strokeStyle = spectrum.preferences.lineColor;
            ctx.lineWidth = spectrum.preferences.lineWidth || 2;
            const firstPoint = interpolatedPoints[0];
            ctx.moveTo(firstPoint.x, firstPoint.y);
            for (let i = 1; i < interpolatedPoints.length; i++) {
                ctx.lineTo(interpolatedPoints[i].x, interpolatedPoints[i].y);
            }
            ctx.stroke();

            // Draw peak hold if enabled
            if (spectrum.isPeakHoldEnabled && spectrum.preferences.showPeak) {
                ctx.beginPath();
                ctx.strokeStyle = spectrum.preferences.peakColor;
                ctx.lineWidth = spectrum.preferences.peakWidth || spectrum.preferences.lineWidth || 2;
                
                const peakPoints = this._interpolatePoints(
                    spectrum.peakHoldData.map((value, i) => ({
                        x: this._freqToX(spectrum.frequencies?.[i] ?? 
                            this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (spectrum.peakHoldData.length - 1))),
                        y: this._dbToY(value)
                    }))
                );
                
                ctx.moveTo(peakPoints[0].x, peakPoints[0].y);
                for (const point of peakPoints) {
                    ctx.lineTo(point.x, point.y);
                }
                ctx.stroke();
            }
        }

        // Update FPS counter less frequently
        if (currentTime - this._lastTime >= 500) {
            ctx.font = `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px ${this._preferences.text.normal.font}`;
            ctx.textAlign = 'right';
            ctx.fillStyle = this._preferences.text.color;
            ctx.fillText(`${this._calculateFPS()} FPS`, width - 10, 15);
            this._lastTime = currentTime;
        }
    }
    
    _drawInitialSpectrum() {
        const ctx = this._spectrumCtx;
        
        ctx.beginPath();
        ctx.strokeStyle = this._preferences.spectrum.lineColor;
        ctx.lineWidth = 2;
        
        // Draw a flat line at minimum dB
        const y = this._dbToY(this._minDb);
        ctx.moveTo(this._freqToX(this._minFreq), y);
        ctx.lineTo(this._freqToX(this._maxFreq), y);
        
        ctx.stroke();
    }
    
    updatePreferences(preferences) {
        this._preferences = {...this._preferences, ...preferences};
        this._domElement.style.backgroundColor = this._preferences.background;
        if (preferences.decayTime) {
            this._decayTimeConstant = preferences.decayTime;
        }
        // Redraw only the grid when preferences change
        this._drawGrid();
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
            x <= this._gridCanvas.width - this._rightPadding &&
            y >= this._topBottomPadding && 
            y <= this._gridCanvas.height - this._topBottomPadding) {
            
            // Set timeout for tooltip display
            this._tooltipTimeout = setTimeout(() => {
                // Calculate frequency and dB values
                const freq = Math.pow(10, 
                    (x - this._leftPadding) / 
                    (this._gridCanvas.width - this._leftPadding - this._rightPadding) * 
                    (Math.log10(this._maxFreq) - Math.log10(this._minFreq)) + 
                    Math.log10(this._minFreq)
                );
                
                const db = this._maxDb - 
                          ((y - this._topBottomPadding) / 
                          (this._gridCanvas.height - 2 * this._topBottomPadding)) * 
                          (this._maxDb - this._minDb);
    
                // Format the values
                const freqDisplay = freq < 1000 ? 
                                  `${Math.round(freq)}Hz` : 
                                  `${(freq/1000).toFixed(1)}kHz`;
                const dbDisplay = `${db.toFixed(1)}dB`;
    
                // Update tooltip content and position
                this._tooltip.textContent = `${freqDisplay}, ${dbDisplay}`;
                this._tooltip.style.display = 'block';
                
                // Position tooltip avoiding screen edges
                const tooltipX = event.offsetX + 10;
                const tooltipY = event.offsetY + 10;
                
                this._tooltip.style.left = `${tooltipX}px`;
                this._tooltip.style.top = `${tooltipY}px`;
                this._tooltip.style.zIndex = 1000;
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







