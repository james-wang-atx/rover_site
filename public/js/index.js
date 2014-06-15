// Note this code runs in client browser context

var images = [];
//var pong = 0;
var counter=1;

//images[0] = "/images/outputHD_0.jpg";
//images[1] = "/images/outputHD_1.jpg";

function displayImage() {
  //document.getElementById("camimg").src = images[pong];
  //pong ^= 1;
  //document.getElementById("camimg").src = "images/last_outputHD.jpg?x=" + counter;
  document.getElementById("camimg").src = "/snapshot?x=" + counter;
  //document.getElementById("UltrasonicFront").src = "/uss/front?x=" + counter;
  //document.getElementById("UltrasonicRear").src = "/uss/rear?x=" + counter;
  counter += 1;

  download_to_textbox("/uss/front", document.getElementById("UltrasonicFront"));
  download_to_textbox("/uss/rear", document.getElementById("UltrasonicRear"));

//  download_to_textbox("/uss/front", document.getElementById("UltrasonicFront"));
//  download_to_textbox("/uss/rear", document.getElementById("UltrasonicFront"));
//  download_to_textbox(url, $("textarea[name='text']"));
}

function startTimer() {
  setInterval(displayImage, 1000);
}

function OnCamImgClick(imgobj) {
}

startTimer();


function download_to_textbox(url, el) {
    $.get(url, null, function (data) {
        //        el.val(data);
        el.value = data;
    }, "text");
}