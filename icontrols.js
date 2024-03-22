/**
 * icontrols - javacript classes to handle html elements
 * as controls for IPlugWebView
 *
 * @copyright (C)2023 HoRNet SRL
 * @author    Saverio Vigni <saverio.vigni@hornetplugins.com>
 */


/**
 * Base icontrol class that must be extended by single widgets
 */
class iControl {

  constructor(options) {
    this._domElement = document.getElementById(options.id);
    this._width = 0;
    this._height = 0;
    this._captured = false;
    this._informHostOfParamChange = true;
    this._paramIdx = -1;
    this._minVal = 0;
    this._maxVal = 1;
    this._defaultVal = 0;
    this._value = 0;
    this._step = 10;
    this._displayType = 0;
    this._label = "";
    this._changeCallback = function() { return; }
    if(options.paramData) {
      this._paramData = options.paramData;
      this._paramIdx = Number(options.paramData.id);
      this._minVal = Number(options.paramData.min);
      this._maxVal = Number(options.paramData.max);
      this._defaultVal = Number(options.paramData.default);
      this._value = this._defaultVal;
      this._step = 1/Number(options.paramData.step);
      this._displayType = Number(options.paramData.displayType);
      this._label = options.paramData.label;
    }
    if(options.value)
        this._value = options.value;
     
    this._receiveMessage = -1;
    if (options.messageId) {
      this._receiveMessage = options.messageId;
    }
    
    this.dblClickHandler = event => {
      let value = this.toNormalized(this._defaultVal);
      this.setValue(value);
    }
    
    this._domElement.addEventListener("dblclick", this.dblClickHandler);
  }
  
  fromNormalized(value) {
    
    let nonNormValue;
    if(this._displayType == 0) { // kDisplayLinear
      nonNormValue = this._minVal + (this._maxVal - this._minVal) * value;
    } else if(this._displayType == 1) { // kDisplayLog
      var add = Math.log(Math.max(this._minVal, 0.000001));
      var mul = Math.log(this._maxVal / Math.max(this._minVal, 0.000001));
      nonNormValue = Math.exp(add + value * mul);
    } else if(this._displayType == 2) { // kDisplayExp
      // todo
    } else if(this._displayType == 3) { // kDisplaySquared
      nonNormValue = this._minVal + Math.pow(value, 0.5) * (this._maxVal - this._minVal);
    } else if(this._displayType == 4) { // kDisplaySquareRoot
      nonNormValue = this._minVal + Math.pow(value, 2) * (this._maxVal - this._minVal);
    } else if(this._displayType == 5) { // kDisplayCubed
      nonNormValue = this._minVal + Math.pow(value, 0.3) * (this._maxVal - this._minVal);
    } else if(this._displayType == 6) { // kDisplayCubeRoot
      nonNormValue = this._minVal + Math.pow(value, 3) * (this._maxVal - this._minVal);
    }
    return nonNormValue;
  }
  
  toNormalized(value) {
    
    var normValue;
    if(this._displayType == 0) { // kDisplayLinear
      normValue = ((value - this._minVal)/(this._maxVal - this._minVal));
    } else if(this._displayType == 1) { // kDisplayLog
      var add = Math.log(Math.max(this._minVal, 0.000001));
      var mul = Math.log(this._maxVal / Math.max(this._minVal, 0.000001));
      normValue = (Math.log(value) - add) / mul;
    } else if(this._displayType == 2) { // kDisplayExp
      // todo
    } else if(this._displayType == 3) { // kDisplaySquared
      normValue = Math.pow((value - this._minVal) / (this._maxVal - this._minVal), 1.0 / 0.5);
    } else if(this._displayType == 4) { // kDisplaySquareRoot
      normValue = Math.pow((value - this._minVal) / (this._maxVal - this._minVal), 1.0 / 2);
    } else if(this._displayType == 5) { // kDisplayCubed
      normValue = Math.pow((value - this._minVal) / (this._maxVal - this._minVal), 1.0 / 0.3);
    } else if(this._displayType == 6) { // kDisplayCubeRoot
      normValue = Math.pow((value - this._minVal) / (this._maxVal - this._minVal), 1.0 / 3);
    }
    return normValue;
  }
  
  setValue(value) {
    if(value > 1) value = 1;
    if(value < 0) value = 0;
    if(this._value != value) {
      this._value = value;
      if(this._informHostOfParamChange)
        SPVFUI(this._paramIdx, this._value);
      this._changeCallback(this.fromNormalized(this._value));
      this._domElement.dispatchEvent(new Event("change"));
      // also update all the other controls with the same param idx
      var controls = GetControlByParamId(this._paramIdx);
      for (var i = 0; i < controls.length; i++) {
        if (controls[i] != this) {
            controls[i].setValue(value);
        }
      }
    }
  }
  
  getValue() {
    return this._value;
  }
  
  getParamIdx() {
    return this._paramIdx;
  }
  
  getMessageIdx() {
    return this._receiveMessage;
  }
  
  getDomElement() {
    return this._domElement;
  }
   
  setCaptured(toggle) {
      this._captured = toggle;
  }
  
  isCaptured() {
    return this._captured;
  }
  
  setInformHostOfParamChange(toggle) {
    this._informHostOfParamChange = toggle;
  }

  setChangeCallback(func) {
    this._changeCallback = func;
  }
  
  setParamData(paramData) {
    this._paramData = paramData;
    this._minVal = paramData.min;
    this._maxVal = paramData.max;
    this._defaultVal = paramData.default;
    this._step = 1/paramData.step;
    this._displayType = paramData.displayType;
    this._label = paramData.label;
  }
}

/**
 * Implements a draggable control
 */
class iDraggable extends iControl {
  
  constructor(options) {
    super(options);
    
    this._startX = 0;
    this._startY = 0;
    this._endX = 0;
    this._endY = 0;
    this._height = window.getComputedStyle(document.getElementById(options.id)).getPropertyValue("height");
    this._height = this._height.substring(0, this._height.length-2);
    this._gearing = 4;
    this._horizontal = options.horizontal;
    if(this._horizontal) this._gearing = 2;

    // Options for the observer (which mutations to observe)
    const observerconfig = { attributes: true, childList: true, subtree: true };
    
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(
        (mutationList, observer) => {
          this._height = window.getComputedStyle(this._domElement).getPropertyValue("height");
          this._height = this._height.substring(0, this._height.length-2);
          this._width = window.getComputedStyle(this._domElement).getPropertyValue("width");
          this._width = this._width.substring(0, this._width.length-2);
        });
    
    // Start observing the target node for configured mutations
    observer.observe(this._domElement, { attributes: true, childList: true, subtree: true });
    
    // increase precision doubling the gearing while shift key is pressed
    document.addEventListener("keydown", event => {
        if (event.key =="Shift") {
            this._gearing *= 4;
        }
    });
    document.addEventListener("keyup", event => {
        if (event.key =="Shift") {
            this._gearing *= 0.25;
        }
    });
    
    this._domElement.addEventListener("mouseover", event => {
      if(!this._captured) {
        if(this._horizontal == true) {
            this._domElement.style.cursor = "ew-resize";
        } else {
            this._domElement.style.cursor = "ns-resize";
        }
      }  
    });
    
    this._domElement.addEventListener("mouseout", event => {
      if(!this._captured)
        this._domElement.style.cursor = "initial";
    });
    
    this.touchMouseStart = (event) => {
      var clientX = -1;
      var clientY = -1;
      if(event.type == "touchstart") {
        var touch = event.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else if (event.buttons == 1) {
        clientX = event.clientX;
        clientY = event.clientY;
      }
      this._startX = clientX;
      this._startY = clientY;
      this._captured = true;
      this._domElement.setPointerCapture(event.pointerId);
      this._domElement.classList.add('captured-control');
    }
    
    this._domElement.addEventListener("pointerdown", this.touchMouseStart);
    this._domElement.addEventListener("touchstart", this.touchMouseStart);
    
    this.touchMouseMove = (event) => {
      
      var clientX = -1;
      var clientY = -1;
      
      if(this._captured == true) {
        if(event.type == "touchmove") {
          var touch = event.changedTouches[0];
          clientX = touch.clientX;
          clientY = touch.clientY;
        } else if (event.buttons == 1) {
          if(this._captured == true) {
            event.preventDefault();
          }
          clientX = event.clientX;
          clientY = event.clientY;
        }
      
        this._endX = clientX;
        this._endY = clientY;
        
        var delta;
        if(this._horizontal == true) {
            delta = ((this._startX - this._endX) / this._width) * 0.5 / this._gearing;
        } else {
            delta = ((this._startY - this._endY) / this._height) * 0.5 / this._gearing;
        }
        this.setValue(this._value + delta);
        this._startX = clientX;
        this._startY = clientY;
      }
    };
                     
    document.addEventListener("touchmove", this.touchMouseMove);
    this._domElement.addEventListener("pointermove", this.touchMouseMove);
    
    this.touchMouseUp = (event) => {
      if(this._captured == true) {
        this._captured = false;
        this._domElement.classList.remove('captured-control');
        
        var clientX = -1;
        var clientY = -1;
        
        if(event.type == "touchend") {
          var touch = event.changedTouches[0];
          clientX = touch.clientX;
          clientY = touch.clientY;
        } else if (event.buttons == 1) {
          if(this._captured == true) {
            event.preventDefault();
          }
          clientX = event.clientX;
          clientY = event.clientY;
        }
        document.activeElement.blur();
        this._endX = clientX;
        this._endY = clientY;
      }
      this._domElement.releasePointerCapture(event.pointerId);
    };
    this._domElement.addEventListener("touchend", this.touchMouseUp);
    this._domElement.addEventListener("pointerup", this.touchMouseUp);
  }
  
}
                       
/**
 * Implements a vertical fader, the cursor must have the .cursor class
 */
class iVerticalFader extends iDraggable {

    constructor(options) {
    
    super(options);
    
    // when SVG is embedde using the "object" tag
    this._fader = document.getElementById(options.id).contentDocument;
    if(this._fader) {
      this._cursor = document.getElementById(options.id).contentDocument.querySelector('.cursor');
    }
    // when svg is inlined ord html elements
    if(!this._fader) {
      this._fader = document.getElementById(options.id);
      this._cursor = document.getElementById(options.id).querySelector('.cursor');
    }
    
    this._sendingMsgToPlug = false;
    
    this._inputValue = document.getElementById(options.inputValueId);
    if (this._inputValue) {
        this._inputValue.addEventListener("click", event =>{
            this._inputValue.select();
        });
    
        this._inputValue.addEventListener("blur", event => {
            this.setValue(this.toNormalized(this._inputValue.value));
        });

        this._inputValue.addEventListener("keypress", event => {
            if (event.which === 13) {
                this.setValue(this.toNormalized(this._inputValue.value));
                document.activeElement.blur();
            }
        });
    }
    
    this.setValue(this._value);
    
    this._gearing = 0.5;
  }
  
  updateFader() {
    this._cursor.style.transform = "translate(0px, -" + (this._value * (this._fader.offsetHeight - this._cursor.offsetHeight)) + "px)";
  }
      
  setValue(value) {
    super.setValue(value);
    this.updateFader();
    if(this._inputValue) {
        this._inputValue.value = Math.round((this.fromNormalized(this._value)*this._step))/this._step;
    }
  }
}

/**
 * Implements a rotating knob, the rotating element must have the .rotator class
 */
class iRotatingKnob extends iDraggable {

  constructor(options) {
    
    super(options);
    
    // when SVG is embedde using the "object" tag
    this._knob = document.getElementById(options.id).contentDocument;
    if(this._knob) {
      this._rotator = document.getElementById(options.id).contentDocument.querySelector('.rotator');
    }
    // when svg is inlined
    if(!this._knob) {
      this._knob = document.getElementById(options.id);
      this._rotator = document.getElementById(options.id).querySelector('.rotator');
    }
    this._rotator.style.transformOriginX = '50%';
    this._rotator.style.transformOriginY = '50%';
    
    this._minAngle = -135;
    this._maxAngle = 135;
    this._angle = 0;
    this._sendingMsgToPlug = false;
    
    //this.updateKnob();
    
    this._inputValue = document.getElementById(options.inputValueId);
    if (this._inputValue) {
        this._inputValue.addEventListener("click", event =>{
            this._inputValue.select();
        });
    
        this._inputValue.addEventListener("blur", event => {
            this.setValue(this.toNormalized(this._inputValue.value));
        });

        this._inputValue.addEventListener("keypress", event => {
            if (event.which === 13) {
                this.setValue(this.toNormalized(this._inputValue.value));
                document.activeElement.blur();
            }
        });
    }
    
    this.setValue(this._value);
  }
  
  updateKnob() {
    this._angle = this._minAngle + ((this._maxAngle - this._minAngle) * this._value);
    if(this._angle < this._minAngle) this._angle = this._minAngle;
    if(this._angle > this._maxAngle) this._angle = this._maxAngle;
    this._rotator.style.transform = "rotate(" + this._angle + "deg)";
  }
      
  setValue(value) {
    super.setValue(value);
    this.updateKnob();
    if(this._inputValue) {
        this._inputValue.value = Math.round((this.fromNormalized(this._value)*this._step))/this._step;
    }
  }
}

/**
 * Implements a switch
 */
class iSwitch extends iControl {
  
  constructor(options) {
    super(options);
    
    this._domElement.addEventListener('click', event => {
      if(this._value == 0) {
        this.setValue(1);
      } else {
        this.setValue(0);
      }
      this.updateSwitch();
      document.activeElement.blur();
    });
  }
  
  updateSwitch() {
    if(this._domElement.type == "checkbox") {
      if(this._value == 1) {
        this._domElement.checked = true;
      } else {
        this._domElement.checked = false;
      }
    }
  }
  
  setValue(value) {
    super.setValue(value);
    this.updateSwitch();
  }
}

/**
 * Implements a select input control
 */
class iSelect extends iControl {
  
  constructor(options) {
    super(options);
    
    this._domElement.addEventListener("change", event => {
      document.activeElement.blur();
      this.setValue(this.toNormalized(this._domElement.value));
    });
    
  }
  
  setValue(value) {
    super.setValue(value);
    let val = this.fromNormalized(value);
    this._domElement.value = Math.round(val);
  }
}

/**
 * Implements a text control
 */
class iText extends iControl {
  
  constructor(options) {
    super(options);
    
    this._domElement.addEventListener("input", event => {
      this.setValue(this.toNormalized(this._domElement.value));
    });
  }
  
  setValue(value) {
    super.setValue(value);
    this._domElement.value = this.fromNormalized(this._value);
  }
}

/**
 * Implements a segment meter
 */
class iSegmentMeter extends iControl {
  
  constructor(options) {
    super(options);
    this._value = options.minVal -1;
    this._minVal = options.minVal;
    this._maxVal = options.maxVal;
    this._peakVal = options.minVal;
    this._nrSegments = this._domElement.children.length;
    if(options.nrSegments){
      this._nrSegments = options.nrSegments;
    }
    
    setInterval(() => this.updateMeter(), 10);
    setInterval(() => this.decayValue(), 100);
    setInterval(() => this.decayPeakValue(), 1000);
  }
  
  setValue(value) {
    value = Math.floor(value);
    if(value < this._minVal) value = this._minVal;
    
    // we don't call our super here because we
    // don't want to send the parameter value to the host
    if(value > this._value) {
      this._value = value;
    }
    if(this._value > this._maxVal) {
      this._value = this._maxVal;
    }
    if(this._value > this._peakVal) {
      this._peakVal = this._value;
    }
  }
  
  updateMeter() {
    // init our segments
    for (var i = 0; i < this._nrSegments; i++) {
      this._domElement.children[i].classList.remove("meter-on");
      // add back meter-on if value is greater than current segment
      if(this._value >= this._domElement.children[i].getAttribute('data-value')) {
        this._domElement.children[i].classList.add("meter-on");
      }
    }
    
    // set the peak hold
    //if(this._peakVal > this._minVal) {
    //  this._domElement.getElementsByClassName(this._peakVal)[0].classList.add("meter-on");
    //}
  }
      
  decayValue() {
    if(this._value > this._minVal -1) {
      this._value = this._value -1;
    }
  }
  
  decayPeakValue() {
    if(this._peakVal > this._minVal -1 ) {
      this._peakVal = this._peakVal -1;
    }
  }
}

/**
 * Implements an input box whise value can be incremented or decremented
 * dragging it up and down
 */
class iDraggableInput extends iDraggable {
  
  constructor(options) {
    super(options);
    
    this._domElement.addEventListener("click", event =>{
      this._domElement.select();
    });
    
    this._domElement.addEventListener("blur", event => {
      this.setValue(this.toNormalized(Number(this._domElement.value)));
    });
    
    this._domElement.addEventListener("keypress", event => {
        if (event.which === 13) {
          this.setValue(this.toNormalized(Number(this._domElement.value)));
          document.activeElement.blur();
        }
    });
    
    this.setValue(this._value);
  }
  
  setValue(value) {
    if(this._domElement.min) {
        var normvalue = this.fromNormalized(value);
        if(normvalue < this._domElement.min) {
            value = this.toNormalized(this._domElement.min);
        }
    }
    if(this._domElement.max) {
        var normvalue = this.fromNormalized(value);
        if(normvalue > this._domElement.max) {
            value = this.toNormalized(this._domElement.max);
        }
    }
    super.setValue(value);
    this._domElement.value = this.fromNormalized(this._value);
    this._domElement.value = Math.round(this._domElement.value*this._step)/this._step;
  }
}

/**
 * Implements an analog style VU meter with SVG and javascript
 */
class iNeedleVUMeter extends iControl {
    
    constructor(options) {
      
        super(options);
        // append the basic svg
        this._domElement.innerHTML = `<svg id="${options.id}-svg" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" fill="none">
            <g class="scaleGroup" transform="translate(60, 50) scale(0.7,1)">
                <!-- Define tick lines and labels here -->
            </g>
            <g class="needleGroup" transform="translate(200, 220) scale(-1,-1)">
                <line class="needleLine" x1="0" y1="0" x2="0" y2="200" stroke="black" stroke-width="4"></line>
            </g>
            <circle cx="200" cy="220" r="30" fill="black"/>
        </svg>`;
        
        let svg = document.getElementById(options.id+"-svg");
        this._scaleGroup = svg.querySelector(".scaleGroup");
        this._needleGroup = svg.querySelector(".needleGroup");
        this._needleLine = svg.querySelector("needleLine");

        this._ticks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
        if(options.ticks)
            this._ticks = options.ticks;
            
        this._minVal = this._ticks[0];
        this._maxVal = this._ticks[this._ticks.length -1];
            
        this._width = 400; // Set a fixed width for the viewBox
        this._height = 220; // Set a fixed height for the viewBox
        this._tickLength = 10; // Length of tick lines
        this._textOffset = 30; // Offset for text labels
        
        this._center = { x: this._width / 2, y: this._height }; // Center of rotation for the needle
        this.drawScale();
        this.setValue(0);
    }
    
    drawScale() {
        this._ticks.forEach((inDb) => {
                const x = Math.exp(Math.log(1.055) * 2.1 * inDb) * this._width / 1.5;

                // Draw tick line
                const tickLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
                tickLine.setAttribute("x1", x);
                tickLine.setAttribute("y1", 10);
                tickLine.setAttribute("x2", x);
                tickLine.setAttribute("y2", 10 + this._tickLength);
                tickLine.setAttribute("stroke", "black");
                tickLine.setAttribute("stroke-width", "4");
                tickLine.setAttribute("class", "tick");
                if(inDb > 0){
                    tickLine.setAttribute("stroke", "red");
                    tickLine.setAttribute("class", "tick-alert");
                }
                
                this._scaleGroup.appendChild(tickLine);

                // Draw label below the tick
                const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
                textLabel.setAttribute("x", x);
                textLabel.setAttribute("y", 10 + this._tickLength + this._textOffset);
                textLabel.setAttribute("font-family", "Arial");
                textLabel.setAttribute("font-size", "22");
                textLabel.setAttribute("text-anchor", "middle");
                textLabel.setAttribute("fill", "black");
                textLabel.setAttribute("class", "label")
                if(inDb > 0) {
                    textLabel.setAttribute("fill", "red");
                    textLabel.setAttribute("class","label-alert");
                }
                
                textLabel.textContent = `${inDb}`;
                this._scaleGroup.appendChild(textLabel);
            });
    }
    
    setValue(value) {
        this._value = this.toNormalized(value);
        // we don't call our super here because we
        // don't want to send the parameter value to the host
        if(this._value > this._maxVal) {
            this._value = this._maxVal;
        }
        if(this._value < this._minVal) {
            this._value = this._minVal;
        }
        this.setNeedle(value);
    }
    
    // Function to set the needle angle based on the level
    setNeedle(level) {
        
        // Ensure the level is within the valid range
        level = Math.max(this._minVal, Math.min(this._maxVal, level));

        let x = Math.exp(Math.log(1.055) * 2.1 * level) * this._width / 1.5;
        x = x - this._center.x;
        let angle = Math.atan(x / this._height);

        // Update the needle's rotation
        this._needleGroup.setAttribute("transform", `translate(${this._center.x}, ${this._center.y}) scale(-1,-1) rotate(${angle * (180 / Math.PI)})`);
    }

}
