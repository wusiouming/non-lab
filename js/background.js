import p5 from 'p5';

let sketchInstance = null,
    pendingImageUrl = 'https://picsum.photos/800/600',
    updateImageFn = null;

// Vertex Shader (compact)
const vert = `attribute vec3 aPosition;attribute vec2 aTexCoord;varying vec2 vTexCoord;void main(){vTexCoord=aTexCoord;gl_Position=vec4(aPosition,1.0);}`;

// Fragment Shader: blend two textures and add a simple blur that is strongest mid-transition
const frag = `
#ifdef GL_ES
precision mediump float;
#endif
uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform float u_time;
uniform float u_mix; // 0.0 -> show tex0, 1.0 -> show tex1
varying vec2 vTexCoord;

vec4 sampleBlur(sampler2D tex, vec2 uv, float radius) {
  // simple 9-tap box blur (cheap)
  vec2 off = vec2(radius) / vec2(800.0, 600.0); // normalized approx; resolution-independent is expensive here
  vec4 c = texture2D(tex, uv) * 4.0;
  c += texture2D(tex, uv + vec2(off.x, 0.0));
  c += texture2D(tex, uv - vec2(off.x, 0.0));
  c += texture2D(tex, uv + vec2(0.0, off.y));
  c += texture2D(tex, uv - vec2(0.0, off.y));
  c /= 8.0;
  return c;
}

void main() {
  vec2 uv = vTexCoord;
  // subtle horizontal shimmer from existing shader
  uv.x += sin(uv.y * 100.0 + u_time) * 0.06;

  // blur radius ramps up near u_mix=0.5 to create a soft blending haze
  float blurScale = smoothstep(0.0, 0.5, abs(u_mix - 0.5) * 2.0);
  float radius0 = mix(0.0, 6.0, 1.0 - blurScale); // older image blurs more early
  float radius1 = mix(0.0, 6.0, blurScale);       // new image blurs more late

  vec4 c0 = sampleBlur(u_texture0, uv, radius0);
  vec4 c1 = sampleBlur(u_texture1, uv, radius1);

  // crossfade
  vec4 mixed = mix(c0, c1, u_mix);

  gl_FragColor = mixed;
}
`;

export function initBackground() {
  if (sketchInstance) return;

  sketchInstance = new p5((s) => {
    let waveShader;
    let img0, img1;
    let transitioning = false;
    let mixVal = 0;
    let transitionStart = 0;
    const TRANSITION_MS = 700;

    s.preload = () => {
      img0 = s.loadImage(pendingImageUrl);
      img1 = s.loadImage(pendingImageUrl); // initialize both
      waveShader = s.createShader(vert, frag);
    };

    s.setup = () => {
      s.createCanvas(s.windowWidth, s.windowHeight, s.WEBGL)
       .id('bg-canvas')
       .position(0, 0)
       .style('position', 'fixed')
       .style('top', '0')
       .style('left', '0')
       .style('z-index', '-100')
       .style('pointer-events', 'none');
      s.noStroke();
    };

    s.draw = () => {
      s.background(0);
      if (!waveShader || !img0 || !img1) return;

      // update transition mix if in progress
      if (transitioning) {
        const now = s.millis();
        const t = Math.min(1, (now - transitionStart) / TRANSITION_MS);
        // smooth ease in/out
        mixVal = t < 0.5 ? 2.0 * t * t : -1.0 + (4.0 - 2.0 * t) * t;
        if ((now - transitionStart) >= TRANSITION_MS) {
          // finish: promote img1 to img0
          img0 = img1;
          mixVal = 1;
          transitioning = false;
        }
      }

      s.shader(waveShader);
      waveShader.setUniform('u_texture0', img0);
      waveShader.setUniform('u_texture1', img1);
      waveShader.setUniform('u_time', s.millis() / 1000.0);
      waveShader.setUniform('u_mix', mixVal);

      s.beginShape(s.TRIANGLE_FAN);
      s.vertex(1, 1, 0, 0, 1); s.vertex(-1, 1, 0, 1, 1); s.vertex(-1, -1, 0, 1, 0); s.vertex(1, -1, 0, 0, 0);
      s.endShape();
    };

    s.windowResized = () => s.resizeCanvas(s.windowWidth, s.windowHeight);

    updateImageFn = (url) => {
      if (!url) return (pendingImageUrl = url);
      // Load into img1, start transition when loaded
      s.loadImage(url, (newImg) => {
        img1 = newImg;
        // start transition
        transitioning = true;
        transitionStart = s.millis();
        mixVal = 0;
      }, () => {
        // on error, just set pending url without transition
        pendingImageUrl = url;
      });
    };
  });
}

// updateBackgroundImage now triggers a crossfade + blur transition
export const updateBackgroundImage = (url) => updateImageFn ? updateImageFn(url) : (pendingImageUrl = url);