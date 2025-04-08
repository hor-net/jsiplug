/**
 * Spectrum analyzer chart component
 */
class iSpectrumChart extends iControl {
    constructor(options) {
        super(options);
        
        // Get decay time from options or use default (5000ms)
        const decayTime = Number(options.decayTime) || 5000;
        
        // Update decay properties for exponential decay
        this._decayData = new Array(200).fill({ value: -120, startTime: 0 });
        this._decayTimeConstant = decayTime; // tau in milliseconds
        
        // Add FPS tracking and animation properties
        this._frameCount = 0;
        this._lastTime = performance.now();
        this._fps = 0;
        this._currentData = new Array(200).fill(-120);
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
        
        // Create canvas element
        this._canvas = document.createElement('canvas');
        this._canvas.style.width = '100%';
        this._canvas.style.height = '100%';
        this._canvas.style.display = 'block';
        this._domElement.style.backgroundColor = this._preferences.background;
        this._domElement.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');
        
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
        this._canvas.addEventListener('click', () => {
            this._peakHoldData.fill(-120);
        });
    }
    
    _updateCanvasSize() {
        const rect = this._domElement.getBoundingClientRect();
        this._topBottomPadding = 20;
        this._leftPadding = 60;
        this._rightPadding = 40;  // Add right padding
        
        this._canvas.width = rect.width;
        this._canvas.height = rect.height;
        this._canvas.style.margin = '0';
        this._drawGrid();
    }

    _freqToX(freq) {
        const logMin = Math.log10(this._minFreq);
        const logMax = Math.log10(this._maxFreq);
        const logFreq = Math.log10(freq);
        return this._leftPadding + ((logFreq - logMin) / (logMax - logMin)) * 
               (this._canvas.width - this._leftPadding - this._rightPadding);  // Account for right padding
    }

    _dbToY(db) {
        // Adjust Y calculation to account for padding
        const availableHeight = this._canvas.height - (this._topBottomPadding * 2);
        return this._topBottomPadding + 
               (1 - ((db - this._minDb) / (this._maxDb - this._minDb))) * availableHeight;
    }
    
    _calculateDbStep() {
        const minSpacing = 30;  // Minimum pixels between dB labels
        const availableHeight = this._canvas.height - (this._topBottomPadding * 2);
        const dbRange = this._maxDb - this._minDb;
        const maxDivisions = Math.floor(availableHeight / minSpacing);
        const step = Math.ceil(dbRange / maxDivisions);
        return Math.ceil(step / 3) * 3;  // Round to nearest multiple of 3
    }

    _drawGrid() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        
        // Style setup
        ctx.strokeStyle = this._preferences.grid.normalLine.color;
        ctx.fillStyle = this._preferences.text.color;
        ctx.font = `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px ${this._preferences.text.normal.font}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        // Use stored left padding
        const leftPadding = this._leftPadding;
        
        const drawWidth = this._canvas.width - leftPadding;
        
        // Define frequency bands for different ranges
        const freqBandsBelow100 = Array.from({length: 9}, (_, i) => (i + 2) * 10); // 20,30,40...90
        const freqBands100to1000 = Array.from({length: 9}, (_, i) => (i + 1) * 100); // 100,200,300...900
        const freqBands1000to10000 = Array.from({length: 10}, (_, i) => (i + 1) * 1000); // 1000,2000...10000
        const labeledFreqs = [100, 1000, 10000];
        const emphasizedFreqs = [100, 1000, 10000];  // Frequencies that get thicker lines

        // Draw regular frequency lines
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
            ctx.lineTo(x, this._canvas.height - this._topBottomPadding);
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
                ctx.fillText(label, x, this._canvas.height - 5);
            }
        };

        // Draw min/max frequency lines with emphasis
        ctx.beginPath();
        ctx.lineWidth = 2;  // Changed from 3 to 2
        ctx.strokeStyle = '#999';
        
        // Min frequency (20 Hz)
        const minX = this._freqToX(this._minFreq);
        ctx.moveTo(minX, this._topBottomPadding);
        ctx.lineTo(minX, this._canvas.height - this._topBottomPadding);
        ctx.stroke();
        
        // Max frequency (20K)
        const maxX = this._freqToX(this._maxFreq);
        ctx.beginPath();
        ctx.moveTo(maxX, this._topBottomPadding);
        ctx.lineTo(maxX, this._canvas.height - this._topBottomPadding);
        ctx.stroke();
        
        // Draw emphasized frequency labels
        const emphasizedFont = this._preferences.text.emphasized;
        ctx.font = `${emphasizedFont.weight} ${emphasizedFont.size}px "${emphasizedFont.font}"`;
        ctx.textAlign = 'center';
        ctx.fillStyle = this._preferences.text.color;
        ctx.fillText('20', minX, this._canvas.height - 5);
        ctx.fillText('20K', maxX, this._canvas.height - 5);
        
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
            
            // Update line drawing to account for left padding and max frequency
            ctx.beginPath();
            ctx.lineWidth = 0.5;
            ctx.moveTo(leftPadding, y);
            ctx.lineTo(this._freqToX(this._maxFreq), y);  // Stop at max frequency
            ctx.stroke();
            
            ctx.textAlign = 'right';
            ctx.fillText(`${db}`, leftPadding - 5, y);
        }
        
        // Draw minDb and maxDb lines and labels with emphasis
        const minY = this._dbToY(this._minDb);
        const maxY = this._dbToY(this._maxDb);
        
        // Draw emphasized lines
        ctx.beginPath();
        ctx.lineWidth = 2;  // Changed from 3 to 2
        ctx.strokeStyle = '#999';
        
        // Min line
        ctx.moveTo(leftPadding, minY);
        ctx.lineTo(this._freqToX(this._maxFreq), minY);  // Stop at max frequency
        ctx.stroke();
        
        // Max line
        ctx.beginPath();
        ctx.moveTo(leftPadding, maxY);
        ctx.lineTo(this._freqToX(this._maxFreq), maxY);  // Stop at max frequency
        ctx.stroke();
        
        // Draw emphasized labels with more space
        ctx.textAlign = 'right';
        ctx.font = `${emphasizedFont.weight} ${emphasizedFont.size}px "${emphasizedFont.font}"`;
        ctx.fillText(`${this._minDb}`, leftPadding - 15, minY);
        ctx.fillText(`${this._maxDb}`, leftPadding - 15, maxY);
        
        // Restore original styles
        ctx.strokeStyle = '#ccc';
        ctx.font = '12px Arial';
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

    // Keep only this version of updateSpectrum
    updateSpectrum(data) {
        const currentTime = performance.now();
        
        // Update peak hold data
        if (this._isPeakHoldEnabled) {
            this._peakHoldData = this._peakHoldData.map((peak, i) => 
                Math.max(peak, data[i]));
        }
        
        // Update values, keeping track of decay
        for (let i = 0; i < data.length; i++) {
            if (data[i] > this._decayData[i].value) {
                this._decayData[i] = {
                    value: data[i],
                    startTime: currentTime
                };
            }
        }
    }

    _drawFrame() {
        const ctx = this._ctx;
        const currentTime = performance.now();
        const currentFPS = this._calculateFPS();
        
        // Clear canvas and draw grid
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        this._drawGrid();
        
        // Draw spectrum with configured colors
        ctx.beginPath();
        ctx.strokeStyle = this._preferences.spectrum.lineColor;
        ctx.fillStyle = this._preferences.spectrum.fillColor;
        ctx.lineWidth = 2;
        
        const startX = this._freqToX(this._minFreq);
        const bottomY = this._dbToY(this._minDb);
        ctx.moveTo(startX, bottomY);
        
        // Draw spectrum with exponential decay
        for (let i = 0; i < this._decayData.length; i++) {
            const freq = this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (this._decayData.length - 1));
            const elapsed = currentTime - this._decayData[i].startTime;
            
            // Calculate exponential decay
            const initialValue = this._decayData[i].value;
            const decayFactor = Math.exp(-elapsed / this._decayTimeConstant);
            let currentValue = this._minDb + (initialValue - this._minDb) * decayFactor;
            currentValue = Math.max(currentValue, this._minDb);
            this._decayData[i].value = currentValue;  // Update value for next frame
            
            ctx.lineTo(this._freqToX(freq), this._dbToY(currentValue));
        }
        
        // Complete the path
        ctx.lineTo(this._freqToX(this._maxFreq), bottomY);
        ctx.fill();
        ctx.stroke();

        // Draw peak hold
        if (this._isPeakHoldEnabled) {
            ctx.beginPath();
            ctx.strokeStyle = this._preferences.spectrum.peakColor;
            ctx.lineWidth = 2;
            
            for (let i = 0; i < this._peakHoldData.length; i++) {
                const freq = this._minFreq * Math.pow(this._maxFreq / this._minFreq, i / (this._peakHoldData.length - 1));
                const x = this._freqToX(freq);
                const y = this._dbToY(this._peakHoldData[i]);
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
        
        // Draw FPS counter
        ctx.font = `${this._preferences.text.normal.weight} ${this._preferences.text.normal.size}px ${this._preferences.text.normal.font}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = this._preferences.text.color;
        ctx.fillText(`${currentFPS} FPS`, this._canvas.width - 10, 15);
    }
    
    _drawInitialSpectrum() {
        const ctx = this._ctx;
        
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
        this._drawGrid();
    }
}




