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
                peakColor: '#FF5722'  // Default peak hold color (orange)
            }
        };

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

    _dbToY(db) {
        const availableHeight = this._gridCanvas.height - (this._topBottomPadding * 2);
        return this._topBottomPadding + 
               (1 - ((db - this._minDb) / (this._maxDb - this._minDb))) * availableHeight;
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
                ctx.fillText(label, x, this._gridCanvas.height - 5);  // Fixed reference
            }
        };

        // Draw min/max frequency lines with emphasis
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#999';
        
        // Min frequency (20 Hz)
        ctx.moveTo(minX, this._topBottomPadding);
        ctx.lineTo(minX, this._gridCanvas.height - this._topBottomPadding);
        ctx.stroke();
        
        // Max frequency (20K)
        ctx.beginPath();
        ctx.moveTo(maxX, this._topBottomPadding);
        ctx.lineTo(maxX, this._gridCanvas.height - this._topBottomPadding);  // Fixed reference
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

        // Remove this entire block as it's using the undefined freqBands variable
        /* for (let decade = 1; decade <= 3; decade++) {
            const multiplier = Math.pow(10, decade);
            freqBands.forEach(freq => {
                const freqValue = freq * multiplier;
                // Skip if frequency is greater than or equal to max frequency
                if (freqValue >= this._maxFreq) return;
                
                const x = this._freqToX(freqValue);
                const isLabeled = labeledFreqs.includes(freqValue);
                
                ctx.beginPath();
                ctx.lineWidth = isLabeled ? 2 : 0.5;
                ctx.moveTo(x, this._topBottomPadding);
                ctx.lineTo(x, this._canvas.height - this._topBottomPadding);
                ctx.stroke();
                
                if (isLabeled) {
                    ctx.textAlign = 'center';
                    ctx.fillText(`${freqValue}`, x, this._canvas.height - 5);
                }
            });
        } */

        // Draw dB lines and labels
        const dbStep = this._calculateDbStep();
        
        // Draw regular grid lines
        for (let db = this._minDb; db <= this._maxDb; db += dbStep) {
            if (db === this._minDb || db === this._maxDb) continue;
            const y = this._dbToY(db);
            
            ctx.beginPath();
            ctx.lineWidth = 0.5;
            ctx.moveTo(leftPadding, y);
            ctx.lineTo(this._freqToX(this._maxFreq), y);
            ctx.stroke();
            
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';  // Add this for regular labels
            ctx.fillText(`${db}`, leftPadding - 5, y);
        }
        
        // Draw minDb and maxDb lines and labels with emphasis
        const minY = this._dbToY(this._minDb);
        const maxY = this._dbToY(this._maxDb);
        
        // Draw emphasized lines
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#999';
        
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
            frequencies: null,  // Add frequencies array
            isPeakHoldEnabled: true,
            preferences: {
                lineColor: '#2196F3',
                fillColor: 'rgba(33, 150, 243, 0.3)',
                peakColor: '#FF5722',
                showFill: true,
                showPeak: true  // Add this new option
            }
        };
    
        const spectrum = { ...defaultSpectrum, ...options };
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
            if (data[i] > spectrum.decayData[i].value) {
                spectrum.decayData[i] = {
                    value: data[i],
                    startTime: currentTime
                };
            }
        }
    }

    // Update _drawFrame method to handle variable data length
    // Add this helper method after _calculateDbStep and before _drawGrid
    // Add this helper method before _interpolatePoints
    _reduceSpectrumData(points, tolerance = 0.1) {
        if (points.length < 2) return points;
        
        const reduced = [points[0]];
        let lastValue = points[0].y;
        let lastX = points[0].x;
        
        for (let i = 1; i < points.length - 1; i++) {
            const diff = Math.abs(points[i].y - lastValue);
            // Make tolerance stricter for lower frequencies (left side)
            const dynamicTolerance = tolerance * (1 + (points[i].x - points[0].x) / (points[points.length - 1].x - points[0].x));
            const xDiff = Math.abs(points[i].x - lastX);
            
            if (diff > dynamicTolerance || xDiff > 20) {  // Add minimum x-spacing check
                reduced.push(points[i]);
                lastValue = points[i].y;
                lastX = points[i].x;
            }
        }
        
        reduced.push(points[points.length - 1]);
        return reduced;
    }

    _interpolatePoints(points) {
        if (points.length < 2) return points;
        
        const result = [];
        result.push(points[0]);
        
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            
            // More interpolation points for lower frequencies
            const steps = Math.max(5, Math.ceil(20 * (1 - (p1.x - points[0].x) / (points[points.length - 1].x - points[0].x))));
            
            for (let t = 1; t < steps; t++) {
                const ratio = t / steps;
                const x = p1.x + (p2.x - p1.x) * ratio;
                const y = p1.y + (p2.y - p1.y) * ratio;
                result.push({ x, y });
            }
        }
        
        result.push(points[points.length - 1]);
        return result;
    }

    // Update the drawing code in _drawFrame to use quadratic curves directly
    _drawFrame() {
        const ctx = this._spectrumCtx;
        const currentTime = performance.now();
        const currentFPS = this._calculateFPS();
        
        // Clear canvas
        ctx.clearRect(0, 0, this._spectrumCanvas.width, this._spectrumCanvas.height);
        
        // Sort spectrums by z-index
        const sortedSpectrums = Array.from(this._spectrumLayers.entries())
            .sort((a, b) => a[1].zIndex - b[1].zIndex);
        
        // Draw each spectrum
        for (const [id, spectrum] of sortedSpectrums) {
            ctx.beginPath();
            ctx.strokeStyle = spectrum.preferences.lineColor;
            ctx.fillStyle = spectrum.preferences.fillColor;
            ctx.lineWidth = 2;
            
            const startX = this._freqToX(this._minFreq);
            const bottomY = this._dbToY(this._minDb);
            
            // Collect and prepare points
            const points = [];
            const dataLength = spectrum.decayData.length;
            
            for (let i = 0; i < dataLength; i++) {
                const freq = spectrum.frequencies ? 
                    spectrum.frequencies[i] : 
                    this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (dataLength - 1));
                
                const elapsed = currentTime - spectrum.decayData[i].startTime;
                const initialValue = spectrum.decayData[i].value;
                const decayFactor = Math.exp(-elapsed / this._decayTimeConstant);
                let currentValue = this._minDb + (initialValue - this._minDb) * decayFactor;
                currentValue = Math.max(currentValue, this._minDb);
                spectrum.decayData[i].value = currentValue;
                
                points.push({
                    x: this._freqToX(freq),
                    y: this._dbToY(currentValue)
                });
            }

            // Reduce redundant points before interpolation
            const reducedPoints = this._reduceSpectrumData(points);
            
            // Interpolate the reduced points
            const interpolatedPoints = this._interpolatePoints(reducedPoints);
            
            // Draw the main curve
            ctx.beginPath();
            ctx.moveTo(interpolatedPoints[0].x, interpolatedPoints[0].y);
            
            for (let i = 1; i < interpolatedPoints.length; i++) {
                ctx.lineTo(interpolatedPoints[i].x, interpolatedPoints[i].y);
            }

            // Only complete the fill path if showFill is true
            if (spectrum.preferences.showFill) {
                ctx.lineTo(this._freqToX(this._maxFreq), bottomY);
                ctx.lineTo(startX, bottomY);
                ctx.closePath();
                ctx.fill();
            }
            
            ctx.stroke();

            // Draw peak hold with improved interpolation
            if (spectrum.isPeakHoldEnabled && spectrum.preferences.showPeak) {  // Add condition here
                ctx.beginPath();
                ctx.strokeStyle = spectrum.preferences.peakColor;
                ctx.lineWidth = 2;
                
                const peakPoints = spectrum.peakHoldData.map((value, i) => ({
                    x: this._freqToX(spectrum.frequencies ? 
                        spectrum.frequencies[i] : 
                        this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (spectrum.peakHoldData.length - 1))),
                    y: this._dbToY(value)
                }));

                const interpolatedPeakPoints = this._interpolatePoints(peakPoints);
                
                ctx.moveTo(interpolatedPeakPoints[0].x, interpolatedPeakPoints[0].y);
                for (let i = 1; i < interpolatedPeakPoints.length; i++) {
                    ctx.lineTo(interpolatedPeakPoints[i].x, interpolatedPeakPoints[i].y);
                }
                
                ctx.stroke();
            }
        }

        // Draw FPS counter
        ctx.font = `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px ${this._preferences.text.normal.font}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = this._preferences.text.color;
        ctx.fillText(`${currentFPS} FPS`, this._spectrumCanvas.width - 10, 15);
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







