precision mediump float;

uniform vec2 u_size;
uniform float u_drift;
uniform float u_hour;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float clouds(vec2 p) {
  float density = 0.0;
  float weight = 0.54;
  for (int layer = 0; layer < 4; ++layer) {
    density += weight * noise(p);
    p = mat2(1.82, 0.82, -0.82, 1.82) * p + 4.3;
    weight *= 0.48;
  }
  return density;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec2 p = vec2(uv.x * min(u_size.x / u_size.y, 7.0) * 0.80, uv.y * 1.85);
  vec2 wind = vec2(u_drift * 0.48, -u_drift * 0.09);

  // Broad bands fold at different speeds, with softer detail where they overlap.
  float farBank = clouds(p * 0.89 + vec2(4.0, 8.0) + wind * 0.34);
  vec2 folds = vec2(farBank, noise(p * 0.8 + vec2(2.1, 5.3) - wind * 0.53));
  vec2 nearPoint = p * 1.58 + folds * 2.26 + vec2(2.2, 0.8) + wind;
  float nearBank = clouds(nearPoint);
  float litSide = nearBank - clouds(nearPoint + vec2(0.20, -0.14));
  float shade = smoothstep(0.33, 0.57, nearBank);
  float rim = smoothstep(-0.02, 0.17, litSide);

  float daylight = smoothstep(5.5, 9.0, u_hour) * (1.0 - smoothstep(16.5, 20.5, u_hour));
  float dawn = 1.0 - smoothstep(0.3, 2.6, abs(u_hour - 6.5));
  float dusk = 1.0 - smoothstep(0.3, 2.6, abs(u_hour - 19.0));
  float horizon = 1.0 - smoothstep(0.04, 0.92, uv.y);
  float dawnLight = dawn * (0.70 - 0.30 * uv.x) * (0.42 + 0.58 * horizon);
  float duskLight = dusk * smoothstep(0.10, 0.94, uv.x) * (0.40 + 0.60 * horizon);
  vec3 sky = mix(vec3(0.05, 0.075, 0.14), vec3(0.13, 0.27, 0.39), daylight);
  sky += mix(vec3(0.045, 0.05, 0.10), vec3(0.09, 0.12, 0.14), daylight) * horizon;
  sky += vec3(0.06, 0.06, 0.09) * smoothstep(0.30, 0.76, farBank);
  vec3 shadow = mix(vec3(0.075, 0.095, 0.16), vec3(0.15, 0.26, 0.36), daylight);
  vec3 silver = mix(vec3(0.25, 0.29, 0.38), vec3(0.45, 0.52, 0.58), daylight);
  vec3 cloud = mix(shadow, silver, rim);
  vec3 color = mix(sky, cloud, shade * 0.92);
  color += (vec3(0.45, 0.30, 0.15) * dawnLight + vec3(0.54, 0.18, 0.10) * duskLight) *
    (0.54 + shade * rim * 0.44);
  // A little shade beneath the title keeps its contrast on the bright daytime sky.
  color *= mix(0.66, 1.0, smoothstep(0.0, 0.72, uv.x));
  color += (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.018;
  gl_FragColor = vec4(color, 1.0);
}
