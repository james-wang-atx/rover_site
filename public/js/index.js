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
  counter += 1;
}

function startTimer() {
  setInterval(displayImage, 1000);
}

function OnCamImgClick(imgobj) {
}

startTimer();