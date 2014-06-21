var bone = require('bonescript');

//////////////////////////////////////////////////////////////////

var pendingUSSFront_callbacks = [];

function ussFrontConvertToInches(x) {
    var distanceInches;
    analogVoltage = x.value * 1.8; // ADC Value converted to voltage

    //1.8v/512 = 0.003515625
    distanceInches = analogVoltage / 0.003515625;

    //LastFrontUSSReading = '' + parseFloat(distanceInches).toFixed(3);
    while (pendingUSSFront_callbacks.length > 0) {
        usercb = pendingUSSFront_callbacks.pop();
        usercb(distanceInches);
    }
}

var frontInches = function (usercallback) {
    pendingUSSFront_callbacks.push(usercallback);
    if (pendingUSSFront_callbacks.length == 1) {
        bone.analogRead('P9_40', ussFrontConvertToInches);
    }
};

/////////////////////////////////////////////////////////////////

var pendingUSSRear_callbacks = [];

function ussRearConvertToInches(x) {
    var distanceInches;
    analogVoltage = x.value * 1.8; // ADC Value converted to voltage

    //1.8v/512 = 0.003515625
    distanceInches = analogVoltage / 0.003515625;

    while (pendingUSSRear_callbacks.length > 0) {
        usercb = pendingUSSRear_callbacks.pop();
        usercb(distanceInches);
    }
}

var rearInches = function (usercallback) {
    pendingUSSRear_callbacks.push(usercallback);
    if (pendingUSSRear_callbacks.length == 1) {
        bone.analogRead('P9_38', ussRearConvertToInches);
    }
};

module.exports = {
    frontInches: frontInches,
    rearInches:  rearInches
};
