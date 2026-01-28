let noiseShader;
let cam;

let flowTime = 0;

// 互動強度（累積參數）
let interactionLevel = 0;
let targetLevel = 0;

let uiLayer;
let startBtn;
let infoText;

let uiVisible = true;
let cameraStarted = false;


// ─── Vertex Shader ───────────────────────────────────────
const vert = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 1.0);
}
`;


// ─── Fragment Shader ─────────────────────────────────────
const frag = `
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float u_time;
uniform float u_power;   // ← 互動強度

varying vec2 vTexCoord;


float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898,78.233))) * 43758.5453);
}


float noise(vec2 st) {

  vec2 i = floor(st);
  vec2 f = fract(st);

  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(a, b, u.x) +
         (c - a) * u.y * (1.0 - u.x) +
         (d - b) * u.x * u.y;
}


void main() {

  vec2 uv = vTexCoord;

  float scale = mix(3.0, 8.0, u_power);

  float amp   = mix(0.1, 1.2, u_power);
  float speed = mix(0.2, 2.0, u_power);


  float n1 = noise(uv * scale + vec2(u_time * speed, 0.0));
  float n2 = noise(uv * scale + vec2(0.0, u_time * speed));

  vec2 uv2 = uv + vec2(n1 - 0.5, n2 - 0.5) * amp;

  gl_FragColor = texture2D(u_texture, uv2);
}
`;


function preload() {
  noiseShader = createShader(vert, frag);
}


function setup() {

  pixelDensity(1);

  createCanvas(windowWidth, windowHeight, WEBGL);

  noStroke();

  ortho(
    -width/2, width/2,
     height/2, -height/2,
     0, 1000
  );

  createUI();
}


// ─── UI ─────────────────────────────────────

function createUI() {

  uiLayer = createDiv('');

  uiLayer.position(0, 0);
  uiLayer.size(windowWidth, windowHeight);

  uiLayer.style('background', 'rgba(0,0,0,0.3)');
  uiLayer.style('display', 'flex');
  uiLayer.style('flex-direction', 'column');
  uiLayer.style('justify-content', 'center');
  uiLayer.style('align-items', 'center');
  uiLayer.style('z-index', '10');


  startBtn = createButton('Enter');

  startBtn.style('font-size', '18px');
  startBtn.style('padding', '12px 28px');
  startBtn.style('background', 'transparent');
  startBtn.style('color', '#fff');
  startBtn.style('border', '1px solid #fff');
  startBtn.style('cursor', 'pointer');
  startBtn.style('letter-spacing', '2px');

  startBtn.mousePressed(startExperience);


  infoText = createP('Camera access is required. No data will be stored. Swipe finger to stir the flood.');

  infoText.style('color', '#fff');
  infoText.style('font-size', '13px');
  infoText.style('letter-spacing', '1px');
  infoText.style('opacity', '0.8');
  infoText.style('margin-top', '20px');
  infoText.style('text-align', 'center');
  infoText.style('max-width', '260px');


  uiLayer.child(startBtn);
  uiLayer.child(infoText);
}


// ─── Camera ──────────────────────────────────

function startExperience() {

  if (cameraStarted) return;

  cameraStarted = true;


  cam = createCapture(
    {
      video: {
        facingMode: { exact: "environment" } // ← 後鏡頭
      },
      audio: false
    },
    () => {

      cam.hide();
      hideUI();

    }
  );

}


// ─── UI Control ─────────────────────────────

function hideUI() {
  uiVisible = false;
  uiLayer.style('display', 'none');
}

function showUI() {
  uiVisible = true;
  uiLayer.style('display', 'flex');
}


// ─── Interaction ─────────────────────────────

// 手指滑動累積能量
function touchMoved() {

  targetLevel += 0.015;

  targetLevel = constrain(targetLevel, 0, 1);

  return false;
}


// 滑鼠也支援（桌機）
function mouseDragged() {

  targetLevel += 0.01;

  targetLevel = constrain(targetLevel, 0, 1);

  return false;
}


// ─── Draw ───────────────────────────────────

function draw() {

  background(0);

  if (!cameraStarted || !cam) return;


  flowTime += deltaTime * 0.001;


  // 平滑過渡（避免暴衝）
  interactionLevel = lerp(interactionLevel, targetLevel, 0.05);


  shader(noiseShader);

  noiseShader.setUniform('u_texture', cam);
  noiseShader.setUniform('u_time', flowTime);
  noiseShader.setUniform('u_power', interactionLevel);


  beginShape(TRIANGLE_FAN);

    vertex(-1, -1, 0,  0, 1);
    vertex( 1, -1, 0,  1, 1);
    vertex( 1,  1, 0,  1, 0);
    vertex(-1,  1, 0,  0, 0);

  endShape();
}


// ─── Resize ────────────────────────────────

function windowResized() {

  resizeCanvas(windowWidth, windowHeight);

  ortho(
    -width/2, width/2,
     height/2, -height/2,
     0, 1000
  );

  if (uiLayer) {
    uiLayer.size(windowWidth, windowHeight);
  }
}