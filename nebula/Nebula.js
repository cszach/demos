const NebulaShape = ({
  radius,
  ovalX,
  ovalY,
  falloff,
  turbulence,
  zSpread = 0.5,
}) => {
  const r = Math.pow(Math.random(), falloff) * radius;

  const t = Math.random() * Math.PI * 2;

  let x = Math.cos(t) * r * ovalX;
  let y = Math.sin(t) * r * ovalY;

  x += (Math.random() * 2 - 1) * turbulence * r;
  y += (Math.random() * 2 - 1) * turbulence * r;

  const zBase = Math.pow(Math.random(), falloff) * radius * zSpread;
  const z = (Math.random() * 2 - 1) * zBase;

  return {
    x,
    y,
    z,
  };
};

const FibonacciSphere = (
  { radius = 1, jitter = 0.0 } = {},
  index = 0,
  count = 1,
) => {
  const increment = Math.PI * (3 - Math.sqrt(5));
  const offset = 2 / count;
  const y = index * offset - 1 + offset / 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = (index % count) * increment;
  let x = Math.cos(phi) * r;
  let z = Math.sin(phi) * r;

  x *= radius;
  const yy = y * radius;
  z *= radius;

  if (jitter > 0) {
    x += (Math.random() * 2 - 1) * jitter;
    const jitterY = (Math.random() * 2 - 1) * jitter;
    const jitterZ = (Math.random() * 2 - 1) * jitter;

    return { x, y: yy + jitterY, z: z + jitterZ };
  }

  return { x, y: yy, z };
};

const Torus = (
  { major = 250, minor = 80, radialJitter = 0.2, tubularJitter = 0.4 } = {},
  index = 0,
  count = 1,
) => {
  // distribute around major circle by index
  const u = (index / count) * Math.PI * 2;
  // angle around tube
  const v = Math.random() * Math.PI * 2;

  // base positions
  const x = (major + minor * Math.cos(v)) * Math.cos(u);
  const y = (major + minor * Math.cos(v)) * Math.sin(u);
  const z = minor * Math.sin(v);

  // jitter/scatter for painterly look
  const jx = (Math.random() * 2 - 1) * radialJitter * minor;
  const jy = (Math.random() * 2 - 1) * radialJitter * minor;
  const jz = (Math.random() * 2 - 1) * tubularJitter * minor;

  return { x: x + jx, y: y + jy, z: z + jz };
};

const SpiralGalaxy = (
  {
    radius = 400,
    arms = 3,
    spin = 2.5,
    armSpread = 0.25,
    fuzz = 0.6,
    inclinationDeg = 0, // pitch: 0 => no tilt, 90 => edge-on
    yawDeg = 0,
  } = {},
  index = 0,
  count = 1,
) => {
  const t = index / count; // 0..1
  const r = Math.pow(t, 0.6) * radius;
  const arm = index % arms;
  const baseAngle = (arm / arms) * Math.PI * 2;
  const angle = baseAngle + (r / radius) * spin * Math.PI * 2;
  const radialNoise = (Math.random() * 2 - 1) * armSpread * r;
  const jitterX = (Math.random() * 2 - 1) * fuzz * 30;
  const jitterY = (Math.random() - 0.5) * fuzz * 30;
  const jitterZ = (Math.random() * 2 - 1) * fuzz * 30;

  let x = Math.cos(angle) * (r + radialNoise) + jitterX;
  let y = (Math.random() - 0.5) * 40 + jitterY;
  let z = Math.sin(angle) * (r + radialNoise) + jitterZ;

  const rotated = rotateYawPitch({ x, y, z }, yawDeg, inclinationDeg);
  return rotated;
};

const SphericalShell = (
  { radius = 350, thickness = 0.12, jitter = 0.5 } = {},
  index = 0,
  count = 1,
) => {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const sq = Math.sqrt(1 - u * u);
  let x = sq * Math.cos(theta);
  let y = sq * Math.sin(theta);
  let z = u;

  const r = radius * (1 - thickness * Math.random());

  x = x * r + (Math.random() * 2 - 1) * jitter * 20;
  y = y * r + (Math.random() * 2 - 1) * jitter * 20;
  z = z * r + (Math.random() * 2 - 1) * jitter * 20;

  return { x, y, z };
};

const DiscPlume = (
  {
    radius = 400,
    falloff = 2.0,
    spiral = 0.0,
    jitter = 0.4,
    inclinationDeg = 0,
    yawDeg = 0,
  } = {},
  index = 0,
  count = 1,
) => {
  const r = Math.pow(Math.random(), falloff) * radius;
  const baseAngle = Math.random() * Math.PI * 2;
  const angle = baseAngle + (r / radius) * spiral;

  let x = Math.cos(angle) * r;
  let y = (Math.random() * 2 - 1) * (radius * 0.02); // nearly flat disc
  let z = Math.sin(angle) * r;

  // soft jitter
  x += (Math.random() * 2 - 1) * jitter * r * 0.15;
  z += (Math.random() * 2 - 1) * jitter * r * 0.15;

  const rotated = rotateYawPitch({ x, y, z }, yawDeg, inclinationDeg);
  return rotated;
};

function rotateYawPitch({ x, y, z }, yawDeg = 0, pitchDeg = 0) {
  const yaw = (yawDeg * Math.PI) / 180.0;
  const pitch = (pitchDeg * Math.PI) / 180.0;

  // yaw (around Y)
  const cosy = Math.cos(yaw);
  const siny = Math.sin(yaw);
  const x1 = x * cosy - z * siny;
  const z1 = x * siny + z * cosy;
  const y1 = y;

  // pitch (around X)
  const cosp = Math.cos(pitch);
  const sinp = Math.sin(pitch);
  const y2 = y1 * cosp - z1 * sinp;
  const z2 = y1 * sinp + z1 * cosp;

  return { x: x1, y: y2, z: z2 };
}

class Nebula {
  constructor(options = {}) {
    this.particles = [];
    this.needsUpdate = true;

    const { sizeMin = 20, sizeMax = 100 } = options;

    this.sizeMin = sizeMin;
    this.sizeMax = sizeMax;
  }

  create(count, shape = NebulaShape, shapeConfig = DEFAULT_NEBULA_CONFIG) {
    this.particles = [];

    for (let i = 0; i < count; i++) {
      const { x, y, z = 0 } = shape(shapeConfig, i, count);

      const w = this.sizeMin + Math.random() * (this.sizeMax - this.sizeMin);
      const h = this.sizeMin + Math.random() * (this.sizeMax - this.sizeMin);

      const r = Math.random();
      const g = Math.random();
      const b = Math.random();
      const a = 1.0;

      this.particles.push([x, y, z, w, h, r, g, b, a]);
    }

    this.needsUpdate = true;
  }

  clear() {
    this.particles.length = 0;
    this.needsUpdate = true;
  }
}
