if (typeof ResizeObserver === 'undefined') {
  window.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observedElements = [];
      this.checkInterval = null;
    }
    observe(element) {
      if (!element) return;
      if (this.observedElements.some(item => item.element === element)) return;
      this.observedElements.push({
        element: element,
        width: element.offsetWidth,
        height: element.offsetHeight
      });
      if (!this.checkInterval) {
        this.checkInterval = setInterval(() => this.checkForChanges(), 200);
      }
      this.checkForChanges(true);
    }
    unobserve(element) {
      this.observedElements = this.observedElements.filter(item => item.element !== element);
      if (this.observedElements.length === 0 && this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    }
    disconnect() {
      this.observedElements = [];
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    }
    checkForChanges(force = false) {
      const entries = [];
      this.observedElements.forEach(item => {
        const newWidth = item.element.offsetWidth;
        const newHeight = item.element.offsetHeight;
        if (force || newWidth !== item.width || newHeight !== item.height) {
          item.width = newWidth;
          item.height = newHeight;
          entries.push({
            target: item.element,
            contentRect: {
              width: newWidth,
              height: newHeight,
              top: 0,
              left: 0,
              bottom: newHeight,
              right: newWidth,
              x: 0,
              y: 0
            }
          });
        }
      });
      if (entries.length > 0) {
        this.callback(entries);
      }
    }
  };
}

// parameters handling
var parameters = [];

// controls storage
var controls = [];

// param values
var paramValues = [];

// event queue
var eventQueue = [];
// param change queue
var paramQueue = [];

var setupReady = false;

// Debug: sopprime i log in produzione
const DEBUG = true;
function debugLog() {
  try {
    if ((typeof window !== 'undefined' && window.__DEBUG) || DEBUG) {
      console.log.apply(console, arguments);
    }
  } catch (_) {}
}

// FROM DELEGATE
function SPVFD(paramIdx, val) {
  debugLog("paramIdx:", paramIdx, "value:", val);
  if(setupReady) {
    OnParamChange(paramIdx, val);
  } else {
    paramQueue.push([paramIdx,val]);
  }
}

function SCVFD(ctrlTag, val) {
  const event = new CustomEvent("ControlChange", {detail:{tag: ctrlTag, value: val}});
  if(setupReady) {
    dispatchEvent(event);
  } else {
    eventQueue.push(event);
  }
}

function SCMFD(ctrlTag, msgTag, msgSize, msg) {
  debugLog("SCMFD ctrlTag:", ctrlTag, "msgTag:", msgTag, "msg:", msg);
  
  // if we are receving the parameter configuration message configure the controls
  if(msgTag == -1) {
    SetupControls();
    let paramData = JSON.parse(window.atob(msg));
    parameters.push(paramData);
    var controls = GetControlByParamId(paramData.id);
    for (var i = 0; i < controls.length; i++) {
        controls[i].setParamData(paramData);
    }
  }
}

function SAMFD(msgTag, dataSize, msg) {
  try {
    let data = JSON.parse(window.atob(msg));
    debugLog("SAMFD", data);
    if (data && data["id"] == "params") {
      SetupControls();
      debugLog("params", data["params"]);
      for( var i = 0; i < data["params"].length; i++) {
        parameters.push(data["params"][i]);
        var controls = GetControlByParamId(data["params"][i].id);
        for (var c = 0; c < controls.length; c++) {
            controls[c].setParamData(data["params"][i]);
        }
      }
    }
  } catch (e) {
    // Message is not JSON or not the params object, proceed
  }

  const event = new CustomEvent("ArbitraryMessage", {detail:{tag: msgTag, value: msg}});
  if(setupReady) {
    dispatchEvent(event);
  } else {
    eventQueue.push(event);
  }
}

function SMMFD(statusByte, dataByte1, dataByte2) {
  debugLog("Got MIDI Message", statusByte, dataByte1, dataByte2);
}

function SSMFD(offset, size, msg) {
  debugLog("Got Sysex Message");
}

// FROM UI
// data should be a base64 encoded string
function SAMFUI(msgTag, ctrlTag = -1, data = 0) {
  debugLog("SAMFUI data:", data);
  var message = {
    "msg": "SAMFUI",
    "msgTag": msgTag,
    "ctrlTag": ctrlTag,
    "data": btoa(data)
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function SMMFUI(statusByte, dataByte1, dataByte2) {
  var message = {
    "msg": "SMMFUI",
    "statusByte": statusByte,
    "dataByte1": dataByte1,
    "dataByte2": dataByte2
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

// data should be a base64 encoded string
function SSMFUI(data = 0) {
  var message = {
    "msg": "SSMFUI",
    "data": data
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function EPCFUI(paramIdx) {
  var message = {
    "msg": "EPCFUI",
    "paramIdx": paramIdx,
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function BPCFUI(paramIdx) {
  var message = {
    "msg": "BPCFUI",
    "paramIdx": paramIdx,
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function SPVFUI(paramIdx, value) {
  if (value == null) return;
  var message = {
    "msg": "SPVFUI",
    "paramIdx": paramIdx,
    "value": value
  };
  // this allow us to develop working controls even outside of the webview environment
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function GetParameterInfo(paramIdx) {
  for (var i = 0; i < parameters.length; i++) {
    if(parameters[i].id == paramIdx) {
        return parameters[i];
    }
  }
  return null;
}

function AddControl(controlObj) {
    controls.push(controlObj);
}

function GetControlByParamId(id) {
  let retcontrols = [];
  for(var i =0; i < controls.length; i++) {
    if(controls[i].getParamIdx() == id) {
      retcontrols.push(controls[i]);
    }
  }
  return retcontrols;
}

function GetControlByMessageId(id) {
    let retcontrols = [];
    for(var i =0; i < controls.length; i++) {
        if(controls[i].getMessageIdx() == id) {
            retcontrols.push(controls[i]);
        }
    }
    return retcontrols;
}

function GetControlById(id) {
    let retcontrols = [];
    for(var i =0; i < controls.length; i++) {
        if(controls[i].getDomElement().id == id) {
          retcontrols.push(controls[i]);
        }
    }
    if(retcontrols.length == 1) {
        return retcontrols[0];
    } else if(retcontrols.length > 1) {
        return retcontrols;
    }
}

function OnParamChange(paramIdx, val) {
  for (var i = 0; i < controls.length; i++ ) {
    if(controls[i] == -1) continue;
    if(paramIdx == controls[i].getParamIdx()) {
      if(controls[i].isCaptured() == false) {
        controls[i].setInformHostOfParamChange(false);
        controls[i].setValue(val, false);
        controls[i].setInformHostOfParamChange(true);
      }
    }
  }
}

function SetupControls() {
    if(controls.length > 0) return;
    
    // all the controls that should receive a message from the delegate
    var pcontrols = document.querySelectorAll('[data-messageid]');
    pcontrols.forEach(function(control){
        
        switch(control.getAttribute('data-controltype')){
            case 'segment-meter':
                AddControl(new iSegmentMeter({
                    "id":control.id,
                    "minVal":control.getAttribute('data-minval'),
                    "maxVal":control.getAttribute('data-maxval'),
                    "zeroVal":control.getAttribute('data-zeroval'),
                    "decayTime":control.getAttribute('data-decaytime'),
                    "peakHold":control.getAttribute('data-peakhold'),
                    "messageId":control.getAttribute("data-messageid"),
                }));
                break;
            
            case 'vumeter':
                AddControl(new iNeedleVUMeter({
                    "id":control.id,
                    "ticks":control.getAttribute('data-ticks'),
                    "messageId":control.getAttribute("data-messageid"),
                    "shape": control.getAttribute('data-shape'),
                    "redifabove": control.getAttribute('data-redifabove'),
                }));
                break;
            case 'spectrum-chart':
                AddControl(new iSpectrumChart({
                    "id": control.id,
                    "minDb": control.getAttribute('data-mindb'),
                    "maxDb": control.getAttribute('data-maxdb'),
                    "messageId": control.getAttribute("data-messageid")
                }));
                break;
            
            default:
                var controlname = "new i"+control.getAttribute('data-controltype')+'({"id": control.id, "paramData":paramData}, paramData.id)';
                debugLog(controlname);
                AddControl( eval(controlname) );
                break;
        }
    });
    // now attach all the controls linked to a parameter id
    var pcontrols = document.querySelectorAll('[data-paramid]');
    pcontrols.forEach(function(control){
  
        var paramData = {
                        "id":control.getAttribute("data-paramid"),
                        "min":control.getAttribute("data-min"),
                        "max":control.getAttribute("data-max"),
                        "default":control.getAttribute("data-default"),
                        "step":control.getAttribute("data-step"),
                        "displayType":control.getAttribute("data-displaytype"),
                        "label":control.getAttribute("data-label")
                    }; 
  
        switch(control.getAttribute('data-controltype')) {
            case "knob":
                AddControl( new iRotatingKnob({"id": control.id, "inputValueId": control.id+"-val", "paramData":paramData}));
                break;
            case "vertical-fader":
                AddControl( new iVerticalFader({"id": control.id, "inputValueId": control.id+"-val", "paramData":paramData}));
                break;
            case "switch":
                AddControl( new iSwitch({"id": control.id, "paramData":paramData}));
                break;
            case "button":
                AddControl( new iButton({"id": control.id, "paramData":paramData}));
                break;
            case "draggable-input":
                AddControl( new iDraggableInput({"id": control.id, "paramData":paramData}, paramData.id));
                break;
            case "select":
                AddControl( new iSelect({"id": control.id, "paramData":paramData}, paramData.id));
                break;
            case "radio":
                AddControl( new iRadio({"id": control.id, "paramData":paramData}, paramData.id));
                break;
            default:
                var controlname = "new i"+control.getAttribute('data-controltype')+'({"id": control.id, "paramData":paramData}, paramData.id)';
                debugLog(controlname);
                AddControl( eval(controlname) );
                break;
        }
    });
 
  const event = new CustomEvent("ControlSetup", {});
  
  addEventListener("ControlSetup", (event) => {
    setTimeout(function() {
      setupReady = true;
      for (var i = 0; i < eventQueue.length; i++) {
        dispatchEvent(eventQueue[i]);
      }
      
      for (var i = 0; i < paramQueue.length; i++) {
        OnParamChange(paramQueue[i][0], paramQueue[i][1]);
      }
      
      eventQueue = [];
      paramQueue = [];
      
      
      addEventListener('ControlChange', (event)=> {
        GetControlByMessageId(event.detail.tag).forEach(function(elem){
          elem.setValue(event.detail.value);
        });
      });
      
    },0);
  });
  
  dispatchEvent(event);
  
}
