// parameters handling
var parameters = [];

// controls storage
var controls = [];

// param values
var paramValues = [];

// event queue
var eventQueue = [];

var setupReady = false;

// FROM DELEGATE
function SPVFD(paramIdx, val) {
  console.log("paramIdx: " + paramIdx + " value:" + val);
  OnParamChange(paramIdx, val);
}

function SCVFD(ctrlTag, val) {
  if(setupReady) {
    const event = new CustomEvent("ControlChange", {detail:{tag: ctrlTag, value: val}});
    dispatchEvent(event);
  }
}

function SCMFD(ctrlTag, msgTag, msgSize, msg) {
  console.log("SCMFD ctrlTag: " + ctrlTag + " msgTag:" + msgTag + "msg:" + msg);
  
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
  let data = JSON.parse(window.atob(msg));
  console.log(data);
  if (data["id"] == "params") {
    SetupControls();
    console.log(data["params"]);
    for( var i = 0; i < data["params"].length; i++) {
      parameters.push(data["params"][i]);
      var controls = GetControlByParamId(data["params"][i].id);
      for (var c = 0; c < controls.length; c++) {
          controls[c].setParamData(data["params"][i]);
      }
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
  console.log("Got MIDI Message" + status + ":" + dataByte1 + ":" + dataByte2);
}

function SSMFD(offset, size, msg) {
  console.log("Got Sysex Message");
}

// FROM UI
// data should be a base64 encoded string
function SAMFUI(msgTag, ctrlTag = -1, data = 0) {
  console.log(data);
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
    for(var i =0; i < controls.length; i++) {
        if(controls[i].getDomElement().id == id) {
            return controls[i];
        }
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
                    "messageId":control.getAttribute("data-messageid")
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
                console.log(controlname);
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
                console.log(controlname);
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
      
      eventQueue = [];
      
      addEventListener('ControlChange', (event)=> {
        GetControlByMessageId(event.detail.tag).forEach(function(elem){
          elem.setValue(event.detail.value);
        });
      });
      
    },0);
  });
  
  dispatchEvent(event);
  
}

// attach all the controls, both those with a parameter id and those
// with a message id (not linked to a parameter)
addEventListener('DOMContentLoaded', (event) => {
  SetupControls();
});
