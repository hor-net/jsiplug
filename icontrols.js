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
    
    this._domElement.addEventListener("dblclick", event => {
      let value = this.toNormalized(this._defaultVal);
      this.setValue(value);
    });
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
      SPVFUI(this._paramIdx, this._value);
      this._changeCallback(this.fromNormalized(this._value));
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
   
  isCaptured() {
    return this._captured;
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
    
    this._domElement.addEventListener("mouseover", event => {
      if(!this._captured)
        this._domElement.style.cursor = "ns-resize";
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
      this._domElement.classList.add('captured-control');
    }
    
    this._domElement.addEventListener("mousedown", this.touchMouseStart);
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
      
        if(clientX >= 0 && clientY >= 0) {
          this._endX = clientX;
          this._endY = clientY;
          var delta = ((this._startY - this._endY) / this._height) * 0.5 / this._gearing;
          this.setValue(this._value + delta);
          this._startX = clientX;
          this._startY = clientY;
        }
      }
    };
                     
    document.addEventListener("mousemove", this.touchMouseMove);
    document.addEventListener("touchmove", this.touchMouseMove);
    
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
    };
    document.addEventListener("mouseup", this.touchMouseUp);
    this._domElement.addEventListener("touchend", this.touchMouseUp);
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
      this.setValue(this.toNormalized(this._domElement.value));
    });
    
    this._domElement.addEventListener("keypress", event => {
        if (event.which === 13) {
          this.setValue(this.toNormalized(this._domElement.value));
          document.activeElement.blur();
        }
    });
    
    this.setValue(this._value);
  }
  
  setValue(value) {
    super.setValue(value);
    this._domElement.value = this.fromNormalized(this._value);
    this._domElement.value = Math.round(this._domElement.value*this._step)/this._step;
  }
}
