// parameters handling
var parameters = [];

// controls storage
var controls = [];

// param values
var paramValues = [];

// FROM DELEGATE
function SPVFD(paramIdx, val) {
  console.log("paramIdx: " + paramIdx + " value:" + val);
  OnParamChange(paramIdx, val);
}

function SCVFD(ctrlTag, val) {
  OnControlChange(ctrlTag, val);
}

function SCMFD(ctrlTag, msgTag, msgSize, msg) {
  console.log("SCMFD ctrlTag: " + ctrlTag + " msgTag:" + msgTag + "msg:" + msg);
  
  // if we are receving the parameter configuration message configure the controls
  if(msgTag == -1) {
    let paramData = JSON.parse(window.atob(msg));
    parameters.push(paramData);
    // trigger the setup of controls so they can be added or updated with parameter info
    SetupControls(); 
  }
}

function SAMFD(msgTag, dataSize, msg) {
  OnArbitraryMessage(msgTag, msg);
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
    // add control to controls array or update it if already present
    for (var i = 0; i  < controls.length; i++) {
        
        if( controls[i].getParamIdx() == controlObj.getParamIdx() 
            && controls[i].getDomElement().id == controlObj.getDomElement().id && controlObj.getParamIdx() >= 0) {
            
            controls[i].setParamData(GetParameterInfo(controls[i].getParamIdx()));
            return controls[i];
        }
    }
    controls.push(controlObj);
    return controlObj;
}

function GetControlByParamId(id) {
  for(var i =0; i < controls.length; i++) {
    if(controls[i].getParamIdx() == id) {
      return controls[i];
    }
  }
  return null;
}

function GetControlByMessageId(id) {
  for(var i =0; i < controls.length; i++) {
    if(controls[i].getMessageIdx() == id) {
      return controls[i];
    }
  }
  return null;
}

function OnParamChange(paramIdx, val) {
  for (var i = 0; i < controls.length; i++ ) {
    if(controls[i] == -1) continue;
    if(paramIdx == controls[i].getParamIdx()) {
      if(controls[i].isCaptured() == false)
        controls[i].setValue(val);
    }
  }
}

function SetupControls() {
    // all the controls that should receive a message from the delegate
    var controls = document.querySelectorAll('[data-messageid]');
    controls.forEach(function(control){
        switch(control.getAttribute('data-controltype')){
            case 'segment-meter':
                AddControl(new iSegmentMeter({
                    "id":control.id,
                    "minVal":control.getAttribute('data-minval'),
                    "maxVal":control.getAttribute('data-maxval'),
                    "messageId":control.getAttribute("data-messageid")
                }));
            break;
        }
    });
    // now attach all the controls linked to a parameter id
    var controls = document.querySelectorAll('[data-paramid]');
    controls.forEach(function(control){
  
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
            case "switch":
                AddControl( new iSwitch({"id": control.id, "paramData":paramData}));
                break;
            case "draggable-input":
                AddControl( new iDraggableInput({"id": control.id, "paramData":paramData}, paramData.id));
                break;
            case "select":
                AddControl( new iSelect({"id": control.id, "paramData":paramData}, paramData.id));
                break;
        }
    });
}

// attach all the controls, both those with a parameter id and those
// with a message id (not linked to a parameter)
addEventListener('DOMContentLoaded', (event) => {
  SetupControls();
});
