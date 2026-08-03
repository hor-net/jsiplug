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
// control message queue (meter values, etc.) - they may arrive before
// SetupControls() has been called, in which case the controls do not
// exist yet. We buffer the raw [ctrlTag, msgTag, msgSize, msg] tuples
// and replay them once setupReady flips to true.
// See hor-net/HoRNetVHSMK2#97.
var scmfQueue = [];

var setupReady = false;

function GetParameterInfo(paramIdx) {
  for (var i = 0; i < parameters.length; i++) {
    if(parameters[i].id == paramIdx) {
        return parameters[i];
    }
  }
  return null;
}

function AddControl(controlObj) {
    if (!controlObj || typeof controlObj.getDomElement !== 'function') {
        return;
    }

    var domElement = controlObj.getDomElement();
    var domId = domElement ? domElement.id : null;
    var paramIdx = (typeof controlObj.getParamIdx === 'function') ? controlObj.getParamIdx() : null;
    var messageIdx = (typeof controlObj.getMessageIdx === 'function') ? controlObj.getMessageIdx() : null;
    var ctorName = (controlObj.constructor && controlObj.constructor.name) ? controlObj.constructor.name : "";

    // Keep support for composite controls that intentionally register multiple logical
    // controls on the same DOM node (for example EQ points with internal freq/gain/q/onoff).
    // Only dedupe exact logical duplicates introduced by repeated SetupControls calls.
    for (var i = 0; i < controls.length; i++) {
        var existing = controls[i];
        if (existing === controlObj || typeof existing.getDomElement !== 'function') {
            if (existing === controlObj) return;
            continue;
        }

        var existingElement = existing.getDomElement();
        if (!existingElement) continue;

        var sameDomId = existingElement.id === domId;
        if (!sameDomId) continue;

        var existingParamIdx = (typeof existing.getParamIdx === 'function') ? existing.getParamIdx() : null;
        var existingMessageIdx = (typeof existing.getMessageIdx === 'function') ? existing.getMessageIdx() : null;
        var existingCtorName = (existing.constructor && existing.constructor.name) ? existing.constructor.name : "";

        if (existingParamIdx === paramIdx &&
            existingMessageIdx === messageIdx &&
            existingCtorName === ctorName) {
            return;
        }
    }

    controls.push(controlObj);
}

function GetControlByParamId(id) {
  let retcontrols = [];
  for(var i =0; i < controls.length; i++) {
    if(controls[i].getParamIdx() == id) {
      retcontrols.push(controls[i]);;
    }
  }
  return retcontrols;
}

function GetControlById(id) {
    var retcontrols = [];
    for (var i = 0; i < controls.length; i++) {
        if (controls[i].getDomElement().id == id) {
            retcontrols.push(controls[i]);
        }
    }

    if (retcontrols.length == 1) {
        return retcontrols[0];
    } else if (retcontrols.length > 1) {
        return retcontrols;
    }

    return null;
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

function OnParamChange(paramIdx, val) {
  for (var i = 0; i < controls.length; i++ ) {
    if(controls[i] == -1) continue;
    if(paramIdx == controls[i].getParamIdx()) {
      if(controls[i].isCaptured() == false) {
        controls[i].setInformHostOfParamChange(false);
        controls[i].setValue(val, false);
        controls[i].getDomElement().dispatchEvent(new Event("change"));
        controls[i].setInformHostOfParamChange(true);
      }
    }
  }
}

function SetupControls() {

    if(controls.length > 0) return;
    
    // all the controls that should receive a message from the delegate
    var domControls = document.querySelectorAll('[data-messageid]');
    domControls.forEach(function(control){
        switch(control.getAttribute('data-controltype')){
            case 'segment-meter':
                AddControl(new iSegmentMeter({
                    "id":control.id,
                    "minVal":control.getAttribute('data-minval'),
                    "maxVal":control.getAttribute('data-maxval'),
                    "zeroVal":control.getAttribute('data-zeroval'),
                    "decayTime":control.getAttribute('data-decaytime'),
                    "peakHold":control.getAttribute('data-peakhold'),
                    "nrSegments":control.getAttribute('data-nrsegments'),
                    "messageId":control.getAttribute("data-messageid")
                }));
                break;
            
            case 'vumeter':
                AddControl(new iNeedleVUMeter({
                    "id": control.id,
                    "ticks": control.getAttribute('data-ticks'),
                    "shape": control.getAttribute('data-shape'),
                    "redifabove": control.getAttribute('data-redifabove'),
                    "messageId": control.getAttribute("data-messageid")
                }));
                break;
            case 'spectrum-chart':
                // Keep the chart optional so a WebGL/WebView failure does not
                // prevent the rest of the UI controls from initializing.
                try {
                    document.chart = new iSpectrumChart({
                      "id":control.id,
                      "minDb":control.getAttribute('data-mindb'),
                      "maxDb":control.getAttribute('data-maxdb'),
                      "decayTime":control.getAttribute('data-decaytime'),
                      "messageId":control.getAttribute("data-messageid")
                    });
                    AddControl(document.chart);
                } catch (error) {
                    console.error('Failed to initialize spectrum chart', error);
                    document.chart = null;
                }
                break;
        }
    });
    // now attach all the controls linked to a parameter id
    var domControls2 = document.querySelectorAll('[data-paramid]');
    domControls2.forEach(function(control){
  
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
            case "eqcontrol":
                AddControl(new ieqcontrol({"id": control.id, "paramData": paramData}));
                break;
            case "switch":
                AddControl( new iSwitch({"id": control.id, "paramData":paramData}));
                break;
            case "radio":
                AddControl( new iRadio({"id": control.id, "paramData":paramData}));
                break;   
            case "draggable-input":
                AddControl( new iDraggableInput({"id": control.id, "paramData":paramData}, paramData.id));
                break;
            case "select":
                AddControl( new iSelect({"id": control.id, "paramData":paramData}, paramData.id));
                break;
        }
    });
 
  const event = new CustomEvent("ControlSetup", {});
  dispatchEvent(event);
}

// Debug: sopprime i log in produzione
const DEBUG = false;
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

  // The C++ delegate can send control messages (including meter values
  // and other "live" data) before the parameter configuration message
  // (msgTag == -1) that triggers SetupControls(). In that case the
  // matching control objects do not exist yet and the message would
  // be silently dropped. Buffer every SCMFD call until setupReady
  // is true, then replay them in order. The param config message
  // (msgTag == -1) is safe to apply immediately because it is the
  // one that flips setupReady.
  // See hor-net/HoRNetVHSMK2#97.
  if (!setupReady && msgTag !== -1) {
    scmfQueue.push([ctrlTag, msgTag, msgSize, msg]);
    return;
  }

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
  let data = null;
  try {
    data = JSON.parse(window.atob(msg));
  } catch (e) {
    // Not JSON, assume binary data
  }
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
    
    setupReady = true;

    // Process queued events
    while(paramQueue.length > 0) {
      let p = paramQueue.shift();
      OnParamChange(p[0], p[1]);
    }
    while(eventQueue.length > 0) {
      dispatchEvent(eventQueue.shift());
    }
    // Replay any SCMFD (control message) calls that arrived before
    // setupReady was true - typically meter values for controls that
    // had not been created yet. See hor-net/HoRNetVHSMK2#97.
    while(scmfQueue.length > 0) {
      let c = scmfQueue.shift();
      // Drop the param config message (-1) - it has already been
      // applied during the SetupControls() call above.
      if (c[1] === -1) continue;
      SCMFD(c[0], c[1], c[2], c[3]);
    }
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
function SPVFUI(paramIdx, value) {
  var message = {
    "msg": "SPVFUI",
    "paramIdx": paramIdx,
    "value": value
  };
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

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
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

function CTXMFUI(paramIdx, x, y, dpr, ctrlTag = -1) {
  var message = {
    "msg": "CTXMFUI",
    "paramIdx": paramIdx,
    "x": x,
    "y": y,
    "dpr": dpr,
    "ctrlTag": ctrlTag
  };
  if(typeof IPlugSendMsg === 'function') {
    IPlugSendMsg(message);
  }
}

document.addEventListener('contextmenu', function(event) {
  var target = event.target;
  var paramIdx = -1;
  var current = target;
  while(current && current !== document) {
    if (current.getAttribute('data-vst3-contextmenu') === "0") return;
    if (current._iControlInstance) {
      if(typeof current._iControlInstance.getParamIdx === 'function') {
        paramIdx = current._iControlInstance.getParamIdx();
      }
      break;
    }
    if (current.hasAttribute('data-paramid')) {
      paramIdx = parseInt(current.getAttribute('data-paramid'));
      break;
    }
    current = current.parentNode;
  }
  
  if (paramIdx >= 0) {
            event.preventDefault();
            var rect = document.documentElement.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            var x = (event.clientX - rect.left);
            var y = (event.clientY - rect.top);
            // console.log("Right click on param " + paramIdx + " at " + x + "," + y);
            CTXMFUI(paramIdx, x, y, dpr);
          }
});

// Send JSREADY message when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    var message = { "msg": "JSREADY" };
    if(typeof IPlugSendMsg === 'function') IPlugSendMsg(message);
  });
} else {
  var message = { "msg": "JSREADY" };
  if(typeof IPlugSendMsg === 'function') IPlugSendMsg(message);
}
