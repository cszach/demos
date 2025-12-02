const shaderCode = `
struct Attributes {
  @location(0) position: vec3f,
  @location(1) size: vec2f,
  @location(2) color: vec4f,
};

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) v_color: vec4f,  // pass to fragment
  @location(1) v_depthFactor: f32,
};

struct Uniforms {
  resolution: vec2f, // pixel width, height
  radius: f32,       // world radius used for mapping
  time: f32,         // seconds
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(a: Attributes,
           @builtin(vertex_index) vertex_idx: u32,
           @builtin(instance_index) instance_idx: u32) -> Varyings {
  var v: Varyings;

  let quad = array(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );

  let angle = u.time * 0.6; // rotation speed (radians/sec)
  let c = cos(angle);
  let s = sin(angle);

  let world = a.position;
  // rotate x/z
  let rx = c * world.x + s * world.z;
  let rz = -s * world.x + c * world.z;
  let ry = world.y;

  let rotated = vec3f(rx, ry, rz);

  // rotated.z ranges roughly ~[-radius, +radius]; map to [0.6, 1.2]
  let depthNorm = (rotated.z / (u.radius)); // ~[-1,1]
  let depthFactor = clamp(1.0 - 0.5 * depthNorm, 0.4, 1.6);

  let phase = f32(instance_idx) * 0.12;
  let twinkle = 0.6 + 0.4 * (0.5 + 0.5 * sin(u.time * 3.0 + phase));

  let instanceSize = a.size * depthFactor * twinkle;

  // compute a single pixels-per-world-unit scale using the smaller canvas dimension
  let minDim = min(u.resolution.x, u.resolution.y);
  let scale = minDim / (2.0 * u.radius); // pixels per world unit (same for x and y)

  let center = u.resolution * 0.5;

  let pixelXY = rotated.xy * scale + center;

  let quadOffset = quad[vertex_idx] * instanceSize;

  let posPixels = pixelXY + quadOffset;

  let ndc = (posPixels / u.resolution) * 2.0 - vec2f(1.0, 1.0);

  v.position = vec4f(ndc, 0.0, 1.0);
  v.v_color = a.color;
  v.v_depthFactor = depthFactor;

  return v;
}

@fragment
fn fs_main(v: Varyings) -> @location(0) vec4f {
  return v.v_color;
}
`;

async function setup() {
  const canvas = document.querySelector("canvas");

  if (!canvas) {
    throw new Error("Canvas not found.");
  }

  if (!navigator.gpu) {
    throw new Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter({
    featureLevel: "compatibility",
    powerPreference: "high-performance",
  });

  if (!adapter) {
    throw new Error("Couldn't request WebGPU adapter.");
  }

  const neededFeatures = ["core-features-and-limits"];
  const requiredFeatures = [];

  for (const feature of neededFeatures) {
    if (adapter.features.has(feature)) {
      requiredFeatures.push(feature);
    }
  }

  const device = await adapter.requestDevice({
    requiredFeatures,
  });

  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
  });

  const initialRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.5;

  const uniformsBuffer = new Float32Array([
    canvas.width,
    canvas.height,
    initialRadius,
    0.0,
  ]);

  const uniformsBufferGPU = device.createBuffer({
    size: uniformsBuffer.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(uniformsBufferGPU, 0, uniformsBuffer);

  const gui = new GUI();

  const shaderModule = device.createShaderModule({
    code: shaderCode,
  });

  const nebula = new Nebula({ sizeMin: 1, sizeMax: 3 });

  let vertexBufferGPU = null;

  function createAndUploadVertexBuffer(floatArray) {
    const byteLength = floatArray.byteLength;

    const buf = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    const mapped = new Float32Array(buf.getMappedRange());
    mapped.set(floatArray);
    buf.unmap();

    vertexBufferGPU = buf;
  }

  const shapeNames = {
    NebulaShape: "NebulaShape",
    FibonacciSphere: "FibonacciSphere",
    Torus: "Torus",
    SpiralGalaxy: "SpiralGalaxy",
    SphericalShell: "SphericalShell",
    DiscPlume: "DiscPlume",
  };

  const shapeConfigs = {
    NebulaShape: {
      radius: 400,
      ovalX: 1,
      ovalY: 1,
      falloff: 2.5,
      turbulence: 0.3,
      zSpread: 1,
    },
    FibonacciSphere: {
      radius: 400,
      jitter: 50,
    },
    Torus: {
      major: 250,
      minor: 80,
      radialJitter: 0.2,
      tubularJitter: 0.4,
    },
    SpiralGalaxy: {
      radius: 400,
      arms: 3,
      spin: 2.5,
      armSpread: 0.25,
      fuzz: 0.6,
      inclinationDeg: -20,
      yawDeg: 0,
    },
    SphericalShell: {
      radius: 350,
      thickness: 0.12,
      jitter: 0.5,
    },
    DiscPlume: {
      radius: 400,
      falloff: 2.0,
      spiral: 0.0,
      jitter: 0.4,
      inclinationDeg: -20,
      yawDeg: 0,
    },
  };

  const guiState = {
    shape: "FibonacciSphere",
    count: 10000,
    regenerate: () => regenerateParticles(),
  };

  function buildVertexFloatArrayFromParticles() {
    const flat = new Float32Array(nebula.particles.length * 9);

    for (let i = 0; i < nebula.particles.length; i++) {
      const p = nebula.particles[i];
      const base = i * 9;

      flat[base + 0] = p[0];
      flat[base + 1] = p[1];
      flat[base + 2] = p[2];
      flat[base + 3] = p[3];
      flat[base + 4] = p[4];
      flat[base + 5] = p[5];
      flat[base + 6] = p[6];
      flat[base + 7] = p[7];
      flat[base + 8] = p[8];
    }
    return flat;
  }

  function regenerateParticles() {
    const shape = guiState.shape;

    // map the shape string to the actual function defined in Nebula.js
    let shapeFn;
    if (shape === "NebulaShape") shapeFn = NebulaShape;
    else if (shape === "FibonacciSphere") shapeFn = FibonacciSphere;
    else if (shape === "Torus") shapeFn = Torus;
    else if (shape === "SpiralGalaxy") shapeFn = SpiralGalaxy;
    else if (shape === "SphericalShell") shapeFn = SphericalShell;
    else if (shape === "DiscPlume") shapeFn = DiscPlume;
    else shapeFn = NebulaShape; // fallback

    const cfg = shapeConfigs[shape];

    nebula.create(guiState.count, shapeFn, cfg);

    const floatArray = buildVertexFloatArrayFromParticles();
    createAndUploadVertexBuffer(floatArray);

    // OPTIONAL: if uniformsBuffer exists, update shader radius to match shape's radius
    // (keeps projection/depth consistent)
    if (
      typeof uniformsBuffer !== "undefined" &&
      typeof uniformsBufferGPU !== "undefined"
    ) {
      if (cfg && typeof cfg.radius === "number") {
        uniformsBuffer[2] = cfg.radius;
        device.queue.writeBuffer(uniformsBufferGPU, 0, uniformsBuffer);
      }
    }
  }

  regenerateParticles();

  const shapeFolder = gui.addFolder("Shape Controls");
  shapeFolder
    .add(guiState, "shape", [
      shapeNames.FibonacciSphere,
      shapeNames.NebulaShape,
      shapeNames.Torus,
      shapeNames.SpiralGalaxy,
      shapeNames.SphericalShell,
      shapeNames.DiscPlume,
    ])
    .name("Shape")
    .onChange((val) => {
      updateFolderVisibility(val);
      regenerateParticles();
    });

  shapeFolder
    .add(guiState, "count", 100, 20000, 100)
    .name("Particle Count")
    .onChange(() => {
      regenerateParticles();
    });

  shapeFolder.add(guiState, "regenerate").name("Regenerate");

  const nebulaFolder = gui.addFolder("NebulaShape");
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "radius", 10, 2000)
    .onChange(() => regenerateParticles());
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "ovalX", 0.1, 3)
    .onChange(() => regenerateParticles());
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "ovalY", 0.1, 3)
    .onChange(() => regenerateParticles());
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "falloff", 0.1, 10)
    .onChange(() => regenerateParticles());
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "turbulence", 0, 2)
    .onChange(() => regenerateParticles());
  nebulaFolder
    .add(shapeConfigs.NebulaShape, "zSpread", 0, 2)
    .onChange(() => regenerateParticles());

  const fiboFolder = gui.addFolder("FibonacciSphere");
  fiboFolder
    .add(shapeConfigs.FibonacciSphere, "radius", 1, 2000)
    .onChange(() => regenerateParticles());
  fiboFolder
    .add(shapeConfigs.FibonacciSphere, "jitter", 0, 200)
    .onChange(() => regenerateParticles());

  const torusFolder = gui.addFolder("Torus");
  torusFolder
    .add(shapeConfigs.Torus, "major", 10, 800)
    .onChange(() => regenerateParticles());
  torusFolder
    .add(shapeConfigs.Torus, "minor", 1, 400)
    .onChange(() => regenerateParticles());
  torusFolder
    .add(shapeConfigs.Torus, "radialJitter", 0, 1)
    .onChange(() => regenerateParticles());
  torusFolder
    .add(shapeConfigs.Torus, "tubularJitter", 0, 1)
    .onChange(() => regenerateParticles());

  const galaxyFolder = gui.addFolder("SpiralGalaxy");
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "radius", 10, 1200)
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "arms", 1, 8, 1)
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "spin", 0, 6)
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "armSpread", 0, 1)
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "fuzz", 0, 2)
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "inclinationDeg", -90, 90, 1)
    .name("Inclination°")
    .onChange(() => regenerateParticles());
  galaxyFolder
    .add(shapeConfigs.SpiralGalaxy, "yawDeg", -180, 180, 1)
    .name("Yaw°")
    .onChange(() => regenerateParticles());

  const shellFolder = gui.addFolder("SphericalShell");
  shellFolder
    .add(shapeConfigs.SphericalShell, "radius", 10, 1200)
    .onChange(() => regenerateParticles());
  shellFolder
    .add(shapeConfigs.SphericalShell, "thickness", 0, 1)
    .onChange(() => regenerateParticles());
  shellFolder
    .add(shapeConfigs.SphericalShell, "jitter", 0, 2)
    .onChange(() => regenerateParticles());

  const discFolder = gui.addFolder("DiscPlume");
  discFolder
    .add(shapeConfigs.DiscPlume, "radius", 10, 1200)
    .onChange(() => regenerateParticles());
  discFolder
    .add(shapeConfigs.DiscPlume, "falloff", 0.1, 5)
    .onChange(() => regenerateParticles());
  discFolder
    .add(shapeConfigs.DiscPlume, "spiral", -6.0, 6.0)
    .onChange(() => regenerateParticles());
  discFolder
    .add(shapeConfigs.DiscPlume, "jitter", 0, 1)
    .onChange(() => regenerateParticles());
  discFolder
    .add(shapeConfigs.DiscPlume, "inclinationDeg", -90, 90, 1)
    .name("Inclination°")
    .onChange(() => regenerateParticles());
  discFolder
    .add(shapeConfigs.DiscPlume, "yawDeg", -180, 180, 1)
    .name("Yaw°")
    .onChange(() => regenerateParticles());

  function updateFolderVisibility(selectedShape) {
    const mapping = {
      NebulaShape: nebulaFolder,
      FibonacciSphere: fiboFolder,
      Torus: torusFolder,
      SpiralGalaxy: galaxyFolder,
      SphericalShell: shellFolder,
      DiscPlume: discFolder,
    };

    // hide all
    for (const key in mapping) {
      const folder = mapping[key];
      if (!folder) continue;
      if (folder.domElement) folder.domElement.style.display = "none";
    }

    // show selected
    const show = mapping[selectedShape];
    if (show?.domElement) show.domElement.style.display = "";
  }

  updateFolderVisibility(guiState.shape);

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: {},
      },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: uniformsBufferGPU,
      },
    ],
  });

  const pipelineGPU = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      buffers: [
        {
          arrayStride: 36,
          stepMode: "instance",
          attributes: [
            {
              format: "float32x3",
              offset: 0,
              shaderLocation: 0,
            },
            {
              format: "float32x2",
              offset: 12,
              shaderLocation: 1,
            },
            {
              format: "float32x4",
              offset: 20,
              shaderLocation: 2,
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      targets: [
        {
          format: canvasFormat,
        },
      ],
    },
  });

  function frame() {
    const t = performance.now() * 0.0005;
    uniformsBuffer[3] = t;
    device.queue.writeBuffer(uniformsBufferGPU, 0, uniformsBuffer);

    const commandEncoder = device.createCommandEncoder();

    const renderPassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    if (!vertexBufferGPU) {
      renderPassEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
      window.requestAnimationFrame(frame);
      return;
    }

    renderPassEncoder.setVertexBuffer(0, vertexBufferGPU);
    renderPassEncoder.setBindGroup(0, bindGroup);
    renderPassEncoder.setPipeline(pipelineGPU);

    const instanceCount = nebula.particles.length;

    if (instanceCount > 0) {
      renderPassEncoder.draw(6, instanceCount, 0, 0);
    }

    renderPassEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === canvas) {
        canvas.width = canvas.clientWidth * window.devicePixelRatio;
        canvas.height = canvas.clientHeight * window.devicePixelRatio;

        context.configure({
          device,
          format: canvasFormat,
        });

        uniformsBuffer[0] = canvas.clientWidth;
        uniformsBuffer[1] = canvas.clientHeight;
        uniformsBuffer[2] = Math.min(canvas.width, canvas.height) * 0.5;

        device.queue.writeBuffer(uniformsBufferGPU, 0, uniformsBuffer);
      }
    }
  });

  resizeObserver.observe(canvas);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await setup();
  } catch (e) {
    if (e instanceof Error) {
      alert(e.message);
    }
  }
});
