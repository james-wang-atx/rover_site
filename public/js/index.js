// Note this code runs in client browser context

var images = [];
//var pong = 0;
var counter=0;

//images[0] = "/images/outputHD_0.jpg";
//images[1] = "/images/outputHD_1.jpg";

function displayImage() {
  //document.getElementById("camimg").src = images[pong];
  //pong ^= 1;
  //document.getElementById("camimg").src = "images/last_outputHD.jpg?x=" + counter;
  document.getElementById("camimg").src = "/snapshot?x=" + counter;
  document.getElementById("edges").src = "/edges?x=" + counter;

  LoadTextAreaFromUrl("/uss/front", document.getElementById("UltrasonicFront"));
  LoadTextAreaFromUrl("/uss/rear", document.getElementById("UltrasonicRear"));
  LoadTextAreaFromUrl("/bt/rssi", document.getElementById("RSSI"));

  // every 3rd time (3 seconds), do the barcode check
  if ((counter & 3) == 0) {
      LoadTextAreaFromUrl("/barcode", document.getElementById("barcode"));
  }

  counter += 1;
}

function startTimer() {
  setInterval(displayImage, 1000);
}

function OnCamImgClick(imgobj) {
}

startTimer();

function LoadTextAreaFromUrl(url, el) {
    $.get(url, null, function (data) {
        el.value = data;
    }, "text");
}
