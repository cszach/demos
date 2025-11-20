const BG_IMAGE_URL =
  "https://images.unsplash.com/photo-1541359927273-d76820fc43f9?w=1920";

const glassShaderCode = `
struct Attributes {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
};

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  canvas_size: vec2f,
  size: vec2f,
  mouse: vec2f,
  blur_radius_px: f32,
  corner_radius_px: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var bg_tex: texture_2d<f32>;
@group(0) @binding(2) var bg_sampler: sampler;

@vertex
fn vs_main(a: Attributes) -> Varyings {
  var v: Varyings;

  let scale = vec2f(u.size / u.canvas_size) * 2.;

  let mouse_clip = vec2f(
    (u.mouse.x / u.canvas_size.x) * 2. - 1.,
    1. - (u.mouse.y / u.canvas_size.y) * 2.
  );

  let local = a.position;
  let world = local * scale + mouse_clip;

  v.position = vec4f(world, 0., 1.);
  v.uv = a.uv;

  return v;
}

@fragment
fn fs_main(v: Varyings) -> @location(0) vec4f {
  let frag_coord = v.position.xy;

  let canvas_uv = frag_coord / u.canvas_size;

  let dims = textureDimensions(bg_tex);
  let image_aspect = f32(dims.x) / f32(dims.y);
  let canvas_aspect = u.canvas_size.x / u.canvas_size.y;

  var scale = vec2f(1.0, 1.0);

  if (image_aspect > canvas_aspect) {
    scale.x = canvas_aspect / image_aspect;
  } else {
    scale.y = image_aspect / canvas_aspect;
  }

  let centered = canvas_uv - vec2f(.5);
  let base_uv = centered * scale + vec2f(.5);

  let half_size = u.size * .5;
  let corner = clamp(u.corner_radius_px, 0.0, min(half_size.x, half_size.y));

  // Rounded rectangle SDF in pixel space.

  let p = frag_coord - u.mouse;
  let q = abs(p) - (half_size - vec2f(corner, corner));
  let outside = max(q, vec2f(0.));
  let inside = min(max(q.x, q.y), 0.);
  let dist = length(outside) + inside - corner;

  let base = textureSample(
    bg_tex,
    bg_sampler,
    clamp(base_uv, vec2f(0.), vec2f(1.))
  );

  let blur_px = clamp(u.blur_radius_px, 0., 20.);
  let blur = i32(blur_px);

  if (blur == 0) {
    return base;
  }

  let texel = scale / u.canvas_size;

  let sigma = max(blur_px * .5, .001);

  var acc = vec3f(0.);
  var weighted_sum = 0.;

  var ix = -blur;

  loop {
    if (ix > blur) { break; }

    var iy = -blur;

    loop {
      if (iy > blur) { break; }

      let offset_px = vec2f(f32(ix), f32(iy));
      let d = length(offset_px);

      // Gaussian weight: exp(-0.5 * (d/sigma)^2)
      let w = exp(-.5 * (d * d) / (sigma * sigma));

      let offset_uv = offset_px * texel;
      let sample_uv = base_uv + offset_uv;
      let uv = clamp(sample_uv, vec2f(0.), vec2f(1.));

      let s = textureSample(bg_tex, bg_sampler, uv).rgb;

      acc += s * w;
      weighted_sum += w;

      iy = iy + 1;
    }

    ix = ix + 1;
  }

  let blurred = acc / weighted_sum;

  let mask = select(0., 1., dist < 0.);
  var final_rgb = mix(base.rgb, blurred, mask);

  let edge_width_px = 2.;
  let edge_band = 1. - smoothstep(0., edge_width_px, abs(dist));
  let edge_mask = edge_band * mask;

  let edge_color = vec3f(1.);
  let edge_intensity = .35;

  final_rgb = mix(final_rgb, edge_color, edge_mask * edge_intensity);

  return vec4f(final_rgb, 1.);
}
`;

const copyShaderCode = `
struct Attributes {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
};

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  canvas_size: vec2f,
  size: vec2f,
  mouse: vec2f,
  blur_radius_px: f32,
  corner_radius_px: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var bg_tex: texture_2d<f32>;
@group(0) @binding(2) var bg_sampler: sampler;

@vertex
fn vs_copy(a: Attributes) -> Varyings {
  var v: Varyings;

  v.position = vec4f(a.position, 0., 1.);
  v.uv = a.uv;

  return v;
}

@fragment
fn fs_copy(v: Varyings) -> @location(0) vec4f {
  let frag_coord = v.position.xy;
  let canvas_uv = frag_coord / u.canvas_size;

  let dims = textureDimensions(bg_tex);
  let image_aspect = f32(dims.x) / f32(dims.y);
  let canvas_aspect = u.canvas_size.x / u.canvas_size.y;

  var scale = vec2f(1.);

  if (image_aspect > canvas_aspect) {
    scale.x = canvas_aspect / image_aspect;
  } else {
    scale.y = image_aspect / canvas_aspect;
  }

  let centered = canvas_uv - vec2f(.5);
  let uv = centered * scale + vec2f(.5);

  return textureSample(bg_tex, bg_sampler, clamp(uv, vec2f(0.), vec2f(1.)));
}
`;

// prettier-ignore
const backgroundVB = [
  -1,  3, 0, -1,
   3, -1, 2,  1,
  -1, -1, 0,  1
];

// prettier-ignore
const glassVB = [
  -0.5,  0.5, 0, 0,
   0.5,  0.5, 0, 1,
   0.5, -0.5, 1, 1,
  -0.5, -0.5, 1, 0,
];

const glassIB = [0, 3, 2, 0, 2, 1];

// prettier-ignore
const glassUB = [
  0, 0, 300, 300,
  0, 0, 8 / window.devicePixelRatio, 24 / window.devicePixelRatio,
];

async function loadTextureFromURL(device, url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;

  await img.decode();
  const bitmap = await createImageBitmap(img);

  const texture = device.createTexture({
    size: {
      width: bitmap.width,
      height: bitmap.height,
      depthOrArrayLayers: 1,
    },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_DST,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    { width: bitmap.width, height: bitmap.height },
  );

  bitmap.close();

  return texture;
}

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

  const backgroundVBGPU = device.createBuffer({
    size: backgroundVB.length * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  const backgroundVBF32 = new Float32Array(backgroundVBGPU.getMappedRange());

  backgroundVBF32.set(backgroundVB);

  backgroundVBGPU.unmap();

  let backgroundTexture = await loadTextureFromURL(device, BG_IMAGE_URL);
  let backgroundTextureView = backgroundTexture.createView();

  const backgroundSampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
  });

  const glassShaderModule = device.createShaderModule({
    code: glassShaderCode,
  });

  const glassVBGPU = device.createBuffer({
    size: glassVB.length * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  const glassVBF32 = new Float32Array(glassVBGPU.getMappedRange());

  glassVBF32.set(glassVB);
  glassVBGPU.unmap();

  const glassIBGPU = device.createBuffer({
    size: glassIB.length * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  const glassIBF32 = new Uint32Array(glassIBGPU.getMappedRange());

  glassIBF32.set(glassIB);
  glassIBGPU.unmap();

  const glassUBGPU = device.createBuffer({
    size: glassUB.length * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const glassUBF32 = new Float32Array(glassUB);

  const glassBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {},
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
    ],
  });

  const glassBindGroup = device.createBindGroup({
    layout: glassBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: glassUBGPU,
      },
      {
        binding: 1,
        resource: backgroundTextureView,
      },
      {
        binding: 2,
        resource: backgroundSampler,
      },
    ],
  });

  const glassPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [glassBindGroupLayout],
  });

  const glassPipelineGPU = device.createRenderPipeline({
    layout: glassPipelineLayout,
    vertex: {
      module: glassShaderModule,
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            {
              format: "float32x2",
              offset: 0,
              shaderLocation: 0,
            },
            {
              format: "float32x2",
              offset: 8,
              shaderLocation: 1,
            },
          ],
        },
      ],
    },
    fragment: {
      module: glassShaderModule,
      targets: [
        {
          format: canvasFormat,
        },
      ],
    },
  });

  const copyShaderModule = device.createShaderModule({
    code: copyShaderCode,
  });

  const copyPipelineGPU = device.createRenderPipeline({
    layout: glassPipelineLayout,
    vertex: {
      module: copyShaderModule,
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { format: "float32x2", offset: 0, shaderLocation: 0 },
            { format: "float32x2", offset: 8, shaderLocation: 1 },
          ],
        },
      ],
    },
    fragment: {
      module: copyShaderModule,
      targets: [{ format: canvasFormat }],
    },
  });

  const stats = new Stats();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);

  function frame() {
    stats.begin();

    const commandEncoder = device.createCommandEncoder();
    const swapView = context.getCurrentTexture().createView();

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: swapView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setVertexBuffer(0, backgroundVBGPU);
    pass.setPipeline(copyPipelineGPU);
    pass.setBindGroup(0, glassBindGroup);
    pass.draw(3);

    pass.setVertexBuffer(0, glassVBGPU);
    pass.setIndexBuffer(glassIBGPU, "uint32");
    pass.setPipeline(glassPipelineGPU);
    pass.setBindGroup(0, glassBindGroup);
    pass.drawIndexed(6);

    pass.end();

    device.queue.submit([commandEncoder.finish()]);

    stats.end();

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

        glassUBF32[0] = canvas.clientWidth;
        glassUBF32[1] = canvas.clientHeight;

        device.queue.writeBuffer(glassUBGPU, 0, glassUBF32);
      }
    }
  });

  resizeObserver.observe(canvas);

  canvas.addEventListener("mousemove", (event) => {
    glassUBF32[4] = event.clientX;
    glassUBF32[5] = event.clientY;

    device.queue.writeBuffer(glassUBGPU, 0, glassUBF32);
  });
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
